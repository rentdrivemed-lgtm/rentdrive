// Cuentas de cobro (remisiones) del propietario autenticado: listarlas y firmarlas.
// La firma es un requisito PREVIO al pago — ver lib/contabilidad.ts → firmarCuentaCobro
// y app/api/contabilidad/liquidaciones/route.ts (el PUT que marca como pagado la rechaza
// si la remisión de esa reserva no está firmada).
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { firmarCuentaCobro, datosEmpresa, parsearConceptosJson, verificarHashRemision, resellarFirmaHeredada, FIRMA_IMAGEN_MAX_CHARS_TOTAL, type RemisionRow, type ConceptoSnapshot } from '@/lib/contabilidad';
import { registrarAuditoria } from '@/lib/permisos';
import { ipCliente } from '@/lib/limite-tasa';

export const dynamic = 'force-dynamic';

// Fila firmable: tanto `remisiones` como `remisiones_anuladas` tienen estas columnas.
type FilaSellada = Parameters<typeof verificarHashRemision>[0] & { firmada_en: string };

// Verifica el sello de integridad de una cuenta ya firmada. Se hace también aquí —no solo
// al pagar— para que una manipulación se vea en el panel del propietario (que es quien
// puede reclamar) y no solo cuando el admin intente transferir.
function veredicto(db: ReturnType<typeof getDb>, tabla: 'remisiones' | 'remisiones_anuladas', r: FilaSellada & { id: number }): { ok: boolean; alg: string; motivo: string } {
  const v = verificarHashRemision(r);
  // Migración perezosa del sello heredado: si verificó con v1, se vuelve a sellar con el
  // HMAC v2 aquí mismo. Ver lib/contabilidad.ts → resellarFirmaHeredada.
  if (v.ok && v.alg === 'v1') resellarFirmaHeredada(db, tabla, r.id, r);
  return { ok: v.ok, alg: v.alg, motivo: v.motivo };
}

// Quita el sello del objeto que se manda al cliente (no aporta nada y no hay razón para
// publicar el MAC de integridad).
function sinSello<T extends { firma_hash?: string }>(r: T): Omit<T, 'firma_hash'> {
  const copia = { ...r };
  delete copia.firma_hash;
  return copia;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (user.rol !== 'propietario') return NextResponse.json({ error: 'Solo propietarios pueden ver sus cuentas de cobro.' }, { status: 403 });

  const db = getDb();
  // Solo las del propietario autenticado — nunca las de otro (filtro por propietario_id, no admin).
  // Se cruza con `liquidaciones` para saber si el pago sigue pendiente: una remisión vieja
  // (de antes de existir este requisito) cuya liquidación YA se pagó no debe aparecer como
  // "pendiente de firma" — sería confuso pedirle al propietario que autorice un pago que ya
  // se hizo. Esas quedan fuera de ambas listas (no son accionables ni una firma real).
  const remisiones = db.prepare(`
    SELECT rem.*, COALESCE(l.estado, 'pendiente') AS liquidacion_estado
    FROM remisiones rem
    LEFT JOIN liquidaciones l ON l.reserva_id = rem.reserva_id
    WHERE rem.propietario_id = ?
    ORDER BY rem.created_at DESC
  `).all(user.id) as Array<RemisionRow & { liquidacion_estado: string }>;

  // El desglose se entrega ya parseado: el propietario tiene que VER línea por línea qué
  // firma (bruto, comisión y cada descuento/adicional con su concepto), no solo un neto.
  // `firma_hash` NO sale en la respuesta: es el sello interno de integridad, al propietario
  // le sirve el veredicto (`integridad`), no el MAC.
  const conDesglose = remisiones.map(r => ({
    ...sinSello(r),
    // Siempre un entero: el cliente la reenvía al firmar y ahora es obligatoria.
    version: Number(r.version) || 1,
    conceptos: parsearConceptosJson(r.conceptos_json) as ConceptoSnapshot[],
    integridad: r.firmada_en ? veredicto(db, 'remisiones', r) : null,
  }));

  const pendientes = conDesglose.filter(r => !r.firmada_en && r.liquidacion_estado === 'pendiente');
  const firmadas = conDesglose.filter(r => !!r.firmada_en);

  // Cuentas de cobro que el propietario firmó y que luego quedaron ANULADAS porque la
  // liquidación se editó. Se le muestran igual: es la constancia de qué autorizó y cuándo,
  // y evita la sensación de que "le cambiaron el papel y desapareció el anterior".
  const anuladas = (db.prepare(`
    SELECT * FROM remisiones_anuladas WHERE propietario_id = ? ORDER BY anulada_en DESC
  `).all(user.id) as Array<Omit<RemisionRow, 'created_at'> & { motivo_anulacion: string; anulada_en: string; emitida_en: string }>)
    // `created_at`: la tabla de anuladas guarda la fecha de emisión original en `emitida_en`
    // (su `anulada_en` es otra cosa). Se expone con el mismo nombre que el resto de cuentas
    // para que el PDF imprima la fecha correcta sin ramas especiales.
    .map(r => ({
      ...sinSello(r), created_at: r.emitida_en, version: Number(r.version) || 1,
      conceptos: parsearConceptosJson(r.conceptos_json) as ConceptoSnapshot[],
      integridad: r.firmada_en ? veredicto(db, 'remisiones_anuladas', r) : null,
    }));

  // Datos de la empresa (nombre/NIT) para armar el PDF en el cliente — no es sensible
  // (ya sale impreso en todas las facturas/remisiones) y evita exponer /api/config
  // (solo-admin) a cuentas de propietario.
  return NextResponse.json({ pendientes, firmadas, anuladas, empresa: datosEmpresa(db) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (user.rol !== 'propietario') return NextResponse.json({ error: 'Solo propietarios pueden firmar cuentas de cobro.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { remision_id?: number; firma_imagen?: string; nombre_confirmado?: string; version?: number };
  const remisionId = Number(body.remision_id);
  if (!Number.isInteger(remisionId) || remisionId <= 0) return NextResponse.json({ error: 'Falta remision_id' }, { status: 400 });
  // La versión del documento es OBLIGATORIA. Era opcional, así que bastaba con no mandarla
  // para saltarse el chequeo de "esta cuenta cambió mientras la revisabas" y firmar a ciegas
  // un monto reemitido que el propietario nunca vio.
  const version = Number(body.version);
  if (!Number.isInteger(version) || version <= 0) {
    return NextResponse.json({ error: 'Falta la versión de la cuenta de cobro. Recarga la página e inténtalo de nuevo.' }, { status: 400 });
  }
  const nombreConfirmado = (body.nombre_confirmado || '').trim();
  if (!nombreConfirmado) return NextResponse.json({ error: 'Debes escribir tu nombre completo para confirmar la firma.' }, { status: 400 });
  // Defensa en profundidad: la validación real (forma de imagen, prefijo exacto, tamaño
  // máximo) vive en firmarCuentaCobro (fuente de verdad); esto solo evita un round-trip
  // innecesario a la DB cuando ni siquiera llegó algo con pinta de firma, o cuando es
  // obviamente descomunal (rechazo barato por longitud de cadena, sin decodificar nada).
  const firmaImagen = (body.firma_imagen || '').trim();
  if (!firmaImagen) return NextResponse.json({ error: 'Falta el trazo de la firma.' }, { status: 400 });
  if (firmaImagen.length > FIRMA_IMAGEN_MAX_CHARS_TOTAL) return NextResponse.json({ error: 'La imagen de la firma es demasiado pesada.' }, { status: 400 });

  const db = getDb();
  const resultado = firmarCuentaCobro(db, remisionId, user.id, {
    firmaImagen,
    nombreConfirmado,
    ip: ipCliente(req),
    userAgent: req.headers.get('user-agent') || '',
    // Versión del documento que el propietario tenía en pantalla: si la liquidación se
    // editó mientras tanto (reemisión), la firma se rechaza en vez de quedar cubriendo
    // un monto que nunca vio.
    version,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  // Bitácora: aunque no es una acción de admin, reutilizamos el mismo mecanismo de
  // auditoría (la tabla/columna `usuario_nivel` es texto libre, no exige un AdminNivel) —
  // deja constancia de quién firmó, cuándo y con qué IP/monto quedó congelado.
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel: 'propietario' }, {
    area: 'contabilidad', accion: 'firmar_cuenta_cobro', entidad: 'remision', entidad_id: remisionId,
    detalle: `Firmó la cuenta de cobro ${resultado.remision.numero} · neto $${resultado.remision.neto.toLocaleString('es-CO')} · IP ${ipCliente(req)}`,
  });

  return NextResponse.json({ ok: true, remision: sinSello(resultado.remision) });
}
