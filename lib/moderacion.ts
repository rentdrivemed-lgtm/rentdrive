import type Database from 'better-sqlite3';

// ============================================================================
// Moderación de contenido — texto: ELIMINADA (16-sep-2026)
// ============================================================================
//
// Había una lista de 91 palabras que rechazaba la descripción de un vehículo. Se
// quitó a petición del dueño, y con razón: bloqueaba descripciones legítimas.
//
// La normalización quitaba tildes para que "coño" no se escapara escrito "cono",
// pero eso mete "cono" en la lista — y un carro lleva CONOS de seguridad en el kit
// de carretera obligatorio (aparecen hasta en el acta de entrega de este mismo
// proyecto). "hp" estaba por el insulto colombiano y es también la unidad de
// caballos de fuerza. El filtro fallaba justo con el vocabulario del negocio.
//
// Se le ofrecieron dos alternativas —quitar solo las palabras ambiguas, o dejar
// publicar y marcar para revisión— y eligió eliminarlo del todo, a sabiendas de que
// lo que escriba un propietario sale directo a la vitrina pública. La red que queda
// es la revisión manual de contenido del panel (`contenido_revision`), que sigue
// intacta, igual que toda la moderación de IMÁGENES de más abajo.

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
