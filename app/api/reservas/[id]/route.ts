import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { crearOperacionYNotificar, avisarPorChat } from '@/lib/reserva-confirmacion';
import { enviarCorreo } from '@/lib/email';
import {
  fechaHoraRecogida, calcularPoliticaCancelacion, esNoShowAplicable, type Lugar,
} from '@/lib/cancelacion';
import { procesarPagoConfirmado } from '@/lib/contabilidad';
import { procesarRecompensaReferido } from '@/lib/referidos';
import { anularTransaccion } from '@/lib/pagos';
import { documentarOperacionConfirmada, bloqueoParaEntregar } from '@/lib/contratos-operacion';
import { nivelDe } from '@/lib/permisos';

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

  // ── Qué puede escribir cada rol ───────────────────────────────────────────
  //
  // ⚠️ CRÍTICO: `pago_estado` refleja el cobro real (Wompi al crear la reserva desde
  // la web, el webhook, o la anulación de abajo) — nunca un valor que mande el
  // cliente. Que un administrador escriba `pago_estado: 'pagado'` a mano sigue
  // existiendo para las reservas de mostrador (pago en efectivo/transferencia/
  // datafono, sin pasarela) y ES el registro de que el pago entró: dispara la
  // factura, la liquidación al propietario, la recompensa del referido y la
  // creación de la operación logística (el carro sale a la calle).
  // Antes, `estado` y `pago_estado` estaban en una sola lista `allowed` común a todos
  // los roles, así que el propio arrendatario —o el propietario del vehículo— podía
  // hacer PUT {estado:'confirmada', pago_estado:'pagado'} sobre su propia reserva y
  // darse por aprobado sin que nadie cobrara nada. El chequeo de rol que hay más
  // abajo (`user.rol === 'admin' && body.estado === 'confirmada'`) solo condiciona el
  // aviso y la operación; el UPDATE ya había ocurrido.
  //
  // Ahora los estados se validan por ROL, no solo el campo:
  //   · admin  → cualquier estado válido de la reserva y del pago;
  //   · usuario (el arrendatario) y propietario → SOLO 'cancelada' sobre su propia
  //     reserva. Cancelar es lo único que la interfaz les ofrece (el modal de
  //     cancelación del dashboard), y la política 72h/50% la sigue calculando el
  //     servidor.
  // `pago_estado` y las columnas de fotos quedan reservadas al administrador.
  const ESTADOS_RESERVA = ['pendiente', 'confirmada', 'en_curso', 'completada', 'cancelada'];
  const ESTADOS_PAGO = ['pendiente', 'pagado', 'cancelado'];
  const ESTADOS_POR_ROL: Record<string, readonly string[]> = {
    admin: ESTADOS_RESERVA,
    propietario: ['cancelada'],
    usuario: ['cancelada'],
  };

  if (body.estado !== undefined) {
    const permitidos = ESTADOS_POR_ROL[user.rol] ?? [];
    if (!ESTADOS_RESERVA.includes(body.estado)) {
      return NextResponse.json({ error: 'Estado de reserva inválido' }, { status: 400 });
    }
    if (!permitidos.includes(body.estado)) {
      return NextResponse.json(
        { error: 'Solo un administrador puede cambiar la reserva a ese estado. Desde tu cuenta solo puedes cancelarla.' },
        { status: 403 },
      );
    }

    // Entregar el vehículo con los papeles de la operación sin firmar es exactamente lo
    // que esos documentos existen para evitar. Se comprueba en el SERVIDOR y no solo en
    // el botón del panel: la transición no tenía ninguna validación previa —ni pago, ni
    // operación creada, ni contrato— y bastaba un PUT para saltársela.
    //
    // Solo las firmas de SUSCRIPCIÓN. Las del acta se recogen en la entrega y en la
    // devolución, que son después; exigirlas aquí impediría entregar el vehículo por no
    // tener firmada su propia devolución.
    if (body.estado === 'en_curso') {
      const bloqueo = bloqueoParaEntregar(db, Number(id));
      if (bloqueo) {
        return NextResponse.json({
          error: bloqueo.motivo,
          codigo: 'firmas_pendientes',
          pendientes: bloqueo.pendientes,
        }, { status: 409 });
      }
    }
  }
  if (body.pago_estado !== undefined) {
    if (user.rol !== 'admin') {
      return NextResponse.json({ error: 'Solo un administrador puede registrar el estado del pago' }, { status: 403 });
    }
    if (!ESTADOS_PAGO.includes(body.pago_estado)) {
      return NextResponse.json({ error: 'Estado de pago inválido' }, { status: 400 });
    }
  }

  const allowed = user.rol === 'admin'
    ? ['estado', 'pago_estado', 'fotos_antes', 'fotos_despues']
    : ['estado'];
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

  // Al RECHAZAR (admin) una reserva que ya se había cobrado EN LÍNEA con Wompi
  // (nace con wompi_transaccion_id, ver app/api/reservas/route.ts), intentamos
  // reversar el cobro en la pasarela. Si la reversa falla (p. ej. fuera de la
  // ventana permitida), dejamos pago_estado como estaba y el admin debe reembolsar
  // manualmente. No aplica a reservas de mostrador (sin wompi_transaccion_id): esas
  // se pagan en efectivo/transferencia/datafono y no hay nada que reversar acá.
  const anulacion: { intentada: boolean; ok: boolean } = { intentada: false, ok: false };
  if (user.rol === 'admin' && body.estado === 'cancelada' && reserva.pago_estado === 'pagado' && reserva.wompi_transaccion_id) {
    anulacion.intentada = true;
    try {
      await anularTransaccion(String(reserva.wompi_transaccion_id));
      db.prepare(`UPDATE reservas SET pago_estado = 'cancelado' WHERE id = ?`).run(Number(id));
      anulacion.ok = true;
    } catch (e) {
      console.error('[pagos] No se pudo anular el cobro al rechazar la reserva:', e instanceof Error ? e.message : e);
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
      const { fecha_inicio, fecha_fin, marca, modelo } = det;
      const motivo = body.motivo_rechazo ? ` Motivo: ${body.motivo_rechazo}` : '';
      const msg = body.estado === 'confirmada'
        ? `✅ Reserva aprobada: ${marca} ${modelo} del ${fecha_inicio} al ${fecha_fin}. ¡Todo listo!`
        : `❌ Reserva rechazada: ${marca} ${modelo} del ${fecha_inicio} al ${fecha_fin}.${motivo}`;
      avisarPorChat(db, Number(id), user.id, msg);
    }
  }

  // Al CONFIRMAR: generar la operación logística (checklist) y avisar al administrador.
  // Aislado dentro del helper (try/catch propio) para que un fallo aquí nunca rompa la
  // confirmación de la reserva. Mismo helper que usa la reserva de mostrador
  // (POST /api/admin/reservas), para que ambas vías creen la operación igual.
  if (user.rol === 'admin' && body.estado === 'confirmada') {
    await crearOperacionYNotificar(db, Number(id));

    // Y los CUATRO documentos de la operación: los dos marcos —si el vehículo o este
    // cliente todavía no los tienen— y los dos otrosíes encadenados a ellos. La
    // sociedad suscribe sus bloques con el sello institucional; a propietario y cliente
    // les queda su firma, y cada uno recibe el aviso en SU campana.
    //
    // Antes esto lo hacía una persona desde el panel, uno por uno. La emisión manual
    // sigue existiendo como respaldo (POST /api/contratos), para reemitir un documento
    // anulado. Es idempotente: reconfirmar no duplica nada.
    //
    // No revierte la confirmación si falla: la reserva ya está cobrada, y quedarse sin
    // reserva por no poder emitir un papel sería peor que emitirlo un minuto después.
    documentarOperacionConfirmada(db, Number(id), {
      id: user.id, nombre: user.nombre, correo: user.correo,
      nivel: nivelDe(db, user.id) || 'admin',
    });
  }

  return NextResponse.json({
    ok: true,
    ...(politicaAplicada ? { cancelacion_pct: politicaAplicada.pct, cancelacion_motivo: politicaAplicada.motivo } : {}),
    ...(anulacion.intentada ? { pago_anulado: anulacion.ok } : {}),
  });
}
