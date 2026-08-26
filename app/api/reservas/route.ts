import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { calcularRecargo, lugarValido, type Lugar } from '@/lib/lugares';
import { enviarCorreo } from '@/lib/email';
import { generarCotizacion } from '@/lib/contabilidad';
import { consumirCreditos } from '@/lib/referidos';
import { MIN_NOCHES_RESERVA } from '@/lib/disponibilidad-reglas';
import { validarDireccion } from '@/lib/validacion';

export const dynamic = 'force-dynamic';

type ReservaRow = {
  id: number; vehiculo_id: number; usuario_id: number;
  marca: string; modelo: string; anio: number; tipo: string; precio_dia: number;
  propietario_id: number; usuario_nombre: string; usuario_correo: string;
  propietario_nombre: string; fecha_inicio: string; fecha_fin: string;
  total: number; estado: string; pago_estado: string;
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const vehiculoId   = searchParams.get('vehiculoId');
  const estado       = searchParams.get('estado');
  const pagoEstado   = searchParams.get('pagoEstado');
  const fechaDesde   = searchParams.get('fechaDesde');
  const fechaHasta   = searchParams.get('fechaHasta');
  const busqueda     = searchParams.get('busqueda');

  let query = `
    SELECT r.*,
      v.marca, v.modelo, v.anio, v.tipo, v.precio_dia,
      v.propietario_id,
      u.nombre  AS usuario_nombre,
      u.correo  AS usuario_correo,
      p.nombre  AS propietario_nombre
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios  u ON r.usuario_id  = u.id
    JOIN usuarios  p ON v.propietario_id = p.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (user.rol === 'usuario') {
    query += ' AND r.usuario_id = ?';
    params.push(user.id);
  } else if (user.rol === 'propietario') {
    query += ' AND v.propietario_id = ?';
    params.push(user.id);
  }

  if (vehiculoId)  { query += ' AND r.vehiculo_id = ?';         params.push(Number(vehiculoId)); }
  if (estado)      { query += ' AND r.estado = ?';              params.push(estado); }
  if (pagoEstado)  { query += ' AND r.pago_estado = ?';         params.push(pagoEstado); }
  if (fechaDesde)  { query += ' AND r.fecha_inicio >= ?';       params.push(fechaDesde); }
  if (fechaHasta)  { query += ' AND r.fecha_fin   <= ?';        params.push(fechaHasta); }
  if (busqueda) {
    query += ' AND (v.marca LIKE ? OR v.modelo LIKE ? OR u.nombre LIKE ?)';
    const like = `%${busqueda}%`;
    params.push(like, like, like);
  }

  query += ' ORDER BY r.fecha_inicio DESC';

  const reservas = db.prepare(query).all(...params) as ReservaRow[];

  const stats = {
    total:       reservas.length,
    ingresos:    reservas
                   .filter(r => r.estado !== 'cancelada')
                   .reduce((s, r) => s + Number(r.total), 0),
    confirmadas: reservas.filter(r => r.estado === 'confirmada').length,
    completadas: reservas.filter(r => r.estado === 'completada').length,
    canceladas:  reservas.filter(r => r.estado === 'cancelada').length,
  };

  return NextResponse.json({ reservas, stats });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'usuario') {
    return NextResponse.json({ error: 'Solo usuarios pueden reservar' }, { status: 403 });
  }

  const {
    vehiculo_id, fecha_inicio, fecha_fin,
    documento_id_url, documento_id_url_dorso, documento_es_pasaporte,
    licencia_url, licencia_url_dorso,
    firma_contrato, recogida, entrega, usar_creditos,
    direccion, ciudad, emergencia_nombre, emergencia_tel,
  } = await req.json();
  if (!vehiculo_id || !fecha_inicio || !fecha_fin) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }
  const nochesSolicitadas = Math.ceil((new Date(fecha_fin).getTime() - new Date(fecha_inicio).getTime()) / 86400000);
  if (nochesSolicitadas < MIN_NOCHES_RESERVA) {
    return NextResponse.json({ error: `El alquiler mínimo es de ${MIN_NOCHES_RESERVA} noches.` }, { status: 400 });
  }
  if (!documento_id_url) return NextResponse.json({ error: 'Debes subir tu documento de identidad.' }, { status: 400 });
  if (!documento_es_pasaporte && !documento_id_url_dorso) return NextResponse.json({ error: 'Falta el dorso de tu documento de identidad.' }, { status: 400 });
  if (!licencia_url || !licencia_url_dorso) return NextResponse.json({ error: 'Debes subir frente y dorso de tu licencia de conducción.' }, { status: 400 });
  if (!firma_contrato) return NextResponse.json({ error: 'Debes aceptar el contrato.' }, { status: 400 });

  const db = getDb();

  // ── Datos de la operación que antes se pedían en el registro ──────────────
  // Se movieron acá para que crear la cuenta sea rápido: la dirección, la ciudad
  // y el contacto de emergencia solo hacen falta cuando de verdad hay un alquiler.
  // Solo se le piden a quien todavía no los tiene guardados (p. ej. de una reserva
  // anterior); si ya están en su perfil, se usan esos y no se vuelve a preguntar.
  const perfil = db.prepare(
    'SELECT direccion, ciudad, contacto_emergencia FROM usuarios WHERE id = ?'
  ).get(user.id) as { direccion: string | null; ciudad: string | null; contacto_emergencia: string | null } | undefined;

  let emergenciaGuardada: { nombre?: string; telefono?: string } = {};
  try { emergenciaGuardada = JSON.parse(perfil?.contacto_emergencia || '{}') || {}; } catch { emergenciaGuardada = {}; }

  const txt = (v: unknown) => String(v ?? '').trim();
  const direccionFinal = txt(perfil?.direccion) || txt(direccion);
  const ciudadFinal    = txt(perfil?.ciudad)    || txt(ciudad);
  const emNombreFinal  = txt(emergenciaGuardada.nombre)  || txt(emergencia_nombre);
  const emTelFinal     = (txt(emergenciaGuardada.telefono) || txt(emergencia_tel)).replace(/\D/g, '');

  const errDireccion = validarDireccion(direccionFinal);
  if (errDireccion) return NextResponse.json({ error: errDireccion }, { status: 400 });
  if (ciudadFinal.length < 3) return NextResponse.json({ error: 'Indica tu ciudad de residencia.' }, { status: 400 });
  if (emNombreFinal.length < 3) return NextResponse.json({ error: 'Indica el nombre de tu contacto de emergencia.' }, { status: 400 });
  if (emTelFinal.length < 7 || emTelFinal.length > 15) {
    return NextResponse.json({ error: 'Indica un teléfono válido para tu contacto de emergencia.' }, { status: 400 });
  }

  const recogidaL = recogida as Lugar | undefined;
  const entregaL  = entrega  as Lugar | undefined;
  if (!lugarValido(recogidaL)) return NextResponse.json({ error: 'Indica el lugar y la hora de recogida.' }, { status: 400 });
  if (!lugarValido(entregaL))  return NextResponse.json({ error: 'Indica el lugar y la hora de entrega.' }, { status: 400 });

  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ? AND disponible = 1').get(Number(vehiculo_id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'Vehículo no disponible' }, { status: 400 });

  const conflicto = db.prepare(`
    SELECT id FROM reservas
    WHERE vehiculo_id = ? AND estado NOT IN ('cancelada')
    AND NOT (fecha_fin < ? OR fecha_inicio > ?)
  `).get(Number(vehiculo_id), fecha_inicio, fecha_fin);
  if (conflicto) return NextResponse.json({ error: 'Vehículo no disponible en esas fechas' }, { status: 409 });

  const dispStr = (vehiculo.dias_disponibles as string) || '[]';
  let diasDisp: string[] = [];
  try { diasDisp = JSON.parse(dispStr); } catch { diasDisp = []; }

  if (diasDisp.length > 0) {
    const dispSet = new Set(diasDisp);
    const cur = new Date(fecha_inicio);
    const fin = new Date(fecha_fin);
    while (cur < fin) {
      const str = cur.toISOString().split('T')[0];
      if (!dispSet.has(str)) {
        return NextResponse.json({ error: `El día ${str} no está disponible` }, { status: 409 });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Se guardan en el perfil para no volver a pedirlos en la próxima reserva.
  db.prepare('UPDATE usuarios SET direccion = ?, ciudad = ?, contacto_emergencia = ? WHERE id = ?')
    .run(direccionFinal, ciudadFinal, JSON.stringify({ nombre: emNombreFinal, telefono: emTelFinal }), user.id);

  const dias = Math.ceil((new Date(fecha_fin).getTime() - new Date(fecha_inicio).getTime()) / (1000 * 60 * 60 * 24));
  const recargo = calcularRecargo(recogidaL, entregaL); // autoritativo: server-side
  const totalBruto = dias * Number(vehiculo.precio_dia) + recargo;

  // Créditos de referidos: se descuentan del servidor (nunca se confía en un monto
  // que mande el cliente), y solo hasta el saldo real disponible.
  const creditosUsados = usar_creditos ? consumirCreditos(db, user.id, totalBruto) : 0;
  const total = totalBruto - creditosUsados;

  const result = db.prepare(`
    INSERT INTO reservas (
      usuario_id, vehiculo_id, fecha_inicio, fecha_fin, total, pago_estado, estado,
      documento_id_url, documento_id_url_dorso, documento_es_pasaporte,
      licencia_url, licencia_url_dorso,
      firma_contrato, recogida, entrega, recargo, creditos_usados
    )
    VALUES (?, ?, ?, ?, ?, 'pendiente', 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, Number(vehiculo_id), fecha_inicio, fecha_fin, total,
    documento_id_url || '', documento_id_url_dorso || '', documento_es_pasaporte ? 1 : 0,
    licencia_url || '', licencia_url_dorso || '',
    firma_contrato || '{}',
    JSON.stringify(recogidaL), JSON.stringify(entregaL), recargo, creditosUsados,
  );

  try {
    await enviarCorreo(user.correo, 'Tu solicitud de reserva en RentDrive',
      `Hola ${user.nombre.split(' ')[0]}, recibimos tu solicitud de reserva del ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} ` +
      `del ${fecha_inicio} al ${fecha_fin} por $${total.toLocaleString('es-CO')}. Te avisamos apenas quede confirmada. ` +
      'Recuerda: cancelaciones con menos de 72h de anticipación tienen un cargo del 50%, y si no te presentas a la hora de recogida (con 3h de gracia) se cobra el 100%.');
  } catch (e) {
    console.error('[reservas] No se pudo enviar el correo de confirmación:', e instanceof Error ? e.message : e);
  }

  try {
    await generarCotizacion(db, Number(result.lastInsertRowid), true);
  } catch (e) {
    console.error('[contabilidad] No se pudo generar la cotización:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ id: result.lastInsertRowid, total, recargo, creditos_usados: creditosUsados }, { status: 201 });
}
