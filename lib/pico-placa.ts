// Pico y placa (restricción vehicular de Medellín por último dígito de placa).
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

export function placaRestringida(pp: PicoPlaca, placa: string, fecha: Date): boolean {
  if (!pp.activo) return false;
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
