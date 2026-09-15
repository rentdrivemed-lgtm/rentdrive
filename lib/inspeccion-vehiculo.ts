import { getAnthropic } from './anthropic';
import { consumirIntento, verificarIntento } from './limite-tasa';
import { fetchAsBase64 } from './verificacion-docs';
import { CASILLAS, esUrlFotoSegura, parseFotosServicio, type FotoServicio } from './fotos-servicio';
export type HallazgoDano = { tipo: string; ubicacion: string; descripcion: string; confianza: 'alta' | 'media' | 'baja'; };
export type InspeccionResultado = { hay_danos_nuevos: boolean; severidad_general: 'ninguna' | 'leve' | 'moderada' | 'grave'; hallazgos: HallazgoDano[]; zonas_no_comparables: string; resumen: string; recomendacion: string; };

/**
 * Una marca que el carro YA TRAÍA cuando salió. Misma forma que `HallazgoDano` a
 * propósito (mismo `tipo` de la lista blanca, misma escala de `confianza`) para que
 * las dos listas se lean igual y se puedan cruzar sin traducir nada — pero el tipo es
 * distinto porque el SIGNIFICADO es distinto: un hallazgo acusa, una marca previa solo
 * describe cómo estaba el carro antes de entregarlo.
 */
export type MarcaPrevia = { tipo: string; ubicacion: string; descripcion: string; confianza: 'alta' | 'media' | 'baja'; };

/**
 * El INVENTARIO del estado en que sale el vehículo: lo que produce
 * `analizarEstadoEntrega` mirando solo las fotos de SALIDA. No es un veredicto y no
 * compara contra nada — no hay contra qué comparar todavía.
 *
 * No tiene `hay_danos_nuevos`, ni `severidad_general`, ni `recomendacion` a propósito:
 * nada de eso significa nada cuando el carro apenas va saliendo, y tenerlo invitaría a
 * pintarlo como una alarma. Un carro de flota usado tiene marcas; eso es lo normal.
 */
export type EstadoEntregaResultado = { marcas: MarcaPrevia[]; zonas_no_cubiertas: string; resumen: string; };

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
  // `parseFotosServicio` y no un filtro de strings a mano: desde las casillas
  // guiadas estas columnas guardan objetos `{casilla, url}`, y un filtro por
  // `typeof u === 'string'` los descartaba TODOS — con las 8 fotos tomadas, esta
  // función respondía "No hay fotos de salida". Sigue leyendo igual el formato
  // legado (array plano de strings) de las operaciones viejas.
  if (parseFotosServicio(fotosSalidaJson).length === 0) return 'No hay fotos de salida para comparar';
  if (parseFotosServicio(fotosEntradaJson).length === 0) return 'No hay fotos de entrada para comparar';
  return null;
}

/**
 * El mismo chequeo BARATO que `faltanFotosParaInspeccion`, pero para el análisis de
 * entrega: ahí solo hace falta el juego de SALIDA (el carro todavía no ha vuelto).
 * Sirve para rechazar ANTES de gastar un intento del límite de tasa.
 */
export function faltanFotosParaEntrega(fotosSalidaJson: unknown): string | null {
  if (parseFotosServicio(fotosSalidaJson).length === 0) return 'No hay fotos de salida para analizar';
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
 *
 * ⚠️ La dirección se vuelve a validar acá con `esUrlFotoSegura` aunque ya se validara
 * al guardarla: este es un punto donde el SERVIDOR se conecta a donde diga la base de
 * datos, y una de las dos pantallas que escriben esas URLs (/m/<token>) no tiene
 * login. Una URL que no apunte al CDN de fotos se anota como no utilizable, igual que
 * una foto caída — nunca se convierte en una petición a la red interna.
 */
async function prepararFoto(url: string, etiqueta: string): Promise<FotoLista> {
  if (!esUrlFotoSegura(url)) {
    return { etiqueta, ok: false, error: 'la dirección de la foto no es de nuestro almacenamiento de fotos' };
  }
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

type ItemFoto = { url: string; etiqueta: string; fase: 'SALIDA' | 'ENTRADA' };

/**
 * Ordena las fotos EN PARES por zona y les pone una etiqueta con el NOMBRE de la
 * zona ("SALIDA — Esquina trasera derecha"), en vez del "SALIDA 3/8" de antes.
 *
 * Por qué importa: en las pruebas reales la IA se quejaba una y otra vez de no
 * poder comparar zonas, porque no tenía forma de saber qué pedazo del carro estaba
 * mirando en cada foto ni cuál de las otras era la misma zona. Con las casillas
 * guiadas (lib/fotos-servicio.ts) eso ya se sabe, así que se le entrega masticado:
 * la foto de SALIDA de una zona y JUSTO DESPUÉS la de ENTRADA de esa misma zona.
 *
 * Las fotos sin casilla (operaciones anteriores a las casillas guiadas) van al
 * final y se etiquetan EXACTAMENTE como antes ("SALIDA 1/8"): para esos servicios
 * la inspección se comporta igual que siempre.
 *
 * `pares` y `soloUnLado` son datos verificables que se le pasan al prompt: qué
 * zonas SÍ se pueden comparar y cuáles no. Lo segundo termina además en
 * `zonas_no_comparables`, que es donde el empleado lo va a leer.
 */
function ordenarPorCasilla(salida: FotoServicio[], entrada: FotoServicio[]): {
  items: ItemFoto[]; pares: string[]; soloUnLado: string[];
} {
  const items: ItemFoto[] = [];
  const pares: string[] = [];
  const soloUnLado: string[] = [];
  const usadaS = new Set<number>();
  const usadaE = new Set<number>();

  for (const c of CASILLAS) {
    const iS = salida.findIndex((f, i) => f.casilla === c.id && !usadaS.has(i));
    const iE = entrada.findIndex((f, i) => f.casilla === c.id && !usadaE.has(i));
    if (iS < 0 && iE < 0) continue;
    if (iS >= 0) {
      usadaS.add(iS);
      items.push({ url: salida[iS].url, etiqueta: `SALIDA — ${c.nombre}`, fase: 'SALIDA' });
    }
    if (iE >= 0) {
      usadaE.add(iE);
      items.push({ url: entrada[iE].url, etiqueta: `ENTRADA — ${c.nombre}`, fase: 'ENTRADA' });
    }
    if (iS >= 0 && iE >= 0) pares.push(c.nombre);
    else soloUnLado.push(`${c.nombre} (solo hay foto de ${iS >= 0 ? 'salida' : 'entrada'})`);
  }

  const sueltasS = salida.filter((_, i) => !usadaS.has(i));
  const sueltasE = entrada.filter((_, i) => !usadaE.has(i));
  sueltasS.forEach((f, i) => items.push({ url: f.url, etiqueta: `SALIDA ${i + 1}/${sueltasS.length}`, fase: 'SALIDA' }));
  sueltasE.forEach((f, i) => items.push({ url: f.url, etiqueta: `ENTRADA ${i + 1}/${sueltasE.length}`, fase: 'ENTRADA' }));

  return { items, pares, soloUnLado };
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
 *
 * 9) Los PARES por zona. Desde las casillas guiadas (lib/fotos-servicio.ts) el
 *    mensajero toma las MISMAS 8 zonas en la entrega y en la devolución, así que
 *    el prompt ya no dice "acá hay dos montones de fotos, arréglatelas": dice qué
 *    zona es cada foto y cuál es su pareja de la otra fase, y lista aparte las
 *    zonas que solo tienen un lado. Eso es exactamente lo que le faltaba a la
 *    regla de la doble evidencia del punto (1) para poder aplicarse: sin saber
 *    qué zona mira, el modelo no podía cumplir la condición (b) y mandaba casi
 *    todo a `zonas_no_comparables`. Para operaciones anteriores a las casillas
 *    (fotos sin zona) el texto vuelve a ser el de antes.
 *
 * 10) El INVENTARIO de entrega (`opts.inventario`), cuando existe. Es la lista de
 *    marcas que `analizarEstadoEntrega` levantó de las fotos de SALIDA en el momento
 *    de entregar el carro, y entra al prompt como "esto es lo que el carro ya tenía".
 *    Le ahorra al modelo tener que deducir de las fotos lo que alguien ya dedujo con
 *    calma y sin prisa, y refuerza la condición (b) de la doble evidencia: una marca
 *    que está en el inventario NO es daño nuevo por clarísima que se vea en la
 *    devolución. Va con su reverso escrito: que algo NO esté en la lista no prueba
 *    nada (el inventario puede estar incompleto), así que la doble evidencia se sigue
 *    aplicando igual. Sin ese reverso, el inventario se convertiría en una máquina de
 *    falsos positivos, que es justo lo contrario de lo que busca todo este prompt.
 *    Es OPCIONAL: la mayoría de las operaciones no lo tienen y ahí el texto es
 *    EXACTAMENTE el de siempre.
 */
function bloqueInventario(inv: EstadoEntregaResultado | null | undefined): string {
  if (!inv) return '';
  const marcas = inv.marcas ?? [];
  const lineas = marcas.map(m => `- ${m.tipo.replace(/_/g, ' ')} · ${m.ubicacion || 'sin zona anotada'} (anotado con confianza ${m.confianza}): ${m.descripcion || 'sin descripción'}`);
  return `
LO QUE EL CARRO YA TENÍA CUANDO SALIÓ (inventario levantado al entregarlo):
Antes de entregarle el carro al cliente se revisaron las fotos de SALIDA y se anotó TODA marca visible. Esto es lo que ya estaba:
${lineas.length > 0 ? lineas.join('\n') : '(no se anotó ninguna marca)'}${inv.zonas_no_cubiertas ? `\nZonas que ese inventario no pudo cubrir: ${inv.zonas_no_cubiertas}` : ''}

CÓMO USAR ESA LISTA (importante):
- Si algo que ves en ENTRADA corresponde a una marca de esa lista (misma zona y misma clase de marca), NO es daño nuevo: no lo reportes, por muy claro que se vea ahora.
- Que una marca NO aparezca en la lista NO prueba que sea nueva: el inventario pudo quedarse corto. Para cualquier cosa que no esté en la lista sigue aplicando la REGLA DE LA DOBLE EVIDENCIA exactamente igual que si la lista no existiera.
`;
}

function construirPrompt(opts: {
  vehiculo: string; placa: string; nSalida: number; nEntrada: number;
  pares: string[]; soloUnLado: string[]; sinCasilla: number;
  inventario?: EstadoEntregaResultado | null;
}): string {
  const bloquePares = opts.pares.length > 0
    ? `
CÓMO VIENEN ORDENADAS LAS FOTOS (esto es lo más útil que tienes):
Las fotos están agrupadas POR ZONA del carro y en pares: primero la de SALIDA de una zona y JUSTO DESPUÉS la de ENTRADA de esa MISMA zona, tomada desde la misma posición. La etiqueta de cada foto trae la fase y el nombre de la zona, por ejemplo "SALIDA — Esquina trasera derecha" seguida de "ENTRADA — Esquina trasera derecha".
Compara cada foto contra la de su pareja. No compares una zona contra otra distinta.

Zonas que SÍ puedes comparar (tienen foto en las dos fases): ${opts.pares.join(', ')}.${
  opts.soloUnLado.length > 0
    ? `
Zonas que NO puedes comparar porque solo tienen foto de una fase: ${opts.soloUnLado.join(', ')}. Sobre estas no puedes concluir nada: van en "zonas_no_comparables".`
    : ''
}${
  opts.sinCasilla > 0
    ? `
Además hay ${opts.sinCasilla} foto(s) sin zona asignada, etiquetadas con números ("SALIDA 1/3"). Con esas tienes que deducir tú la zona; si no logras emparejarlas con su equivalente de la otra fase, no concluyas nada sobre ellas.`
    : ''
}
`
    : `
Cada foto viene precedida de su etiqueta (ej. "SALIDA 2/5"). Estas fotos no traen la zona del carro anotada: tienes que deducir tú qué parte del carro es cada una y cuál es su equivalente en la otra fase.
`;

  return `Eres un perito de inspección vehicular para DrivePass, una plataforma colombiana de alquiler de carros en Medellín.

Vehículo: ${opts.vehiculo || 'no especificado'}${opts.placa ? ` · Placa: ${opts.placa}` : ''}
Arriba tienes ${opts.nSalida} foto(s) etiquetadas SALIDA (tomadas cuando se le ENTREGÓ el carro al cliente) y ${opts.nEntrada} foto(s) etiquetadas ENTRADA (tomadas cuando el cliente DEVOLVIÓ el carro).
${bloquePares}
Tu trabajo es UNO solo: decir si el carro volvió con daños NUEVOS que no estuvieran ya en las fotos de SALIDA.

LO MÁS IMPORTANTE — el costo de equivocarse no es simétrico:
Un empleado va a leer tu respuesta y con ella va a hablar con el cliente. Si dices que hay un daño nuevo, a esa persona le van a cobrar. Acusar a alguien de un daño que no causó es MUCHO peor que dejar pasar un rayón pequeño. Ante cualquier duda, NO afirmes que hay daño nuevo.

REGLA DE LA DOBLE EVIDENCIA (obligatoria para cada hallazgo):
Solo puedes reportar un daño si se cumplen las DOS cosas:
  (a) lo ves claramente en al menos una foto de ENTRADA, y
  (b) ves esa MISMA zona del carro en al menos una foto de SALIDA y ahí NO está.
Si la zona no aparece en las fotos de SALIDA, no puedes saber si el daño ya existía: eso NO es un hallazgo, va en "zonas_no_comparables". Nunca compares contra "cómo debería verse un carro en buen estado": estos carros suelen tener marcas previas de uso.
${bloqueInventario(opts.inventario)}
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
- "ubicacion": la zona del carro y entre paréntesis las fotos en que te basas, usando las etiquetas tal como vienen. Ejemplo: "puerta delantera izquierda (ENTRADA — Esquina delantera izquierda vs SALIDA — Esquina delantera izquierda)".
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

/* ── El prompt del ANÁLISIS DE ENTREGA ────────────────────────────────────────
 *
 * ⚠️ ACÁ EL SESGO ESTÁ AL REVÉS QUE EN EL PROMPT DE ARRIBA. No es un descuido ni una
 * copia mal hecha: es la decisión central de esta función, y conviene entender por qué
 * antes de "arreglarla" para que se parezca a la comparación.
 *
 * En la COMPARACIÓN los dos errores no cuestan lo mismo: un falso positivo significa
 * acusar (y cobrarle) a un cliente por un daño que no hizo. Por eso ese prompt está
 * sesgado hacia NO afirmar daño.
 *
 * Acá no se acusa a nadie. El carro sale como sale: las marcas que tenga son marcas que
 * ya estaban, de nadie en particular, y anotarlas no le cuesta un peso a ningún cliente.
 * En cambio, CADA MARCA QUE SE PASE POR ALTO ACÁ ES UNA MARCA QUE EN LA DEVOLUCIÓN VA A
 * PARECER NUEVA — y que se le puede terminar cobrando a quien no la hizo. O sea que el
 * error caro de este prompt es exactamente el contrario del otro: quedarse corto.
 *
 * De ahí las tres reglas que lo definen:
 *
 * 1) EXHAUSTIVIDAD explícita. Se le pide anotar TODO —rayones, raspones, piedrazos,
 *    abolladuras, desgaste, tapicería, rines— por pequeño que sea, y se le dice que una
 *    lista larga es el resultado NORMAL en un carro de flota usado. Sin decirlo así, un
 *    modelo de visión tiende a resumir ("el vehículo se ve en buen estado general") y
 *    ese resumen es justo lo que después deja a un cliente pagando un rayón ajeno.
 *
 * 2) ANTE LA DUDA, SÍ SE ANOTA (con `confianza: 'baja'`). Al revés de la comparación,
 *    donde la duda manda a no reportar. Acá la duda se registra: una marca anotada de
 *    más solo hace que la comparación sea un poco más prudente; una anotada de menos
 *    puede volverse una acusación.
 *
 * 3) Lo que NO se anota son las cosas que CAMBIAN SOLAS entre la entrega y la
 *    devolución (suciedad, polvo, gotas, objetos adentro, nivel de gasolina): no
 *    describen el estado físico del carro y ensucian el inventario sin aportar nada.
 *    Pero si algo podría ser suciedad O podría ser un rayón, se anota igual con
 *    confianza baja: ese es el reverso de la regla 2.
 *
 * Lo demás se mantiene igual que en el otro prompt porque ya está resuelto ahí: `tipo`
 * restringido a la lista blanca (y además IMPUESTO en `normalizarEntrega`: un prompt no
 * valida nada), sólo JSON sin prosa, zonas no cubiertas DECLARADAS en vez de adivinadas,
 * y el `resumen` escrito para una persona —acá, además, para leérselo al cliente en el
 * punto de atención antes de entregarle el carro: sin jerga, sin culpar a nadie y sin
 * hablar de plata.
 */
function construirPromptEntrega(opts: {
  vehiculo: string; placa: string; nSalida: number; zonas: string[]; sinCasilla: number;
}): string {
  const bloqueZonas = opts.zonas.length > 0
    ? `
CÓMO VIENEN LAS FOTOS:
Cada foto trae su etiqueta con el nombre de la zona del carro, por ejemplo "SALIDA — Esquina trasera derecha". Las zonas fotografiadas son: ${opts.zonas.join(', ')}.${
  opts.sinCasilla > 0
    ? `
Además hay ${opts.sinCasilla} foto(s) sin zona asignada, etiquetadas con números ("SALIDA 1/3"): de esas tienes que deducir tú qué parte del carro es.`
    : ''
}
`
    : `
CÓMO VIENEN LAS FOTOS:
Cada foto viene precedida de su etiqueta (ej. "SALIDA 2/5"). No traen la zona anotada: tienes que deducir tú qué parte del carro es cada una.
`;

  return `Eres un perito de inspección vehicular para DrivePass, una plataforma colombiana de alquiler de carros en Medellín.

Vehículo: ${opts.vehiculo || 'no especificado'}${opts.placa ? ` · Placa: ${opts.placa}` : ''}
Arriba tienes ${opts.nSalida} foto(s) del carro tomadas JUSTO ANTES de entregárselo al cliente.
${bloqueZonas}
Tu trabajo es UNO solo: levantar el INVENTARIO del estado en que sale el vehículo. Anotar TODAS las marcas que el carro YA TIENE en este momento. No estás comparando nada con nada y no hay ningún daño que atribuirle a nadie: el carro está saliendo.

LO MÁS IMPORTANTE — sé EXHAUSTIVO, quedarte corto es el error caro:
Esta lista se va a usar después, cuando el cliente devuelva el carro, para saber qué marcas ya estaban. Toda marca que NO anotes ahora va a parecer nueva en la devolución, y se le puede terminar cobrando a un cliente que no la hizo. Por eso: anota TODO lo que veas, por pequeño que sea. Una lista larga es el resultado NORMAL: estos son carros de alquiler con kilómetros encima, no carros de vitrina.

ANTE LA DUDA, ANÓTALO:
Si no estás seguro de si eso es un rayón o es un reflejo, ANÓTALO igual y ponle "confianza": "baja". Anotar de más no perjudica a nadie; anotar de menos sí.

QUÉ ANOTAR (todo lo que sea estado físico del carro):
- Rayones, raspones y rayas de cualquier tamaño en la pintura; marcas de piedra o piedrazos en el capó y el frente.
- Abolladuras, golpes, zonas hundidas, bómper rozado o descuadrado, molduras sueltas, rotas o faltantes.
- Pintura saltada, opaca, despintada, oxidada o repintada de otro tono.
- Vidrios o farolas con estrellas, fisuras, picaduras o rayas; espejos rayados, rotos o pegados.
- Rines rayados, mordidos o con el borde golpeado; llantas gastadas, cortadas o desgastadas de un lado.
- Interior: tapicería rota, rasgada, quemada, descosida o muy desgastada; manchas; tablero rayado o agrietado; manijas, botones o forros rotos o faltantes; baúl marcado.
- Cualquier otra cosa visible que describa cómo está el carro físicamente.

QUÉ NO ANOTAR (cambia solo entre la entrega y la devolución y no dice nada del estado):
- Suciedad, polvo, barro, huellas, gotas de agua, carro mojado, hojas encima.
- Objetos dentro del carro, posición de asientos o espejos, nivel de gasolina, kilometraje.
- OJO: si algo PODRÍA ser suciedad o PODRÍA ser un rayón, anótalo igual con "confianza": "baja". Esta regla no es una excusa para dejar cosas fuera.

CÓMO USAR "confianza" (úsala de verdad, no pongas todo en "alta"):
- "alta": se ve clarísimo, no hay otra explicación posible.
- "media": se ve, pero la foto no ayuda del todo (luz, ángulo, distancia, nitidez).
- "baja": podría ser una sombra, un reflejo, suciedad o un desenfoque. Anótalo igual: por eso existe esta confianza.

REDACCIÓN (la leen personas, y este texto se le muestra al cliente antes de entregarle el carro):
- "ubicacion": la zona del carro y entre paréntesis las fotos en que te basas, con las etiquetas tal como vienen. Ejemplo: "puerta delantera izquierda (SALIDA — Esquina delantera izquierda)".
- "descripcion": qué se ve y dónde exactamente, en una o dos frases claras. Sin jerga, sin culpar a nadie, sin hablar de dinero ni de cobros.
- "zonas_no_cubiertas": una frase diciendo qué partes del carro NO pudiste revisar y por qué (no aparecen en ninguna foto, están tapadas, muy oscuras, movidas). Si pudiste revisar todo el exterior visible, escribe "".
- "resumen": 1 a 3 frases en español claro que se le puedan leer al cliente: cuántas marcas se anotaron, de qué tipo en general y qué quedó sin revisar. Es una descripción del estado en que sale el carro, no una queja ni un reclamo.

Si ves un texto "[No se pudo cargar esta foto: ...]" en lugar de una imagen, esa foto no existe para ti: no opines sobre ella y menciona esa limitación en "zonas_no_cubiertas".

Responde ÚNICAMENTE con este JSON, sin markdown, sin texto antes ni después:
{
  "marcas": [
    {
      "tipo": "rayon"|"abolladura"|"hundido"|"vidrio_roto"|"espejo"|"faro"|"llanta"|"otro",
      "ubicacion": "<zona del carro (fotos en que te basas)>",
      "descripcion": "<qué se ve, en una o dos frases claras>",
      "confianza": "alta"|"media"|"baja"
    }
  ],
  "zonas_no_cubiertas": "<qué no pudiste revisar y por qué, o cadena vacía>",
  "resumen": "<1 a 3 frases para leerle al cliente>"
}

Si de verdad no ves NINGUNA marca, devuelve "marcas": [] y dilo en el resumen — pero antes vuelve a mirar: en un carro de alquiler usado eso es poco común.`;
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

/**
 * Tope de marcas que se guardan de UN análisis de entrega. El prompt pide ser
 * exhaustivo a propósito, así que una lista larga es lo esperado; esto no está para
 * recortar el trabajo bien hecho sino para acotar el tamaño de la columna y de la
 * pantalla si el modelo se va por las ramas y devuelve doscientas entradas. El recorte
 * NUNCA es silencioso: se declara en `zonas_no_cubiertas`, que es donde alguien lo va
 * a leer.
 */
const MAX_MARCAS = 40;

/**
 * Normaliza lo que devuelva el modelo a un `EstadoEntregaResultado` válido.
 *
 * Reutiliza `opcion`/`texto`/`TIPOS_HALLAZGO` igual que `normalizar` — la lista blanca
 * de `tipo` es la misma porque los íconos y los nombres que dibuja la interfaz son los
 * mismos. Lo que NO se replica acá es la corrección de coherencia de allá (bajar el
 * veredicto cuando todo es de confianza baja): acá no hay veredicto que bajar, y una
 * marca de confianza baja es exactamente lo que este análisis quiere capturar.
 */
function normalizarEntrega(bruto: Record<string, unknown>, avisos: string[]): EstadoEntregaResultado {
  const brutas = Array.isArray(bruto.marcas) ? bruto.marcas : [];
  const todas: MarcaPrevia[] = brutas
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      tipo: opcion(m.tipo, TIPOS_HALLAZGO, 'otro'),
      ubicacion: texto(m.ubicacion),
      descripcion: texto(m.descripcion),
      confianza: opcion(m.confianza, CONFIANZAS, 'baja'),
    }))
    // Una marca sin ubicación NI descripción no es información: se dibujaría como una
    // fila en blanco y contaría en el total.
    .filter(m => m.ubicacion !== '' || m.descripcion !== '');

  const marcas = todas.slice(0, MAX_MARCAS);
  if (todas.length > marcas.length) {
    avisos.push(`se guardaron las primeras ${marcas.length} de ${todas.length} marcas anotadas`);
  }

  const zonas = [texto(bruto.zonas_no_cubiertas), ...avisos].filter(Boolean).join(' · ');
  return {
    marcas,
    zonas_no_cubiertas: zonas,
    resumen: texto(bruto.resumen) || 'La IA no devolvió un resumen; revisa la lista de marcas y las fotos.',
  };
}

/**
 * Lee un inventario guardado en `operaciones.entrega_ia` (o cualquier cosa que venga de
 * la base) y lo devuelve ya normalizado, o `null` si no hay nada legible.
 *
 * Pasa por `normalizarEntrega` y no por un `JSON.parse` a pelo a propósito: lo que sale
 * de acá termina metido en el prompt de la comparación, así que se lee con la misma
 * lista blanca de `tipo` y el mismo saneado de texto con que se escribió. Nunca lanza.
 */
export function parseEstadoEntrega(raw: unknown): EstadoEntregaResultado | null {
  let valor: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { valor = JSON.parse(raw); } catch { return null; }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  return normalizarEntrega(valor as Record<string, unknown>, []);
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

// ── Lo común a las dos acciones de IA sobre fotos ───────────────────────────
// `analizarEstadoEntrega` (paso 1, al entregar) y `compararFotosVehiculo` (paso 2, al
// recibir) hacen lo MISMO con las fotos: bajarlas en lotes, anotar las que se cayeron,
// armar los bloques etiqueta+imagen y llamar a Claude con su reintento dentro del
// presupuesto. Lo único que cambia entre las dos es el prompt y cómo se lee la
// respuesta. Está acá una sola vez para que el timeout, el presupuesto, el tope de
// lotes y el criterio de reintento no puedan divergir entre las dos.

/** Baja las fotos (en lotes) y deja anotadas en `avisos` las que no se pudieron traer. */
async function bajarFotos(items: ItemFoto[], avisos: string[]): Promise<FotoLista[]> {
  const preparadas = await prepararFotos(items.map(it => ({ url: it.url, etiqueta: it.etiqueta })));
  const fallidas = preparadas.filter(f => !f.ok);
  if (fallidas.length) {
    avisos.push(`${fallidas.length} foto(s) no se pudieron cargar (${fallidas.map(f => f.etiqueta).join(', ')})`);
  }
  return preparadas;
}

/** Los bloques de contenido: cada foto precedida de su etiqueta; las caídas, anotadas. */
function bloquesDeFotos(preparadas: FotoLista[]): ContentBlock[] {
  const content: ContentBlock[] = [];
  for (const f of preparadas) {
    content.push({ type: 'text', text: `\n--- ${f.etiqueta} ---` });
    if (f.ok) content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
    else content.push({ type: 'text', text: `[No se pudo cargar esta foto: ${f.error}]` });
  }
  return content;
}

/**
 * La llamada con su reintento. La primera nunca baja de MIN_PARA_LLAMAR_MS (si las
 * descargas se comieron el presupuesto igual hay que intentarlo una vez) ni pasa de
 * TIMEOUT_LLAMADA_MS; la segunda solo ocurre si de verdad cabe y si el fallo era
 * reintentable (ver `llamarClaude`). Lanza con un mensaje listo para el usuario.
 */
async function pedirJson(content: ContentBlock[], restanteMs: () => number, queEs: string): Promise<Record<string, unknown>> {
  let intento = await llamarClaude(content, Math.max(MIN_PARA_LLAMAR_MS, Math.min(TIMEOUT_LLAMADA_MS, restanteMs())));
  if (!intento.ok && intento.reintentable) {
    const queda = restanteMs();
    if (queda >= MIN_PARA_LLAMAR_MS) {
      intento = await llamarClaude(content, Math.min(TIMEOUT_LLAMADA_MS, queda));
    }
  }
  if (!intento.ok) throw new Error(`No se pudo completar ${queEs} con IA: ${intento.error}. Intenta de nuevo en un momento.`);
  return intento.bruto;
}

/**
 * PASO 1 — al ENTREGAR el carro. Levanta el inventario del estado en que SALE el
 * vehículo mirando únicamente las fotos de SALIDA. No compara con nada (no hay contra
 * qué: el carro apenas se está entregando) y no emite ningún veredicto.
 *
 * Su resultado se guarda y después se le entrega masticado al paso 2
 * (`compararFotosVehiculo`), que así no tiene que deducir de las fotos qué marcas ya
 * traía el carro. Ver el comentario de `construirPromptEntrega` para lo importante:
 * acá el sesgo es EXHAUSTIVO, al revés que en la comparación.
 */
export async function analizarEstadoEntrega(ctx: { vehiculo?: string; placa?: string }, fotosSalida: FotoServicio[]): Promise<EstadoEntregaResultado> {
  const inicio = Date.now();
  const restanteMs = () => PRESUPUESTO_TOTAL_MS - (Date.now() - inicio);

  const avisos: string[] = [];
  const usadas = fotosSalida.slice(0, MAX_FOTOS_POR_JUEGO);
  if (fotosSalida.length > usadas.length) {
    avisos.push(`solo se revisaron las primeras ${usadas.length} de ${fotosSalida.length} fotos de salida`);
  }

  // Mismo etiquetado por zona que la comparación (`ordenarPorCasilla`): con el juego de
  // entrada vacío devuelve solo las de SALIDA, cada una con el nombre de su zona
  // ("SALIDA — Tablero encendido") y las sueltas numeradas al final, igual que siempre.
  const { items } = ordenarPorCasilla(usadas, []);
  const preparadas = await bajarFotos(items, avisos);
  if (!preparadas.some(f => f.ok)) {
    throw new Error('No se pudo cargar ninguna de las fotos de salida; revisa que las imágenes sigan disponibles.');
  }

  const content = bloquesDeFotos(preparadas);
  content.push({
    type: 'text',
    text: construirPromptEntrega({
      vehiculo: ctx.vehiculo?.trim() || '',
      placa: ctx.placa?.trim() || '',
      nSalida: usadas.length,
      zonas: CASILLAS.filter(c => usadas.some(f => f.casilla === c.id)).map(c => c.nombre),
      sinCasilla: usadas.filter(f => !f.casilla).length,
    }),
  });

  return normalizarEntrega(await pedirJson(content, restanteMs, 'el análisis de entrega'), avisos);
}

/**
 * PASO 2 — al RECIBIR el carro.
 *
 * `fotosSalida` / `fotosEntrada` llegan YA parseadas con `parseFotosServicio`
 * (lib/operaciones.ts), o sea con su casilla cuando la tienen. Una foto de una
 * operación vieja llega con `casilla: null` y se trata exactamente como antes.
 *
 * `inventario` es el resultado del paso 1 (`analizarEstadoEntrega`) cuando ese servicio
 * lo tiene: entra al prompt como "esto es lo que el carro ya tenía cuando salió" (ver el
 * punto 10 del comentario del prompt). Es OPCIONAL y el camino sin él no cambia en NADA
 * — la mayoría de las operaciones no lo van a tener, y para esas el comportamiento tiene
 * que seguir siendo exactamente el de siempre.
 */
export async function compararFotosVehiculo(
  ctx: { vehiculo?: string; placa?: string },
  fotosSalida: FotoServicio[],
  fotosEntrada: FotoServicio[],
  inventario?: EstadoEntregaResultado | null,
): Promise<InspeccionResultado> {
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

  // Las fotos se ordenan EN PARES por zona antes de descargarse (ver
  // `ordenarPorCasilla`): así la de SALIDA de una zona y la de ENTRADA de esa
  // misma zona llegan juntas al modelo. `items` conserva ese orden de punta a
  // punta — es el mismo que ven el prompt y el bloque de imágenes.
  const { items, pares, soloUnLado } = ordenarPorCasilla(salidaUsadas, entradaUsadas);
  if (soloUnLado.length) {
    avisos.push(`sin pareja para comparar: ${soloUnLado.join('; ')}`);
  }

  // Un solo recorrido en lotes para los dos juegos: si se lanzaran los dos
  // "en lotes" pero en paralelo, el paralelismo real sería el doble.
  const preparadas = await bajarFotos(items, avisos);

  // Una foto rota no debe tumbar la inspección (se anota y se sigue), pero
  // quedarse sin NINGUNA foto utilizable de un lado sí: sin material de un
  // juego no hay comparación posible, y pedirle un veredicto a la IA en esas
  // condiciones es exactamente cómo se fabrica una acusación falsa.
  // `items[i]` es la foto i-ésima: `prepararFotos` conserva el orden de entrada.
  const hayOk = (fase: 'SALIDA' | 'ENTRADA') => preparadas.some((f, i) => f.ok && items[i].fase === fase);
  if (!hayOk('SALIDA')) throw new Error('No se pudo cargar ninguna de las fotos de salida; revisa que las imágenes sigan disponibles.');
  if (!hayOk('ENTRADA')) throw new Error('No se pudo cargar ninguna de las fotos de entrada; revisa que las imágenes sigan disponibles.');

  const content = bloquesDeFotos(preparadas);
  content.push({
    type: 'text',
    text: construirPrompt({
      vehiculo: ctx.vehiculo?.trim() || '',
      placa: ctx.placa?.trim() || '',
      nSalida: salidaUsadas.length,
      nEntrada: entradaUsadas.length,
      pares,
      soloUnLado,
      sinCasilla: [...salidaUsadas, ...entradaUsadas].filter(f => !f.casilla).length,
      inventario,
    }),
  });

  return normalizar(await pedirJson(content, restanteMs, 'la inspección'), avisos);
}
