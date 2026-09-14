// Campos del vehículo que salen de la tarjeta de propiedad (matrícula): tipo de
// combustible y "clase de vehículo".
//
// Módulo PURO (sin BD, sin `fs`, sin imports de servidor): lo usan tanto los API
// routes para validar lo que llega del cliente como los componentes 'use client'
// (selectores, calendarios de pico y placa). No agregar aquí nada que dependa de
// better-sqlite3 o del filesystem.
//
// OJO: `combustible` NO reemplaza a `tipo` (sedan/suv/camioneta7/…, ver
// lib/rentabilidad.ts) ni `clase_vehiculo` tampoco. `tipo` sigue siendo la categoría
// comercial que alimenta filtros de la home, precio de mercado y rentabilidad; estos
// dos campos son datos descriptivos que se transcriben de la matrícula.

/** Valores aceptados para `vehiculos.combustible`. El vacío ('') = "no declarado". */
export type Combustible = 'gasolina' | 'diesel' | 'hibrido' | 'electrico' | 'gas';

export const COMBUSTIBLE_LABELS: Record<Combustible, string> = {
  gasolina: 'Gasolina',
  diesel: 'Diésel',
  hibrido: 'Híbrido',
  electrico: 'Eléctrico',
  gas: 'Gas (GNV)',
};

export const COMBUSTIBLES = Object.keys(COMBUSTIBLE_LABELS) as Combustible[];

export function esCombustibleValido(v: unknown): v is Combustible {
  return typeof v === 'string' && (COMBUSTIBLES as string[]).includes(v);
}

/**
 * Normaliza lo que llegue del cliente (o de la IA) a uno de los valores válidos.
 * Todo lo que no se reconozca con seguridad cae a '' ("no declarado") — nunca se
 * adivina, y nunca se guarda un string arbitrario en la columna.
 */
export function normalizarCombustible(v: unknown): Combustible | '' {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase();
  if (!s) return '';
  return esCombustibleValido(s) ? s : '';
}

// ─── Exención de pico y placa (Medellín) ──────────────────────────────────────
//
// Normativa vigente (Acuerdos 84/2009, 23/2012, 44/2015 y 58/2017 del Concejo de
// Medellín; Decretos 1213/2014 y 1221/2016; Leyes 1811/2016, 1964/2019 y 2128/2021):
//
//   • ELÉCTRICOS: exentos de forma AUTOMÁTICA. La exención sale del propio registro
//     del vehículo en el RUNT, el propietario no hace ningún trámite.
//   • HÍBRIDOS y GAS NATURAL (GNV): también exentos, PERO la exención no es automática:
//     el propietario debe INSCRIBIR el vehículo ante la Secretaría de Movilidad de
//     Medellín. Sin esa inscripción el carro sigue sujeto a la restricción y lo
//     comparendan igual.
//
// Por eso la decisión necesita DOS datos, no uno: el combustible y si el trámite está
// hecho (`vehiculos.exencion_pico_placa_inscrita`). Van juntos en un objeto —
// `DatosExencion` — en vez de como parámetros sueltos, para que agregar un criterio
// nuevo mañana no siga alargando la firma de `placaRestringida()` ni obligue a revisar
// el orden de los argumentos en los 5 llamadores.

/** Los dos datos del vehículo que deciden la exención. Ambos opcionales a propósito. */
export type DatosExencion = {
  /** `vehiculos.combustible`. Vacío/ausente = "no declarado". */
  combustible?: string | null;
  /**
   * `vehiculos.exencion_pico_placa_inscrita`: ¿el propietario confirmó que inscribió la
   * exención ante la Secretaría de Movilidad? Llega como INTEGER 0/1 desde SQLite y como
   * boolean desde el formulario, por eso se acepta cualquiera de los dos.
   */
  inscrita?: boolean | number | string | null;
};

/**
 * Normaliza el flag de inscripción con criterio FAIL-SAFE: solo `true`, `1` y `'1'`/`'true'`
 * cuentan como "sí". Cualquier otra cosa (null, undefined, '', 0, texto raro) es "no", que
 * es el lado seguro: como mucho le mostramos pico y placa a un carro que sí estaba exento,
 * nunca al revés (decirle "estás exento" a alguien que se va a ganar un comparendo).
 */
export function inscripcionExencionConfirmada(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === '1' || s === 'true';
  }
  return false;
}

/**
 * ¿Este combustible necesita el trámite ante la Secretaría de Movilidad para estar exento?
 * Híbrido y gas (GNV) sí; eléctrico no (es automático); el resto ni siquiera es exento.
 * Lo usa el formulario para decidir si muestra la casilla de confirmación, y el servidor
 * para no guardar un "sí, inscrito" en un carro a gasolina.
 */
export function requiereInscripcionExencion(combustible: unknown): boolean {
  const c = normalizarCombustible(combustible);
  return c === 'hibrido' || c === 'gas';
}

/**
 * Punto único de verdad de "¿este vehículo está exento de pico y placa?".
 *
 * Un vehículo sin combustible declarado ('' — el caso de TODOS los vehículos que ya
 * existían antes de estas columnas) NO es exento: se comporta exactamente igual que
 * siempre. Lo mismo un híbrido o un GNV cuyo propietario no ha confirmado la inscripción.
 */
export function exentoPicoPlaca(datos: DatosExencion | null | undefined): boolean {
  const c = normalizarCombustible(datos?.combustible);
  if (c === 'electrico') return true;               // automático, sin trámite
  if (c === 'hibrido' || c === 'gas') return inscripcionExencionConfirmada(datos?.inscrita);
  return false;                                      // gasolina, diésel, '' o basura
}

/**
 * Motivo de la exención, para que cada vista arme su propio texto (los calendarios lo
 * traducen; ver components/CalendarioReserva.tsx). `null` = no está exento.
 */
export function motivoExencion(datos: DatosExencion | null | undefined): 'electrico' | 'hibrido' | 'gas' | null {
  if (!exentoPicoPlaca(datos)) return null;
  const c = normalizarCombustible(datos?.combustible);
  return c === 'electrico' || c === 'hibrido' || c === 'gas' ? c : null;
}

/**
 * "Clase de vehículo" impresa en la matrícula ('Automóvil', 'Campero', 'Camioneta',
 * 'Station Wagon'…). Es texto libre transcrito del documento, así que no se valida
 * contra una lista cerrada (el RUNT usa variantes); solo se recorta y se limita para
 * que el cliente no pueda guardar un texto arbitrariamente largo en la columna.
 */
export const CLASE_VEHICULO_MAX = 40;

export function sanitizarClaseVehiculo(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, CLASE_VEHICULO_MAX);
}
