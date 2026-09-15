// ── Casillas de fotos del servicio ──────────────────────────────────────────
//
// ÚNICA FUENTE DE VERDAD de las 8 zonas que hay que fotografiar en cada fase del
// servicio (8 en la SALIDA + 8 en la ENTRADA = 16 por servicio). La usan:
//   · la pantalla del mensajero (app/m/[token]/page.tsx),
//   · el panel de Operaciones del admin (components/OperacionesPanel.tsx) vía
//     components/CasillasFotos.tsx,
//   · la inspección con IA (lib/inspeccion-vehiculo.ts), que etiqueta cada foto
//     con el nombre de su zona y la empareja con su equivalente de la otra fase,
//   · el acta de respaldo (lib/acta-servicio.ts y lib/acta-servicio-pdf.ts),
//   · el bloqueo de las tareas de entrega/devolución (lib/operaciones.ts).
// Si cambian las zonas o sus instrucciones, se cambian ACÁ y en ningún otro lado.
//
// ⚠️ Módulo PURO: sin `fs`, sin `better-sqlite3`, sin nada de servidor. Se importa
// desde componentes 'use client' igual que lib/lugares.ts o lib/pico-placa.ts.
//
// ── Por qué casillas y no una lista suelta ──────────────────────────────────
// Antes las fotos eran un array plano de URLs: el mensajero subía las que quisiera
// en el orden que quisiera. Eso rompía dos cosas a la vez: no había mínimo (se
// cerraban servicios con dos fotos) y la IA que compara salida contra entrada no
// sabía QUÉ zona estaba viendo en cada foto. En las pruebas reales, la IA se
// quejaba una y otra vez de no poder comparar zonas que solo aparecían en uno de
// los dos juegos. Con casillas fijas, la misma zona sale en las dos fases y la
// comparación tiene sentido.
//
// ── Compatibilidad con lo que ya existe (CRÍTICO) ───────────────────────────
// Hay operaciones en producción con las fotos guardadas como array plano de
// strings (`["https://…", "https://…"]`). Esas fotos NO se pueden perder ni dejar
// de mostrar. El formato nuevo es un array de objetos `{casilla, url}`, y
// `parseFotosServicio` acepta LOS DOS: un string suelto se lee como una foto "sin
// casilla asignada" (`casilla: null`), que la interfaz muestra aparte y la IA
// etiqueta como siempre ("SALIDA 1/8"). Nunca se reescriben las filas viejas.

/** Las dos fases del servicio. La entrega al cliente es SALIDA; la devolución, ENTRADA. */
export type FaseFoto = 'salida' | 'entrada';

export const FASES: readonly FaseFoto[] = ['salida', 'entrada'] as const;

export function esFase(v: unknown): v is FaseFoto {
  return v === 'salida' || v === 'entrada';
}

/** Nombre de la fase tal como se le habla al mensajero. */
export const FASE_NOMBRE: Record<FaseFoto, string> = {
  salida: 'entrega al cliente',
  entrada: 'devolución del cliente',
};

export type CasillaId =
  | 'esq_del_izq'
  | 'esq_tras_izq'
  | 'esq_tras_der'
  | 'esq_del_der'
  | 'tablero'
  | 'interior_del'
  | 'interior_tras'
  | 'llantas';

export type Casilla = {
  id: CasillaId;
  /** Nombre corto para la lista y para las etiquetas que ve la IA. */
  nombre: string;
  /** Cómo tomarla. Se le muestra al mensajero debajo del nombre, siempre visible. */
  instruccion: string;
};

/**
 * Las 8 casillas, en el orden en que se recorre el carro: las cuatro esquinas en
 * sentido de las manecillas empezando por la delantera izquierda (así el mensajero
 * da UNA vuelta al carro sin devolverse), después el tablero, el interior y las
 * llantas.
 *
 * Las instrucciones incluyen las advertencias que salieron de las pruebas reales
 * con la IA, porque cada una corresponde a un fallo que de verdad ocurrió:
 *   · Fotos en diagonal desde la esquina: una foto plana del costado no deja ver
 *     el frente ni la parte de atrás, y la IA se quedaba sin la mitad del carro.
 *   · "Que salga completo, sin recortar": con la zona recortada la IA no podía
 *     confirmar si un rayón ya estaba en la salida y lo mandaba a
 *     `zonas_no_comparables`.
 *   · Contraluz: con el sol de frente la carrocería sale negra y cualquier sombra
 *     parece un golpe.
 *   · No fotografiar a través del vidrio: el reflejo del vidrio se lee como rayón.
 *   · El tablero solo se lee con el carro ENCENDIDO: apagado no marca gasolina.
 */
export const CASILLAS: readonly Casilla[] = [
  {
    id: 'esq_del_izq',
    nombre: 'Esquina delantera izquierda',
    instruccion: 'Párate en diagonal frente a la esquina, a unos 2 metros, y que salgan completos el frente y todo el costado izquierdo. No te pongas con el sol de frente: si el carro sale oscuro, muévete.',
  },
  {
    id: 'esq_tras_izq',
    nombre: 'Esquina trasera izquierda',
    instruccion: 'Ahora en diagonal desde atrás, a unos 2 metros: que salgan completos la parte de atrás y todo el costado izquierdo, sin recortar el bómper.',
  },
  {
    id: 'esq_tras_der',
    nombre: 'Esquina trasera derecha',
    instruccion: 'La misma diagonal del otro lado: parte de atrás y costado derecho completos. Da la vuelta al carro, no la tomes desde lejos con zoom.',
  },
  {
    id: 'esq_del_der',
    nombre: 'Esquina delantera derecha',
    instruccion: 'Cierras la vuelta: en diagonal desde el frente, con el frente y todo el costado derecho completos dentro de la foto.',
  },
  {
    id: 'tablero',
    nombre: 'Tablero encendido',
    instruccion: 'Enciende el carro antes de la foto (apagado no marca la gasolina). Abre la puerta y toma el tablero de frente, sin fotografiar a través del vidrio. Que se lean el kilometraje y la aguja de la gasolina.',
  },
  {
    id: 'interior_del',
    nombre: 'Interior delantero',
    instruccion: 'Con la puerta abierta, toma los asientos de adelante y la consola. Sin fotografiar a través del vidrio y sin que la puerta tape los asientos.',
  },
  {
    id: 'interior_tras',
    nombre: 'Interior trasero y baúl',
    instruccion: 'Los asientos de atrás con la puerta abierta. Si el baúl trae algo (herramienta, llanta de repuesto), ábrelo y que salga en la misma foto o repítela con el baúl abierto.',
  },
  {
    id: 'llantas',
    nombre: 'Llantas y rines',
    instruccion: 'Agáchate hasta la altura de la llanta y toma las de un costado con el rin completo. Se ven mejor las rayadas de los rines desde abajo que desde arriba.',
  },
] as const;

export const TOTAL_CASILLAS = CASILLAS.length;

const CASILLAS_POR_ID = new Map<string, Casilla>(CASILLAS.map(c => [c.id, c]));

export function esCasilla(v: unknown): v is CasillaId {
  return typeof v === 'string' && CASILLAS_POR_ID.has(v);
}

/** Nombre visible de una casilla. Una casilla desconocida (o `null`) no revienta nada. */
export function nombreCasilla(id: CasillaId | null | undefined): string {
  if (!id) return 'Sin casilla asignada';
  return CASILLAS_POR_ID.get(id)?.nombre ?? id;
}

/** Posición humana de la casilla ("3 de 8"). 0 si no se reconoce. */
export function ordenCasilla(id: CasillaId | null | undefined): number {
  if (!id) return 0;
  return CASILLAS.findIndex(c => c.id === id) + 1;
}

// ── Fotos ───────────────────────────────────────────────────────────────────

/** Una foto del servicio. `casilla: null` = foto vieja, sin zona asignada. */
export type FotoServicio = { url: string; casilla: CasillaId | null };

/**
 * Lee la columna `operaciones.fotos_salida` / `fotos_entrada` TOLERANDO los dos
 * formatos que conviven en producción:
 *   · legado: `["https://…", "https://…"]` → cada string queda con `casilla: null`;
 *   · nuevo:  `[{"casilla":"tablero","url":"https://…"}, …]`.
 * Acepta tanto el JSON crudo (string) como el valor ya parseado, porque el mismo
 * dato llega del servidor como texto y del cliente a veces ya deserializado.
 * Cualquier basura se ignora en silencio: esta función no puede lanzar nunca — la
 * usan pantallas que ya están en la calle.
 */
export function parseFotosServicio(raw: unknown): FotoServicio[] {
  let valor: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { valor = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((f): FotoServicio[] => {
    if (typeof f === 'string') return f.trim() ? [{ url: f, casilla: null }] : [];
    if (!f || typeof f !== 'object') return [];
    const { url, casilla } = f as { url?: unknown; casilla?: unknown };
    if (typeof url !== 'string' || !url.trim()) return [];
    return [{ url, casilla: esCasilla(casilla) ? casilla : null }];
  });
}

/** Tope de largo de una URL de foto. Las de Cloudinary rondan los 120 caracteres. */
export const URL_MAX = 2000;

/**
 * Hosts desde los que el SERVIDOR acepta (y descarga) una foto de servicio.
 * Es el CDN al que sube `uploadFile()` de lib/storage.ts, y nada más.
 */
export const HOSTS_FOTO: readonly string[] = ['res.cloudinary.com'];

/** Prefijo de las fotos legado guardadas en el filesystem local (public/uploads). */
export const RUTA_FOTO_LOCAL = '/uploads/';

/**
 * ¿Este hostname es una IP privada, de loopback o de enlace local?
 *
 * Solo mira literales (no resuelve DNS: este módulo es puro y corre también en el
 * navegador). Hoy es redundante con la allowlist de host de `esUrlFotoSegura` —
 * `res.cloudinary.com` no es ninguna de estas—, pero es la red de seguridad si
 * mañana alguien agrega un host a `HOSTS_FOTO`: la URL guardada se CONGELA en el
 * acta y el servidor la descarga después (lib/acta-servicio-pdf.ts, la inspección
 * con IA), así que una URL apuntando a 169.254.169.254 o a 127.0.0.1 sería una
 * petición del servidor contra su propia red interna (SSRF).
 */
export function esHostPrivado(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv6: loopback, enlace local (fe80::/10) y direcciones únicas locales (fc00::/7).
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) return true;
  // IPv4 (también las mapeadas en IPv6, ::ffff:10.0.0.1).
  const m = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(h);
  if (!m) return false;
  const o = m[1].split('.').map(Number);
  if (o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true; // no es una IP válida
  if (o[0] === 10 || o[0] === 127 || o[0] === 0) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  if (o[0] === 169 && o[1] === 254) return true;
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
  return o[0] >= 224; // multicast / reservadas
}

/**
 * ¿Esta URL se puede guardar como foto del servicio?
 *
 * Se valida al ESCRIBIR (en las rutas), nunca al leer: las URLs que ya están
 * guardadas se muestran como estén, porque filtrarlas al leer sería borrar fotos de
 * respaldo de servicios reales sin que nadie se entere.
 *
 * Es una allowlist de DESTINO, no solo de esquema. Dos cosas se cierran acá:
 *
 *  1. XSS almacenado: un `javascript:` o un `data:` guardado no solo se pinta en un
 *     `<img>` (donde sería inerte), también sale como `href` del botón de descarga
 *     del visor a pantalla completa (components/VisorFotos.tsx), y ahí sí se
 *     ejecuta al hacer clic — en la sesión del administrador.
 *  2. SSRF: la URL se CONGELA en el acta y después el SERVIDOR la descarga para
 *     armar el PDF (lib/acta-servicio-pdf.ts) y para la inspección con IA. Aceptar
 *     cualquier `http(s)://` era dejar que quien tiene el enlace del mensajero
 *     (sin login) eligiera a qué dirección se conecta el servidor: `http://10.0.0.5/`,
 *     `http://169.254.169.254/latest/meta-data/`…
 *
 * Se acepta, entonces: `https://` a uno de `HOSTS_FOTO` (el CDN donde escribe
 * `uploadFile()`), o una ruta del PROPIO sitio bajo `/uploads/` (las fotos legado
 * que quedaron en el filesystem). Las formas que un parser resuelve hacia OTRO
 * origen se rechazan explícitamente: `//evil.com/x` (protocol-relative) y
 * `/\evil.com/x` o `\\evil.com\x`, porque el parser WHATWG del navegador trata `\`
 * igual que `/` y ambas terminan en evil.com.
 */
export function esUrlFotoSegura(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || u.length > URL_MAX) return false;
  // Caracteres de control (incluido \n): parten la URL y engañan a cualquier parser.
  if (/[\u0000-\u001f\u007f]/.test(u)) return false;
  // `//host`, `/\host`, `\\host`, `\/host`: el esquema lo pone el navegador y el
  // destino es otro origen.
  if (/^[/\\]{2}/.test(u)) return false;

  if (u.startsWith('/')) return u.startsWith(RUTA_FOTO_LOCAL) && !u.includes('..');

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (esHostPrivado(host)) return false;
  return HOSTS_FOTO.includes(host);
}

/**
 * Deja la lista lista para guardar: UNA sola foto por casilla (la última gana, que
 * es lo que espera quien acaba de repetir una foto) y sin URLs repetidas. Las fotos
 * sin casilla se conservan TODAS y en su orden original: son las de las operaciones
 * viejas y no hay ningún criterio para descartar una.
 */
export function normalizarFotos(fotos: FotoServicio[]): FotoServicio[] {
  const porCasilla = new Map<CasillaId, FotoServicio>();
  const sinCasilla: FotoServicio[] = [];
  const urlsVistas = new Set<string>();
  for (const f of fotos) {
    if (f.casilla) { porCasilla.set(f.casilla, f); continue; }
    if (urlsVistas.has(f.url)) continue;
    urlsVistas.add(f.url);
    sinCasilla.push({ url: f.url, casilla: null });
  }
  // Orden estable: primero las casillas en el orden del recorrido, después las
  // sueltas. Así el acta y el visor muestran siempre lo mismo.
  const ordenadas = CASILLAS.flatMap(c => {
    const f = porCasilla.get(c.id);
    return f ? [{ url: f.url, casilla: c.id }] : [];
  });
  return [...ordenadas, ...sinCasilla.filter(f => !ordenadas.some(o => o.url === f.url))];
}

/** La foto de una casilla concreta, o `undefined` si todavía no se ha tomado. */
export function fotoDeCasilla(fotos: FotoServicio[], casilla: CasillaId): FotoServicio | undefined {
  return fotos.find(f => f.casilla === casilla);
}

/** Las fotos que NO tienen casilla (operaciones viejas). Se muestran aparte. */
export function fotosSinCasilla(fotos: FotoServicio[]): FotoServicio[] {
  return fotos.filter(f => f.casilla === null);
}

// ── Casillas omitidas con motivo ────────────────────────────────────────────
//
// Exigir las 8 fotos sin escapatoria deja al mensajero varado en la calle: sin
// batería, sin señal, de noche, o con el carro en un parqueadero tan apretado que
// no se puede dar la vuelta. Por eso una casilla se puede OMITIR, pero solo
// escribiendo el motivo — y ese motivo queda con el nombre de quien lo escribió y
// la hora, y sale en el acta de respaldo. Exigir sin dejar a nadie tirado.

export type OmisionFoto = {
  fase: FaseFoto;
  casilla: CasillaId;
  motivo: string;
  /** Nombre de quien la omitió (mensajero o empleado del panel). */
  autor: string;
  autor_tipo: 'mensajero' | 'admin';
  /** Fecha y hora legibles, congeladas en el momento de omitir. */
  fecha: string;
};

/** Mínimo y máximo del motivo. Un motivo de 2 letras ("no") no es un motivo. */
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 300;

/** Valida y recorta el motivo. Devuelve `null` si no sirve como constancia. */
export function normalizarMotivo(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < MOTIVO_MIN) return null;
  return s.slice(0, MOTIVO_MAX);
}

/** Lee `operaciones.fotos_omitidas`. Igual que `parseFotosServicio`: nunca lanza. */
export function parseOmisiones(raw: unknown): OmisionFoto[] {
  let valor: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { valor = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((o): OmisionFoto[] => {
    if (!o || typeof o !== 'object') return [];
    const { fase, casilla, motivo, autor, autor_tipo, fecha } = o as Record<string, unknown>;
    if (!esFase(fase) || !esCasilla(casilla)) return [];
    const texto = typeof motivo === 'string' ? motivo.trim() : '';
    if (!texto) return [];
    return [{
      fase,
      casilla,
      motivo: texto.slice(0, MOTIVO_MAX),
      autor: typeof autor === 'string' ? autor : '',
      autor_tipo: autor_tipo === 'admin' ? 'admin' : 'mensajero',
      fecha: typeof fecha === 'string' ? fecha : '',
    }];
  });
}

export function omisionesDeFase(omisiones: OmisionFoto[], fase: FaseFoto): OmisionFoto[] {
  return omisiones.filter(o => o.fase === fase);
}

export function omisionDeCasilla(omisiones: OmisionFoto[], fase: FaseFoto, casilla: CasillaId): OmisionFoto | undefined {
  return omisiones.find(o => o.fase === fase && o.casilla === casilla);
}

// ── Estado de una fase ──────────────────────────────────────────────────────

/**
 * Casillas de `fase` que ni tienen foto ni están omitidas con motivo. Si devuelve
 * una lista vacía, la fase está lista y su tarea se puede marcar como hecha.
 * Esta es la función que decide el bloqueo, y la llama el SERVIDOR
 * (lib/operaciones.ts) además de la pantalla: que la interfaz deshabilite un
 * botón es cosmético.
 */
export function casillasPendientes(fotos: FotoServicio[], omisiones: OmisionFoto[], fase: FaseFoto): Casilla[] {
  return CASILLAS.filter(c => !fotoDeCasilla(fotos, c.id) && !omisionDeCasilla(omisiones, fase, c.id));
}

/** Resumen para el encabezado de la pantalla: "6 de 8 · 1 omitida". */
export type ResumenFase = { tomadas: number; omitidas: number; faltan: number; total: number; sinCasilla: number };

export function resumenFase(fotos: FotoServicio[], omisiones: OmisionFoto[], fase: FaseFoto): ResumenFase {
  const tomadas = CASILLAS.filter(c => !!fotoDeCasilla(fotos, c.id)).length;
  const omitidas = omisionesDeFase(omisiones, fase).filter(o => !fotoDeCasilla(fotos, o.casilla)).length;
  return {
    tomadas,
    omitidas,
    faltan: TOTAL_CASILLAS - tomadas - omitidas,
    total: TOTAL_CASILLAS,
    sinCasilla: fotosSinCasilla(fotos).length,
  };
}

// ── Desde cuándo se exige el recorrido guiado ───────────────────────────────
//
// FECHA EN QUE SE LANZÓ el recorrido de 8 casillas por fase. Sirve para UNA sola
// decisión: cuando el backfill de GET /api/operaciones crea la operación que le
// faltaba a una reserva, ¿se le exigen las fotos o no?
//
// Antes esa decisión se tomaba por CAMINO DE CÓDIGO ("viene del backfill, luego es
// una reserva vieja, luego queda exenta"), y eso es falso: una reserva se puede
// quedar sin operación por otros motivos —`crearOperacionYNotificar` se traga
// cualquier error en su catch (lib/reserva-confirmacion.ts)— así que una reserva
// confirmada HOY podía terminar con una operación creada por el backfill, exenta del
// bloqueo para siempre. No hay ningún `UPDATE … fotos_guiadas` en el repo: ese 0 es
// irreversible.
//
// Decidir por `reservas.created_at` no tiene ese agujero: lo que manda es cuándo se
// hizo la reserva, no por qué rama pasó. Reserva anterior al lanzamiento → nadie pudo
// tomar esas fotos cuando tocaba, queda exenta. Reserva posterior → se exigen, venga
// por donde venga.
//
// ⚠️ Esta constante es la fecha en que el recorrido guiado entra en producción. Si el
// despliegue se mueve, se mueve acá. `reservas.created_at` se guarda en UTC
// (`datetime('now')`, ver lib/db.ts), y Colombia va en UTC-5: una reserva hecha la
// noche anterior al lanzamiento puede caer del lado "se exige". Es el error que
// conviene: pedir fotos de más en una operación nueva se resuelve con el motivo
// escrito; perdonarlas deja un servicio sin respaldo y no se puede deshacer.
export const FECHA_LANZAMIENTO_CASILLAS = '2026-09-15';

/**
 * ¿A una reserva creada en `createdAt` le corresponde el recorrido guiado?
 * `createdAt` viene de `reservas.created_at` ('YYYY-MM-DD HH:MM:SS'), así que la
 * comparación de textos ordena igual que la cronología. Sin fecha (dato viejo o
 * corrupto) se responde `false`: no se le exige nada a una reserva de la que no
 * sabemos cuándo nació.
 */
export function exigeCasillasPorFecha(createdAt: string | null | undefined): boolean {
  const s = typeof createdAt === 'string' ? createdAt.trim() : '';
  if (!s) return false;
  return s >= FECHA_LANZAMIENTO_CASILLAS;
}

/** La tarea del checklist que corresponde a cada fase (ver `plantillaTareas`). */
export const TIPO_TAREA_POR_FASE: Record<FaseFoto, string> = {
  salida: 'entrega',
  entrada: 'recepcion',
};

/** La fase que exige una tarea del checklist, o `null` si esa tarea no exige fotos. */
export function faseDeTarea(tipoTarea: string): FaseFoto | null {
  if (tipoTarea === TIPO_TAREA_POR_FASE.salida) return 'salida';
  if (tipoTarea === TIPO_TAREA_POR_FASE.entrada) return 'entrada';
  return null;
}
