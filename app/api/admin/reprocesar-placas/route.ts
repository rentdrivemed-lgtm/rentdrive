import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { guardArea } from '@/lib/guard';
import { secretoCronValido } from '@/lib/cron-secret';
import { detectarYDifuminarPlaca } from '@/lib/blur-placas';
import { uploadFile, esUrlDeStorageValida } from '@/lib/storage';
import { registrarFotoModeracion, normalizarUrlFoto } from '@/lib/moderacion';
import { registrarAuditoria } from '@/lib/permisos';
import { leerHuellaSello, mismoSellado, type HuellaSello } from '@/lib/tapar-placa';
import { descargarFotoParaTapar } from '@/lib/tapar-placa-imagen';
import type Database from 'better-sqlite3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Puede tardar bastante: llama a la API de Anthropic (vision) UNA VEZ POR CADA FOTO
// de cada vehículo, con un pequeño respiro entre llamadas (ver DELAY_ENTRE_FOTOS_MS).
// Solo tiene efecto real en plataformas que lo respetan (p. ej. Vercel); en Railway
// (donde corre este proyecto) el límite real de una request larga lo impone el proxy,
// no esta constante — si un lote grande se corta a mitad de camino, se puede seguir
// reprocesando el resto con `offset`/`limit` (ver más abajo) sin duplicar trabajo ya
// hecho (ver la nota de IDEMPOTENCIA más abajo).
export const maxDuration = 300;

const DELAY_ENTRE_FOTOS_MS = 400;

// ═══════════════════════════════════════════════════════════════════════════════════════
// REPROCESO DE PLACAS — qué cambió y por qué (incidente real en producción, sep-2026)
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Se corrió este endpoint sobre UN vehículo de prueba (id 13, KIA Seltos) y pasaron dos
// cosas, las dos graves para un lote sobre la flota entera:
//
//  1. APILÓ SELLOS. La foto ya traía el tapado de una corrida anterior, y esta corrida
//     trabajó sobre la foto YA SELLADA en vez de sobre la original: le estampó dos logos
//     más encima. Tres sellos superpuestos sobre la misma placa. El comentario del código
//     afirmaba que era idempotente y no lo era: la guarda que existía (`tapadoImpreciso`)
//     solo descartaba el caso `via === 'ia'`, y basta con que quede UN píxel amarillo cerca
//     del sello viejo para que la corrida nueva resuelva por color y vuelva a estampar.
//
//  2. SACÓ EL VEHÍCULO DE LA VITRINA. El detector nuevo retiene la foto cuando no puede dar
//     cuenta de la placa de algún vehículo del encuadre, y esa retención pone
//     `vehiculos.contenido_revision = 1`, que lo quita del catálogo público. Con el criterio
//     aprobado por el dueño eso es correcto para una foto que se está SUBIENDO, pero en un
//     lote masivo significa media flota fuera de la vitrina sin que nadie lo haya decidido.
//
// Los cuatro arreglos, en el mismo orden:
//
//  A. SIEMPRE SE PARTE DE LA ORIGINAL. El sello se estampa sobre la foto tal como estaba
//     ANTES del primer sellado, que se guarda en `fotos_moderacion.placa_origen_url` — la
//     MISMA columna, con la misma semántica, que ya usaba el camino manual
//     (app/api/admin/tapar-placa) desde que se construyó, justamente porque ahí ya se había
//     resuelto este problema. No hacía falta ninguna tabla nueva: el registro de moderación
//     de la foto es el sitio natural del vínculo original→sellada, es por URL (que es la
//     clave con la que se publica la foto) y ya lo lee el panel para abrir el editor manual
//     sobre la imagen correcta. Con esto, apilar sellos es IMPOSIBLE por construcción: el
//     lienzo de partida siempre está limpio.
//
//  B. LAS YA SELLADAS SIN VÍNCULO NO SE TOCAN. Las fotos que salieron de corridas anteriores
//     (nombre `reproc-placa-…`) no tienen registrado su original. NO se intenta adivinar a
//     qué foto corresponden —emparejar por fecha de subida puede sustituir la foto de un
//     carro por la de otro, que es peor que dejarla como está—: se OMITEN, se cuentan aparte
//     (`omitidas_sin_original`) y se listan en la respuesta con su vehículo, para resolverlas
//     con la herramienta que ya existe (el tapado manual, que muestra la foto y deja marcar
//     las placas a mano). Lo mismo con las tapadas a mano: reprocesarlas desde su original
//     borraría el trabajo de la persona que las revisó.
//
//     ⚠️ OJO CON ALGO QUE APARECIÓ COMPROBANDO ESTO, porque cambia el alcance de (A) y (B):
//     la MAYORÍA de las fotos del catálogo también están selladas, pero no se nota por
//     ningún lado. `POST /api/upload` estampa el sello ANTES de subir la foto, así que la
//     única copia que llega a Cloudinary ya viene sellada, con nombre de subida normal
//     (`<ts>-<rand>.jpg`) y sin nada en `fotos_moderacion` que lo diga — y la versión sin
//     sellar no existe en ninguna parte, nunca se guardó. Medido sobre el catálogo real de
//     producción: las fotos traseras del KIA Sportage, del Mazda 3 y del Nivus parecen
//     originales intactas por nombre y por base, y traen el sello horneado en los píxeles.
//     Para ESAS no hay original de la que partir, y omitirlas todas dejaría este endpoint
//     sin nada que hacer sobre la flota actual. La red que las protege es otra y está una
//     capa más abajo: `sinZonasYaSelladas` (lib/blur-placas.ts) mide, justo antes de pintar,
//     si el rectángulo que se iba a estampar YA es el navy+naranja del sello de DrivePass, y
//     en ese caso no lo pinta. Así, sobre una foto ya sellada este endpoint solo puede
//     AGREGAR sellos sobre placas que quedaron destapadas, nunca encima de los que ya están.
//
//     (Para que esto deje de ser un parche habría que guardar también la foto sin sellar al
//     subirla, y anotarla como `placa_origen_url`. Es un cambio en `POST /api/upload` —una
//     subida más a Cloudinary por foto— que queda FUERA de esta tarea, pero es lo que haría
//     que toda la flota fuera reprocesable desde su original de verdad.)
//
//  C. MODO SIMULACIÓN (`simular: true`). Corre el pipeline COMPLETO —descarga, detección,
//     reconciliación— y no escribe nada: ni sube a Cloudinary ni toca la base. Reporta
//     cuántas fotos cambiarían, cuántas quedarían retenidas y, sobre todo, cuántos vehículos
//     SALDRÍAN DEL CATÁLOGO PÚBLICO. Cuesta lo mismo que la corrida de verdad (la llamada a
//     la IA es el gasto), y es a propósito: una simulación que no llame al modelo no sería
//     una simulación de nada.
//
//  D. LA RETENCIÓN ES VISIBLE Y DECIDIDA. En modo lote hay que elegir explícitamente qué
//     pasa con la vitrina (`retencion`), no hay default silencioso; el resumen cuenta los
//     vehículos retirados; y existe un freno (`max_retiros`) que corta el lote antes de
//     seguir bajando carros. Ver `ModoRetencion` más abajo para el modo diferido y su
//     justificación.

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

/**
 * Qué se hace con una foto que el detector deja RETENIDA (`revisionManual`: sabe que pudo
 * quedar una placa sin tapar bien y no puede arreglarlo solo).
 *
 *  · `retirar` — lo que hace hoy el camino de subida y lo que hacía este endpoint: se marca
 *    la foto en `fotos_moderacion.contenido_inapropiado` y el vehículo pasa a
 *    `contenido_revision = 1`, o sea que SALE del catálogo público hasta que un humano lo
 *    apruebe. Es el criterio que el dueño aprobó ("vale más una foto retenida que una placa
 *    publicada") y por eso sigue siendo el único modo que el endpoint aplica si no le dicen
 *    otra cosa en el modo de un solo vehículo.
 *
 *  · `diferir` — se estampa lo que se pudo tapar (igual que en `retirar`) pero la revisión
 *    queda anotada en `fotos_moderacion.placa_revision_pendiente`, que el panel de placas
 *    muestra igual de visible, SIN retirar el vehículo de la vitrina hasta que alguien la
 *    mire.
 *
 * POR QUÉ EXISTE `diferir`, Y POR QUÉ NO ES EL DEFAULT. El criterio aprobado se decidió para
 * una foto que se está SUBIENDO: ahí retener no le cuesta nada a nadie, porque la foto nunca
 * llegó a ser pública. En un REPROCESO la situación es distinta en los dos lados de la
 * balanza: la foto lleva meses publicada (retenerla unas horas más mientras alguien la mira
 * no cambia gran cosa en privacidad), la corrida SÍ estampa los sellos que puede (o sea que
 * la foto queda mejor que antes, no peor), y el costo es inmediato y grande — el carro
 * desaparece de la vitrina y deja de alquilarse. Además, buena parte de estas retenciones
 * son por un carro del fondo del que la IA no supo dar cuenta, no por la placa del vehículo
 * publicado. Aun así NO es el default: cambiar en silencio un criterio que el dueño aprobó
 * sería exactamente el tipo de decisión que no le toca tomar al código. En modo lote hay que
 * elegir uno de los dos a mano.
 *
 * Lo que NUNCA se difiere: una marca de CONTENIDO INAPROPIADO y un "no se pudo evaluar el
 * contenido". Esas dos siguen siendo fail-closed y retiran el vehículo en los dos modos.
 */
type ModoRetencion = 'retirar' | 'diferir';

type VehiculoRow = {
  id: number;
  propietario_id: number;
  marca: string;
  modelo: string;
  placa: string;
  fotos: string;
  fotos_detalle: string;
  archivado: number;
  disponible: number;
  contenido_revision: number;
};

const CAMPOS_VEHICULO =
  'id, propietario_id, marca, modelo, placa, fotos, fotos_detalle, archivado, disponible, contenido_revision';

/** Registro de moderación de UNA foto, con todo lo que este endpoint necesita saber de ella. */
type RegistroFoto = {
  contenido_inapropiado: number;
  motivo: string;
  placa_origen_url: string;
  placa_manual: number;
  placa_auto_zonas: string;
};

const SELECT_REGISTRO_FOTO = `
  SELECT contenido_inapropiado, motivo, placa_origen_url, placa_manual, placa_auto_zonas
    FROM fotos_moderacion WHERE url_normalizada = ?`;

type EstadoFoto =
  /** Se estampó un sello nuevo y la foto publicada se reemplaza (en simulación: se reemplazaría). */
  | 'corregida'
  /** Se miró y no hay nada que cambiar. */
  | 'sin_cambios'
  /** El reproceso llega al MISMO sellado que la foto ya tiene: no se vuelve a subir (idempotencia). */
  | 'ya_sellada'
  /** Salió de una corrida vieja y no se sabe de qué original: NO se toca (ver el bloque B de arriba). */
  | 'omitida_sin_original'
  /** La tapó una persona a mano: reprocesarla desde la original borraría ese trabajo. */
  | 'omitida_manual'
  | 'error';

type FotoResultado = {
  url: string;
  estado: EstadoFoto;
  /** Foto sobre la que se trabajó de verdad (la original), cuando es distinta de la publicada. */
  origen_url?: string;
  nuevaUrl?: string;
  /** Rectángulos que se estamparon (o que se estamparían, en simulación), en píxeles. */
  zonas?: HuellaSello['zonas'];
  /** Esta foto genera una retención (por placa o por contenido). */
  retenida?: boolean;
  motivo?: string;
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
  ya_selladas: number;
  omitidas_sin_original: number;
  omitidas_manual: number;
  fallidas: number;
  fotos_retenidas: number;
  /** El vehículo queda (o quedaría) marcado en revisión de contenido por esta corrida. */
  retenido: boolean;
  /** Estaba visible en el catálogo público y esta corrida lo saca (o lo sacaría). */
  sale_del_catalogo: boolean;
  /** La retención se anotó sin retirar el vehículo de la vitrina (`retencion: 'diferir'`). */
  retencion_diferida: boolean;
  motivo_retencion?: string;
  fotos: FotoResultado[];
};

function esperar(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Prefijos con los que el sistema nombra las fotos que SELLA (este endpoint y el tapado
// manual). Cloudinary los conserva en la URL pública, así que son una marca fiable y
// determinística de "esta foto no es la original de nadie, ya salió de un sellado".
const PREFIJO_FOTO_REPROCESADA = 'reproc-placa-';
const PREFIJO_FOTO_MANUAL = 'placa-manual-';

function esFotoYaSellada(url: string): boolean {
  return url.includes(`/${PREFIJO_FOTO_REPROCESADA}`) || url.includes(`/${PREFIJO_FOTO_MANUAL}`);
}

/**
 * Veredicto de moderación/retención de UNA foto ya procesada, separado en las dos cosas que
 * la columna `contenido_inapropiado` mezcla hoy y que aquí NO se pueden tratar igual:
 *  - `bloqueante`: contenido inapropiado de verdad, o moderación que no se pudo evaluar.
 *    Retira el vehículo del catálogo SIEMPRE, en los dos modos de retención.
 *  - `placa`: el detector no pudo garantizar el tapado de alguna placa. Es la única que el
 *    modo `diferir` puede posponer.
 */
type Veredicto = {
  bloqueante: boolean;
  placa: boolean;
  motivoBloqueante: string;
  motivoPlaca: string;
};

function motivoDe(v: Veredicto): string {
  return [v.motivoBloqueante, v.motivoPlaca].filter(Boolean).join(' | ');
}

/**
 * Qué se escribe en `fotos_moderacion` para una foto, según el veredicto y el modo.
 * `contenido_inapropiado` refleja SIEMPRE el veredicto fresco (igual que antes de este
 * cambio), menos la retención por placa cuando está diferida — que se va a su propia
 * columna para no arrastrar al vehículo fuera de la vitrina.
 */
function escrituraModeracion(v: Veredicto, modo: ModoRetencion): {
  contenidoInapropiado: boolean;
  motivo: string;
  pendiente: boolean;
  motivoPendiente: string;
} {
  const diferirPlaca = v.placa && !v.bloqueante && modo === 'diferir';
  return {
    contenidoInapropiado: v.bloqueante || (v.placa && !diferirPlaca),
    motivo: diferirPlaca ? v.motivoBloqueante : motivoDe(v),
    pendiente: diferirPlaca,
    motivoPendiente: diferirPlaca ? v.motivoPlaca : '',
  };
}

function parseFotos(json: string): string[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string' && !!u) : [];
  } catch {
    return [];
  }
}

function parseFotosDetalle(json: string): Record<string, string> {
  try {
    const obj = JSON.parse(json || '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && !!e[1],
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Baja una foto para reprocesarla.
 *
 * Doble cerrojo, y los dos hacen falta:
 *  - `esUrlDeStorageValida` exige que sea una URL de NUESTRA cuenta de Cloudinary. Las filas
 *    viejas de `fotos`/`fotos_detalle` se guardaron antes de que existiera cualquier
 *    validación de URL, y este endpoint puede correr sobre toda la flota: sin esto, un
 *    vehículo viejo con una URL arbitraria guardada (interna, localhost, metadata de nube)
 *    convertiría este endpoint en un oráculo de reconocimiento de red interna, porque el
 *    error del fetch se devuelve en el JSON de respuesta.
 *  - `descargarFotoParaTapar` (lib/tapar-placa-imagen.ts, el mismo que usa el tapado manual)
 *    acota redirecciones, tiempo y TAMAÑO. El `fetch` a pelo que había antes se tragaba
 *    entero lo que hubiera del otro lado.
 */
async function descargarImagen(url: string) {
  if (!esUrlDeStorageValida(url)) {
    throw new Error('La dirección de esta foto no es de nuestro almacenamiento — no se descargó nada.');
  }
  return descargarFotoParaTapar(url);
}

/** Lo que se decidió para UNA foto, ya con el trabajo de red hecho y listo para escribir. */
type TrabajoFoto = {
  resultado: FotoResultado;
  /** Presente solo si hay que reemplazar la URL publicada. */
  cambio?: { nuevaUrl: string; origenUrl: string; huella: string };
  /** Presente para toda foto que se llegó a evaluar (haya cambiado de URL o no). */
  moderacion?: { urlPublicada: string; origenUrl: string; veredicto: Veredicto };
};

/**
 * Reprocesa TODAS las fotos (fotos + fotos_detalle) de un vehículo.
 *
 * IDEMPOTENCIA (ahora sí, y por dos vías independientes):
 *  1. ESTRUCTURAL: el sello se estampa siempre sobre `placa_origen_url`, la foto original sin
 *     tapar. Dos corridas no pueden apilar sellos porque ninguna de las dos parte de una foto
 *     sellada. Esto es lo que faltaba y lo que produjo los tres logos superpuestos.
 *  2. DE RESULTADO: junto a cada foto sellada se guarda la HUELLA de lo que se estampó
 *     (lienzo + rectángulos, en `placa_auto_zonas`). Si la corrida nueva llega a un sellado
 *     equivalente (`mismoSellado`, lib/tapar-placa.ts), no se sube nada y la foto se reporta
 *     como `ya_sellada`. Sin esto, como la detección pasa por un modelo y no es
 *     determinística, cada pasada generaría un JPG distinto —con UN solo sello, sí, pero
 *     distinto— y la URL publicada cambiaría para siempre en cada corrida.
 */
async function reprocesarVehiculo(
  db: Database.Database,
  vehiculo: VehiculoRow,
  opciones: { simular: boolean; retencion: ModoRetencion },
): Promise<VehiculoResumen> {
  const fotos = parseFotos(vehiculo.fotos);
  const fotosDetalle = parseFotosDetalle(vehiculo.fotos_detalle);
  const urlsUnicas = [...new Set([...fotos, ...Object.values(fotosDetalle)])];

  const leerRegistro = db.prepare(SELECT_REGISTRO_FOTO);
  const trabajos: TrabajoFoto[] = [];

  for (const url of urlsUnicas) {
    try {
      const registro = leerRegistro.get(normalizarUrlFoto(url)) as RegistroFoto | undefined;
      const origenUrl = registro?.placa_origen_url || '';

      // ── Fotos que NO se tocan ────────────────────────────────────────────────────────
      if (registro?.placa_manual) {
        // La revisó una persona, vio las placas y las marcó a mano. Volver a derivarla de la
        // original tiraría ese trabajo y publicaría otra vez lo que ella decidió tapar.
        trabajos.push({ resultado: { url, estado: 'omitida_manual', origen_url: origenUrl || undefined } });
        continue;
      }
      if (!origenUrl && esFotoYaSellada(url)) {
        // Salió de una corrida anterior a este arreglo y nadie registró de qué foto viene.
        // Trabajar sobre ella es exactamente lo que apiló los sellos, y adivinar su original
        // por proximidad de fecha puede sustituirla por la foto de OTRO carro. Se deja como
        // está y se reporta para resolverla con el tapado manual.
        trabajos.push({ resultado: { url, estado: 'omitida_sin_original' } });
        continue;
      }

      // ── Siempre desde la original ────────────────────────────────────────────────────
      const fuente = origenUrl || url;
      const { buffer, mediaType } = await descargarImagen(fuente);
      const resultado = await detectarYDifuminarPlaca(buffer, mediaType);

      if (!resultado.moderacionEvaluada) {
        // Fail-closed ante fallo de moderación (mismo criterio que app/api/upload/route.ts).
        // `moderacionEvaluada === false` significa que la IA NO llegó a evaluar de verdad esta
        // foto (sin API key, error de red/API, o JSON inválido — ver lib/blur-placas.ts); en
        // ese caso `resultado.contenidoInapropiado` viene en `false` como valor de RELLENO,
        // nunca como "evaluada y limpia". Escribirlo tal cual podría SOBRESCRIBIR con `0` un
        // registro previo real `contenido_inapropiado = 1` de esta misma URL y saltarse la
        // moderación en silencio la próxima vez que la foto se reutilice.
        //
        // La versión tapada que igual pudo producir el detector de color se DESCARTA a
        // propósito: publicar un buffer cuyo contenido nunca se moderó sería fail-open. Basta
        // con reintentar cuando la IA vuelva a responder. Se reporta como `error` (nunca
        // `sin_cambios`) para que se note y se pueda reintentar esa foto puntual.
        const veredicto: Veredicto = {
          bloqueante: true,
          placa: false,
          motivoBloqueante: 'No se pudo evaluar automáticamente el contenido de esta foto en el reproceso (fallo de moderación) — pendiente de revisión manual.',
          motivoPlaca: '',
        };
        trabajos.push({
          resultado: {
            url,
            estado: 'error',
            origen_url: origenUrl || undefined,
            retenida: true,
            motivo: veredicto.motivoBloqueante,
            error: 'No se pudo evaluar el contenido automáticamente (fallo de moderación de la IA) — la placa no se reprocesó en esta corrida y la foto quedó marcada a revisión manual.',
          },
          moderacion: { urlPublicada: url, origenUrl: fuente, veredicto },
        });
        continue;
      }

      const veredicto: Veredicto = {
        bloqueante: resultado.contenidoInapropiado,
        placa: resultado.revisionManual,
        motivoBloqueante: resultado.contenidoInapropiado ? (resultado.motivoInapropiado || '') : '',
        motivoPlaca: resultado.revisionManual ? (resultado.motivoRevision || '') : '',
      };
      const retenida = veredicto.bloqueante || veredicto.placa;
      const moderacion = { urlPublicada: url, origenUrl: fuente, veredicto };

      if (!resultado.difuminada) {
        // Ninguna placa que tapar en la ORIGINAL. Ojo: si lo publicado hoy es una foto sellada
        // derivada de esa original, NO se vuelve atrás — sustituir la sellada por la original
        // destaparía la placa que una corrida anterior sí supo cubrir. Se deja publicada la
        // que está y solo se anota el veredicto.
        trabajos.push({
          resultado: { url, estado: 'sin_cambios', origen_url: origenUrl || undefined, retenida, motivo: motivoDe(veredicto) || undefined },
          moderacion,
        });
        continue;
      }

      const huella: HuellaSello = { ancho: resultado.ancho, alto: resultado.alto, zonas: resultado.zonas };

      // Idempotencia de RESULTADO: lo publicado ya salió de esta misma original y el sellado
      // que acaba de calcularse es equivalente al que se le estampó entonces. No se sube nada.
      if (origenUrl && mismoSellado(leerHuellaSello(registro?.placa_auto_zonas), huella)) {
        trabajos.push({
          resultado: { url, estado: 'ya_sellada', origen_url: origenUrl, zonas: huella.zonas, retenida, motivo: motivoDe(veredicto) || undefined },
          moderacion,
        });
        continue;
      }

      if (opciones.simular) {
        // Simulación: se llegó hasta el final (la foto CAMBIARÍA), pero no se sube ni se
        // escribe nada. Se reporta con las coordenadas del sellado que se habría estampado.
        trabajos.push({
          resultado: { url, estado: 'corregida', origen_url: origenUrl || undefined, zonas: huella.zonas, retenida, motivo: motivoDe(veredicto) || undefined },
          moderacion,
        });
        continue;
      }

      const nombre = `${PREFIJO_FOTO_REPROCESADA}${vehiculo.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const { url: nuevaUrl } = await uploadFile(nombre, 'image/jpeg', resultado.buffer);
      trabajos.push({
        resultado: { url, estado: 'corregida', origen_url: origenUrl || undefined, nuevaUrl, zonas: huella.zonas, retenida, motivo: motivoDe(veredicto) || undefined },
        cambio: { nuevaUrl, origenUrl: fuente, huella: JSON.stringify(huella) },
        moderacion,
      });
    } catch (err) {
      // Tolerante a fallos por foto: una foto individual (URL caída, formato raro, error
      // de red/Anthropic/Cloudinary) no aborta el resto del vehículo ni del lote.
      trabajos.push({ resultado: { url, estado: 'error', error: err instanceof Error ? err.message : String(err) } });
    }
    await esperar(DELAY_ENTRE_FOTOS_MS);
  }

  // ── ¿Este vehículo queda retenido? ──────────────────────────────────────────────────
  const veredictos = trabajos.map(t => t.moderacion?.veredicto).filter((v): v is Veredicto => !!v);
  const bloqueantes = veredictos.filter(v => v.bloqueante);
  const porPlaca = veredictos.filter(v => v.placa && !v.bloqueante);
  // Se difiere solo si TODO lo que hay es retención por placa: basta un motivo bloqueante
  // (contenido inapropiado o moderación sin evaluar) para que el vehículo salga igual.
  const diferir = opciones.retencion === 'diferir' && bloqueantes.length === 0;
  const retirar = bloqueantes.length > 0 || (porPlaca.length > 0 && !diferir);
  const motivoRetiro = [...bloqueantes.map(v => v.motivoBloqueante), ...(diferir ? [] : porPlaca.map(v => v.motivoPlaca))]
    .filter(Boolean).join(' | ');

  const estabaVisible = Number(vehiculo.archivado) === 0
    && Number(vehiculo.disponible) === 1
    && Number(vehiculo.contenido_revision) === 0;
  const saleDelCatalogo = retirar && estabaVisible;

  if (!opciones.simular && veredictos.length > 0) {
    const cambios = new Map<string, { nuevaUrl: string; origenUrl: string; huella: string }>();
    for (const t of trabajos) if (t.cambio) cambios.set(t.resultado.url, t.cambio);

    const aplicarCambios = db.transaction(() => {
      // Lost-update: `fotos`/`fotos_detalle` se leyeron ANTES del bucle async de
      // descarga+IA+subida (puede tardar decenas de segundos por vehículo). Si el propietario
      // editó el vehículo mientras tanto, ese snapshot ya quedó obsoleto. Se relee FRESCO
      // aquí dentro y los reemplazos se aplican sobre esa lectura. Si una URL que íbamos a
      // reemplazar ya no está (la borró mientras tanto), no hay nada que reemplazar — no es
      // un error.
      const filaFresca = db.prepare('SELECT fotos, fotos_detalle FROM vehiculos WHERE id = ?')
        .get(vehiculo.id) as { fotos: string; fotos_detalle: string } | undefined;

      if (filaFresca && cambios.size > 0) {
        const nuevasFotos = parseFotos(filaFresca.fotos).map(u => cambios.get(u)?.nuevaUrl ?? u);
        const nuevasFotosDetalle: Record<string, string> = {};
        for (const [clave, u] of Object.entries(parseFotosDetalle(filaFresca.fotos_detalle))) {
          nuevasFotosDetalle[clave] = cambios.get(u)?.nuevaUrl ?? u;
        }
        if (retirar) {
          db.prepare('UPDATE vehiculos SET fotos = ?, fotos_detalle = ?, contenido_revision = 1, contenido_revision_motivo = ? WHERE id = ?')
            .run(JSON.stringify(nuevasFotos), JSON.stringify(nuevasFotosDetalle), motivoRetiro, vehiculo.id);
        } else {
          db.prepare('UPDATE vehiculos SET fotos = ?, fotos_detalle = ? WHERE id = ?')
            .run(JSON.stringify(nuevasFotos), JSON.stringify(nuevasFotosDetalle), vehiculo.id);
        }
      } else if (retirar) {
        // Ninguna foto cambió de URL, pero igual hay que marcar el vehículo en revisión.
        db.prepare('UPDATE vehiculos SET contenido_revision = 1, contenido_revision_motivo = ? WHERE id = ?')
          .run(motivoRetiro, vehiculo.id);
      }

      // Registro allow-list (ver lib/moderacion.ts): POST/PUT /api/vehiculos exige que TODA
      // URL en fotos/fotos_detalle tenga un registro server-side de haber pasado por
      // /api/upload, perteneciente al usuario que edita. Sin este registro, la PRÓXIMA vez que
      // el propietario edite este vehículo (incluso sin tocar fotos) el guardado se
      // rechazaría. Se registra a nombre del PROPIETARIO del vehículo (no del admin que
      // dispara el reproceso) — igual que si él mismo la hubiera subido.
      //
      // Se registra TODA foto evaluada en esta corrida, no solo las que cambiaron de URL: una
      // foto sin placa visible que igual quedó marcada no debe perderse en silencio. Se
      // registra bajo la URL que el vehículo va a conservar: la NUEVA si hubo reemplazo, o la
      // publicada si no cambió.
      for (const t of trabajos) {
        if (!t.moderacion) continue;
        const urlFinal = t.cambio?.nuevaUrl ?? t.moderacion.urlPublicada;
        // Se pasa la decisión EFECTIVA del vehículo, no el modo pedido: si alguna otra foto
        // trajo un motivo bloqueante, el vehículo sale del catálogo igual, y entonces no tiene
        // sentido anotar la retención por placa de ESTA foto como "diferida" (quedaría como
        // pendiente sin bloquear, cuando el vehículo ya está bloqueado por otra cosa).
        const escritura = escrituraModeracion(t.moderacion.veredicto, diferir ? 'diferir' : 'retirar');
        registrarFotoModeracion(db, urlFinal, vehiculo.propietario_id, escritura.contenidoInapropiado, escritura.motivo);
        // El VÍNCULO con la original: es lo que permite que la próxima corrida parta de la
        // foto limpia en vez de apilar un sello más. `placa_auto_zonas` (la huella de lo que
        // se estampó) solo se escribe cuando de verdad se subió una foto nueva — si no, se
        // conserva la de la foto que sigue publicada.
        if (t.cambio) {
          db.prepare(
            `UPDATE fotos_moderacion
                SET placa_origen_url = ?, placa_auto_zonas = ?,
                    placa_revision_pendiente = ?, placa_revision_motivo = ?
              WHERE url_normalizada = ?`,
          ).run(
            t.cambio.origenUrl, t.cambio.huella,
            escritura.pendiente ? 1 : 0, escritura.motivoPendiente,
            normalizarUrlFoto(urlFinal),
          );
        } else {
          db.prepare(
            `UPDATE fotos_moderacion
                SET placa_origen_url = ?, placa_revision_pendiente = ?, placa_revision_motivo = ?
              WHERE url_normalizada = ?`,
          ).run(
            t.moderacion.origenUrl, escritura.pendiente ? 1 : 0, escritura.motivoPendiente,
            normalizarUrlFoto(urlFinal),
          );
        }
      }
    });
    aplicarCambios();
  }

  const cuenta = (e: EstadoFoto) => trabajos.filter(t => t.resultado.estado === e).length;
  return {
    vehiculo_id: vehiculo.id,
    marca: vehiculo.marca,
    modelo: vehiculo.modelo,
    placa: vehiculo.placa,
    fotos_totales: urlsUnicas.length,
    corregidas: cuenta('corregida'),
    sin_cambios: cuenta('sin_cambios'),
    ya_selladas: cuenta('ya_sellada'),
    omitidas_sin_original: cuenta('omitida_sin_original'),
    omitidas_manual: cuenta('omitida_manual'),
    fallidas: cuenta('error'),
    fotos_retenidas: trabajos.filter(t => t.resultado.retenida).length,
    retenido: retirar || (diferir && porPlaca.length > 0),
    sale_del_catalogo: saleDelCatalogo,
    retencion_diferida: diferir && porPlaca.length > 0,
    motivo_retencion: motivoRetiro || (diferir ? porPlaca.map(v => v.motivoPlaca).filter(Boolean).join(' | ') : '') || undefined,
    fotos: trabajos.map(t => t.resultado),
  };
}

// POST /api/admin/reprocesar-placas
// Body:
//  - vehiculo_id?: number — reprocesa SOLO ese vehículo (recomendado para probar antes del
//    lote; puede ser cualquier vehículo, incluido uno archivado).
//  - limit?/offset?: paginación manual sobre "todos los vehículos publicados" (archivado=0),
//    para cortar el trabajo en lotes más chicos (mitiga el riesgo de que una request muy
//    larga se corte por un timeout de proxy/plataforma).
//  - confirmar?: OBLIGATORIO en true para el modo "todos los vehículos" (sin vehiculo_id) y
//    sin `simular`. Sin este flag, un body vacío/mal armado ({} por typo, JSON corrupto que
//    cae al default) NO dispara el reproceso de toda la flota.
//  - simular?: true — DRY RUN. Corre el pipeline completo y no escribe nada (ni Cloudinary ni
//    base). Es el modo con el que hay que mirar un lote ANTES de correrlo: dice cuántas fotos
//    cambiarían, cuántas quedarían retenidas y cuántos vehículos saldrían del catálogo.
//  - retencion?: 'retirar' | 'diferir' — qué hacer con las fotos retenidas (ver ModoRetencion).
//    OBLIGATORIO y explícito en modo lote; en el modo de un solo vehículo, por defecto
//    'retirar' (el criterio aprobado).
//  - max_retiros?: number — freno del lote: si la corrida llega a retirar esa cantidad de
//    vehículos del catálogo público, se detiene y no sigue con los que falten.
export async function POST(req: NextRequest) {
  const puerta = await puertaDeEntrada(req);
  if ('error' in puerta) return puerta.error;
  const actor = puerta.actor;

  let body: {
    vehiculo_id?: number; limit?: number; offset?: number; confirmar?: boolean;
    simular?: boolean; retencion?: string; max_retiros?: number;
  } = {};
  try { body = await req.json(); } catch { body = {}; }

  const simular = body.simular === true;
  const esLote = body.vehiculo_id === undefined;

  if (body.retencion !== undefined && body.retencion !== 'retirar' && body.retencion !== 'diferir') {
    return NextResponse.json(
      { error: "retencion debe ser 'retirar' o 'diferir'" },
      { status: 400 },
    );
  }
  // En un LOTE REAL hay que decidir a mano qué pasa con la vitrina. Es el punto 3 del
  // incidente: el problema no fue el criterio, fue que media flota podía salir del catálogo
  // sin que nadie lo hubiera elegido. En el modo de un solo vehículo se mantiene el default
  // aprobado ('retirar'), y en SIMULACIÓN tampoco se exige: pedir un parámetro extra para
  // mirar sin tocar nada solo desalentaría el paso previo que este arreglo quiere fomentar —
  // se simula el peor caso ('retirar', el criterio aprobado) y la respuesta siempre dice con
  // cuál se simuló.
  if (esLote && !simular && body.retencion === undefined) {
    return NextResponse.json(
      {
        error: "Falta retencion: 'retirar' o 'diferir'. En modo lote hay que decidir explícitamente qué pasa con los vehículos cuyas fotos queden retenidas: 'retirar' los saca del catálogo público (criterio aprobado, es lo que hacía antes) y 'diferir' aplica los sellos y deja la revisión anotada sin sacarlos de la vitrina. Corre antes con simular:true para ver cuántos serían.",
      },
      { status: 400 },
    );
  }
  const retencion: ModoRetencion = body.retencion === 'diferir' ? 'diferir' : 'retirar';

  const maxRetiros = body.max_retiros !== undefined ? Number(body.max_retiros) : undefined;
  if (maxRetiros !== undefined && (!Number.isFinite(maxRetiros) || maxRetiros < 0)) {
    return NextResponse.json({ error: 'max_retiros inválido' }, { status: 400 });
  }

  const db = getDb();
  let vehiculos: VehiculoRow[];

  if (!esLote) {
    const vehiculoId = Number(body.vehiculo_id);
    if (!Number.isFinite(vehiculoId) || vehiculoId <= 0) {
      return NextResponse.json({ error: 'vehiculo_id inválido' }, { status: 400 });
    }
    vehiculos = db.prepare(`SELECT ${CAMPOS_VEHICULO} FROM vehiculos WHERE id = ?`).all(vehiculoId) as VehiculoRow[];
    if (vehiculos.length === 0) {
      return NextResponse.json({ error: 'Vehículo no encontrado' }, { status: 404 });
    }
  } else {
    // La simulación no escribe nada, así que no necesita `confirmar` — pedirlo solo
    // desalentaría el paso previo que este arreglo existe para fomentar.
    if (!simular && body.confirmar !== true) {
      return NextResponse.json(
        { error: 'Falta confirmar:true para reprocesar TODOS los vehículos publicados (o simular:true para ver antes qué pasaría)' },
        { status: 400 },
      );
    }
    // Sin vehiculo_id: TODOS los vehículos publicados (no archivados — los archivados no se
    // listan en ningún lado, no vale la pena gastar llamadas a Anthropic en ellos; para
    // reprocesar uno archivado puntual, pasar su vehiculo_id explícitamente).
    const limit = body.limit !== undefined ? Math.max(1, Math.min(500, Number(body.limit) || 0)) : undefined;
    const offset = body.offset !== undefined ? Math.max(0, Number(body.offset) || 0) : 0;
    const base = `SELECT ${CAMPOS_VEHICULO} FROM vehiculos WHERE archivado = 0 ORDER BY id ASC`;
    vehiculos = (
      limit ? db.prepare(`${base} LIMIT ? OFFSET ?`).all(limit, offset) : db.prepare(base).all()
    ) as VehiculoRow[];
  }

  const resumenVehiculos: VehiculoResumen[] = [];
  let retirados = 0;
  let detenidoPorTope = false;

  for (const vehiculo of vehiculos) {
    // Freno: si el lote ya sacó del catálogo tantos vehículos como se autorizó, se para acá
    // en vez de seguir bajando carros. Lo ya hecho queda hecho (cada vehículo se aplica en su
    // propia transacción); el resto se puede retomar con `offset` después de mirar el
    // reporte. En simulación no frena: ahí justamente se quiere el número completo.
    if (!simular && maxRetiros !== undefined && retirados >= maxRetiros) {
      detenidoPorTope = true;
      break;
    }
    try {
      const resumen = await reprocesarVehiculo(db, vehiculo, { simular, retencion });
      if (resumen.sale_del_catalogo) retirados++;
      resumenVehiculos.push(resumen);
    } catch (err) {
      // Defensivo: cada foto ya está protegida por su propio try/catch dentro de
      // reprocesarVehiculo, así que esto solo cubre un fallo inesperado a nivel de vehículo
      // entero — igual no debe abortar el resto del lote.
      resumenVehiculos.push({
        vehiculo_id: vehiculo.id, marca: vehiculo.marca, modelo: vehiculo.modelo, placa: vehiculo.placa,
        fotos_totales: 0, corregidas: 0, sin_cambios: 0, ya_selladas: 0,
        omitidas_sin_original: 0, omitidas_manual: 0, fallidas: 1, fotos_retenidas: 0,
        retenido: false, sale_del_catalogo: false, retencion_diferida: false,
        fotos: [{ url: '(vehículo completo)', estado: 'error', error: err instanceof Error ? err.message : String(err) }],
      });
    }
  }

  const totales = resumenVehiculos.reduce(
    (acc, r) => ({
      fotos_totales: acc.fotos_totales + r.fotos_totales,
      corregidas: acc.corregidas + r.corregidas,
      sin_cambios: acc.sin_cambios + r.sin_cambios,
      ya_selladas: acc.ya_selladas + r.ya_selladas,
      omitidas_sin_original: acc.omitidas_sin_original + r.omitidas_sin_original,
      omitidas_manual: acc.omitidas_manual + r.omitidas_manual,
      fallidas: acc.fallidas + r.fallidas,
      fotos_retenidas: acc.fotos_retenidas + r.fotos_retenidas,
    }),
    { fotos_totales: 0, corregidas: 0, sin_cambios: 0, ya_selladas: 0, omitidas_sin_original: 0, omitidas_manual: 0, fallidas: 0, fotos_retenidas: 0 },
  );

  const vehiculosRetenidos = resumenVehiculos.filter(r => r.retenido).length;
  const vehiculosDiferidos = resumenVehiculos.filter(r => r.retencion_diferida).length;
  const vehiculosFueraDelCatalogo = resumenVehiculos.filter(r => r.sale_del_catalogo);
  const vehiculosPendientesDeOriginal = resumenVehiculos.filter(r => r.omitidas_sin_original > 0);

  // Bitácora de auditoría: este endpoint reescribe fotos de vehículos reales en lote, así
  // que debe quedar rastro de quién lo disparó (o 'cron' si vino por x-cron-secret), con
  // qué parámetros y con qué resultado — y también de las simulaciones, que son la decisión
  // previa a una corrida real. `registrarAuditoria` ya traga sus propios errores
  // internamente (ver lib/permisos.ts) y jamás lanza.
  registrarAuditoria(db, actor, {
    area: 'vehiculos',
    accion: simular ? 'reprocesar_placas_simulacion' : 'reprocesar_placas',
    entidad: 'vehiculo',
    entidad_id: body.vehiculo_id !== undefined ? Number(body.vehiculo_id) : 0,
    detalle: JSON.stringify({
      modo: simular ? 'simulacion' : 'real',
      retencion,
      vehiculo_id: body.vehiculo_id ?? null,
      limit: body.limit ?? null,
      offset: body.offset ?? null,
      max_retiros: maxRetiros ?? null,
      detenido_por_tope: detenidoPorTope,
      ...totales,
      vehiculos_procesados: resumenVehiculos.length,
      vehiculos_con_correcciones: resumenVehiculos.filter(r => r.corregidas > 0).length,
      vehiculos_retenidos: vehiculosRetenidos,
      vehiculos_fuera_del_catalogo: vehiculosFueraDelCatalogo.length,
    }),
  });

  return NextResponse.json({
    modo: simular ? 'simulacion' : 'real',
    retencion,
    // La detección pasa por un modelo de visión, que no responde exactamente igual dos veces.
    // La simulación corre el MISMO pipeline sobre las MISMAS fotos, así que sus cuentas son
    // las que hay que mirar para decidir; pero un caso de frontera (una placa chica del fondo
    // que el modelo ve en una corrida y no en la siguiente) puede moverse entre "retenida" y
    // "sin cambios" de una pasada a otra. Se dice acá y no en un comentario para que quien
    // lea la respuesta lo sepa.
    aviso: simular
      ? 'Simulación: no se subió ni se guardó nada. Las cuentas salen de correr el mismo pipeline sobre las mismas fotos; la detección usa un modelo de visión, así que un caso de frontera puede moverse entre corridas.'
      : undefined,
    vehiculos_procesados: resumenVehiculos.length,
    vehiculos_con_correcciones: resumenVehiculos.filter(r => r.corregidas > 0).length,
    ...totales,
    // Lo que el dueño tiene que ver ANTES de decidir: cuántos carros deja de mostrar la
    // vitrina. `vehiculos_retenidos` incluye también los que ya estaban fuera (archivados, no
    // disponibles o ya en revisión); `vehiculos_fuera_del_catalogo` son solo los que ESTA
    // corrida saca de la vitrina pública.
    vehiculos_retenidos: vehiculosRetenidos,
    vehiculos_retencion_diferida: vehiculosDiferidos,
    [simular ? 'vehiculos_que_saldrian_del_catalogo' : 'vehiculos_retirados_del_catalogo']: vehiculosFueraDelCatalogo.length,
    vehiculos_fuera_del_catalogo: vehiculosFueraDelCatalogo.map(r => ({
      vehiculo_id: r.vehiculo_id, marca: r.marca, modelo: r.modelo, placa: r.placa, motivo: r.motivo_retencion,
    })),
    // Fotos selladas por corridas anteriores a este arreglo, sin vínculo con su original: no
    // se tocaron. Se resuelven a mano con el tapado manual (que muestra la foto y deja marcar
    // las placas), no adivinando de qué original vienen.
    vehiculos_con_fotos_sin_original: vehiculosPendientesDeOriginal.map(r => ({
      vehiculo_id: r.vehiculo_id, marca: r.marca, modelo: r.modelo, placa: r.placa, fotos: r.omitidas_sin_original,
    })),
    detenido_por_tope: detenidoPorTope,
    vehiculos_sin_procesar: detenidoPorTope ? vehiculos.length - resumenVehiculos.length : 0,
    detalle: resumenVehiculos,
  });
}
