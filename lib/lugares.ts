// Catálogo de lugares de recogida/entrega para DrivePass: municipios del Área
// Metropolitana del Valle de Aburrá + Rionegro (aeropuerto JMC). El aeropuerto
// es un punto especial con recargo. Compartido por inicio, detalle y pago, y
// usado server-side en /api/reservas para calcular el recargo de forma autoritativa.

export type Lugar = {
  municipio: string;  // id del municipio (ver MUNICIPIOS)
  barrio: string;     // vacío si es aeropuerto
  direccion: string;  // dirección exacta que escribe la persona
  hora: string;       // HH:MM
};

export const LUGAR_VACIO: Lugar = { municipio: '', barrio: '', direccion: '', hora: '' };

export const RECARGO_AEROPUERTO = 100000;

export type Municipio = {
  id: string;
  nombre: string;
  aeropuerto?: boolean;
  barrios: string[];
};

// El aeropuerto va primero por ser el punto clave de recogida/entrega.
export const MUNICIPIOS: Municipio[] = [
  {
    id: 'aeropuerto-jmc',
    nombre: 'Aeropuerto José María Córdova (Rionegro)',
    aeropuerto: true,
    barrios: [],
  },
  {
    id: 'medellin',
    nombre: 'Medellín',
    barrios: [
      'El Poblado', 'Laureles', 'Belén', 'La América', 'Estadio', 'Conquistadores',
      'Buenos Aires', 'Boston', 'Prado Centro', 'La Candelaria (Centro)', 'Aranjuez',
      'Manrique', 'Castilla', 'Robledo', 'Calasanz', 'La Floresta', 'Guayabal',
      'San Javier', 'Los Colores', 'Santa Mónica', 'San Antonio de Prado', 'Santa Elena',
    ],
  },
  {
    id: 'bello',
    nombre: 'Bello',
    barrios: ['Niquía', 'La Cumbre', 'Madera', 'París', 'El Trébol', 'Cabañas', 'Santa Ana', 'Zamora', 'La Navarra', 'Suárez'],
  },
  {
    id: 'itagui',
    nombre: 'Itagüí',
    barrios: ['Centro', 'Santa María', 'La Gloria', 'San Pío', 'Ditaires', 'San Francisco', 'Las Mercedes', 'Calatrava', 'El Rosario', 'San Gabriel'],
  },
  {
    id: 'envigado',
    nombre: 'Envigado',
    barrios: ['El Dorado', 'La Magnolia', 'El Esmeraldal', 'Las Vegas', 'San Marcos', 'El Portal', 'Zúñiga', 'La Paz', 'Loma del Barro', 'El Trianón'],
  },
  {
    id: 'sabaneta',
    nombre: 'Sabaneta',
    barrios: ['Centro', 'Aliadas', 'San Joaquín', 'Las Lomitas', 'La Doctora', 'Holanda', 'Restrepo Naranjo', 'María Auxiliadora', 'Playas', 'Vegas de la Doctora'],
  },
  {
    id: 'la-estrella',
    nombre: 'La Estrella',
    barrios: ['Centro', 'Ancón', 'La Tablaza', 'Pueblo Viejo', 'Sagrada Familia', 'Caquetá', 'San Isidro', 'Tablacita'],
  },
];

export function getMunicipio(id: string): Municipio | undefined {
  return MUNICIPIOS.find(m => m.id === id);
}

export function esAeropuerto(municipioId: string): boolean {
  return !!getMunicipio(municipioId)?.aeropuerto;
}

/** Recargo por trayecto: $100.000 por cada extremo (recogida y/o entrega) que sea el aeropuerto. */
export function calcularRecargo(recogida?: Lugar | null, entrega?: Lugar | null): number {
  let r = 0;
  if (recogida && esAeropuerto(recogida.municipio)) r += RECARGO_AEROPUERTO;
  if (entrega && esAeropuerto(entrega.municipio)) r += RECARGO_AEROPUERTO;
  return r;
}

/** Un lugar es válido si tiene municipio y hora; fuera del aeropuerto también barrio y dirección exacta. */
export function lugarValido(l?: Lugar | null): boolean {
  if (!l || !l.municipio || !l.hora) return false;
  if (esAeropuerto(l.municipio)) return true;
  return !!l.barrio && !!l.direccion.trim();
}

/** Texto resumido para mostrar un lugar en confirmaciones. */
export function lugarResumen(l?: Lugar | null): string {
  if (!l || !l.municipio) return '—';
  const m = getMunicipio(l.municipio);
  const nombre = m?.nombre ?? l.municipio;
  if (m?.aeropuerto) {
    const dir = l.direccion ? ` (${l.direccion})` : '';
    return `${nombre}${dir}${l.hora ? ' · ' + l.hora : ''}`;
  }
  const partes = [l.barrio, nombre].filter(Boolean).join(', ');
  const dir = l.direccion ? ` — ${l.direccion}` : '';
  return `${partes}${dir}${l.hora ? ' · ' + l.hora : ''}`;
}

// ── Persistencia entre páginas (inicio → detalle → pago) vía sessionStorage ──
const KEY = 'drivepass_lugares';

export function guardarLugares(recogida: Lugar, entrega: Lugar): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ recogida, entrega })); } catch { /* storage no disponible */ }
}

// ── Destino pendiente tras iniciar sesión / registrarse (continuar la reserva) ──
const NEXT_KEY = 'drivepass_next';

export function guardarDestino(url: string): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(NEXT_KEY, url); } catch { /* storage no disponible */ }
}

/** Devuelve el destino pendiente y lo borra (uso de una sola vez). */
export function tomarDestino(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(NEXT_KEY);
    if (v) sessionStorage.removeItem(NEXT_KEY);
    return v;
  } catch {
    return null;
  }
}

export function cargarLugares(): { recogida: Lugar; entrega: Lugar } {
  const vacio = { recogida: { ...LUGAR_VACIO }, entrega: { ...LUGAR_VACIO } };
  if (typeof window === 'undefined') return vacio;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return vacio;
    const p = JSON.parse(raw);
    return {
      recogida: { ...LUGAR_VACIO, ...(p.recogida || {}) },
      entrega:  { ...LUGAR_VACIO, ...(p.entrega  || {}) },
    };
  } catch {
    return vacio;
  }
}
