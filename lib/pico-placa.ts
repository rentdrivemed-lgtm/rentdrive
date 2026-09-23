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

/**
 * Los días de un alquiler en que ESTE vehículo no puede circular por pico y placa.
 *
 * El rango va como lo guarda una reserva: `fechaInicio` incluido y `fechaFin` EXCLUIDO
 * (`fecha_inicio < fecha_fin`, igual que `calcularDiasAlquiler` en lib/lugares.ts). El
 * día de devolución no cuenta porque tampoco se cobra como día de alquiler.
 *
 * Existe porque esos días NO SE COBRAN: el cliente tiene el carro pero la norma le
 * impide moverlo, así que cobrárselos sería cobrarle un día de uso que no puede usar.
 * Es la misma regla que la calculadora del propietario ya aplicaba por su lado («el día
 * de pico y placa no se cobra ni se paga»); desde sep-2026 el motor de reservas también.
 *
 * Devuelve las FECHAS y no un número para que el desglose pueda decirle al cliente
 * cuáles son, en vez de restarle días que no sabe de dónde salen.
 */
export function diasRestringidosEnRango(
  pp: PicoPlaca, placa: string, fechaInicio: string, fechaFin: string,
  exencion?: DatosExencion | null,
): string[] {
  if (!pp.activo || !placa || !fechaInicio || !fechaFin) return [];
  if (exentoPicoPlaca(exencion)) return [];
  const [ay, am, ad] = fechaInicio.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = fechaFin.slice(0, 10).split('-').map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return [];
  const cur = new Date(ay, am - 1, ad);
  const fin = new Date(by, bm - 1, bd);
  const out: string[] = [];
  // Tope de seguridad: un rango corrupto o invertido no debe colgar el servidor en un
  // bucle. `MAX_DIAS_DISPONIBLES` (lib/dias-disponibles.ts) es 1100, así que 1200 cubre
  // cualquier alquiler legítimo con margen.
  let guardia = 1200;
  while (cur < fin && guardia-- > 0) {
    if (placaRestringida(pp, placa, cur, exencion)) out.push(fechaISOLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
