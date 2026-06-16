// Pico y placa (restricción vehicular de Medellín por último dígito de placa).
// Módulo PURO (sin acceso a BD) para poder usarlo tanto en el cliente (resaltar
// carros) como en el servidor (enviar avisos). La rotación la define el admin
// manualmente porque cambia cada cierto tiempo.

export type PicoPlaca = {
  activo: boolean;
  vigencia: string;                  // texto libre, p.ej. "2025 · segundo semestre"
  dias: Record<string, number[]>;    // "1".."5" (Lunes..Viernes) -> dígitos restringidos (0-9)
};

export const DIAS_SEMANA: { id: string; nombre: string }[] = [
  { id: '1', nombre: 'Lunes' },
  { id: '2', nombre: 'Martes' },
  { id: '3', nombre: 'Miércoles' },
  { id: '4', nombre: 'Jueves' },
  { id: '5', nombre: 'Viernes' },
];

export function picoPlacaVacio(): PicoPlaca {
  return { activo: false, vigencia: '', dias: { '1': [], '2': [], '3': [], '4': [], '5': [] } };
}

function normalizarDias(d: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = { '1': [], '2': [], '3': [], '4': [], '5': [] };
  if (d && typeof d === 'object') {
    for (const k of Object.keys(out)) {
      const arr = (d as Record<string, unknown>)[k];
      if (Array.isArray(arr)) out[k] = arr.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 9);
    }
  }
  return out;
}

export function parsePicoPlaca(raw: string): PicoPlaca {
  if (!raw) return picoPlacaVacio();
  try {
    const o = JSON.parse(raw) as Partial<PicoPlaca>;
    return { activo: !!o.activo, vigencia: typeof o.vigencia === 'string' ? o.vigencia : '', dias: normalizarDias(o.dias) };
  } catch {
    return picoPlacaVacio();
  }
}

// Último dígito numérico de la placa (las placas CO terminan en número).
export function ultimoDigitoPlaca(placa?: string): number | null {
  if (!placa) return null;
  const m = placa.replace(/\s+/g, '').match(/(\d)(?!.*\d)/);
  return m ? Number(m[1]) : null;
}

// Dígitos restringidos para una fecha (Lun-Vie). getDay(): 0=Dom..6=Sáb.
export function digitosRestringidos(pp: PicoPlaca, date: Date): number[] {
  if (!pp.activo) return [];
  const d = date.getDay();
  if (d < 1 || d > 5) return [];
  return pp.dias[String(d)] || [];
}

export function placaRestringida(pp: PicoPlaca, placa: string | undefined, date: Date): boolean {
  const dig = ultimoDigitoPlaca(placa);
  if (dig === null) return false;
  return digitosRestringidos(pp, date).includes(dig);
}

// YYYY-MM-DD en hora local (para idempotencia de avisos).
export function fechaISOLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
