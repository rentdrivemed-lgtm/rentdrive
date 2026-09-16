// ── Fecha de llegada a la plataforma (`created_at`) ─────────────────────────
//
// Módulo PURO (sin `fs`, sin `better-sqlite3`): lo importan componentes 'use client'
// igual que lib/pico-placa.ts o lib/dias-disponibles.ts.
//
// ⚠️ POR QUÉ EXISTE — el desfase de 5 horas que corría el día:
// En `lib/db.ts`, las tablas `usuarios` (línea ~37) y `vehiculos` (línea ~52) guardan
// `created_at TEXT DEFAULT (datetime('now'))` — o sea **UTC**, no hora local, a
// diferencia de la mayoría de las otras tablas del proyecto, que usan
// `datetime('now', 'localtime')`. En Postgres/Supabase (supabase/schema.sql) es lo
// mismo: `to_char(now(), 'YYYY-MM-DD HH24:MI:SS')` con la sesión en UTC.
//
// Medellín es UTC-5, así que un registro hecho a las 8:00 p. m. del 15 de septiembre
// queda guardado como '2026-09-16 01:00:00'. Si ese texto se muestra tal cual —o se
// parsea con `new Date(ts.replace(' ', 'T'))`, que en JS significa "hora LOCAL"— el
// panel dice que esa persona llegó el 16, un día después de lo que pasó de verdad.
//
// La normalización se hace SIEMPRE al mostrar (y al filtrar/ordenar), nunca
// reescribiendo lo que hay en la base: los datos guardados son correctos, lo que
// estaba mal era leerlos.
//
// Nadie escribe `created_at` a mano en estas dos tablas (todos los INSERT dejan el
// DEFAULT), así que el formato es estable: 'YYYY-MM-DD HH:MM:SS' en UTC. Aun así las
// funciones toleran ISO con 'T', con 'Z' o con desfase explícito, y fechas sueltas.
import { ZONA_OPERACION, fechaISOValida } from './dias-disponibles';

/** Meses abreviados en español, fijos a propósito. */
// `Intl` con locale 'es-CO' devuelve "sept" (y con punto en algunos runtimes) según la
// versión de ICU del navegador: la tabla evita que la misma fila se vea distinta en dos
// computadores del equipo.
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

/**
 * Convierte el `created_at` guardado (UTC) en un `Date`, o `null` si no se puede leer.
 *
 * El texto de la base NO trae zona ('2026-09-16 01:00:00'), y `new Date` interpretaría
 * eso como hora local del navegador. Por eso se le agrega la 'Z' explícita: es UTC.
 */
export function fechaRegistroDate(ts: unknown): Date | null {
  const s = String(ts ?? '').trim();
  if (!s) return null;
  let iso = s.replace(' ', 'T');
  // Fecha suelta sin hora ('2026-09-16'): se ancla al mediodía UTC, que cae el MISMO día
  // en Medellín (UTC-5) — con medianoche UTC se vería como el día anterior.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T12:00:00Z';
  // Sin 'Z' ni desfase (+HH:MM / -HHMM) el valor es UTC por definición de la columna.
  else if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Milisegundos desde época, o `null`. Es la clave de ordenamiento por fecha de llegada. */
export function fechaRegistroMs(ts: unknown): number | null {
  const d = fechaRegistroDate(ts);
  return d ? d.getTime() : null;
}

/**
 * Día calendario 'YYYY-MM-DD' **visto desde Medellín**. Es contra esto que se comparan
 * los extremos de un filtro "desde / hasta" (que el operador escribe en hora de acá).
 */
export function diaRegistroISO(ts: unknown): string | null {
  const d = fechaRegistroDate(ts);
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_OPERACION, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch {
    // Runtime sin datos de zonas horarias: se resta el desfase a mano antes que romper.
    return new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

/** Hora 'HH:MM' (24h) en Medellín, o cadena vacía. */
function horaRegistro(d: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA_OPERACION, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return '';
  }
}

/** "15 sep 2026" (hora de Medellín). Devuelve `alternativa` si el dato no se puede leer. */
export function fechaRegistroCorta(ts: unknown, alternativa = '—'): string {
  const iso = diaRegistroISO(ts);
  if (!iso || !fechaISOValida(iso)) return alternativa;
  const [anio, mes, dia] = iso.split('-');
  return `${Number(dia)} ${MESES_CORTOS[Number(mes) - 1]} ${anio}`;
}

/** "15 sep 2026, 8:00 p. m." → se usa en el `title` de la celda, para el dato exacto. */
export function fechaRegistroLarga(ts: unknown, alternativa = 'Sin fecha de registro'): string {
  const d = fechaRegistroDate(ts);
  if (!d) return alternativa;
  const corta = fechaRegistroCorta(ts, '');
  if (!corta) return alternativa;
  const hora = horaRegistro(d);
  return hora ? `${corta}, ${hora} (hora de Medellín)` : corta;
}

/** Direcciones posibles del orden por fecha de llegada. */
export type OrdenLlegada = 'recientes' | 'antiguos';

/**
 * Ordena por `created_at`. `recientes` = el último que llegó, de primero (lo que un
 * operador revisa a diario); `antiguos` = orden de llegada cronológico.
 *
 * Desempate por `id` (autoincremental = orden real de inserción), que además cubre las
 * filas sin fecha legible: nunca quedan intercaladas al azar entre dos recargas.
 */
export function ordenarPorLlegada<T extends { id: number; created_at?: string }>(
  filas: readonly T[], orden: OrdenLlegada,
): T[] {
  const signo = orden === 'recientes' ? -1 : 1;
  return [...filas].sort((a, b) => {
    const ma = fechaRegistroMs(a.created_at);
    const mb = fechaRegistroMs(b.created_at);
    if (ma !== null && mb !== null && ma !== mb) return (ma - mb) * signo;
    // Una fila sin fecha legible se va al final, mire como mire el orden.
    if (ma === null && mb !== null) return 1;
    if (mb === null && ma !== null) return -1;
    return (Number(a.id) - Number(b.id)) * signo;
  });
}

/**
 * ¿Este `created_at` cae dentro del rango 'YYYY-MM-DD'..'YYYY-MM-DD'? Ambos extremos son
 * INCLUSIVOS y se leen en día de Medellín (mismo criterio que `diaRegistroISO`), que es
 * lo que espera quien escribe "del 1 al 30" en los dos campos de fecha.
 *
 * Un extremo vacío = sin tope por ese lado. Un `created_at` ilegible NO se descarta si no
 * hay rango puesto, pero sí queda fuera en cuanto se filtra por fechas (no se puede
 * afirmar que esté dentro).
 */
export function enRangoRegistro(ts: unknown, desde: string, hasta: string): boolean {
  const d = (desde || '').trim();
  const h = (hasta || '').trim();
  if (!d && !h) return true;
  const dia = diaRegistroISO(ts);
  if (!dia) return false;
  if (d && fechaISOValida(d) && dia < d) return false;
  if (h && fechaISOValida(h) && dia > h) return false;
  return true;
}
