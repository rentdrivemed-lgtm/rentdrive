// ── GET /api/documentos/<ambito>/<id>/<clave> ──────────────────────────────
//
// ÚNICA puerta por la que una pantalla obtiene un documento de identidad (cédula,
// licencia, certificado bancario, tarjeta de propiedad). El navegador nunca vuelve a
// recibir una dirección del CDN: pide esta ruta, el servidor comprueba la sesión y el
// permiso, deja el acceso en la bitácora y devuelve los bytes.
//
// POR QUÉ HACER DE INTERMEDIARIO Y NO MANDAR UNA URL FIRMADA.
// La firma de Cloudinary (`s--xxx--`) no caduca: es un HMAC del `public_id`, sin
// componente temporal. Los enlaces que SÍ caducan necesitan `auth_token`, que es una
// función del plan Advanced y hay que habilitarla en la cuenta. Con el plan actual,
// entregarle al navegador una URL firmada crearía otra vez un enlace permanente que
// abre el documento sin sesión y que no se puede revocar — exactamente el problema
// que se quiere cerrar. Sirviendo los bytes desde aquí no existe ninguna dirección
// compartible: sin la cookie de sesión correcta, esta ruta responde 401/403.
//
// Los documentos pesan poco (fotos de cédula, PDF de pocas páginas) y los abre el
// equipo, no el público: el coste de pasar por el servidor es despreciable frente a
// dejar de tener enlaces públicos eternos.
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { nivelDe } from '@/lib/permisos';
import { esAmbitoDocumento } from '@/lib/documentos-ref';
import { resolverDocumento, registrarAccesoDocumento, bytesDeDocumento } from '@/lib/documentos-acceso';
import { nombreDescargaDocumento } from '@/lib/documento-tipo';
import { tipoRealDocumento } from '@/lib/subida-imagen';
import { consumirIntento } from '@/lib/limite-tasa';

export const dynamic = 'force-dynamic';

// Tipos que el navegador puede abrir EN LÍNEA sin riesgo. Cualquier otro se fuerza a
// descarga con `application/octet-stream`.
//
// Esto es nuevo y es importante: hasta ahora los documentos se servían desde
// `res.cloudinary.com`, un origen ajeno; a partir de aquí salen del NUESTRO. Un
// archivo HTML/SVG servido en línea desde el propio dominio ejecutaría su script con
// la sesión del administrador que lo abre (XSS almacenado). Por eso: lista blanca
// corta, `nosniff` para que el navegador no adivine otro tipo, y `attachment` para
// todo lo demás. El SVG queda fuera a propósito — es XML con scripts.
const TIPOS_EN_LINEA = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
]);

function tipoDesdeNombre(url: string): string {
  const ext = (url.split('?')[0].split('#')[0].match(/\.([A-Za-z0-9]{2,8})$/)?.[1] || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  return '';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ambito: string; id: string; clave: string }> },
) {
  const { ambito, id, clave } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Inicia sesión para ver este documento.' }, { status: 401 });

  // Tope por sesión. No es la defensa principal (esa es el permiso), pero evita que
  // una cuenta cualquiera barra el rango de ids buscando 403 contra 404 a toda
  // velocidad, y acota el gasto de ancho de banda si alguien automatiza la descarga.
  // `consumirIntento` devuelve `null` cuando el intento SÍ está permitido, y los
  // segundos que faltan cuando ya se pasó del cupo (ver lib/limite-tasa.ts).
  const esperar = consumirIntento(`documento:${user.id}`, 400, 10 * 60_000);
  if (esperar !== null) {
    return NextResponse.json(
      { error: 'Demasiadas peticiones de documentos. Espera unos minutos.' },
      { status: 429, headers: { 'Retry-After': String(esperar) } },
    );
  }

  if (!esAmbitoDocumento(ambito)) {
    return NextResponse.json({ error: 'Referencia inválida.' }, { status: 400 });
  }
  const idNum = Number(id);
  const db = getDb();
  const res = resolverDocumento(db, user, ambito, idNum, clave);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.estado });

  const descargar = req.nextUrl.searchParams.get('descargar') === '1';

  // La bitácora se escribe ANTES de traer los bytes: si la descarga del storage
  // falla, el intento de acceso ya quedó registrado igual. Lo que interesa auditar
  // es quién pidió ver el documento de quién, no si el CDN respondió.
  registrarAccesoDocumento(
    db,
    { id: user.id, nombre: user.nombre, correo: user.correo, nivel: user.rol === 'admin' ? (nivelDe(db, user.id) || '') : user.rol },
    ambito, idNum, clave, res.titular, descargar ? 'descargar' : 'ver',
  );

  const traido = await bytesDeDocumento(res.url);
  if ('error' in traido) {
    return NextResponse.json({ error: traido.error }, { status: 502 });
  }

  // ── De qué tipo es ESTE archivo ───────────────────────────────────────────
  //
  // Los BYTES mandan, y en este proyecto son la única señal fiable para los PDF:
  //
  //   · el NOMBRE no sirve — `uploadFile` sube los PDF sin extensión a propósito
  //     (la cuenta de Cloudinary tiene restringida la entrega de archivos con
  //     `.pdf`: 401 con extensión, 200 sin ella — ver lib/storage.ts);
  //   · el CONTENT-TYPE de Cloudinary tampoco — los `raw` los entrega como
  //     `application/octet-stream`.
  //
  // Con solo esas dos señales, todo PDF caía fuera de `TIPOS_EN_LINEA`, se servía
  // como binario y el navegador lo descargaba en vez de mostrarlo. Era el «los sube
  // pero no los muestra» que se reportó. Se mira primero el contenido real y solo
  // se cae a las otras dos señales si los bytes no dicen nada reconocible.
  const tipoReal = tipoRealDocumento(traido.buffer);
  const tipoCrudo = (tipoReal || traido.contentType || tipoDesdeNombre(res.url) || '').toLowerCase();
  const enLinea = TIPOS_EN_LINEA.has(tipoCrudo);
  const contentType = enLinea ? tipoCrudo : 'application/octet-stream';
  const nombre = nombreDescargaDocumento(res.url, `${res.titular.nombre || ambito}-${clave}`);
  const disposicion = descargar || !enLinea ? 'attachment' : 'inline';

  return new NextResponse(new Uint8Array(traido.buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(traido.buffer.length),
      // `filename*` en UTF-8 por los nombres con tildes; `filename` ASCII de reserva.
      'Content-Disposition': `${disposicion}; filename="documento"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'X-Content-Type-Options': 'nosniff',
      // Documento personal: ni el navegador ni ningún intermediario deben guardarlo.
      // `no-store` es lo que evita que quede en la caché de disco de un equipo
      // compartido después de cerrar sesión.
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
