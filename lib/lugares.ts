// Catálogo de lugares de recogida/entrega para DrivePass
export type Lugar = { municipio: string; barrio: string; direccion: string; hora: string; };
export const LUGAR_VACIO: Lugar = { municipio: '', barrio: '', direccion: '', hora: '' };
export const RECARGO_AEROPUERTO = 100000;
export const MUNICIPIO_AEROPUERTO = 'aeropuerto-jmc';

// ── Normalización: UN SOLO punto de entrada ──────────────────────────────────
// Todo lo que decide sobre un lugar (¿es válido?, ¿cobra recargo?, ¿cómo se
// resume?) mira el MISMO valor normalizado. Que una función normalizara y otra
// no ya costó un bug de plata: con `municipio: ' aeropuerto-jmc '` (con espacios)
// la validación entraba por el atajo de aeropuerto —no pide barrio ni dirección—
// pero el recargo comparaba el valor crudo y daba $0: reserva creada y facturada
// $100.000 más barata, en silencio, por las dos vías (pública y mostrador).
//
// Los campos NO se coercionan: un lugar con `barrio: 0` o `direccion: 123` es un
// lugar INVÁLIDO (400), no un "0"/"123" válido. Un campo ausente (undefined/null)
// cuenta como '' , igual que siempre.
const CAMPOS_LUGAR = ['municipio', 'barrio', 'direccion', 'hora'] as const;

/**
 * Convierte cualquier cosa que venga del body de una request en un `Lugar` con
 * los 4 campos presentes y recortados, o `null` si no puede serlo.
 * Es la ÚNICA función que normaliza; el resto se apoya en ella.
 */
export function normalizarLugar(l: unknown): Lugar | null {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const o = l as Record<string, unknown>;
  const out: Lugar = { ...LUGAR_VACIO };
  for (const campo of CAMPOS_LUGAR) {
    const v = o[campo];
    if (v === undefined || v === null) continue; // ausente = ''
    if (typeof v !== 'string') return null;      // presente pero no es texto = lugar inválido
    out[campo] = v.trim();
  }
  return out;
}

/** Municipio ya normalizado de un lugar cualquiera ('' si no se puede leer). */
function municipioDe(l?: Lugar | null): string {
  const m = l && typeof l === 'object' ? (l as Lugar).municipio : undefined;
  return typeof m === 'string' ? m.trim() : '';
}

export function esAeropuerto(municipioId: string): boolean {
  // El typeof no sobra: esta función también la llaman componentes con datos que
  // vienen de la red (`value.municipio`), donde el tipo es una promesa, no un hecho.
  return typeof municipioId === 'string' && municipioId.trim() === MUNICIPIO_AEROPUERTO;
}

export function calcularRecargo(recogida?: Lugar | null, entrega?: Lugar | null): number {
  let r = 0;
  if (esAeropuerto(municipioDe(recogida))) r += RECARGO_AEROPUERTO;
  if (esAeropuerto(municipioDe(entrega))) r += RECARGO_AEROPUERTO;
  return r;
}

export function lugarValido(l?: Lugar | null): boolean {
  const n = normalizarLugar(l);
  if (!n || !n.municipio || !n.hora) return false;
  // El aeropuerto no tiene barrio ni dirección que pedir. Este atajo y el recargo
  // usan el MISMO criterio (`esAeropuerto` sobre el municipio normalizado): o se
  // cobra el recargo, o el lugar se rechaza; nunca "válido y gratis".
  if (esAeropuerto(n.municipio)) return true;
  return !!n.barrio && !!n.direccion;
}

export function lugarResumen(l?: Lugar | null): string { return municipioDe(l) || '—'; }

// Cálculo del total de un alquiler — la MISMA fórmula la usa la reserva real (app/api/reservas/route.ts) y el cotizador de venta (sin reserva, lib/contabilidad.ts), para que nunca se desincronicen.
export function calcularDiasAlquiler(fechaInicio: string, fechaFin: string): number {
  return Math.max(1, Math.ceil((new Date(fechaFin).getTime() - new Date(fechaInicio).getTime()) / 86400000));
}
export function calcularTotalAlquiler(dias: number, precioDia: number, recargo: number): number {
  return dias * precioDia + recargo;
}
export function guardarLugares(recogida: Lugar, entrega: Lugar): void { if (typeof window === 'undefined') return; try { sessionStorage.setItem('drivepass_lugares', JSON.stringify({ recogida, entrega })); } catch {} }
export function cargarLugares(): { recogida: Lugar; entrega: Lugar } { return { recogida: { ...LUGAR_VACIO }, entrega: { ...LUGAR_VACIO} }; }
export function guardarDestino(url: string): void { if (typeof window === 'undefined') return; try { sessionStorage.setItem('drivepass_next', url); } catch {} }
export function tomarDestino(): string | null { if (typeof window === 'undefined') return null; try { const v = sessionStorage.getItem('drivepass_next'); if (v) sessionStorage.removeItem('drivepass_next'); return v; } catch { return null; } }
export const MUNICIPIOS = [{ id: 'aeropuerto-jmc', nombre: 'Aeropuerto JMC', aeropuerto: true, barrios: [] }, { id: 'medellin', nombre: 'Medellín', barrios: ['El Poblado', 'Laureles'] }];
export function getMunicipio(id: string) { return MUNICIPIOS.find(m => m.id === id); }