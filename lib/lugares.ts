// Catálogo de lugares de recogida/entrega para DrivePass
export type Lugar = { municipio: string; barrio: string; direccion: string; hora: string; };
export const LUGAR_VACIO: Lugar = { municipio: '', barrio: '', direccion: '', hora: '' };

export const MUNICIPIO_AEROPUERTO = 'aeropuerto-jmc';
export const MUNICIPIO_AEROPUERTO_OLAYA = 'aeropuerto-olaya';
export const MUNICIPIO_PUNTO_ATENCION = 'punto-san-joaquin';
export const DIRECCION_PUNTO_ATENCION = 'Calle 42A #68A-10';

// ── Catálogo y tarifa ────────────────────────────────────────────────────────
// El recargo NO es "el del aeropuerto": cada lugar tiene el suyo y es el catálogo
// —esta lista— la ÚNICA fuente de verdad. El desplegable de la UI y el cobro leen
// de aquí, así que es imposible ofrecerle al cliente un lugar sin precio.
// El recargo es POR TRAMO: recogida y entrega se suman (recoger y entregar en el
// aeropuerto = 2 × $150.000).
export type LugarCatalogo = {
  id: string;
  nombre: string;
  /** Recargo por TRAMO, en pesos. 0 = no se cobra. */
  recargo: number;
  /** false = no se le EXIGEN barrio ni dirección exacta al cliente: ya sabemos dónde es. */
  pideDireccion: boolean;
  /** Dirección conocida del lugar. Se guarda en la reserva y se le muestra al cliente. */
  direccionFija?: string;
  /**
   * Solo los aeropuertos: además del recargo, se ofrece el campo terminal/vuelo.
   * NO implica tarifa de aeropuerto —cada lugar cobra lo que diga su `recargo`—,
   * solo que la dirección que da el cliente es un vuelo y no una calle.
   */
  aeropuerto?: boolean;
  /** Sugerencias para el campo de barrio (texto libre: la lista nunca está completa). */
  barrios?: string[];
};

export const LUGARES: LugarCatalogo[] = [
  { id: MUNICIPIO_PUNTO_ATENCION, nombre: 'Punto de atención San Joaquín', recargo: 0, pideDireccion: false, direccionFija: DIRECCION_PUNTO_ATENCION },
  { id: 'medellin', nombre: 'Medellín', recargo: 35000, pideDireccion: true, barrios: ['El Poblado', 'Laureles'] },
  { id: 'envigado', nombre: 'Envigado', recargo: 35000, pideDireccion: true },
  { id: 'bello', nombre: 'Bello', recargo: 45000, pideDireccion: true },
  { id: 'itagui', nombre: 'Itagüí', recargo: 45000, pideDireccion: true },
  { id: 'sabaneta', nombre: 'Sabaneta', recargo: 50000, pideDireccion: true },
  { id: 'la-estrella', nombre: 'La Estrella', recargo: 50000, pideDireccion: true },
  { id: 'copacabana', nombre: 'Copacabana', recargo: 50000, pideDireccion: true },
  { id: MUNICIPIO_AEROPUERTO, nombre: 'Aeropuerto JMC', recargo: 150000, pideDireccion: false, aeropuerto: true },
  // Olaya Herrera está DENTRO de Medellín (no en Rionegro como el JMC), así que el
  // desplazamiento es el mismo de cualquier punto de la ciudad y cobra la tarifa de
  // Medellín, no la del JMC. Los Términos y /para-usuarios ya lo ofrecían pero no
  // era seleccionable: no había forma de reservarlo desde la web.
  { id: MUNICIPIO_AEROPUERTO_OLAYA, nombre: 'Aeropuerto Olaya Herrera', recargo: 35000, pideDireccion: false, aeropuerto: true },
];

/** El recargo más caro del catálogo. Red de seguridad de `recargoTramo`: un lugar
 *  fuera del catálogo nunca sale gratis (y además `lugarValido` ya lo rechazó). */
export const RECARGO_MAXIMO = LUGARES.reduce((max, l) => Math.max(max, l.recargo), 0);

// ── Normalización: UN SOLO punto de entrada ──────────────────────────────────
// Todo lo que decide sobre un lugar (¿es válido?, ¿cuánto cobra?, ¿cómo se
// resume?) mira el MISMO valor normalizado. Que una función normalizara y otra
// no ya costó un bug de plata: con `municipio: ' aeropuerto-jmc '` (con espacios)
// la validación entraba por el atajo de aeropuerto —no pide barrio ni dirección—
// pero el recargo comparaba el valor crudo y daba $0: reserva creada y facturada
// $100.000 más barata, en silencio, por las dos vías (pública y mostrador).
//
// Al generalizar a una tabla de tarifas ese principio se mantiene: `getLugar` es
// el único acceso al catálogo y recorta el id igual que `normalizarLugar`, así
// que validación, cobro y resumen siempre resuelven el mismo lugar.
//
// Los campos NO se coercionan: un lugar con `barrio: 0` o `direccion: 123` es un
// lugar INVÁLIDO (400), no un "0"/"123" válido. Un campo ausente (undefined/null)
// cuenta como '' , igual que siempre.
const CAMPOS_LUGAR = ['municipio', 'barrio', 'direccion', 'hora'] as const;

/**
 * Convierte cualquier cosa que venga del body de una request en un `Lugar` con
 * los 4 campos presentes y recortados, o `null` si no puede serlo.
 * Es la ÚNICA función que normaliza; el resto se apoya en ella.
 *
 * Además canoniza los lugares de dirección conocida (hoy el punto de atención):
 * su dirección la pone el catálogo, no el cliente, para que la reserva guardada
 * siempre diga a dónde ir —venga de la web, del mostrador o de un curl— y para
 * que no quede un barrio suelto de una selección anterior.
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
  const cat = getLugar(out.municipio);
  if (cat?.direccionFija) { out.direccion = cat.direccionFija; out.barrio = ''; }
  return out;
}

/** Municipio ya normalizado de un lugar cualquiera ('' si no se puede leer). */
function municipioDe(l?: Lugar | null): string {
  const m = l && typeof l === 'object' ? (l as Lugar).municipio : undefined;
  return typeof m === 'string' ? m.trim() : '';
}

/**
 * Único acceso al catálogo. Recorta igual que `normalizarLugar` —el typeof no
 * sobra: también lo llaman componentes con datos que vienen de la red, donde el
 * tipo es una promesa, no un hecho—. `undefined` = el lugar no existe.
 */
export function getLugar(municipioId: unknown): LugarCatalogo | undefined {
  const id = typeof municipioId === 'string' ? municipioId.trim() : '';
  return id ? LUGARES.find(m => m.id === id) : undefined;
}

export function esAeropuerto(municipioId: unknown): boolean {
  return getLugar(municipioId)?.aeropuerto === true;
}

/** Recargo de UN tramo (recogida o entrega). */
export function recargoTramo(l?: Lugar | null): number {
  const m = municipioDe(l);
  if (!m) return 0;                    // todavía no eligió lugar: no hay nada que cobrar (y `lugarValido` lo rechaza)
  const cat = getLugar(m);
  // Fuera del catálogo: `lugarValido` ya lo rechazó (no se crea la reserva). Si
  // alguien llegara acá sin validar, se cobra la tarifa más alta: jamás "gratis".
  return cat ? cat.recargo : RECARGO_MAXIMO;
}

export function calcularRecargo(recogida?: Lugar | null, entrega?: Lugar | null): number {
  return recargoTramo(recogida) + recargoTramo(entrega);
}

export function lugarValido(l?: Lugar | null): boolean {
  const n = normalizarLugar(l);
  if (!n || !n.municipio || !n.hora) return false;
  // Fail-closed: un lugar que no está en el catálogo no tiene tarifa NI logística
  // (nadie sabría a dónde ir), así que se rechaza en vez de inventarle un precio.
  const cat = getLugar(n.municipio);
  if (!cat) return false;
  // Aeropuerto y punto de atención no tienen barrio ni dirección que pedir. El
  // atajo y el cobro usan el MISMO criterio (el catálogo, sobre el municipio ya
  // normalizado): o se cobra lo que diga la tabla, o el lugar se rechaza; nunca
  // "válido y gratis".
  if (!cat.pideDireccion) return true;
  return !!n.barrio && !!n.direccion;
}

/** Texto corto del lugar para resúmenes, correos y paneles. */
export function lugarResumen(l?: Lugar | null): string {
  const m = municipioDe(l);
  if (!m) return '—';
  const cat = getLugar(m);
  if (!cat) return m; // lugar viejo o desconocido: al menos se ve qué se guardó
  return cat.direccionFija ? `${cat.nombre} — ${cat.direccionFija}` : cat.nombre;
}

// Cálculo del total de un alquiler — la MISMA fórmula la usa la reserva real (app/api/reservas/route.ts) y el cotizador de venta (sin reserva, lib/contabilidad.ts), para que nunca se desincronicen.
export function calcularDiasAlquiler(fechaInicio: string, fechaFin: string): number {
  return Math.max(1, Math.ceil((new Date(fechaFin).getTime() - new Date(fechaInicio).getTime()) / 86400000));
}
export function calcularTotalAlquiler(dias: number, precioDia: number, recargo: number): number {
  return dias * precioDia + recargo;
}
export function guardarLugares(recogida: Lugar, entrega: Lugar): void { if (typeof window === 'undefined') return; try { sessionStorage.setItem('drivepass_lugares', JSON.stringify({ recogida, entrega })); } catch {} }
/**
 * Lee los lugares que `guardarLugares` dejó en sessionStorage al elegirlos en la
 * ficha del vehículo. Es lo que `app/pago/page.tsx` usa para saber dónde recoger
 * y entregar: ahí NO hay selector, solo se muestran.
 *
 * ⚠️ Esta función estuvo devolviendo SIEMPRE lugares vacíos (ignoraba lo guardado).
 * El efecto no era cosmético: el checkout mandaba `municipio: ''`, el servidor lo
 * rechazaba con "Indica el lugar y la hora de recogida" y el cliente no tenía cómo
 * corregirlo, porque el lugar se elige dos pantallas atrás. Producción llevaba 0
 * reservas completadas por la web. Si alguien vuelve a "simplificar" esto,
 * que sepa qué rompe.
 *
 * Cada lugar se pasa por `normalizarLugar` para no confiar en lo que haya en
 * sessionStorage (lo puede editar cualquiera desde el navegador): si no tiene la
 * forma de un Lugar, se devuelve vacío y la ficha lo vuelve a pedir. La validación
 * que manda sigue siendo la del servidor.
 */
export function cargarLugares(): { recogida: Lugar; entrega: Lugar } {
  const vacio = { recogida: { ...LUGAR_VACIO }, entrega: { ...LUGAR_VACIO } };
  if (typeof window === 'undefined') return vacio;
  try {
    const crudo = sessionStorage.getItem('drivepass_lugares');
    if (!crudo) return vacio;
    const datos = JSON.parse(crudo) as { recogida?: unknown; entrega?: unknown };
    return {
      recogida: normalizarLugar(datos?.recogida) ?? { ...LUGAR_VACIO },
      entrega: normalizarLugar(datos?.entrega) ?? { ...LUGAR_VACIO },
    };
  } catch { return vacio; }
}
export function guardarDestino(url: string): void { if (typeof window === 'undefined') return; try { sessionStorage.setItem('drivepass_next', url); } catch {} }
export function tomarDestino(): string | null { if (typeof window === 'undefined') return null; try { const v = sessionStorage.getItem('drivepass_next'); if (v) sessionStorage.removeItem('drivepass_next'); return v; } catch { return null; } }