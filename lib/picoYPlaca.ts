// Pico y placa Medellín
const DIGITO_DIA: Record<number, number[]> = { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 0] };
export function ultimoDigito(placa: string): number | null { const d = placa.replace(/\D/g, ''); if (!d) return null; return parseInt(d[d.length - 1]); }
export function diasPicoYPlaca(placa: string, year: number, month: number): string[] { void DIGITO_DIA; void placa; void year; void month; return []; }