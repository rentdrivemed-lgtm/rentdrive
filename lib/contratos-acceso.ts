// ── Quién puede ver y quién puede tocar un contrato ─────────────────────────
//
// Un contrato lo miran TRES clases de cuenta distintas —el cliente, el propietario
// del vehículo y el equipo de DrivePass—, así que `guardArea` no sirve por sí sola
// (exigiría rol admin y le respondería 403 al cliente legítimo). Es el mismo patrón
// de los endpoints compartidos que documenta lib/guard.ts: rama de administración
// con `adminTieneArea`, rama del dueño de los datos con la pertenencia de siempre.
//
// Se concentra aquí, y no dentro de cada ruta, para que no haya dos rutas con
// criterios distintos sobre el mismo documento.
//
// ⚠️ Server-only (lee la BD): no importar desde un componente 'use client'.

import type Database from 'better-sqlite3';
import type { UserPayload } from './auth';
import { adminTieneArea } from './guard';

/** Área del panel para ver, emitir y anular documentos. */
export const AREA_CONTRATOS = 'contratos';
/** Permiso para suscribir EN NOMBRE DE DrivePass (EL AGENTE). */
export const AREA_FIRMAR_AGENTE = 'contratos_firmar_agente';

export type PartesDocumento = { cliente_id: number; propietario_id: number };

export type AccesoContrato = {
  /** ¿Puede ver el documento completo? */
  puedeVer: boolean;
  /** Qué papel tiene esta cuenta en el documento, si tiene alguno. */
  parte: 'cliente' | 'propietario' | null;
  /** ¿Es una cuenta del equipo con el área de contratos? */
  puedeGestionar: boolean;
  /** ¿Puede poner el trazo de EL AGENTE? */
  puedeFirmarComoAgente: boolean;
};

/**
 * Acceso a un documento cuyas PARTES ya se conocen.
 *
 * Las partes salen de las columnas congeladas del propio contrato
 * (`cliente_id`/`propietario_id`) y no de la reserva: si mañana el vehículo cambia
 * de dueño, el que firmó sigue pudiendo consultar lo que firmó, y el dueño nuevo no
 * hereda el acceso a un documento en el que no es parte.
 */
export function accesoContrato(db: Database.Database, user: UserPayload, partes: PartesDocumento): AccesoContrato {
  const esAdmin = user.rol === 'admin';
  const puedeGestionar = esAdmin && adminTieneArea(db, user.id, AREA_CONTRATOS);
  const puedeFirmarComoAgente = esAdmin && adminTieneArea(db, user.id, AREA_FIRMAR_AGENTE);

  // El papel se decide por el ID de la cuenta, no por `usuarios.rol`: una cuenta de
  // propietario puede perfectamente alquilar un carro ajeno (y sería el ARRENDATARIO
  // de ese contrato), así que atar el papel al rol le cerraría la puerta a su propia
  // firma. Quién puede poner CADA trazo no se decide aquí de todos modos, sino contra
  // el `usuario_esperado_id` congelado en cada bloque (lib/contratos-firma.ts →
  // puedeFirmarBloque); esto solo decide quién puede VER el documento.
  const parte: 'cliente' | 'propietario' | null =
    Number(partes.cliente_id) === Number(user.id) ? 'cliente'
      : Number(partes.propietario_id) === Number(user.id) ? 'propietario'
        : null;

  return {
    puedeVer: puedeGestionar || parte !== null,
    parte,
    puedeGestionar,
    puedeFirmarComoAgente,
  };
}

/**
 * Acceso a los documentos de una reserva (para el listado, donde todavía no hay
 * documento del cual leer las partes). Devuelve `null` si la reserva no existe.
 */
export function accesoReserva(db: Database.Database, user: UserPayload, reservaId: number): AccesoContrato | null {
  const r = db.prepare(`
    SELECT r.usuario_id AS cliente_id, v.propietario_id
    FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id
    WHERE r.id = ?
  `).get(reservaId) as PartesDocumento | undefined;
  if (!r) return null;
  return accesoContrato(db, user, r);
}
