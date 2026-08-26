import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { crearOperacionParaReserva, cargarDetalleServicio, mensajeAdmin, getConfig } from '@/lib/operaciones';
import { enviarWhatsapp } from '@/lib/whatsapp';
import { enviarCorreo } from '@/lib/email';
import {
  fechaHoraRecogida, calcularPoliticaCancelacion, esNoShowAplicable, type Lugar,
} from '@/lib/cancelacion';
import { procesarPagoConfirmado } from '@/lib/contabilidad';
import { procesarRecompensaReferido } from '@/lib/referidos';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const reserva = db.prepare(`
    SELECT r.*, v.propietario_id FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    WHERE r.id = ?
  `).get(Number(id)) as Record<string, unknown> | undefined;

  if (!reserva) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Ruta compartida (admin / propietario del vehículo / arrendatario). A la rama de
  // administración se le exige además la sección "reservas": sin ella, un admin no
  // puede confirmar, cancelar ni marcar pagos aunque escriba la URL a mano.
  if (user.rol === 'admin') {
    if (!adminTieneArea(db, user.id, 'reservas')) return sinPermisoArea();
  } else {
    const canUpdate =
      (user.rol === 'propietario' && Number(reserva.propietario_id) === user.id) ||
      (user.rol === 'usuario' && Number(reserva.usuario_id) === user.id);
    if (!canUpdate) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  if (body.marcar_no_show === true && user.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede marcar no-show' }, { status: 403 });
  }

  type ReservaConLugar = { fecha_inicio: string; recogida: string; total: number; estado: string; usuario_id: number };
  const reservaFull = db.prepare('SELECT fecha_inicio, recogida, total, estado, usuario_id FROM reservas WHERE id = ?')
    .get(Number(id)) as ReservaConLugar | undefined;

  let recogidaLugar: Lugar = {};
  try { recogidaLugar = JSON.parse(reservaFull?.recogida || '{}'); } catch { recogidaLugar = {}; }
  const pickup = reservaFull ? fechaHoraRecogida(reservaFull.fecha_inicio, recogidaLugar) : null;

  // ── Marcar no-show (solo admin, solo si ya pasó la ventana de gracia) ──
  if (user.rol === 'admin' && body.marcar_no_show === true) {
    if (!reservaFull || !pickup) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!['confirmada', 'en_curso'].includes(reservaFull.estado)) {
      return NextResponse.json({ error: 'Esta reserva no está en un estado que permita marcar no-show.' }, { status: 400 });
    }
    if (!esNoShowAplicable(pickup)) {
      return NextResponse.json({ error: 'Todavía no se cumplen las 3 horas de gracia tras la hora de recogida.' }, { status: 400 });
    }
    const motivo = `El cliente no se presentó — pasadas 3h de la hora de recogida (${pickup.toLocaleString('es-CO')}). Se cobra 100% del total.`;
    db.prepare(`
      UPDATE reservas SET estado = 'cancelada', no_show = 1, cancelacion_pct = 100,
        cancelacion_motivo = ?, cancelado_en = datetime('now', 'localtime') WHERE id = ?
    `).run(motivo, Number(id));

    const dest = db.prepare('SELECT correo, nombre FROM usuarios WHERE id = ?').get(reservaFull.usuario_id) as { correo: string; nombre: string } | undefined;
    if (dest) {
      await enviarCorreo(dest.correo, 'No-show en tu reserva RentDrive',
        `Hola ${dest.nombre.split(' ')[0]}, no te presentaste a recoger el vehículo dentro de las 3 horas de gracia tras la hora acordada. Según nuestra política, se cobra el 100% del total de la reserva ($${Number(reservaFull.total).toLocaleString('es-CO')}). El vehículo quedó disponible para otro alquiler.`);
    }
    return NextResponse.json({ ok: true, cancelacion_pct: 100, no_show: true });
  }

  const allowed = ['estado', 'pago_estado', 'fotos_antes', 'fotos_despues'];
  const updates = allowed.filter(f => body[f] !== undefined).map(f => `${f} = ?`).join(', ');
  const values = allowed.filter(f => body[f] !== undefined).map(f => body[f]);

  // ── El propio arrendatario cancela: la política (72h/50%) la calcula el servidor, no el cliente ──
  let politicaAplicada: { pct: number; motivo: string } | null = null;
  if (user.rol === 'usuario' && body.estado === 'cancelada' && pickup) {
    const politica = calcularPoliticaCancelacion(pickup);
    politicaAplicada = { pct: politica.pct, motivo: politica.motivo };
  }

  if (updates) {
    if (politicaAplicada) {
      db.prepare(`UPDATE reservas SET ${updates}, cancelacion_pct = ?, cancelacion_motivo = ?, cancelado_en = datetime('now', 'localtime') WHERE id = ?`)
        .run(...values, politicaAplicada.pct, politicaAplicada.motivo, Number(id));
    } else {
      db.prepare(`UPDATE reservas SET ${updates} WHERE id = ?`).run(...values, Number(id));
    }
  }

  // Al confirmarse el pago (nunca antes): factura + liquidación al propietario,
  // y si el cliente fue referido, la recompensa a quien lo invitó.
  // Aislado en try/catch — un fallo aquí no debe romper la confirmación del pago.
  if (reserva.pago_estado !== 'pagado' && body.pago_estado === 'pagado') {
    try {
      await procesarPagoConfirmado(db, Number(id));
    } catch (e) {
      console.error('[contabilidad] No se pudo procesar el pago confirmado:', e instanceof Error ? e.message : e);
    }
    try {
      procesarRecompensaReferido(db, Number(reserva.usuario_id), Number(id));
    } catch (e) {
      console.error('[referidos] No se pudo procesar la recompensa:', e instanceof Error ? e.message : e);
    }
  }

  if (politicaAplicada) {
    const det2 = db.prepare(`
      SELECT u.correo, u.nombre, v.marca, v.modelo FROM reservas r
      JOIN usuarios u ON r.usuario_id = u.id JOIN vehiculos v ON r.vehiculo_id = v.id WHERE r.id = ?
    `).get(Number(id)) as { correo: string; nombre: string; marca: string; modelo: string } | undefined;
    if (det2) {
      const montoCobrado = (Number(reservaFull?.total || 0) * politicaAplicada.pct) / 100;
      const cuerpo = politicaAplicada.pct > 0
        ? `Hola ${det2.nombre.split(' ')[0]}, confirmamos la cancelación de tu reserva del ${det2.marca} ${det2.modelo}. ${politicaAplicada.motivo} Monto a cobrar: $${montoCobrado.toLocaleString('es-CO')}.`
        : `Hola ${det2.nombre.split(' ')[0]}, confirmamos la cancelación de tu reserva del ${det2.marca} ${det2.modelo} sin ningún costo. ${politicaAplicada.motivo}`;
      await enviarCorreo(det2.correo, 'Cancelación de tu reserva RentDrive', cuerpo);
    }
  }

  // When admin approves or rejects, notify both usuario and propietario via chat
  if (user.rol === 'admin' && (body.estado === 'confirmada' || body.estado === 'cancelada')) {
    type ReservaDetalle = {
      usuario_id: number; propietario_id: number;
      fecha_inicio: string; fecha_fin: string;
      marca: string; modelo: string;
    };
    const det = db.prepare(`
      SELECT r.usuario_id, v.propietario_id, r.fecha_inicio, r.fecha_fin, v.marca, v.modelo
      FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id WHERE r.id = ?
    `).get(Number(id)) as ReservaDetalle | undefined;

    if (det) {
      const { usuario_id, propietario_id, fecha_inicio, fecha_fin, marca, modelo } = det;
      const motivo = body.motivo_rechazo ? ` Motivo: ${body.motivo_rechazo}` : '';
      const msg = body.estado === 'confirmada'
        ? `✅ Reserva aprobada: ${marca} ${modelo} del ${fecha_inicio} al ${fecha_fin}. ¡Todo listo!`
        : `❌ Reserva rechazada: ${marca} ${modelo} del ${fecha_inicio} al ${fecha_fin}.${motivo}`;

      let conv = db.prepare(
        'SELECT id FROM conversaciones WHERE propietario_id = ? AND usuario_id = ?'
      ).get(propietario_id, usuario_id) as { id: number } | undefined;

      if (!conv) {
        const ins = db.prepare(
          'INSERT INTO conversaciones (propietario_id, usuario_id) VALUES (?, ?)'
        ).run(propietario_id, usuario_id);
        conv = { id: Number(ins.lastInsertRowid) };
      }

      db.prepare(
        'INSERT INTO mensajes (conversacion_id, remitente_id, contenido) VALUES (?, ?, ?)'
      ).run(conv.id, user.id, msg);
    }
  }

  // Al CONFIRMAR: generar la operación logística (checklist) y avisar al administrador.
  // Aislado en try/catch para que un fallo aquí nunca rompa la confirmación de la reserva.
  if (user.rol === 'admin' && body.estado === 'confirmada') {
    try {
      const { creada, operacionId } = crearOperacionParaReserva(db, Number(id));
      if (creada) {
        const det = cargarDetalleServicio(db, Number(id));
        if (det) {
          // Notificación in-app a todos los administradores.
          const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin'").all() as { id: number }[];
          const titulo = '🚗 Nuevo servicio confirmado';
          const mensajeIn = `${det.marca} ${det.modelo} para ${det.usuario_nombre} (${det.fecha_inicio} → ${det.fecha_fin}). Asigna un mensajero en Operaciones.`;
          const insN = db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)');
          for (const a of admins) insN.run(a.id, 'operacion_nueva', titulo, mensajeIn, operacionId, 'operacion');

          // WhatsApp al administrador (si hay número configurado y el canal activo).
          const adminWa = getConfig(db, 'admin_whatsapp');
          const resultado = adminWa
            ? (await enviarWhatsapp(adminWa, mensajeAdmin(det))).detalle
            : 'no enviado: falta el WhatsApp del administrador (configúralo en Operaciones)';
          db.prepare('UPDATE operaciones SET wa_admin = ? WHERE id = ?').run(resultado, operacionId);
        }
      }
    } catch (e) {
      console.error('[operaciones] No se pudo crear la operación al confirmar:', e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, ...(politicaAplicada ? { cancelacion_pct: politicaAplicada.pct, cancelacion_motivo: politicaAplicada.motivo } : {}) });
}
