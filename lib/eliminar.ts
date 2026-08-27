// ─────────────────────────────────────────────────────────────────────────────
// "Eliminar inteligente" de usuarios y vehículos.
//
// Decisión de producto (Victor, ver tarea de referencia): eliminar SIEMPRE decide
// automáticamente entre borrado real y archivado reversible:
//   · Sin historial de negocio real  -> DELETE de verdad.
//   · Con historial de negocio real  -> se ARCHIVA (no se borra): desaparece de los
//     listados normales/públicos, pero la fila se conserva íntegra (facturas,
//     liquidaciones y cuentas de cobro YA FIRMADAS —remisiones.firmada_en— siguen
//     siendo consultables sin romper ningún JOIN). Es reversible.
//
// ── Criterio: qué cuenta como "historial" ───────────────────────────────────
// Se clasificó cada tabla que tiene una FK hacia usuarios(id) / vehiculos(id)
// (`grep REFERENCES usuarios(id)` / `REFERENCES vehiculos(id)` en lib/db.ts) en dos
// grupos:
//
//  1) HISTORIAL DE NEGOCIO REAL (bloquea el borrado, fuerza archivar): reservas,
//     vehículos publicados, remisiones/liquidaciones (dinero real), conversaciones/
//     mensajes de chat (evidencia de la relación propietario↔cliente), soporte,
//     referidos (créditos/recompensas reales), tarjetas NFC (activo ya producido con
//     visitas), avisos de WhatsApp enviados. Es la evidencia que un cliente,
//     propietario o el negocio podrían necesitar después.
//
//  2) METADATA PURAMENTE ADMINISTRATIVA/INTERNA (NO bloquea el borrado): quién
//     registró un gasto o un proveedor, quién creó/le asignaron una tarea del
//     equipo, un evento de calendario, un documento interno, un tablero o un
//     elemento de tablero, quién respondió un ticket de soporte como admin, y la
//     bitácora de auditoría (`auditoria.usuario_id` — instrucción explícita: la
//     auditoría nunca debe ser razón para bloquear un borrado). Son señales de
//     "quién operó el sistema", no evidencia de una relación de negocio con esa
//     persona. Casi todas estas columnas son NULLABLE y varias tienen su propio
//     campo de texto denormalizado (ej. `created_by_nombre`, `asignado_nombre`,
//     `subido_por_nombre`, o `auditoria.usuario_nombre/usuario_correo/usuario_nivel`)
//     así que desvincular la FK (poner NULL) no pierde esa información visible.
//     `notificaciones` es ephemeral (avisos ya leídos/expirados) y se borra sin más.
//
// Por diseño, esto es más permisivo para dar de baja una cuenta de EMPLEADO
// (admin/socio/secretaria) que solo usó el panel de control internamente, y mucho
// más conservador para un propietario/cliente con actividad real de la plataforma
// — tal como pidió el dueño.
//
// Defensa en profundidad: aun así, `eliminarUsuarioInteligente`/`eliminarVehiculoInteligente`
// intentan el DELETE real dentro de una transacción con `try/catch`; si SQLite
// rechaza el borrado por una FK que no anticipamos (`foreign_keys = ON`), el error
// se atrapa y se cae a archivar en vez de tumbar la petición — nunca al revés.
import type Database from 'better-sqlite3';

type DB = Database.Database;

export type ResultadoEliminar = 'borrado' | 'archivado';

// ── Usuarios ─────────────────────────────────────────────────────────────────

function existe(db: DB, sql: string, ...params: number[]): boolean {
  return !!db.prepare(`${sql} LIMIT 1`).get(...params);
}

/** ¿Este usuario tiene historial de negocio real que impida borrarlo de verdad? */
export function tieneHistorialUsuario(db: DB, usuarioId: number): boolean {
  const id = usuarioId;
  return (
    existe(db, 'SELECT 1 FROM vehiculos WHERE propietario_id = ?', id) ||
    existe(db, 'SELECT 1 FROM reservas WHERE usuario_id = ?', id) ||
    existe(db, 'SELECT 1 FROM remisiones WHERE propietario_id = ?', id) ||
    existe(db, 'SELECT 1 FROM liquidaciones WHERE propietario_id = ?', id) ||
    existe(db, 'SELECT 1 FROM conversaciones WHERE propietario_id = ? OR usuario_id = ?', id, id) ||
    existe(db, 'SELECT 1 FROM referidos WHERE referrer_id = ? OR referido_id = ?', id, id) ||
    existe(db, 'SELECT 1 FROM conversaciones_soporte WHERE solicitante_id = ?', id) ||
    existe(db, 'SELECT 1 FROM nfc_cards WHERE usuario_id = ?', id) ||
    existe(db, 'SELECT 1 FROM whatsapp_mensajes WHERE usuario_id = ?', id)
  );
}

/**
 * Desvincula (o borra, si es efímero) todo lo que es puramente administrativo antes
 * de un DELETE real de un usuario — para que ese DELETE no falle por una FK que no
 * cuenta como "historial de negocio" (ver comentario del módulo). Debe correr DENTRO
 * de la misma transacción que el DELETE.
 */
function desvincularMetadataAdministrativaUsuario(db: DB, usuarioId: number) {
  // Notificaciones: efímeras (avisos ya vistos), se borran con la cuenta.
  db.prepare('DELETE FROM notificaciones WHERE destinatario_id = ?').run(usuarioId);
  // Lecturas de chat: puntero de "último leído", sin valor si la cuenta ya no existe.
  db.prepare('DELETE FROM lecturas WHERE usuario_id = ?').run(usuarioId);
  // Resto: FKs nullable donde el texto relevante ya quedó denormalizado en la fila.
  db.prepare('UPDATE auditoria SET usuario_id = NULL WHERE usuario_id = ?').run(usuarioId);
  db.prepare('UPDATE gastos SET created_by = NULL WHERE created_by = ?').run(usuarioId);
  db.prepare('UPDATE proveedores SET created_by = NULL WHERE created_by = ?').run(usuarioId);
  db.prepare('UPDATE tareas_equipo SET created_by = NULL WHERE created_by = ?').run(usuarioId);
  db.prepare('UPDATE tareas_equipo SET asignado_id = NULL WHERE asignado_id = ?').run(usuarioId);
  db.prepare('UPDATE eventos_calendario SET created_by = NULL WHERE created_by = ?').run(usuarioId);
  db.prepare('UPDATE documentos_equipo SET subido_por = NULL WHERE subido_por = ?').run(usuarioId);
  db.prepare('UPDATE tableros SET created_by = NULL WHERE created_by = ?').run(usuarioId);
  db.prepare('UPDATE tablero_elementos SET created_by = NULL WHERE created_by = ?').run(usuarioId);
  // tablero_colaboradores.usuario_id es NOT NULL (no se puede desvincular a NULL): se borra la
  // invitación de este colaborador puntual, el tablero y sus demás colaboradores quedan intactos.
  db.prepare('DELETE FROM tablero_colaboradores WHERE usuario_id = ?').run(usuarioId);
  db.prepare('UPDATE nfc_cards SET created_by = NULL WHERE created_by = ?').run(usuarioId);
  db.prepare('UPDATE mensajes_soporte SET remitente_admin_id = NULL WHERE remitente_admin_id = ?').run(usuarioId);
}

/**
 * Elimina o archiva un usuario según tenga o no historial de negocio real.
 * Devuelve 'borrado' o 'archivado'. NO valida permisos/auth ni "no te elimines a ti
 * mismo" — eso es responsabilidad del endpoint que llama a esta función.
 */
export function eliminarUsuarioInteligente(db: DB, usuarioId: number): ResultadoEliminar {
  if (tieneHistorialUsuario(db, usuarioId)) {
    db.prepare("UPDATE usuarios SET estado_cuenta = 'archivada' WHERE id = ?").run(usuarioId);
    return 'archivado';
  }

  try {
    const borrar = db.transaction(() => {
      desvincularMetadataAdministrativaUsuario(db, usuarioId);
      db.prepare('DELETE FROM usuarios WHERE id = ?').run(usuarioId);
    });
    borrar();
    return 'borrado';
  } catch (e) {
    // Defensa en profundidad: si SQLite rechazó el DELETE por una FK que no
    // anticipamos (`foreign_keys = ON`), no tumbamos la petición — se archiva.
    console.error('[eliminar] DELETE de usuario falló, se archiva en su lugar:', e instanceof Error ? e.message : e);
    db.prepare("UPDATE usuarios SET estado_cuenta = 'archivada' WHERE id = ?").run(usuarioId);
    return 'archivado';
  }
}

// ── Vehículos ────────────────────────────────────────────────────────────────

/** ¿Este vehículo tiene reservas (historial de negocio real) que impidan borrarlo de verdad? */
export function tieneHistorialVehiculo(db: DB, vehiculoId: number): boolean {
  // reservas.vehiculo_id es la única FK "de negocio" real hacia vehiculos(id); remisiones,
  // liquidaciones y facturas cuelgan de la reserva (reserva_id), no directamente del vehículo,
  // así que quedan cubiertas transitivamente al bloquear cualquier vehículo con reservas.
  return existe(db, 'SELECT 1 FROM reservas WHERE vehiculo_id = ?', vehiculoId);
}

/**
 * Desvincula lo administrativo antes de un DELETE real de un vehículo. `cotizaciones`
 * es una herramienta de venta (cotización "suelta", ver lib/db.ts): su vínculo con
 * un vehículo del inventario es nullable y ya guarda `vehiculo_descripcion` como
 * texto libre de respaldo, así que desvincular no pierde información relevante.
 */
function desvincularMetadataAdministrativaVehiculo(db: DB, vehiculoId: number) {
  db.prepare('UPDATE cotizaciones SET vehiculo_id = NULL WHERE vehiculo_id = ?').run(vehiculoId);
}

/**
 * Elimina o archiva un vehículo según tenga o no historial de negocio real (reservas).
 * Devuelve 'borrado' o 'archivado'. NO valida permisos/pertenencia — responsabilidad
 * del endpoint que llama a esta función.
 */
export function eliminarVehiculoInteligente(db: DB, vehiculoId: number): ResultadoEliminar {
  if (tieneHistorialVehiculo(db, vehiculoId)) {
    db.prepare('UPDATE vehiculos SET archivado = 1 WHERE id = ?').run(vehiculoId);
    return 'archivado';
  }

  try {
    const borrar = db.transaction(() => {
      desvincularMetadataAdministrativaVehiculo(db, vehiculoId);
      db.prepare('DELETE FROM vehiculos WHERE id = ?').run(vehiculoId);
    });
    borrar();
    return 'borrado';
  } catch (e) {
    console.error('[eliminar] DELETE de vehículo falló, se archiva en su lugar:', e instanceof Error ? e.message : e);
    db.prepare('UPDATE vehiculos SET archivado = 1 WHERE id = ?').run(vehiculoId);
    return 'archivado';
  }
}
