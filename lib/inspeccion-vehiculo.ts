import { getAnthropic } from './anthropic';
import { consumirIntento, verificarIntento } from './limite-tasa';
import { fetchAsBase64 } from './verificacion-docs';
export type HallazgoDano = { tipo: string; ubicacion: string; descripcion: string; confianza: 'alta' | 'media' | 'baja'; };
export type InspeccionResultado = { hay_danos_nuevos: boolean; severidad_general: 'ninguna' | 'leve' | 'moderada' | 'grave'; hallazgos: HallazgoDano[]; zonas_no_comparables: string; resumen: string; recomendacion: string; };

type ImgMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

// ── Límite de tasa ───────────────────────────────────────────────────────────
// Una inspección manda hasta 16 imágenes en una sola llamada a Claude: es de
// lejos la acción más cara de la app por clic, y el botón que la dispara está
// en dos pantallas donde es normal darle otra vez si algo no convence. Además,
// una de esas pantallas (/m/<token>) no tiene login: basta con el enlace del
// mensajero para gastar consultas de IA. Los topes viven acá (y no en cada
// ruta) para que las dos compartan de verdad el techo global.
const ACTOR_MAX_CORTO = 6;
const ACTOR_VENTANA_CORTA_MS = 10 * 60 * 1000;
const ACTOR_MAX_DIARIO = 40;
const DIA_MS = 24 * 60 * 60 * 1000;
const GLOBAL_MAX_HORA = 120;
const HORA_MS = 60 * 60 * 1000;

/**
 * Consume un intento de inspección para `actor` (ej. `admin:12`, `mensajero:3`).
 * Devuelve el mensaje de error listo para el usuario si se pasó del límite, o
 * null si puede seguir. El llamador responde 429 con ese mensaje.
 *
 * Los tres cubos se MIRAN primero y solo se consumen si pasan los tres. Hacerlo
 * en cascada (consumir el corto, luego el diario, luego el global) significaba
 * que un rechazo del cubo global — que se llena con el tráfico de TODOS — le
 * gastaba al actor un intento de su cuota diaria por una inspección que nunca
 * ocurrió: en un rato malo, alguien podía quemar sus 40 del día sin haber
 * mandado una sola foto.
 *
 * El límite es por actor y por ventana fija: si se agota, el mensaje dice
 * cuánto falta de verdad (la ventana empieza en el PRIMER intento, no a
 * medianoche) para no prometer un reset que no va a ocurrir.
 */
export function limiteInspeccion(actor: string): string | null {
  const cubos = [
    {
      clave: `inspeccion-ia:corto:${actor}`, max: ACTOR_MAX_CORTO, ventanaMs: ACTOR_VENTANA_CORTA_MS,
      mensaje: (segundos: number) => `Muchas inspecciones seguidas. Espera ${Math.ceil(segundos / 60)} minuto(s) e intenta de nuevo.`,
    },
    {
      clave: `inspeccion-ia:dia:${actor}`, max: ACTOR_MAX_DIARIO, ventanaMs: DIA_MS,
      mensaje: (segundos: number) => `Alcanzaste el máximo de inspecciones con IA (${ACTOR_MAX_DIARIO} cada 24 horas). Vuelve a intentar en ${Math.ceil(segundos / 3600)} hora(s).`,
    },
    {
      clave: 'inspeccion-ia:global', max: GLOBAL_MAX_HORA, ventanaMs: HORA_MS,
      mensaje: () => 'La inspección con IA está saturada en este momento. Intenta más tarde.',
    },
  ];

  for (const c of cubos) {
    const espera = verificarIntento(c.clave, c.max);
    if (espera !== null) return c.mensaje(espera);
  }
  for (const c of cubos) consumirIntento(c.clave, c.max, c.ventanaMs);
  return null;
}

/**
 * Chequeo BARATO de que la operación tiene material para comparar: no descarga
 * nada ni llama a la IA, solo mira las dos columnas de fotos.
 *
 * Existe para poder rechazar ANTES de gastar un intento del límite de tasa. Es
 * de lejos el fallo más común en campo (el mensajero le da a "inspeccionar"
 * antes de subir las fotos de entrada) y gastaba cuota igual: seis toques al
 * botón dejaban al mensajero bloqueado 10 minutos con el cliente delante por
 * seis inspecciones que nunca salieron de la app. `ejecutarInspeccion` vuelve a
 * comprobarlo por su cuenta; esto no lo reemplaza, se adelanta.
 *
 * Devuelve el mensaje de error (400) o null si hay fotos de los dos juegos.
 */
export function faltanFotosParaInspeccion(fotosSalidaJson: unknown, fotosEntradaJson: unknown): string | null {
  const urls = (raw: unknown): string[] => {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.trim() !== '') : [];
    } catch {
      return [];
    }
  };
  if (urls(fotosSalidaJson).length === 0) return 'No hay fotos de salida para comparar';
  if (urls(fotosEntradaJson).length === 0) return 'No hay fotos de entrada para comparar';
  return null;
}

// Tope de fotos POR JUEGO que se mandan en una sola llamada. Cada imagen cuesta
// tokens de visión (y tiempo de subida), y una operación puede acumular muchas
// fotos sueltas: con 8 + 8 ya se cubre el recorrido típico del mensajero
// (frente, atrás, los dos costados, las cuatro esquinas / interior). Si un juego
// trae más, se usan las PRIMERAS y el recorte se declara en
// `zonas_no_comparables` — nunca en silencio: quien lee el resultado tiene que
// saber que hay fotos que la IA no miró.
const MAX_FOTOS_POR_JUEGO = 8;

// Lado largo al que se reescala cada foto antes de mandarla. La API de visión de
// Anthropic ya reduce internamente cualquier imagen cuyo lado largo supere
// ~1568 px, así que mandar el original de 12 MP de un celular no le da ni un
// píxel más de detalle al modelo: solo infla el base64 (hasta ~6 MB por foto,
// x16 fotos) y hace que la petición tarde o reviente. Reducir acá NO pierde
// detalle útil para ver un rayón y baja el payload en un orden de magnitud.
const LADO_MAX_PX = 1568;

// Cuántas fotos se descargan y decodifican A LA VEZ. Descargar las 16 en
// paralelo era tentador (termina antes) pero significa tener 16 fotos de 12 MP
// decodificándose al mismo tiempo: cada una son decenas de MB de mapa de bits
// en libvips, y esto corre en UN contenedor de Railway compartido con TODO el
// sitio. Un pico así no tumba solo la inspección: tumba la app. En lotes de 4 el
// techo de memoria es predecible y el tiempo total sigue siendo aceptable
// (4 tandas de descargas con timeout de 20 s cada una en el peor caso).
const LOTE_FOTOS = 4;

// Tope de tiempo por llamada a Claude. Sin opciones, el SDK usa `maxRetries: 2`
// y un timeout efectivo de 10 minutos: con el reintento de más abajo, el peor
// caso eran SEIS subidas de 16 fotos y una petición colgada eternamente.
// `export const maxDuration` de Next no corta nada acá (esto se despliega en
// Railway con Docker, no en Vercel), así que el único tope real es este.
// Medido: una inspección de 16 fotos a 1568 px son ~25-26k tokens de visión y
// tarda entre 20 y 45 s, así que 120 s deja margen de sobra para un servicio con
// muchas fotos y un día lento sin matar inspecciones legítimas.
const TIMEOUT_LLAMADA_MS = 120_000;

// Presupuesto de punta a punta (descargas + llamadas). El reintento solo ocurre
// si de verdad cabe: reintentar cuando ya se gastaron 4 minutos solo sirve para
// dejar al mensajero mirando una rueda que igual va a fallar.
const PRESUPUESTO_TOTAL_MS = 240_000;
// Por debajo de esto no vale la pena ni empezar una llamada de 16 fotos.
const MIN_PARA_LLAMAR_MS = 45_000;

type FotoLista =
  | { etiqueta: string; ok: true; data: string; mediaType: ImgMediaType }
  | { etiqueta: string; ok: false; error: string };

/**
 * Descarga UNA foto y la deja lista para el bloque `image` de Anthropic.
 *
 * Reutiliza `fetchAsBase64` (lib/verificacion-docs.ts), que ya trae lo caro de
 * hacer bien: timeout de descarga, validación de los bytes REALES con sharp (no
 * del content-type que declare el CDN), rechazo de archivos truncados, rotación
 * EXIF y tope de tamaño. Acá solo se añade el reescalado y el descarte de PDFs
 * (un juego de fotos no debería traer uno; si pasa, se anota como foto no
 * utilizable en vez de mandarle a Claude un bloque `document` que no toca).
 */
async function prepararFoto(url: string, etiqueta: string): Promise<FotoLista> {
  try {
    // El reescalado se delega a `fetchAsBase64` (opción `ladoMaxPx`) a propósito:
    // hacerlo acá obligaba a decodificar cada foto DOS veces (una para validarla
    // allá, otra para reducirla acá). Con 12 MP por foto eso era el doble de
    // memoria y de CPU por nada.
    const { data, mediaType } = await fetchAsBase64(url, { ladoMaxPx: LADO_MAX_PX });
    if (mediaType === 'application/pdf') {
      return { etiqueta, ok: false, error: 'el archivo es un PDF, no una foto del vehículo' };
    }
    return { etiqueta, ok: true, data, mediaType };
  } catch (e) {
    return { etiqueta, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Descarga y prepara las fotos en lotes de `LOTE_FOTOS` (ver esa constante:
 * el paralelismo total revienta la memoria del contenedor). Conserva el orden
 * de entrada, que es el que se usa para etiquetar las fotos. */
async function prepararFotos(items: { url: string; etiqueta: string }[]): Promise<FotoLista[]> {
  const listas: FotoLista[] = [];
  for (let i = 0; i < items.length; i += LOTE_FOTOS) {
    const lote = items.slice(i, i + LOTE_FOTOS);
    listas.push(...await Promise.all(lote.map(it => prepararFoto(it.url, it.etiqueta))));
  }
  return listas;
}

/* ── El prompt ────────────────────────────────────────────────────────────────
 *
 * Este texto decide si un empleado de DrivePass le va a decir a un cliente que
 * devolvió el carro dañado — y, en la práctica, si le va a cobrar. Los dos
 * errores posibles NO cuestan lo mismo:
 *   · Falso negativo: se pasa por alto un rayón pequeño. Se pierde plata.
 *   · Falso positivo: se acusa (y probablemente se le cobra) a alguien por un
 *     daño que no hizo. Se pierde el cliente, la reputación y la razón.
 * Por eso todo el prompt está sesgado hacia NO afirmar daño, y por eso se le
 * dice al modelo esa asimetría de forma explícita: sin ella, un modelo de visión
 * "colaborador" encuentra daños donde solo hay una sombra distinta.
 *
 * Decisiones concretas y su porqué:
 *
 * 1) Regla de la doble evidencia. Un hallazgo exige ver la marca en una foto de
 *    ENTRADA **y** ver la MISMA zona en una de SALIDA sin ella. Comparar "lo que
 *    veo ahora" contra "lo que me imagino que había" es justo lo que produce
 *    acusaciones falsas: casi todos los carros de flota ya traen marcas previas.
 *
 * 2) Lista explícita de falsos amigos (luz, hora, sombra, ángulo, distancia,
 *    reflejos, mojado/seco, sucio/lavado, gotas, polvo, encuadre, resolución,
 *    compresión). Enumerarlos uno por uno funciona mucho mejor que un genérico
 *    "sé conservador": le da al modelo la explicación alternativa concreta que
 *    tiene que descartar antes de reportar algo.
 *
 * 3) Lista cerrada de lo que SÍ es daño. Sin ella, "está más sucio" o "tiene
 *    menos gasolina" terminan colándose como hallazgos.
 *
 * 4) `confianza` con criterio operativo, no decorativo: 'baja' es literalmente
 *    "esto podría explicarse por las condiciones de la foto". Y la consecuencia
 *    está escrita: si TODO lo que encontraste es 'baja', `hay_danos_nuevos` es
 *    false (el hallazgo igual se lista, para que una persona lo mire). Esa regla
 *    además se vuelve a aplicar en código más abajo, porque es la que sostiene
 *    todo lo demás.
 *
 * 5) `zonas_no_comparables` como salida de emergencia obligatoria: lo que no se
 *    puede comparar se DECLARA, no se adivina. Es lo que convierte un "no sé" en
 *    información útil para el empleado ("revisa el costado derecho a mano").
 *
 * 6) `resumen` y `recomendacion` van dirigidos a un empleado que en 5 minutos
 *    va a estar frente al cliente: español claro, sin jerga, sin atribuir culpa
 *    y sin hablar de plata. La decisión es humana; esto es un apoyo.
 *
 * 7) `tipo` se restringe a las claves que components/InspeccionResultado.tsx
 *    sabe dibujar (rayon, abolladura, hundido, vidrio_roto, espejo, faro,
 *    llanta, otro) para que el ícono y el texto de la tarjeta salgan bien. El
 *    prompt lo pide y `normalizar` lo IMPONE con la lista blanca
 *    `TIPOS_HALLAZGO`: un prompt no es una validación.
 *
 * 8) Se pide SOLO JSON (sin razonamiento en prosa): igual que en
 *    lib/verificacion-docs.ts, el parseo ancla en el primer `{` y el último `}`,
 *    y acá los valores son texto libre en español que podría traer llaves.
 */
function construirPrompt(opts: { vehiculo: string; placa: string; nSalida: number; nEntrada: number }): string {
  return `Eres un perito de inspección vehicular para DrivePass, una plataforma colombiana de alquiler de carros en Medellín.

Vehículo: ${opts.vehiculo || 'no especificado'}${opts.placa ? ` · Placa: ${opts.placa}` : ''}
Arriba tienes ${opts.nSalida} foto(s) etiquetadas SALIDA (tomadas cuando se le ENTREGÓ el carro al cliente) y ${opts.nEntrada} foto(s) etiquetadas ENTRADA (tomadas cuando el cliente DEVOLVIÓ el carro). Cada foto viene precedida de su etiqueta (ej. "SALIDA 2/5").

Tu trabajo es UNO solo: decir si el carro volvió con daños NUEVOS que no estuvieran ya en las fotos de SALIDA.

LO MÁS IMPORTANTE — el costo de equivocarse no es simétrico:
Un empleado va a leer tu respuesta y con ella va a hablar con el cliente. Si dices que hay un daño nuevo, a esa persona le van a cobrar. Acusar a alguien de un daño que no causó es MUCHO peor que dejar pasar un rayón pequeño. Ante cualquier duda, NO afirmes que hay daño nuevo.

REGLA DE LA DOBLE EVIDENCIA (obligatoria para cada hallazgo):
Solo puedes reportar un daño si se cumplen las DOS cosas:
  (a) lo ves claramente en al menos una foto de ENTRADA, y
  (b) ves esa MISMA zona del carro en al menos una foto de SALIDA y ahí NO está.
Si la zona no aparece en las fotos de SALIDA, no puedes saber si el daño ya existía: eso NO es un hallazgo, va en "zonas_no_comparables". Nunca compares contra "cómo debería verse un carro en buen estado": estos carros suelen tener marcas previas de uso.

NO ES DAÑO NUEVO (descarta estas explicaciones ANTES de reportar algo):
- Diferencia de luz, de hora del día, de día nublado vs soleado, flash, sombras de árboles/postes/personas.
- Reflejos en la pintura, en los vidrios o en el cromado; el reflejo del que toma la foto; reflejo del cielo o de edificios.
- Ángulo, distancia o encuadre distintos; foto más cerca, más lejos, más inclinada.
- Carro mojado vs seco, gotas de agua, lluvia, vaho en los vidrios.
- Carro sucio vs lavado: polvo, barro, huellas de dedos, salpicaduras, hojas.
- Diferencia de resolución, foto movida, desenfocada, oscura, con ruido o muy comprimida (bloques de compresión que parecen rayones).
- Diferencias que no son daño: nivel de gasolina, objetos adentro, posición de espejos o asientos, kilometraje, llantas más sucias.

SÍ ES DAÑO (lo único que debes reportar):
rayón o raspón nuevo en la pintura, abolladura o golpe hundido, vidrio o farola rota/estrellada/fisurada, espejo roto o faltante, llanta rasgada/reventada, parte del carro rota, partida o faltante (bómper, moldura, manija, emblema), daño interior evidente (tapicería rota, rasgada o quemada, mancha grande y nueva).

CÓMO USAR "confianza" (úsala de verdad, no pongas todo en "alta"):
- "alta": el daño es evidente y grande, y ves la misma zona en SALIDA y en ENTRADA con calidad parecida.
- "media": lo ves, pero las condiciones de las fotos no son equivalentes (luz, ángulo o nitidez distintos).
- "baja": podría explicarse por las condiciones de la foto (sombra, reflejo, suciedad, desenfoque). Repórtalo igual como punto a revisar en persona, pero con esta confianza.
- Si TODOS tus hallazgos son de confianza "baja", entonces "hay_danos_nuevos" debe ser false: son puntos a revisar, no un daño confirmado.

REDACCIÓN (la leen personas, no abogados ni ingenieros):
- "resumen": 1 a 3 frases en español claro para un empleado que va a hablar con el cliente. Di qué comparaste y cuál es la principal limitación. Sin jerga, sin porcentajes inventados, sin atribuir culpa, sin hablar de dinero ni de cobros.
- "recomendacion": qué debería hacer esa persona ahora (por ejemplo: cerrar sin novedad, o revisar en persona una zona concreta con el cliente presente antes de concluir nada). Nunca digas que el cliente es responsable ni propongas un cobro: eso lo decide una persona.
- "ubicacion": la zona del carro y entre paréntesis las fotos en que te basas. Ejemplo: "puerta delantera izquierda (ENTRADA 3/5 vs SALIDA 2/5)".
- "zonas_no_comparables": una frase en español diciendo qué partes NO pudiste comparar y por qué (no aparecen en un juego, están tapadas, muy oscuras, movidas). Si pudiste comparar todo el exterior visible, escribe "".

Si ves un texto "[No se pudo cargar esta foto: ...]" en lugar de una imagen, esa foto no existe para ti: no opines sobre ella y menciona esa limitación en "zonas_no_comparables".

Responde ÚNICAMENTE con este JSON, sin markdown, sin texto antes ni después:
{
  "hay_danos_nuevos": true|false,
  "severidad_general": "ninguna"|"leve"|"moderada"|"grave",
  "hallazgos": [
    {
      "tipo": "rayon"|"abolladura"|"hundido"|"vidrio_roto"|"espejo"|"faro"|"llanta"|"otro",
      "ubicacion": "<zona del carro (fotos en que te basas)>",
      "descripcion": "<qué ves y por qué crees que es nuevo, en una o dos frases claras>",
      "confianza": "alta"|"media"|"baja"
    }
  ],
  "zonas_no_comparables": "<qué no pudiste comparar y por qué, o cadena vacía>",
  "resumen": "<1 a 3 frases para el empleado>",
  "recomendacion": "<qué hacer ahora>"
}

Si no encuentras daños nuevos: "hay_danos_nuevos": false, "severidad_general": "ninguna", "hallazgos": [] — y dilo con tranquilidad en el resumen. Ese es el resultado esperado en la mayoría de las entregas.`;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImgMediaType; data: string } };

const SEVERIDADES: InspeccionResultado['severidad_general'][] = ['ninguna', 'leve', 'moderada', 'grave'];
const CONFIANZAS: HallazgoDano['confianza'][] = ['alta', 'media', 'baja'];
// Lista blanca de `tipo`. El prompt ya la pide, pero un prompt no valida nada:
// si el modelo inventa "bomper_roto", la tarjeta de la UI queda sin ícono. Todo
// lo que no esté acá cae a 'otro', que sí sabe dibujarse.
const TIPOS_HALLAZGO = ['rayon', 'abolladura', 'hundido', 'vidrio_roto', 'espejo', 'faro', 'llanta', 'otro'] as const;

/** Texto libre venido del modelo. `String(x)` no sirve: si el modelo devuelve un
 * objeto o un array donde se pedía una frase, `String()` produce
 * "[object Object]" y eso termina impreso como resumen delante del cliente.
 * Si no es una cadena, no es texto: se descarta. */
function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Valida un valor de lista cerrada normalizando mayúsculas y espacios: sin esto
 * un `"Alta"` (perfectamente normal viniendo de un modelo) no coincidía con
 * 'alta', se degradaba a 'baja' y se llevaba por delante el veredicto entero. */
function opcion<T extends string>(v: unknown, permitidas: readonly T[], porDefecto: T): T {
  const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
  return (permitidas as readonly string[]).includes(s) ? (s as T) : porDefecto;
}

/**
 * Normaliza lo que devuelva el modelo a un `InspeccionResultado` válido y
 * COHERENTE. Las correcciones de acá van hacia abajo (menos acusación), con UNA
 * excepción deliberada: la severidad sube de "ninguna" a "leve" cuando el
 * modelo afirma daños con evidencia firme pero deja la severidad en "ninguna".
 * Ahí el modelo se está contradiciendo y el código resuelve la contradicción
 * hacia el lado MÁS acusador a propósito, porque la alternativa es peor: la
 * tarjeta pintaría el badge verde "Sin daños nuevos" encima de una lista de
 * daños confirmados, y quien la lee de afán se queda con el badge. Es el único
 * camino hacia arriba de toda la función.
 */
function normalizar(bruto: Record<string, unknown>, avisos: string[]): InspeccionResultado {
  const hallazgosBrutos = Array.isArray(bruto.hallazgos) ? bruto.hallazgos : [];
  const hallazgos: HallazgoDano[] = hallazgosBrutos
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map(h => ({
      tipo: opcion(h.tipo, TIPOS_HALLAZGO, 'otro'),
      ubicacion: texto(h.ubicacion),
      descripcion: texto(h.descripcion),
      confianza: opcion(h.confianza, CONFIANZAS, 'baja'),
    }))
    // Un hallazgo sin ubicación NI descripción (un `{}` suelto en el array) no
    // es información: se dibujaría como una tarjeta de daño en blanco delante
    // del cliente y, peor, contaría como "hay algo que revisar". Fuera.
    .filter(h => h.ubicacion !== '' || h.descripcion !== '');

  // Misma regla que se le pide al modelo en el prompt, aplicada también acá
  // porque es la que evita el daño real de un falso positivo: un hallazgo que
  // el propio modelo cree que "podría ser la sombra" no es motivo para decirle
  // a nadie que devolvió el carro dañado. El hallazgo NO se borra: se sigue
  // mostrando en la tarjeta para que una persona lo revise.
  const hayEvidenciaFirme = hallazgos.some(h => h.confianza === 'alta' || h.confianza === 'media');
  const hayDanos = bruto.hay_danos_nuevos === true && hallazgos.length > 0 && hayEvidenciaFirme;

  let severidad = opcion(bruto.severidad_general, SEVERIDADES, 'ninguna');
  if (!hayDanos) severidad = 'ninguna';
  else if (severidad === 'ninguna') severidad = 'leve'; // única corrección hacia arriba (ver doc de la función)

  const zonas = [texto(bruto.zonas_no_comparables), ...avisos].filter(Boolean).join(' · ');

  return {
    hay_danos_nuevos: hayDanos,
    severidad_general: severidad,
    hallazgos,
    zonas_no_comparables: zonas,
    resumen: texto(bruto.resumen) || 'La IA no devolvió un resumen; revisa los hallazgos y las fotos.',
    recomendacion: texto(bruto.recomendacion),
  };
}

/** Una llamada a Claude + parseo. Separada porque puede invocarse 2 veces (ver
 * `compararFotosVehiculo`).
 *
 * `reintentable` marca los fallos en los que repetir la llamada tiene sentido:
 * SOLO los de parseo (la respuesta llegó pero no traía JSON legible), que son
 * ruido del muestreo y suelen salir bien a la segunda. Un error de la API NO es
 * reintentable acá: el caso típico es un `400 Could not process image`, que es
 * determinista — resubir las mismas 16 fotos da exactamente el mismo 400,
 * después de haberlas subido otra vez. Los transitorios de red/carga también
 * quedan sin reintento (el SDK va con `maxRetries: 0`): se prefiere fallar
 * rápido y que la persona decida, antes que duplicar a ciegas la acción más
 * cara de la app. */
type FalloLlamada = { ok: false; error: string; reintentable: boolean };

async function llamarClaude(content: ContentBlock[], timeoutMs: number): Promise<{ ok: true; bruto: Record<string, unknown> } | FalloLlamada> {
  const anthropic = getAnthropic();
  type AnthropicContent = Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'];

  let text = '';
  try {
    const resp = await anthropic.messages.create(
      {
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        messages: [{ role: 'user', content: content as AnthropicContent }],
      },
      // Ver TIMEOUT_LLAMADA_MS: sin esto el SDK usa 10 minutos y 2 reintentos
      // propios, y nada más acota la petición en Railway.
      { timeout: timeoutMs, maxRetries: 0 },
    );
    text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), reintentable: false };
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'la IA no devolvió JSON', reintentable: true };
  try {
    const bruto = JSON.parse(match[0]) as Record<string, unknown>;
    return { ok: true, bruto };
  } catch {
    return { ok: false, error: 'la IA devolvió un JSON que no se pudo leer', reintentable: true };
  }
}

export async function compararFotosVehiculo(ctx: { vehiculo?: string; placa?: string }, fotosSalida: string[], fotosEntrada: string[]): Promise<InspeccionResultado> {
  // Reloj de toda la inspección: lo que se gaste descargando fotos sale del
  // mismo presupuesto que las llamadas a la IA (ver PRESUPUESTO_TOTAL_MS).
  const inicio = Date.now();
  const restanteMs = () => PRESUPUESTO_TOTAL_MS - (Date.now() - inicio);

  // Avisos que se añaden a `zonas_no_comparables` desde el código (no desde la
  // IA): recortes por tope de fotos y fotos que no se pudieron descargar. Son
  // hechos verificables, así que no se dejan a criterio del modelo.
  const avisos: string[] = [];

  const salidaUsadas = fotosSalida.slice(0, MAX_FOTOS_POR_JUEGO);
  const entradaUsadas = fotosEntrada.slice(0, MAX_FOTOS_POR_JUEGO);
  if (fotosSalida.length > salidaUsadas.length) {
    avisos.push(`solo se compararon las primeras ${salidaUsadas.length} de ${fotosSalida.length} fotos de salida`);
  }
  if (fotosEntrada.length > entradaUsadas.length) {
    avisos.push(`solo se compararon las primeras ${entradaUsadas.length} de ${fotosEntrada.length} fotos de entrada`);
  }

  const etiqueta = (fase: 'SALIDA' | 'ENTRADA', i: number, total: number) => `${fase} ${i + 1}/${total}`;
  // Un solo recorrido en lotes para los dos juegos: si se lanzaran los dos
  // "en lotes" pero en paralelo, el paralelismo real sería el doble.
  const preparadas = await prepararFotos([
    ...salidaUsadas.map((u, i) => ({ url: u, etiqueta: etiqueta('SALIDA', i, salidaUsadas.length) })),
    ...entradaUsadas.map((u, i) => ({ url: u, etiqueta: etiqueta('ENTRADA', i, entradaUsadas.length) })),
  ]);
  const salida = preparadas.slice(0, salidaUsadas.length);
  const entrada = preparadas.slice(salidaUsadas.length);

  const fallidas = [...salida, ...entrada].filter(f => !f.ok);
  if (fallidas.length) {
    avisos.push(`${fallidas.length} foto(s) no se pudieron cargar (${fallidas.map(f => f.etiqueta).join(', ')})`);
  }

  // Una foto rota no debe tumbar la inspección (se anota y se sigue), pero
  // quedarse sin NINGUNA foto utilizable de un lado sí: sin material de un
  // juego no hay comparación posible, y pedirle un veredicto a la IA en esas
  // condiciones es exactamente cómo se fabrica una acusación falsa.
  const salidaOk = salida.filter((f): f is Extract<FotoLista, { ok: true }> => f.ok);
  const entradaOk = entrada.filter((f): f is Extract<FotoLista, { ok: true }> => f.ok);
  if (salidaOk.length === 0) throw new Error('No se pudo cargar ninguna de las fotos de salida; revisa que las imágenes sigan disponibles.');
  if (entradaOk.length === 0) throw new Error('No se pudo cargar ninguna de las fotos de entrada; revisa que las imágenes sigan disponibles.');

  const content: ContentBlock[] = [];
  for (const f of [...salida, ...entrada]) {
    content.push({ type: 'text', text: `\n--- ${f.etiqueta} ---` });
    if (f.ok) content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
    else content.push({ type: 'text', text: `[No se pudo cargar esta foto: ${f.error}]` });
  }
  content.push({
    type: 'text',
    text: construirPrompt({
      vehiculo: ctx.vehiculo?.trim() || '',
      placa: ctx.placa?.trim() || '',
      nSalida: salidaUsadas.length,
      nEntrada: entradaUsadas.length,
    }),
  });

  // Primera llamada: nunca menos de MIN_PARA_LLAMAR_MS (si las descargas se
  // comieron el presupuesto igual hay que intentarlo una vez), nunca más de
  // TIMEOUT_LLAMADA_MS.
  let intento = await llamarClaude(content, Math.max(MIN_PARA_LLAMAR_MS, Math.min(TIMEOUT_LLAMADA_MS, restanteMs())));
  if (!intento.ok && intento.reintentable) {
    const queda = restanteMs();
    if (queda >= MIN_PARA_LLAMAR_MS) {
      intento = await llamarClaude(content, Math.min(TIMEOUT_LLAMADA_MS, queda));
    }
  }
  if (!intento.ok) throw new Error(`No se pudo completar la inspección con IA: ${intento.error}. Intenta de nuevo en un momento.`);

  return normalizar(intento.bruto, avisos);
}
