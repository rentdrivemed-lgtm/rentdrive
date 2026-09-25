// ── El reporte que alimenta el acta de entrega y devolución ─────────────────
//
// Hasta sep-2026 eran dos cosas separadas que decían lo mismo: el mensajero tomaba
// fotos en la app, y el acta imprimía su inventario, el kilometraje y el nivel de
// combustible EN BLANCO para llenarlos a mano. Los mismos datos, dos veces, y uno de
// los dos en papel.
//
// Ahora el reporte es la fuente y el acta lo imprime. Quien lo llena no vuelve a
// digitarlo en ninguna parte.
//
// DOS MOMENTOS, UNA SOLA ACTA. 'salida' es la entrega al cliente y 'entrada' la
// devolución. Entre uno y otro el acta sigue abierta y eso es lo normal, no un error:
// no se puede firmar la devolución de un vehículo que todavía no ha vuelto.
//
// QUIÉN PUEDE. El mensajero, pero también la secretaría y los administradores, porque
// a veces quien entrega no es quien recibe. Cada intervención queda registrada con
// nombre, rol, fecha y qué hizo — incluido el mensajero, que entra por token y no tiene
// cuenta: su identidad es el nombre asociado al token.
//
// ⚠️ Server-only.

import type Database from 'better-sqlite3';
import { ITEMS_ESTADO_VEHICULO } from './contratos-datos';

type DB = Database.Database;

/** 'salida' = entrega al cliente · 'entrada' = devolución del cliente. */
export type FaseReporte = 'salida' | 'entrada';

export const FASES: readonly FaseReporte[] = ['salida', 'entrada'];

export const ETIQUETA_FASE: Record<FaseReporte, string> = {
  salida: 'entrega',
  entrada: 'devolución',
};

/** Estado de un ítem del inventario. */
export type EstadoItem = 'B' | 'R' | 'M';

export function esEstadoItem(v: unknown): v is EstadoItem {
  return v === 'B' || v === 'R' || v === 'M';
}

export type ItemInventario = { estado: EstadoItem; nota: string };
export type Inventario = Record<string, ItemInventario>;

/**
 * Nivel de combustible en OCTAVOS (0 a 8).
 *
 * En octavos y no en texto libre porque es lo que marca la aguja, y porque el contrato
 * obliga a restituir el vehículo «con el mismo nivel de combustible con que lo recibió»:
 * eso solo se puede comparar si los dos lados están en la misma escala.
 */
export const COMBUSTIBLE_MIN = 0;
export const COMBUSTIBLE_MAX = 8;

export function esNivelCombustible(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= COMBUSTIBLE_MIN && (v as number) <= COMBUSTIBLE_MAX;
}

/** «5/8», para imprimir en el acta. */
export function combustibleTexto(octavos: number | null): string {
  if (octavos === null || !esNivelCombustible(octavos)) return '';
  if (octavos === 0) return 'Vacío';
  if (octavos === COMBUSTIBLE_MAX) return 'Lleno';
  return `${octavos}/8`;
}

export function parsearInventario(json: string | null | undefined): Inventario {
  if (!json) return {};
  let datos: unknown;
  try { datos = JSON.parse(json); } catch { return {}; }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return {};

  const limpio: Inventario = {};
  for (const [item, valor] of Object.entries(datos as Record<string, unknown>)) {
    // Solo ítems del catálogo: un JSON con claves inventadas no debe acabar impreso en
    // un acta. Lo que no esté en la lista se descarta en silencio.
    if (!ITEMS_ESTADO_VEHICULO.includes(item)) continue;
    if (!valor || typeof valor !== 'object') continue;
    const v = valor as Record<string, unknown>;
    if (!esEstadoItem(v.estado)) continue;
    limpio[item] = { estado: v.estado, nota: String(v.nota ?? '').trim().slice(0, 300) };
  }
  return limpio;
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export type ReporteFase = {
  fase: FaseReporte;
  kilometraje: number | null;
  combustible: number | null;
  inventario: Inventario;
  fotos: number;
  /** Ítems del catálogo que todavía no se han calificado. */
  itemsFaltantes: string[];
  /** ¿Están los tres datos y el inventario completo? */
  completo: boolean;
  confirmadoEn: string;
  confirmadoPor: number | null;
  /** Constancia de por qué el cliente no confirmó, si ese fue el caso. */
  constancia: string;
};

type FilaOperacion = Record<string, unknown>;

function contarFotos(json: unknown): number {
  if (typeof json !== 'string' || !json) return 0;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.length : 0;
  } catch { return 0; }
}

export function leerReporte(db: DB, operacionId: number, fase: FaseReporte): ReporteFase | null {
  const fila = db.prepare('SELECT * FROM operaciones WHERE id = ?').get(operacionId) as FilaOperacion | undefined;
  if (!fila) return null;

  const km = fila[`kilometraje_${fase}`];
  const comb = fila[`combustible_${fase}`];
  const inventario = parsearInventario(fila[`inventario_${fase}`] as string);
  const itemsFaltantes = ITEMS_ESTADO_VEHICULO.filter(i => !inventario[i]);

  const kilometraje = typeof km === 'number' ? km : null;
  const combustible = typeof comb === 'number' ? comb : null;
  const fotos = contarFotos(fila[fase === 'salida' ? 'fotos_salida' : 'fotos_entrada']);

  return {
    fase,
    kilometraje,
    combustible,
    inventario,
    fotos,
    itemsFaltantes,
    // «Completo» exige las tres cosas Y al menos una foto: un acta sin registro
    // fotográfico no sirve como patrón de comparación, que es para lo que existe.
    completo: kilometraje !== null && combustible !== null && itemsFaltantes.length === 0 && fotos > 0,
    confirmadoEn: String(fila[`${fase}_confirmado_en`] ?? ''),
    confirmadoPor: typeof fila[`${fase}_confirmado_por`] === 'number' ? fila[`${fase}_confirmado_por`] as number : null,
    constancia: String(fila[`${fase}_constancia`] ?? ''),
  };
}

// ── Quién intervino ─────────────────────────────────────────────────────────

export type AccionIntervencion =
  | 'fotos' | 'inventario' | 'mediciones' | 'confirmacion_cliente' | 'constancia';

export type ActorIntervencion = {
  /** `null` para el mensajero, que entra por token y no tiene cuenta. */
  usuarioId: number | null;
  nombre: string;
  rol: string;
};

export type Intervencion = {
  id: number;
  usuarioId: number | null;
  nombre: string;
  rol: string;
  accion: string;
  fase: string;
  detalle: string;
  cuando: string;
};

/**
 * Deja constancia de que alguien tocó el reporte.
 *
 * NO usa la bitácora general (`auditoria`) a propósito. Aquella cubría solo cuatro
 * acciones del módulo —no registraba subir una foto ni editar el inventario— y solo la
 * ven `principal` y `socio`, mientras que esto tiene que aparecer EN EL ACTA y en la
 * ficha de la reserva. Son dos cosas distintas: una es el rastro interno de
 * administración; esta es parte del documento.
 */
export function registrarIntervencion(
  db: DB, operacionId: number, actor: ActorIntervencion,
  accion: AccionIntervencion, fase: FaseReporte | '', detalle = '',
): void {
  db.prepare(`
    INSERT INTO operacion_intervenciones (operacion_id, usuario_id, nombre, rol, accion, fase, detalle)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    operacionId, actor.usuarioId, actor.nombre || '', actor.rol || '',
    accion, fase, detalle.slice(0, 500),
  );
}

/**
 * Igual, pero SIN acumular una línea por cada foto.
 *
 * Tomar el registro fotográfico son veinte toques de pantalla, no veinte
 * intervenciones: si cada foto dejara su fila, el acta acabaría con una página de
 * «tomó el registro fotográfico» y nadie encontraría lo que de verdad importa —quién
 * entregó y quién recibió—. Se conserva UNA por actor, acción y fase, con la hora y el
 * detalle más recientes.
 */
export function registrarIntervencionUnica(
  db: DB, operacionId: number, actor: ActorIntervencion,
  accion: AccionIntervencion, fase: FaseReporte | '', detalle = '',
): void {
  const previa = db.prepare(`
    SELECT id FROM operacion_intervenciones
    WHERE operacion_id = ? AND accion = ? AND fase = ? AND nombre = ?
      AND (usuario_id IS ? OR usuario_id = ?)
    ORDER BY id DESC LIMIT 1
  `).get(operacionId, accion, fase, actor.nombre || '', actor.usuarioId, actor.usuarioId) as { id: number } | undefined;

  if (previa) {
    db.prepare(
      "UPDATE operacion_intervenciones SET detalle = ?, created_at = datetime('now','localtime') WHERE id = ?"
    ).run(detalle.slice(0, 500), previa.id);
    return;
  }
  registrarIntervencion(db, operacionId, actor, accion, fase, detalle);
}

export function leerIntervenciones(db: DB, operacionId: number): Intervencion[] {
  const filas = db.prepare(
    'SELECT * FROM operacion_intervenciones WHERE operacion_id = ? ORDER BY created_at, id'
  ).all(operacionId) as Record<string, unknown>[];

  return filas.map(f => ({
    id: Number(f.id),
    usuarioId: typeof f.usuario_id === 'number' ? f.usuario_id : null,
    nombre: String(f.nombre ?? ''),
    rol: String(f.rol ?? ''),
    accion: String(f.accion ?? ''),
    fase: String(f.fase ?? ''),
    detalle: String(f.detalle ?? ''),
    cuando: String(f.created_at ?? ''),
  }));
}

// ── Escritura ───────────────────────────────────────────────────────────────

export type GuardarMediciones = {
  kilometraje?: number;
  combustible?: number;
  inventario?: Inventario;
};

export type ResultadoGuardar = { ok: true } | { ok: false; status: number; error: string };

/**
 * Guarda lo que anotó quien está con el vehículo delante.
 *
 * Cada campo es opcional: se puede ir llenando a trozos, que es como ocurre de verdad
 * —primero el odómetro, después la vuelta al carro— y no exige tenerlo todo para poder
 * guardar algo.
 *
 * Guardar INVALIDA la confirmación del cliente que hubiera: si alguien cambia el
 * kilometraje después de que el cliente confirmó, lo que el cliente aceptó ya no es lo
 * que dice el reporte, y el acta no puede afirmar que lo aceptó.
 */
export function guardarMediciones(
  db: DB, operacionId: number, fase: FaseReporte, datos: GuardarMediciones, actor: ActorIntervencion,
): ResultadoGuardar {
  const existe = db.prepare('SELECT id FROM operaciones WHERE id = ?').get(operacionId);
  if (!existe) return { ok: false, status: 404, error: 'La operación no existe.' };

  if (datos.kilometraje !== undefined) {
    if (!Number.isInteger(datos.kilometraje) || datos.kilometraje < 0 || datos.kilometraje > 9_999_999) {
      return { ok: false, status: 400, error: 'El kilometraje no es válido.' };
    }
  }
  if (datos.combustible !== undefined && !esNivelCombustible(datos.combustible)) {
    return { ok: false, status: 400, error: 'El nivel de combustible debe ir de 0 a 8 octavos.' };
  }

  const cambios: string[] = [];
  const aplicar = db.transaction(() => {
    if (datos.kilometraje !== undefined) {
      db.prepare(`UPDATE operaciones SET kilometraje_${fase} = ? WHERE id = ?`).run(datos.kilometraje, operacionId);
      cambios.push(`kilometraje ${datos.kilometraje}`);
    }
    if (datos.combustible !== undefined) {
      db.prepare(`UPDATE operaciones SET combustible_${fase} = ? WHERE id = ?`).run(datos.combustible, operacionId);
      cambios.push(`combustible ${combustibleTexto(datos.combustible)}`);
    }
    if (datos.inventario !== undefined) {
      // Se mezcla con lo que ya hubiera: quien revisa el carro va marcando ítems, y un
      // guardado parcial no puede borrar los que ya estaban.
      const previo = parsearInventario(
        (db.prepare(`SELECT inventario_${fase} AS inv FROM operaciones WHERE id = ?`)
          .get(operacionId) as { inv: string }).inv,
      );
      const fusionado = { ...previo, ...datos.inventario };
      db.prepare(`UPDATE operaciones SET inventario_${fase} = ? WHERE id = ?`)
        .run(JSON.stringify(fusionado), operacionId);
      cambios.push(`${Object.keys(datos.inventario).length} ítem(s) del inventario`);
    }

    if (cambios.length === 0) return;

    // La confirmación del cliente deja de valer: aceptó otros datos.
    db.prepare(
      `UPDATE operaciones SET ${fase}_confirmado_en = '', ${fase}_confirmado_por = NULL WHERE id = ?`
    ).run(operacionId);

    registrarIntervencion(
      db, operacionId, actor,
      datos.inventario !== undefined ? 'inventario' : 'mediciones',
      fase, `Anotó ${cambios.join(', ')} en la ${ETIQUETA_FASE[fase]}`,
    );
  });
  aplicar();

  return { ok: true };
}

/**
 * El cliente confirma lo que se anotó.
 *
 * Es lo que convierte el reporte en algo que el acta puede afirmar que las dos partes
 * vieron. Solo se puede confirmar un reporte COMPLETO: confirmar a medias no significa
 * nada.
 */
export function confirmarCliente(
  db: DB, operacionId: number, fase: FaseReporte, clienteId: number, nombre: string,
): ResultadoGuardar {
  const reporte = leerReporte(db, operacionId, fase);
  if (!reporte) return { ok: false, status: 404, error: 'La operación no existe.' };
  if (!reporte.completo) {
    return { ok: false, status: 409, error: `El reporte de ${ETIQUETA_FASE[fase]} todavía está incompleto.` };
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE operaciones SET ${fase}_confirmado_en = datetime('now','localtime'), ${fase}_confirmado_por = ?, ${fase}_constancia = '' WHERE id = ?`
    ).run(clienteId, operacionId);
    registrarIntervencion(
      db, operacionId, { usuarioId: clienteId, nombre, rol: 'cliente' },
      'confirmacion_cliente', fase, `Confirmó el estado del vehículo en la ${ETIQUETA_FASE[fase]}`,
    );
  })();

  return { ok: true };
}

export const CONSTANCIA_MIN = 10;
export const CONSTANCIA_MAX = 500;

/**
 * El cliente no pudo confirmar y quien entrega deja constancia de por qué.
 *
 * Decisión del dueño (sep-2026): que la entrega NO se trabe por esto. El vehículo se
 * entrega igual y el acta dice la verdad —que el cliente no confirmó y por qué— en vez
 * de afirmar una conformidad que no hubo.
 */
export function dejarConstancia(
  db: DB, operacionId: number, fase: FaseReporte, motivo: string, actor: ActorIntervencion,
): ResultadoGuardar {
  const reporte = leerReporte(db, operacionId, fase);
  if (!reporte) return { ok: false, status: 404, error: 'La operación no existe.' };

  const m = (motivo || '').trim();
  if (m.length < CONSTANCIA_MIN) {
    return { ok: false, status: 400, error: 'Escribe por qué el cliente no pudo confirmar.' };
  }
  if (m.length > CONSTANCIA_MAX) {
    return { ok: false, status: 400, error: 'La constancia es demasiado larga.' };
  }
  if (reporte.confirmadoEn) {
    return { ok: false, status: 409, error: 'El cliente ya confirmó este reporte.' };
  }

  db.transaction(() => {
    db.prepare(`UPDATE operaciones SET ${fase}_constancia = ? WHERE id = ?`).run(m, operacionId);
    registrarIntervencion(
      db, operacionId, actor, 'constancia', fase,
      `El cliente no confirmó la ${ETIQUETA_FASE[fase]}: ${m}`,
    );
  })();

  return { ok: true };
}

// ── Puerta de la firma del acta ─────────────────────────────────────────────

/**
 * ¿Se pueden recoger ya las firmas de este momento del acta?
 *
 * La firma de la ENTREGA se habilita solo con el reporte de entrega completo, y la de
 * la DEVOLUCIÓN solo con el de devolución. Firmar antes sería suscribir un inventario
 * que nadie ha levantado.
 *
 * Que la de devolución esté cerrada mientras el carro está alquilado NO es un error y
 * el panel no debe pintarlo como tal: es el curso normal de la operación.
 */
export function puedeFirmarMomento(
  db: DB, operacionId: number, momento: 'entrega' | 'devolucion',
): { puede: true } | { puede: false; motivo: string } {
  const fase: FaseReporte = momento === 'entrega' ? 'salida' : 'entrada';
  const reporte = leerReporte(db, operacionId, fase);
  if (!reporte) return { puede: false, motivo: 'La operación no existe.' };
  if (reporte.completo) return { puede: true };

  const falta: string[] = [];
  if (reporte.fotos === 0) falta.push('las fotografías');
  if (reporte.kilometraje === null) falta.push('el kilometraje');
  if (reporte.combustible === null) falta.push('el nivel de combustible');
  if (reporte.itemsFaltantes.length > 0) {
    falta.push(`${reporte.itemsFaltantes.length} ítem(s) del inventario`);
  }

  return {
    puede: false,
    motivo: `El reporte de ${ETIQUETA_FASE[fase]} está incompleto: falta ${falta.join(', ')}.`,
  };
}
