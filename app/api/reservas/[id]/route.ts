import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { crearOperacionParaReserva, cargarDetalleServicio, mensajeAdmin, getConfig } from '@/lib/operaciones';
import { enviarWhatsapp } from '@/lib/whatsapp';

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

  const canUpdate =
    user.rol === 'admin' ||
    (user.rol === 'propietario' && Number(reserva.propietario_id) === user.id) ||
    (user.rol === 'usuario' && Number(reserva.usuario_id) === user.id);

  if (!canUpdate) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const allowed = ['estado', 'pago_estado', 'fotos_antes', 'fotos_despues'];
  const updates = allowed.filter(f => body[f] !== undefined).map(f => `${f} = ?`).join(', ');
  const values = allowed.filter(f => body[f] !== undefined).map(f => body[f]);

  if (updates) {
    db.prepare(`UPDATE reservas SET ${updates} WHERE id = ?`).run(...values, Number(id));
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

  return NextResponse.json({ ok: true });
}
