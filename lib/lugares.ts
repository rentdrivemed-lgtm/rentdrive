// Catálogo de lugares de recogida/entrega para DrivePass
export type Lugar = { municipio: string; barrio: string; direccion: string; hora: string; };
export const LUGAR_VACIO: Lugar = { municipio: '', barrio: '', direccion: '', hora: '' };
export const RECARGO_AEROPUERTO = 100000;
export function esAeropuerto(municipioId: string): boolean { return municipioId === 'aeropuerto-jmc'; }
export function calcularRecargo(recogida?: Lugar | null, entrega?: Lugar | null): number { let r = 0; if (recogida && esAeropuerto(recogida.municipio)) r += RECARGO_AEROPUERTO; if (entrega && esAeropuerto(entrega.municipio)) r += RECARGO_AEROPUERTO; return r; }
export function lugarValido(l?: Lugar | null): boolean { if (!l || !l.municipio || !l.hora) return false; if (esAeropuerto(l.municipio)) return true; return !!l.barrio && !!l.direccion.trim(); }
export function lugarResumen(l?: Lugar | null): string { if (!l || !l.municipio) return '—'; return l.municipio; }
export function guardarLugares(recogida: Lugar, entrega: Lugar): void { if (typeof window === 'undefined') return; try { sessionStorage.setItem('drivepass_lugares', JSON.stringify({ recogida, entrega })); } catch {} }
export function cargarLugares(): { recogida: Lugar; entrega: Lugar } { return { recogida: { ...LUGAR_VACIO }, entrega: { ...LUGAR_VACIO} }; }
export function guardarDestino(url: string): void { if (typeof window === 'undefined') return; try { sessionStorage.setItem('drivepass_next', url); } catch {} }
export function tomarDestino(): string | null { if (typeof window === 'undefined') return null; try { const v = sessionStorage.getItem('drivepass_next'); if (v) sessionStorage.removeItem('drivepass_next'); return v; } catch { return null; } }
export const MUNICIPIOS = [{ id: 'aeropuerto-jmc', nombre: 'Aeropuerto JMC', aeropuerto: true, barrios: [] }, { id: 'medellin', nombre: 'Medellín', barrios: ['El Poblado', 'Laureles'] }];
export function getMunicipio(id: string) { return MUNICIPIOS.find(m => m.id === id); }