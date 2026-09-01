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
// Cascada propietario -> vehículos (confirmado con Victor): si el usuario archivado
// es un propietario, sus vehículos se archivan CON él en la misma transacción (ver
// `archivarUsuarioYVehiculosSiPropietario`), para que no queden carros visibles de un
// dueño archivado. Es de un solo sentido: desarchivar la cuenta NO desarchiva sus
// vehículos — se reactivan uno por uno, a propósito (ver esa función para el detalle).
//
// ── Criterio: qué cuenta como "historial" ───────────────────────────────────
// Se clasificó cada tabla que tiene una FK hacia usuarios(id) / vehiculos(id)
// (`grep REFERENCES usuarios(id)` / `REFERENCES vehiculos(id)` en lib/db.ts) en dos
// grupos:
//
//  1) HISTORIAL DE NEGOCIO REAL (bloquea el borrado, fuerza archivar): reservas,
//     vehículos publicados, remisiones/liquidaciones (dinero real), conversaciones/
//     mensajes de chat (evidencia de la relación propietario↔cliente, incluyendo los
//     mensajes de sistema que un admin envía al aprobar/rechazar una reserva), soporte,
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
    // mensajes.remitente_id es NOT NULL (no se puede desvincular a NULL, a diferencia de las
    // FKs administrativas de más abajo): incluye tanto los mensajes de un cliente/propietario en
    // el chat como los mensajes de sistema que un ADMIN envía al aprobar/rechazar una reserva (ver
    // app/api/reservas/[id]/route.ts). En ambos casos es evidencia real de una relación/operación,
    // así que cuenta como historial explícitamente en vez de depender solo del catch de defensa en
    // profundidad (el DELETE fallaría igual por esta FK, pero declararlo aquí es más preciso).
    existe(db, 'SELECT 1 FROM mensajes WHERE remitente_id = ?', id) ||
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
 * Archiva la cuenta y, si es un propietario, archiva TODOS sus vehículos con él —
 * atómico (misma transacción). Así un propietario archivado deja de aparecer en
 * cualquier listado normal (público, admin, su propio dashboard) junto con sus
 * carros, en vez de dejar vehículos "huérfanos" visibles de un dueño archivado
 * (confirmado con Victor). Se usa tanto en el camino directo (tiene historial)
 * como en el fallback de defensa en profundidad (el DELETE real falló).
 *
 * INTENCIONAL — la dirección inversa NO es automática: desarchivar la cuenta
 * (vuelve a 'inactiva', ver PUT { accion: 'desarchivar' } en el endpoint) NO
 * desarchiva sus vehículos. Mismo criterio conservador que "desarchivar cuenta
 * → inactiva, no activa": reactivar cada vehículo es una decisión consciente
 * aparte (PUT /api/vehiculos/:id { archivado: 0 }, uno por uno), no un efecto
 * secundario automático de reactivar al propietario.
 */
function archivarUsuarioYVehiculosSiPropietario(db: DB, usuarioId: number) {
  const archivar = db.transaction(() => {
    const objetivo = db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(usuarioId) as { rol: string } | undefined;
    db.prepare("UPDATE usuarios SET estado_cuenta = 'archivada' WHERE id = ?").run(usuarioId);
    if (objetivo?.rol === 'propietario') {
      // No filtra por si ya estaba archivado a mano: da igual, queda en 1 de todos modos.
      // `disponible = 0` en la misma UPDATE: un vehículo archivado nunca debe seguir
      // siendo reservable (ver también eliminarVehiculoInteligente, mismo criterio).
      db.prepare('UPDATE vehiculos SET archivado = 1, disponible = 0 WHERE propietario_id = ?').run(usuarioId);
    }
  });
  archivar();
}

/**
 * Elimina o archiva un usuario según tenga o no historial de negocio real.
 * Devuelve 'borrado' o 'archivado'. NO valida permisos/auth ni "no te elimines a ti
 * mismo" — eso es responsabilidad del endpoint que llama a esta función.
 */
export function eliminarUsuarioInteligente(db: DB, usuarioId: number): ResultadoEliminar {
  if (tieneHistorialUsuario(db, usuarioId)) {
    archivarUsuarioYVehiculosSiPropietario(db, usuarioId);
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
    archivarUsuarioYVehiculosSiPropietario(db, usuarioId);
    return 'archivado';
  }
}

// ── Vehículos ────────────────────────────────────────────────────────────────

/**
 * ¿Este vehículo tiene reservas (historial de negocio real) que impidan borrarlo de verdad?
 * Para buses (tipo='bus'), además reconoce como "historial" cualquier fila ligada en las
 * tablas de tarifas/cambios/cotizaciones de bus (hallazgo QA/revisor-código, ronda post-Etapa
 * 2: antes esta función no las miraba, así que la decisión de archivar-en-vez-de-borrar un bus
 * con tarifas propias o cotizaciones reales dependía implícitamente de que el DELETE fallara
 * por una excepción de FK y cayera al `catch` genérico de `eliminarVehiculoInteligente` — acá
 * queda como un chequeo explícito).
 *
 * Detecta el tipo consultando `vehiculos` en vez de recibirlo por parámetro: así la firma no
 * cambia para el llamador existente (DELETE /api/vehiculos/[id]) y solo se pagan las 5 queries
 * extra cuando el vehículo en cuestión de verdad es un bus.
 */
export function tieneHistorialVehiculo(db: DB, vehiculoId: number): boolean {
  // reservas.vehiculo_id es la única FK "de negocio" real hacia vehiculos(id) para autos;
  // remisiones, liquidaciones y facturas cuelgan de la reserva (reserva_id), no directamente
  // del vehículo, así que quedan cubiertas transitivamente al bloquear cualquier vehículo con
  // reservas.
  if (existe(db, 'SELECT 1 FROM reservas WHERE vehiculo_id = ?', vehiculoId)) return true;

  const v = db.prepare("SELECT tipo FROM vehiculos WHERE id = ?").get(vehiculoId) as { tipo: string } | undefined;
  if (v?.tipo !== 'bus') return false;

  return (
    existe(db, 'SELECT 1 FROM bus_tarifas_destino_veh WHERE vehiculo_id = ?', vehiculoId) ||
    existe(db, 'SELECT 1 FROM bus_tarifas_hora_veh WHERE vehiculo_id = ?', vehiculoId) ||
    existe(db, 'SELECT 1 FROM bus_valor_km_veh WHERE vehiculo_id = ?', vehiculoId) ||
    existe(db, 'SELECT 1 FROM bus_tarifas_cambios WHERE vehiculo_id = ?', vehiculoId) ||
    existe(db, 'SELECT 1 FROM cotizaciones_bus WHERE vehiculo_id = ?', vehiculoId)
  );
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
    // `disponible = 0` en la misma UPDATE: un vehículo archivado nunca debe seguir
    // siendo reservable (mismo criterio que archivarUsuarioYVehiculosSiPropietario).
    db.prepare('UPDATE vehiculos SET archivado = 1, disponible = 0 WHERE id = ?').run(vehiculoId);
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
    db.prepare('UPDATE vehiculos SET archivado = 1, disponible = 0 WHERE id = ?').run(vehiculoId);
    return 'archivado';
  }
}
