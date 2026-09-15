// Efectos de CONFIRMAR una reserva, compartidos por las dos vías que hoy la confirman:
//   · el admin aprueba una solicitud que llegó por la app → PUT /api/reservas/[id]
//   · el admin crea la reserva ya confirmada en el punto de atención → POST /api/admin/reservas
//
// Vive en su propio módulo (y no dentro de lib/operaciones.ts) para no crear un ciclo de
// imports: lib/db.ts importa lib/operaciones.ts (getConfig/setConfig) y lib/whatsapp.ts
// importa lib/db.ts, así que meter el envío de WhatsApp dentro de operaciones.ts cerraría
// el ciclo db → operaciones → whatsapp → db.
import type Database from 'better-sqlite3';
import { crearOperacionParaReserva, cargarDetalleServicio, mensajeAdmin, getConfig } from './operaciones';
import { enviarWhatsapp } from './whatsapp';

type DB = Database.Database;

/**
 * Crea la operación logística (checklist de lavar/tanquear/entregar/recibir/inspección)
 * y avisa al equipo: notificación in-app a todos los administradores + WhatsApp al número
 * del administrador si está configurado y el canal activo.
 *
 * Idempotente: `crearOperacionParaReserva` no duplica la operación si ya existe (devuelve
 * `creada: false`), y en ese caso no se vuelve a notificar.
 *
 * Nunca lanza: un fallo aquí no debe tumbar la confirmación de la reserva.
 */
export async function crearOperacionYNotificar(db: DB, reservaId: number): Promise<void> {
  try {
    const { creada, operacionId } = crearOperacionParaReserva(db, reservaId);
    if (!creada) return;

    const det = cargarDetalleServicio(db, reservaId);
    if (!det) return;

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
  } catch (e) {
    console.error('[operaciones] No se pudo crear la operación al confirmar:', e instanceof Error ? e.message : e);
  }
}

/**
 * Deja constancia en el chat propietario↔cliente de lo que pasó con la reserva
 * (aprobada / rechazada / confirmada en mostrador). Es también la forma en que el
 * propietario se entera de que su vehículo quedó alquilado.
 *
 * `remitenteId` es el admin que ejecuta la acción. Crea la conversación si no existía.
 */
export function avisarPorChat(db: DB, reservaId: number, remitenteId: number, mensaje: string): void {
  type ReservaDetalle = { usuario_id: number; propietario_id: number };
  const det = db.prepare(`
    SELECT r.usuario_id, v.propietario_id
    FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id WHERE r.id = ?
  `).get(reservaId) as ReservaDetalle | undefined;
  if (!det) return;

  let conv = db.prepare(
    'SELECT id FROM conversaciones WHERE propietario_id = ? AND usuario_id = ?'
  ).get(det.propietario_id, det.usuario_id) as { id: number } | undefined;

  if (!conv) {
    const ins = db.prepare(
      'INSERT INTO conversaciones (propietario_id, usuario_id) VALUES (?, ?)'
    ).run(det.propietario_id, det.usuario_id);
    conv = { id: Number(ins.lastInsertRowid) };
  }

  db.prepare(
    'INSERT INTO mensajes (conversacion_id, remitente_id, contenido) VALUES (?, ?, ?)'
  ).run(conv.id, remitenteId, mensaje);
}
