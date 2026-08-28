import type Database from 'better-sqlite3';

// ============================================================================
// Moderación de contenido — texto (lenguaje soez/inapropiado)
// ============================================================================
//
// Filtro simple por lista de palabras + coincidencia exacta de token (no
// substring "a lo bruto"): normalizamos cada palabra del texto (minúsculas,
// sin tildes, solo letras) y comparamos esa palabra COMPLETA contra la lista.
// Esto evita el problema clásico de los filtros por substring — por ejemplo
// "disputa"/"diputado" NO deben marcarse solo porque contienen "puta"/"puto"
// como substring; con coincidencia de palabra completa no pasa, porque
// "disputa" normalizado es "disputa", no "puta".
//
// Al normalizar cada palabra quitamos símbolos/números intercalados (p. ej.
// "p.u.t.o", "p-u-t-o", "put0" sin la o) para tolerar evasión básica con
// separadores, sin sobre-ingeniería (no se intenta cubrir leetspeak
// completo ni frases fragmentadas entre palabras reales separadas por
// espacio, que es exactamente el caso que produce falsos positivos).
//
// Lista deliberadamente NO exhaustiva: cubre groserías/insultos comunes y
// contenido sexual explícito en texto, en español (con variantes coloquiales
// colombianas) e inglés básico. Se excluyen a propósito palabras que son de
// uso cotidiano neutro en Colombia y darían muchos falsos positivos si se
// incluyeran (p. ej. "coger" = tomar/agarrar en LatAm, "huevón" = muletilla
// coloquial muy común y no necesariamente ofensiva; y "concha", ver nota abajo).
//
// Lista en crudo, SIN normalizar (puede tener tildes/ñ reales, tal como se leen). La
// normalización se aplica al construir el Set más abajo — ver el comentario junto a
// `PALABRAS_PROHIBIDAS`.
//
// Nota: se quitó "concha" (antes estaba en la lista): en Colombia es de uso neutro muy
// común (nombre propio, "concha de coco/nuez", etc.) y solo es vulgar en el Cono Sur —
// daba falsos positivos costosos aquí. "coño" sí se mantiene (grosería explícita también
// en Colombia), y ahora SÍ puede coincidir (ver bug de normalización corregido abajo).
const PALABRAS_PROHIBIDAS_RAW = [
  // Español — groserías/insultos comunes
  'mierda', 'mierdas', 'mierdero', 'mierdera',
  'puta', 'putas', 'puto', 'putos', 'putica', 'putico',
  'hijueputa', 'hijoeputa', 'hpta', 'hp', 'hdp',
  'gonorrea', 'malparido', 'malparida', 'malnacido', 'malnacida',
  'cabron', 'cabrona', 'cabrones',
  'pendejo', 'pendeja', 'pendejada', 'pendejadas',
  'culero', 'culera', 'culiado', 'culiada',
  'verga', 'vergas',
  'chingada', 'chingado', 'chingar', 'chingadera', 'chingaderas',
  'joder', 'jodido', 'jodida',
  'maricon', 'mariconada',
  'perra', 'perras', 'zorra', 'zorras',
  'gilipollas',
  'coño',
  'conchudo', 'conchuda',
  'marica',
  // Español — contenido sexual explícito
  'porno', 'pornografia', 'pornografico', 'pornografica',
  'prostituta', 'prostitutas', 'prostitucion',
  'follar', 'follada', 'folladas',
  'vagina', 'vaginas', 'pene', 'penes',
  'tetas', 'chichis',
  'orgia', 'orgias',
  'xxx',
  // Inglés básico
  'fuck', 'fucking', 'fucked', 'fucker',
  'shit', 'bullshit',
  'bitch', 'bitches',
  'asshole', 'assholes',
  'bastard',
  'dick', 'dicks',
  'pussy',
  'cunt',
  'whore', 'whores',
  'slut', 'sluts',
  'porn', 'porno',
  'cock',
  'faggot',
];

function normalizarPalabra(palabra: string): string {
  return palabra
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes/diacríticos
    .replace(/[^a-z]/g, ''); // deja solo letras (quita números y símbolos intercalados)
}

// IMPORTANTE (bug corregido): la lista de arriba se normaliza con la MISMA función
// `normalizarPalabra` que se usa para normalizar el texto del usuario en
// `contieneLenguajeInapropiado`. Antes la lista tenía 'coño' literal (con ñ real, SIN
// pasar por normalizarPalabra) mientras que cada palabra del texto del usuario SÍ se
// normalizaba antes de compararse — normalizarPalabra hace `.normalize('NFD')` seguido
// de quitar diacríticos, lo que descompone la 'ñ' en 'n' + tilde y luego elimina la
// tilde, dejando "cono". Como los dos lados de la comparación quedaban en formatos
// distintos ("coño" en la lista vs "cono" viniendo del texto), 'coño' NUNCA podía
// coincidir. Al normalizar también la lista con `.map(normalizarPalabra)`, ambos lados
// quedan en el mismo formato y la comparación por Set funciona.
const PALABRAS_PROHIBIDAS = new Set<string>(PALABRAS_PROHIBIDAS_RAW.map(normalizarPalabra));

export type ChequeoTexto = { encontrado: boolean; palabra?: string };

/**
 * Revisa un texto libre (descripción de vehículo, etc.) buscando lenguaje
 * soez/inapropiado por coincidencia de palabra COMPLETA (ver comentario del
 * módulo). Case-insensitive, tolerante a tildes y a símbolos/números
 * intercalados dentro de una misma palabra.
 */
export function contieneLenguajeInapropiado(texto: unknown): ChequeoTexto {
  // Defensa de tipo: `descripcion` llega del body de un POST/PUT sin validar su tipo
  // río arriba — si el cliente manda un número, un objeto, etc. en vez de un string,
  // `texto.split(...)` lanzaría un TypeError sin capturar (500) antes de esta guarda.
  if (typeof texto !== 'string' || !texto) return { encontrado: false };
  const palabras = texto.split(/\s+/);
  for (const cruda of palabras) {
    const limpia = normalizarPalabra(cruda);
    if (limpia && PALABRAS_PROHIBIDAS.has(limpia)) {
      return { encontrado: true, palabra: limpia };
    }
  }
  return { encontrado: false };
}

// ============================================================================
// Moderación de contenido — imágenes (registro ALLOW-LIST de fotos subidas)
// ============================================================================
//
// La detección la hace `detectarYDifuminarPlaca` (lib/blur-placas.ts), que reusa la
// MISMA llamada a Claude vision que ya hace para localizar la placa (ver decisión de
// diseño documentada ahí) en vez de una llamada aparte por foto.
//
// Modelo ALLOW-LIST (no deny-list): `POST /api/upload` registra en `fotos_moderacion`
// TODA foto que sube (no solo las marcadas), con su resultado de moderación y quién la
// subió — esto corre SIEMPRE, sin depender de ningún flag que el cliente pudiera
// mandar u omitir (ver app/api/upload/route.ts). `POST/PUT /api/vehiculos` exige que
// CADA URL nueva en `fotos`/`fotos_detalle` tenga un registro aquí perteneciente al
// usuario autenticado — si una URL no está registrada (nunca pasó por /api/upload, o
// es una URL externa inventada) o pertenece a otro usuario, se rechaza. Antes solo se
// registraban las fotos marcadas como sospechosas y solo si el cliente mandaba
// `blurPlaca=1`, así que una URL externa o subida sin ese flag pasaba sin ningún
// chequeo — ver el bug documentado en app/api/upload/route.ts.
//
// Las URLs se normalizan (minúsculas, sin query string, sin trailing slash) tanto al
// registrar como al consultar, con la MISMA función (`normalizarUrlFoto`), para que el
// cruce no sea evadible con variaciones triviales de la misma URL.

/** Normaliza una URL de foto para comparación: minúsculas, sin query string/hash, sin trailing slash. */
export function normalizarUrlFoto(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  let u = url.trim().toLowerCase();
  const qIdx = u.search(/[?#]/);
  if (qIdx !== -1) u = u.slice(0, qIdx);
  u = u.replace(/\/+$/, '');
  return u;
}

/**
 * Registra (o actualiza) el resultado de moderación de UNA foto ya subida por
 * /api/upload. Se llama para TODA foto de imagen subida, sin importar si quedó
 * marcada o no — así el cruce de POST/PUT /api/vehiculos puede confirmar que una
 * URL sí pasó por el pipeline, no solo que no fue marcada como sospechosa.
 */
export function registrarFotoModeracion(
  db: Database.Database,
  url: string,
  usuarioId: number | null,
  contenidoInapropiado: boolean,
  motivo: string,
): void {
  const urlNormalizada = normalizarUrlFoto(url);
  if (!urlNormalizada) return;
  const existente = db.prepare('SELECT id FROM fotos_moderacion WHERE url_normalizada = ?').get(urlNormalizada) as { id: number } | undefined;
  if (existente) {
    db.prepare('UPDATE fotos_moderacion SET url = ?, usuario_id = ?, contenido_inapropiado = ?, motivo = ? WHERE id = ?')
      .run(url, usuarioId, contenidoInapropiado ? 1 : 0, motivo || '', existente.id);
  } else {
    db.prepare('INSERT INTO fotos_moderacion (url, url_normalizada, usuario_id, contenido_inapropiado, motivo) VALUES (?, ?, ?, ?, ?)')
      .run(url, urlNormalizada, usuarioId, contenidoInapropiado ? 1 : 0, motivo || '');
  }
}

export type FotoRegistrada = { usuarioId: number | null; contenidoInapropiado: boolean; motivo: string };

/**
 * Devuelve, para las URLs dadas (normalizadas), el registro de moderación existente
 * (si lo hay) — mapa de URL normalizada → registro. Una URL ausente del mapa significa
 * que NUNCA pasó por /api/upload (no tiene ningún registro server-side).
 */
export function fotosRegistradasEntre(db: Database.Database, urls: string[]): Map<string, FotoRegistrada> {
  const normalizadas = [...new Set(urls.map(normalizarUrlFoto).filter(Boolean))];
  const mapa = new Map<string, FotoRegistrada>();
  if (normalizadas.length === 0) return mapa;
  const placeholders = normalizadas.map(() => '?').join(',');
  const filas = db.prepare(
    `SELECT url_normalizada, usuario_id, contenido_inapropiado, motivo FROM fotos_moderacion WHERE url_normalizada IN (${placeholders})`
  ).all(...normalizadas) as { url_normalizada: string; usuario_id: number | null; contenido_inapropiado: number; motivo: string }[];
  for (const f of filas) {
    mapa.set(f.url_normalizada, {
      usuarioId: f.usuario_id,
      contenidoInapropiado: !!f.contenido_inapropiado,
      motivo: f.motivo || '',
    });
  }
  return mapa;
}

/** Extrae las URLs de foto presentes en los campos `fotos` (JSON array) y `fotos_detalle` (JSON objeto) de un vehículo. */
export function extraerUrlsFotos(fotos: unknown, fotosDetalle: unknown): string[] {
  const urls: string[] = [];
  try {
    const arr = typeof fotos === 'string' ? JSON.parse(fotos) : fotos;
    if (Array.isArray(arr)) for (const u of arr) if (typeof u === 'string' && u) urls.push(u);
  } catch { /* ignorar JSON inválido */ }
  try {
    const obj = typeof fotosDetalle === 'string' ? JSON.parse(fotosDetalle) : fotosDetalle;
    if (obj && typeof obj === 'object') {
      for (const v of Object.values(obj as Record<string, unknown>)) {
        if (typeof v === 'string' && v) urls.push(v);
      }
    }
  } catch { /* ignorar JSON inválido */ }
  return urls;
}
