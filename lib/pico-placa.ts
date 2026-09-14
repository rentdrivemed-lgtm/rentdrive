// Pico y placa (restricción vehicular de Medellín por último dígito de placa).
import { exentoPicoPlaca, type DatosExencion } from './vehiculo-campos';

export type PicoPlaca = {
  activo: boolean;
  vigencia: string;
  dias: Record<string, number[]>;
};

export const DIAS_SEMANA: { id: string; nombre: string }[] = [
  { id: '1', nombre: 'Lunes' },
  { id: '2', nombre: 'Martes' },
  { id: '3', nombre: 'Miércoles' },
  { id: '4', nombre: 'Jueves' },
  { id: '5', nombre: 'Viernes' },
];

export function parsePicoPlaca(configStr: string): PicoPlaca {
  try {
    const parsed = JSON.parse(configStr || '{}') as Partial<PicoPlaca>;
    return {
      activo: !!parsed.activo,
      vigencia: parsed.vigencia ?? '',
      dias: parsed.dias ?? {},
    };
  } catch {
    return { activo: false, vigencia: '', dias: {} };
  }
}

export function ultimoDigitoPlaca(placa: string): number | null {
  const digits = (placa ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return parseInt(digits[digits.length - 1]);
}

/**
 * Punto ÚNICO de decisión de "¿este vehículo tiene pico y placa este día?".
 *
 * `exencion` es opcional a propósito (no rompe llamadores viejos): si no se pasa, o si
 * llega vacío/desconocido — el caso de todos los vehículos anteriores a las columnas
 * `combustible` / `exencion_pico_placa_inscrita` — el resultado es exactamente el de
 * siempre. Solo devuelve false por exención cuando el vehículo realmente lo está en
 * Medellín: eléctrico (automático) o híbrido/GNV CON la inscripción confirmada ante la
 * Secretaría de Movilidad (ver exentoPicoPlaca en lib/vehiculo-campos.ts). Marcar como
 * exento a un híbrido sin el trámite sería información falsa que termina en comparendo.
 *
 * Va como objeto `{ combustible, inscrita }` y no como dos parámetros sueltos: son 5 los
 * llamadores y la firma ya iba por el cuarto argumento posicional.
 */
export function placaRestringida(pp: PicoPlaca, placa: string, fecha: Date, exencion?: DatosExencion | null): boolean {
  if (!pp.activo) return false;
  if (exentoPicoPlaca(exencion)) return false;
  const diaStr = String(fecha.getDay()); // 0=domingo, 1=lunes, ..., 6=sábado
  const digito = ultimoDigitoPlaca(placa);
  if (digito === null) return false;
  const digitosRestringidos: number[] = pp.dias[diaStr] ?? [];
  return digitosRestringidos.includes(digito);
}

export function fechaISOLocal(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function picoPlacaVacio(): PicoPlaca {
  return { activo: false, vigencia: '', dias: {} };
}

export function digitosRestringidos(pp: PicoPlaca, fecha: Date): number[] {
  if (!pp.activo) return [];
  const diaStr = String(fecha.getDay());
  return pp.dias[diaStr] ?? [];
}
