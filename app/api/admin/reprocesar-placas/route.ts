import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { guardArea } from '@/lib/guard';
import { secretoCronValido } from '@/lib/cron-secret';
import { detectarYDifuminarPlaca } from '@/lib/blur-placas';
import { uploadFile, esUrlDeStorageValida } from '@/lib/storage';
import { registrarFotoModeracion } from '@/lib/moderacion';
import { registrarAuditoria } from '@/lib/permisos';
import type Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
// Puede tardar bastante: llama a la API de Anthropic (vision) UNA VEZ POR CADA FOTO
// de cada vehículo, con un pequeño respiro entre llamadas (ver DELAY_ENTRE_FOTOS_MS).
// Solo tiene efecto real en plataformas que lo respetan (p. ej. Vercel); en Railway
// (donde corre este proyecto) el límite real de una request larga lo impone el proxy,
// no esta constante — si un lote grande se corta a mitad de camino, se puede seguir
// reprocesando el resto con `offset`/`limit` (ver más abajo) sin duplicar trabajo ya
// hecho (las fotos ya corregidas quedan `sin_cambios` en una segunda pasada, ver nota
// de idempotencia en `reprocesarVehiculo`).
export const maxDuration = 300;

const DELAY_ENTRE_FOTOS_MS = 400;

// Actor sintético para la bitácora de auditoría cuando quien dispara el endpoint es el
// cron (x-cron-secret), no una sesión de usuario real — no hay precedente de esto en
// otras rutas con doble puerta (pico-placa/alertas, admin/mercado/check no auditan), así
// que se documenta aquí el criterio elegido: id=0 (no hay fila de usuario real que
// referenciar) y nivel='cron' (distinguible a simple vista en el reporte de auditoría
// de cualquier nivel admin real, que siempre es 'principal'/'socio'/etc.).
const ACTOR_CRON = { id: 0, nombre: 'cron', correo: '', nivel: 'cron' };

type Actor = { id: number; nombre?: string; correo?: string; nivel?: string };

// Doble puerta (mismo patrón que app/api/pico-placa/alertas/route.ts): el cron entra
// con su secreto y sin sesión; una persona entra solo si es admin Y tiene la sección
// "vehiculos" (esta acción reescribe fotos/URLs de vehículos reales en Cloudinary y BD).
// Devuelve el actor (real o sintético) para poder auditar quién disparó la acción.
async function puertaDeEntrada(req: NextRequest): Promise<{ actor: Actor } | { error: NextResponse }> {
  const secret = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secretoCronValido(secret, process.env.CRON_SECRET)) return { actor: ACTOR_CRON };
  const g = await guardArea('vehiculos');
  if ('error' in g) return { error: g.error };
  return { actor: { id: g.user.id, nombre: g.user.nombre, correo: g.user.correo, nivel: g.nivel } };
}

type VehiculoRow = {
  id: number;
  propietario_id: number;
  marca: string;
  modelo: string;
  placa: string;
  fotos: string;
  fotos_detalle: string;
};

type FotoResultado = {
  url: string;
  estado: 'corregida' | 'sin_cambios' | 'error';
  nuevaUrl?: string;
  error?: string;
};

type VehiculoResumen = {
  vehiculo_id: number;
  marca: string;
  modelo: string;
  placa: string;
  fotos_totales: number;
  corregidas: number;
  sin_cambios: number;
  fallidas: number;
  fotos: FotoResultado[];
};

function esperar(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp';

async function descargarImagen(url: string): Promise<{ buffer: Buffer; mediaType: MediaType }> {
  // Defensa SSRF: `fotos`/`fotos_detalle` de filas viejas pudieron guardarse ANTES de que
  // existiera la validación allow-list de URLs (ver documentosConUrlsValidas en
  // lib/storage.ts, que solo se aplica a `documentos` y a fotos NUEVAS subidas después de
  // esa validación — nunca se corrió un backfill retroactivo sobre filas viejas). Este
  // endpoint puede correr en modo "todos los vehículos" contra producción real, así que
  // antes de hacer CUALQUIER fetch de red se rechaza cualquier URL que no sea, de verdad,
  // una URL de Cloudinary bajo nuestra cuenta — si no, un vehículo viejo con una URL
  // arbitraria guardada (interna, localhost, metadata de nube, etc.) convertiría este
  // endpoint en un oráculo de reconocimiento de red interna (el error de fetch se
  // devolvía tal cual en la respuesta JSON). Se rechaza SOLO esa foto puntual (mismo
  // try/catch por-foto que ya tolera cualquier otro fallo), no el vehículo completo.
  if (!esUrlDeStorageValida(url)) {
    throw new Error('URL de foto no es de nuestro storage (Cloudinary) — rechazada sin descargar (posible SSRF)');
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`No se pudo descargar la foto (HTTP ${resp.status})`);
  const contentType = resp.headers.get('content-type') || '';
  const buffer = Buffer.from(await resp.arrayBuffer());
  const mediaType: MediaType = contentType.includes('png')
    ? 'image/png'
    : contentType.includes('webp')
    ? 'image/webp'
    : 'image/jpeg'; // por defecto: es lo que sube uploadFile() para la mayoría de fotos de vehículos
  return { buffer, mediaType };
}

/**
 * Reprocesa TODAS las fotos (fotos + fotos_detalle) de un vehículo con la versión ya
 * corregida de detectarYDifuminarPlaca. Solo sube/reemplaza una foto si el resultado
 * DIFIERE del original (`resultado.difuminada === true`, es decir: se volvió a detectar
 * y tapar una placa) — si Claude ya no encuentra una placa "visible" en la foto (p. ej.
 * porque ya quedó bien tapada en una corrida anterior, o porque el rectángulo viejo la
 * cubre lo suficiente como para que ya no se reconozca como placa), la foto se deja
 * intacta y se marca `sin_cambios`. Esto hace que volver a correr el endpoint sobre el
 * mismo vehículo sea razonablemente idempotente: no genera una foto nueva ni gasta una
 * subida a Cloudinary por cada corrida repetida — el costo repetido es solo la llamada
 * de detección a Anthropic.
 *
 * LIMITACIÓN CONOCIDA (documentada para quien revise/corra esto): no existe un
 * "original sin tapar" guardado aparte — la única fuente disponible es la foto YA
 * publicada (que, para los vehículos afectados por el bug del rectángulo gigante, ya
 * tiene una placa tapada de forma imprecisa). Corregir esos casos depende de que Claude
 * vuelva a ubicar la región de la placa (aunque esté oscurecida/borrosa) a partir de
 * pistas de contexto (posición típica en el paragolpes, marco de placa, etc. — el
 * prompt ya le pide intentarlo incluso si está "partially obscured"). En la práctica
 * debería funcionar para la mayoría de los casos reales, pero no hay garantía de que
 * Claude relocalice CADA placa ya tapada de forma imprecisa; los casos que no se
 * puedan corregir así quedan documentados en el resultado como `sin_cambios` (no se
 * puede distinguir automáticamente "no había placa" de "había pero no se reubicó").
 */
async function reprocesarVehiculo(db: Database.Database, vehiculo: VehiculoRow): Promise<VehiculoResumen> {
  let fotosArr: unknown[] = [];
  try { fotosArr = JSON.parse(vehiculo.fotos || '[]'); } catch { fotosArr = []; }
  if (!Array.isArray(fotosArr)) fotosArr = [];
  const fotos: string[] = fotosArr.filter((u): u is string => typeof u === 'string' && !!u);

  let fotosDetalleObj: unknown = {};
  try { fotosDetalleObj = JSON.parse(vehiculo.fotos_detalle || '{}'); } catch { fotosDetalleObj = {}; }
  const fotosDetalle: Record<string, string> =
    fotosDetalleObj && typeof fotosDetalleObj === 'object' && !Array.isArray(fotosDetalleObj)
      ? Object.fromEntries(
          Object.entries(fotosDetalleObj as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === 'string' && !!e[1],
          ),
        )
      : {};

  const urlsUnicas = [...new Set([...fotos, ...Object.values(fotosDetalle)])];

  const resultados: FotoResultado[] = [];
  // url original → { nuevaUrl, resultado de moderación fresco de ESTA corrida }.
  // Todas las escrituras a BD de este vehículo (fotos/fotos_detalle + registro allow-list
  // de las URLs nuevas) se aplican en UNA sola transacción sincrónica al final del bucle:
  // no se puede mantener una transacción de better-sqlite3 abierta mientras se hacen
  // `await` de red (descarga + Anthropic + subida a Cloudinary son asíncronos).
  const cambios = new Map<string, { nuevaUrl: string; contenidoInapropiado: boolean; motivoInapropiado?: string }>();
  // TODA foto reprocesada en esta corrida, tenga o no `difuminada`, con su resultado de
  // moderación FRESCO — a diferencia de `cambios` (solo fotos con URL nueva), esto cubre
  // también el caso de una foto SIN placa visible que igual queda marcada
  // `contenidoInapropiado=true` (nunca pasa por `uploadFile`, pero su moderación sí debe
  // registrarse — ver hallazgo CRÍTICO de revisor-codigo).
  const moderacionPorUrl = new Map<string, { contenidoInapropiado: boolean; motivoInapropiado?: string }>();

  for (const url of urlsUnicas) {
    try {
      const { buffer, mediaType } = await descargarImagen(url);
      const resultado = await detectarYDifuminarPlaca(buffer, mediaType);

      if (!resultado.moderacionEvaluada) {
        // Fail-closed ante fallo de moderación (mismo criterio que app/api/upload/route.ts;
        // ver hallazgo CRÍTICO de revisor-codigo). `moderacionEvaluada === false` significa
        // que la IA NO llegó a evaluar de verdad esta foto (sin API key, error de red/API, o
        // JSON inválido — ver lib/blur-placas.ts); en ese caso `resultado.contenidoInapropiado`
        // viene en `false` como valor de RELLENO, nunca como "evaluada y limpia". Escribirlo
        // tal cual en `moderacionPorUrl` podría SOBRESCRIBIR con `0` un registro previo real
        // `contenido_inapropiado=1` de esta misma URL (p. ej. de una subida anterior por
        // /api/upload que sí la marcó) — eso saltaría la moderación en silencio la próxima
        // vez que esa foto se reutilice en una publicación nueva (fotos_moderacion es la
        // fuente que consulta POST /api/vehiculos). En vez de eso: NO se toca `difuminada`
        // (viene en `false`, no se sube nada nuevo a Cloudinary con un resultado sin
        // evaluar) y se registra fail-closed (contenidoInapropiado=true) con un motivo
        // explícito distinto al de una detección real, para que el vehículo caiga a
        // revisión manual en vez de quedar aprobado por accidente. El resumen refleja esto
        // como `estado: 'error'` (nunca `sin_cambios`) para que el admin lo note y pueda
        // reintentar esa foto puntual más tarde.
        moderacionPorUrl.set(url, {
          contenidoInapropiado: true,
          motivoInapropiado: 'No se pudo evaluar automáticamente el contenido de esta foto en el reproceso (fallo de moderación) — pendiente de revisión manual.',
        });
        resultados.push({
          url,
          estado: 'error',
          error: 'No se pudo evaluar el contenido automáticamente (fallo de moderación de la IA) — la placa no se reprocesó en esta corrida y la foto quedó marcada a revisión manual.',
        });
      } else {
        moderacionPorUrl.set(url, {
          contenidoInapropiado: resultado.contenidoInapropiado,
          motivoInapropiado: resultado.motivoInapropiado,
        });
        if (!resultado.difuminada) {
          resultados.push({ url, estado: 'sin_cambios' });
        } else {
          const nombre = `reproc-placa-${vehiculo.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
          const { url: nuevaUrl } = await uploadFile(nombre, 'image/jpeg', resultado.buffer);
          cambios.set(url, {
            nuevaUrl,
            contenidoInapropiado: resultado.contenidoInapropiado,
            motivoInapropiado: resultado.motivoInapropiado,
          });
          resultados.push({ url, estado: 'corregida', nuevaUrl });
        }
      }
    } catch (err) {
      // Tolerante a fallos por foto: una foto individual (URL caída, formato raro, error
      // de red/Anthropic/Cloudinary) no aborta el resto del vehículo ni del lote.
      resultados.push({ url, estado: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    await esperar(DELAY_ENTRE_FOTOS_MS);
  }

  // ¿Alguna foto de ESTE vehículo (de las reprocesadas en esta corrida) quedó marcada como
  // contenido inapropiado? Si sí, el vehículo debe entrar a `contenido_revision`, con el
  // mismo criterio no-bypasseable que ya usa PUT /api/vehiculos/[id] (líneas ~283-317):
  // la marca de la IA prevalece siempre, sin importar el estado previo del vehículo.
  const fotosInapropiadas = [...moderacionPorUrl.values()].filter(m => m.contenidoInapropiado);
  const requiereRevisionContenido = fotosInapropiadas.length > 0;
  const motivoRevisionContenido = fotosInapropiadas.map(m => m.motivoInapropiado).filter(Boolean).join(' | ');

  if (moderacionPorUrl.size > 0) {
    const aplicarCambios = db.transaction(() => {
      // Lost-update (ver hallazgo ALTO de revisor-codigo): `fotos`/`fotos_detalle` se
      // parsearon UNA vez al INICIO de esta función, antes del bucle async de
      // descarga+IA+subida (puede tardar decenas de segundos por vehículo). Si el
      // propietario editó el vehículo mientras tanto (agregó/borró/reordenó fotos), ese
      // snapshot inicial ya quedó obsoleto. Por eso, justo aquí (dentro de la
      // transacción, después de todo el trabajo async), releemos fotos/fotos_detalle
      // FRESCOS de la BD y aplicamos los reemplazos de URL sobre esa lectura fresca — NO
      // sobre `fotos`/`fotosDetalle` (el snapshot viejo capturado al inicio). Si una URL
      // que íbamos a reemplazar ya no está en la lectura fresca (el propietario la borró
      // mientras tanto), simplemente no hay nada que reemplazar ahí — no es un error.
      const filaFresca = db.prepare('SELECT fotos, fotos_detalle FROM vehiculos WHERE id = ?')
        .get(vehiculo.id) as { fotos: string; fotos_detalle: string } | undefined;

      if (filaFresca && cambios.size > 0) {
        let fotosFrescaArr: unknown[] = [];
        try { fotosFrescaArr = JSON.parse(filaFresca.fotos || '[]'); } catch { fotosFrescaArr = []; }
        if (!Array.isArray(fotosFrescaArr)) fotosFrescaArr = [];
        const fotosFrescas: string[] = fotosFrescaArr.filter((u): u is string => typeof u === 'string' && !!u);

        let fotosDetalleFrescaObj: unknown = {};
        try { fotosDetalleFrescaObj = JSON.parse(filaFresca.fotos_detalle || '{}'); } catch { fotosDetalleFrescaObj = {}; }
        const fotosDetalleFrescas: Record<string, string> =
          fotosDetalleFrescaObj && typeof fotosDetalleFrescaObj === 'object' && !Array.isArray(fotosDetalleFrescaObj)
            ? Object.fromEntries(
                Object.entries(fotosDetalleFrescaObj as Record<string, unknown>).filter(
                  (e): e is [string, string] => typeof e[1] === 'string' && !!e[1],
                ),
              )
            : {};

        const nuevasFotos = fotosFrescas.map(u => cambios.get(u)?.nuevaUrl ?? u);
        const nuevasFotosDetalle: Record<string, string> = {};
        for (const [clave, url] of Object.entries(fotosDetalleFrescas)) {
          nuevasFotosDetalle[clave] = cambios.get(url)?.nuevaUrl ?? url;
        }

        if (requiereRevisionContenido) {
          db.prepare('UPDATE vehiculos SET fotos = ?, fotos_detalle = ?, contenido_revision = 1, contenido_revision_motivo = ? WHERE id = ?')
            .run(JSON.stringify(nuevasFotos), JSON.stringify(nuevasFotosDetalle), motivoRevisionContenido, vehiculo.id);
        } else {
          db.prepare('UPDATE vehiculos SET fotos = ?, fotos_detalle = ? WHERE id = ?')
            .run(JSON.stringify(nuevasFotos), JSON.stringify(nuevasFotosDetalle), vehiculo.id);
        }
      } else if (requiereRevisionContenido) {
        // Ninguna foto cambió de URL (ninguna placa nueva que tapar), pero igual hay que
        // marcar el vehículo en revisión por una foto con contenido inapropiado detectado
        // en esta corrida — no se toca fotos/fotos_detalle en este caso.
        db.prepare('UPDATE vehiculos SET contenido_revision = 1, contenido_revision_motivo = ? WHERE id = ?')
          .run(motivoRevisionContenido, vehiculo.id);
      }

      // Registro allow-list (ver lib/moderacion.ts): POST/PUT /api/vehiculos exige que
      // TODA URL en fotos/fotos_detalle tenga un registro server-side de haber pasado
      // por /api/upload, perteneciente al usuario que edita. Sin este registro, la
      // PRÓXIMA vez que el propietario edite este vehículo (incluso sin tocar fotos)
      // el guardado se rechazaría por tener una URL "sin registro". Se registra a
      // nombre del PROPIETARIO del vehículo (no del admin que dispara el reproceso) —
      // igual que si él mismo la hubiera subido.
      //
      // Se registra el resultado de moderación FRESCO de TODA foto reprocesada en esta
      // corrida (no solo las que cambiaron de URL) — ver hallazgo CRÍTICO de
      // revisor-codigo: una foto sin placa visible que igual quedó marcada como
      // contenido inapropiado no debe perderse en silencio solo porque no generó una
      // URL nueva. Se registra bajo la URL que el vehículo va a conservar para esa
      // foto: la NUEVA si hubo reemplazo (placa tapada), o la ORIGINAL si no cambió.
      for (const [urlOriginal, moderacion] of moderacionPorUrl.entries()) {
        const urlFinal = cambios.get(urlOriginal)?.nuevaUrl ?? urlOriginal;
        registrarFotoModeracion(db, urlFinal, vehiculo.propietario_id, moderacion.contenidoInapropiado, moderacion.motivoInapropiado || '');
      }
    });
    aplicarCambios();
  }

  return {
    vehiculo_id: vehiculo.id,
    marca: vehiculo.marca,
    modelo: vehiculo.modelo,
    placa: vehiculo.placa,
    fotos_totales: urlsUnicas.length,
    corregidas: resultados.filter(r => r.estado === 'corregida').length,
    sin_cambios: resultados.filter(r => r.estado === 'sin_cambios').length,
    fallidas: resultados.filter(r => r.estado === 'error').length,
    fotos: resultados,
  };
}

// POST /api/admin/reprocesar-placas
// Body opcional: { vehiculo_id?: number, limit?: number, offset?: number, confirmar?: boolean }
//  - vehiculo_id: reprocesa SOLO ese vehículo (recomendado para probar antes de correr
//    el lote completo — puede ser cualquier vehículo, incluido uno archivado).
//  - limit/offset: paginación manual sobre "todos los vehículos publicados" (archivado=0),
//    para cortar el trabajo en lotes más chicos si el lote completo es grande (mitiga el
//    riesgo de que una request muy larga se corte por un timeout de proxy/plataforma).
//  - confirmar: OBLIGATORIO en true para el modo "todos los vehículos" (sin vehiculo_id).
//    Sin este flag, un body vacío/mal armado ({} por typo, JSON corrupto que cae al
//    default, etc.) NO dispara silenciosamente el reproceso de toda la flota — se
//    responde 400 sin tocar nada. El modo con vehiculo_id ya es explícito por sí mismo
//    y no lo necesita.
export async function POST(req: NextRequest) {
  const puerta = await puertaDeEntrada(req);
  if ('error' in puerta) return puerta.error;
  const actor = puerta.actor;

  let body: { vehiculo_id?: number; limit?: number; offset?: number; confirmar?: boolean } = {};
  try { body = await req.json(); } catch { body = {}; }

  const db = getDb();
  let vehiculos: VehiculoRow[];

  if (body.vehiculo_id !== undefined) {
    const vehiculoId = Number(body.vehiculo_id);
    if (!Number.isFinite(vehiculoId) || vehiculoId <= 0) {
      return NextResponse.json({ error: 'vehiculo_id inválido' }, { status: 400 });
    }
    vehiculos = db.prepare(
      'SELECT id, propietario_id, marca, modelo, placa, fotos, fotos_detalle FROM vehiculos WHERE id = ?'
    ).all(vehiculoId) as VehiculoRow[];
    if (vehiculos.length === 0) {
      return NextResponse.json({ error: 'Vehículo no encontrado' }, { status: 404 });
    }
  } else {
    if (body.confirmar !== true) {
      return NextResponse.json(
        { error: 'Falta confirmar:true para reprocesar TODOS los vehículos publicados' },
        { status: 400 },
      );
    }
    // Sin vehiculo_id: TODOS los vehículos publicados (no archivados — los archivados no
    // se listan en ningún lado, no vale la pena gastar llamadas a Anthropic en ellos; para
    // reprocesar uno archivado puntual, pasar su vehiculo_id explícitamente).
    const limit = body.limit !== undefined ? Math.max(1, Math.min(500, Number(body.limit) || 0)) : undefined;
    const offset = body.offset !== undefined ? Math.max(0, Number(body.offset) || 0) : 0;
    const base = 'SELECT id, propietario_id, marca, modelo, placa, fotos, fotos_detalle FROM vehiculos WHERE archivado = 0 ORDER BY id ASC';
    vehiculos = (
      limit ? db.prepare(`${base} LIMIT ? OFFSET ?`).all(limit, offset) : db.prepare(base).all()
    ) as VehiculoRow[];
  }

  const resumenVehiculos: VehiculoResumen[] = [];
  for (const vehiculo of vehiculos) {
    try {
      resumenVehiculos.push(await reprocesarVehiculo(db, vehiculo));
    } catch (err) {
      // Defensivo: cada foto ya está protegida por su propio try/catch dentro de
      // reprocesarVehiculo, así que esto solo cubre un fallo inesperado a nivel de
      // vehículo entero (ej. JSON corrupto que rompe algo no previsto) — igual no debe
      // abortar el resto del lote.
      resumenVehiculos.push({
        vehiculo_id: vehiculo.id, marca: vehiculo.marca, modelo: vehiculo.modelo, placa: vehiculo.placa,
        fotos_totales: 0, corregidas: 0, sin_cambios: 0, fallidas: 1,
        fotos: [{ url: '(vehículo completo)', estado: 'error', error: err instanceof Error ? err.message : String(err) }],
      });
    }
  }

  const totales = resumenVehiculos.reduce(
    (acc, r) => ({
      fotos_totales: acc.fotos_totales + r.fotos_totales,
      corregidas: acc.corregidas + r.corregidas,
      sin_cambios: acc.sin_cambios + r.sin_cambios,
      fallidas: acc.fallidas + r.fallidas,
    }),
    { fotos_totales: 0, corregidas: 0, sin_cambios: 0, fallidas: 0 },
  );

  // Bitácora de auditoría: este endpoint reescribe fotos de vehículos reales en lote, así
  // que debe quedar rastro de quién lo disparó (o 'cron' si vino por x-cron-secret), con
  // qué parámetros y con qué resultado — mismo patrón que el resto de rutas admin que
  // mutan datos. `registrarAuditoria` ya traga sus propios errores internamente (ver
  // lib/permisos.ts) y jamás lanza, así que no puede tumbar la respuesta ya calculada.
  registrarAuditoria(db, actor, {
    area: 'vehiculos',
    accion: 'reprocesar_placas',
    entidad: 'vehiculo',
    entidad_id: body.vehiculo_id !== undefined ? Number(body.vehiculo_id) : 0,
    detalle: JSON.stringify({
      vehiculo_id: body.vehiculo_id ?? null,
      limit: body.limit ?? null,
      offset: body.offset ?? null,
      ...totales,
      vehiculos_procesados: resumenVehiculos.length,
      vehiculos_con_correcciones: resumenVehiculos.filter(r => r.corregidas > 0).length,
    }),
  });

  return NextResponse.json({
    vehiculos_procesados: resumenVehiculos.length,
    vehiculos_con_correcciones: resumenVehiculos.filter(r => r.corregidas > 0).length,
    ...totales,
    detalle: resumenVehiculos,
  });
}
