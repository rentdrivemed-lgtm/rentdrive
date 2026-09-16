// GET /api/perfil/paquete → .zip con los documentos de QUIEN PIDE, y de nadie más.
// GET /api/perfil/paquete?info=1 → solo el conteo.
//
// El propietario tiene derecho a llevarse su propia carpeta: su cédula, su
// certificado bancario, y de cada carro suyo la tarjeta de propiedad, el SOAT, la
// tecno-mecánica y la carátula de la póliza que expide DrivePass. Un cliente, sus
// documentos de identidad y licencia.
//
// ── Por qué es una ruta aparte y no `/api/admin/usuarios/<id>/paquete` ──────
// Porque así no hay ningún id en la petición. El paquete se arma SIEMPRE con
// `user.id` de la sesión: no existe el parámetro que habría que validar, y por lo
// tanto no existe el IDOR. Un propietario no puede pedir el paquete de otro
// propietario ni el de un cliente por esta vía, ni cambiando nada del request. La
// ruta del equipo (área `usuarios`, hoy `principal` y `socio`) es la otra y exige
// rol admin.
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { registrarAuditoria } from '@/lib/permisos';
import { consumirIntento } from '@/lib/limite-tasa';
import {
  listarDocumentosPersona, construirPaquete, fechaHoraColombia,
  tomarTurnoPaquete, liberarTurnoPaquete, cuerpoZip, ERROR_OCUPADO,
  MAX_ARCHIVOS, MAX_CONTRATOS,
} from '@/lib/paquete-documentos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Tope por persona y por hora. Más bajo que el del equipo: una persona descarga su
 * carpeta una vez, no veinte. Sirve sobre todo para que una cuenta comprometida no
 * pueda usar esta ruta para golpear el CDN en bucle.
 */
const MAX_DESCARGAS_HORA = 6;
const HORA_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  // `user.id` de la sesión, nunca un id del request. Es todo el control de acceso
  // que necesita esta ruta.
  const lista = listarDocumentosPersona(db, user.id);
  if (!lista) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  // Estado de la cuenta, releído de la BD en esta misma consulta. `getCurrentUser` solo valida
  // la FIRMA del token, que dura 7 días: una cuenta suspendida (por fraude, por una disputa o
  // porque se archivó al eliminarla) seguiría exportando en bloque todos sus documentos durante
  // una semana con la sesión que ya tenía. Aplica también a `?info=1`: si la cuenta no está
  // activa, esta ruta no responde nada.
  if (lista.persona.estado_cuenta !== 'activa') {
    return NextResponse.json(
      { error: 'Tu cuenta no está activa. Escríbenos para poder darte tus documentos.' },
      { status: 403 },
    );
  }

  if (req.nextUrl.searchParams.get('info') === '1') {
    return NextResponse.json({
      archivos: lista.documentos.length,
      vehiculos: lista.vehiculos,
      reservas: lista.reservas,
      excedentes: lista.excedentes.length,
      contratos: lista.contratos.length,
      contratos_excedentes: lista.contratosExcedentes.length,
      max_archivos: MAX_ARCHIVOS,
      max_contratos: MAX_CONTRATOS,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Los contratos cuentan: se puede no tener ni una foto subida y sí tener contratos
  // digitales firmados, y ese paquete sí tiene sentido.
  if (lista.documentos.length === 0 && lista.contratos.length === 0) {
    return NextResponse.json({ error: 'Todavía no tienes documentos cargados.' }, { status: 404 });
  }


  // Mismo semáforo global que la ruta del equipo: el zip se arma entero en memoria y los topes
  // por hora no limitan la concurrencia (ver lib/paquete-documentos.ts).
  if (!tomarTurnoPaquete()) {
    return NextResponse.json({ error: ERROR_OCUPADO }, { status: 503, headers: { 'Retry-After': '20' } });
  }

  const espera = consumirIntento(`paquete-docs-propio:${user.id}`, MAX_DESCARGAS_HORA, HORA_MS);
  if (espera !== null) {
    liberarTurnoPaquete(); // el 503/429 no puede dejar el cupo tomado
    return NextResponse.json(
      { error: `Ya descargaste tu paquete varias veces seguidas. Intenta de nuevo en ${Math.ceil(espera / 60)} minuto(s).` },
      { status: 429 },
    );
  }

  const { fechaISO, fechaHora } = fechaHoraColombia();
  let paquete;
  try {
    paquete = await construirPaquete(lista, {
      generadoPor: `${user.nombre} (${user.correo}) — su propio paquete`,
      fechaHora,
      fechaISO,
      // `db` va en el contexto porque los CONTRATOS no se descargan de ningún lado: se
      // generan leyendo su texto congelado (lib/contrato-pdf.ts).
      db,
    });
  } catch (e) {
    console.error('[paquete-documentos] no se pudo armar el zip propio:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No pudimos armar el paquete. Intenta de nuevo.' }, { status: 500 });
  } finally {
    liberarTurnoPaquete();
  }

  // También se audita: aunque la persona se lleve lo suyo, el registro sirve para
  // reconstruir qué salió y cuándo si después hay una disputa o una cuenta robada.
  // `nivel` va vacío a propósito — quien descarga acá no es del equipo.
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo }, {
    area: 'usuarios',
    accion: 'descargar_paquete_documentos_propio',
    entidad: 'usuario',
    entidad_id: user.id,
    detalle: JSON.stringify({
      rol: user.rol,
      archivos: paquete.incluidos,
      omitidos: paquete.omitidos.length,
      bytes: paquete.bytes,
    }),
  });

  // Vista sobre el mismo buffer, sin copiar los bytes (ver `cuerpoZip`).
  return new NextResponse(cuerpoZip(paquete.zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${paquete.nombreArchivo}"`,
      'Content-Length': String(paquete.zip.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
