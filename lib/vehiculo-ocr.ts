// Lectura asistida de la tarjeta de propiedad al PUBLICAR un vehículo.
//
// ⚠️ IMPORTANTE — EXTRAER NO ES VERIFICAR (mismo principio que lib/registro-ocr.ts).
// Este módulo solo TRANSCRIBE lo que se ve en las fotos del frente y el reverso de
// la tarjeta de propiedad para pre-llenar el formulario de publicación y ahorrarle
// tipeo al propietario. NO prueba que el documento sea auténtico, ni que el
// vehículo le pertenezca a quien lo publica, ni marca nada como verificado. El
// flujo real de verificación de documentos sigue siendo `lib/verificacion-docs.ts`
// (documentos ya subidos al vehículo + cruce con la cédula del propietario +
// revisión del equipo): esa es la única autoridad.
//
// Los datos que salen de aquí SIEMPRE se le muestran al propietario para que los
// confirme o corrija antes de publicar: la IA se equivoca con fotos borrosas,
// reflejos o tarjetas desgastadas.

import { getAnthropic } from './anthropic';
import type { TipoVehiculo } from './rentabilidad';
import type { MediaTypeImagen } from './subida-imagen';

export type DatosVehiculoTarjeta = {
  placa: string | null;
  marca: string | null;
  modelo: string | null;   // línea / referencia
  anio: number | null;     // año modelo
  tipo: TipoVehiculo | null;
};

export type ConfianzaOcrVehiculo = 'alta' | 'media' | 'baja';

export type LecturaTarjetaPropiedad = {
  es_legible: boolean;
  coincide_tipo: boolean;  // ¿las fotos realmente son de una tarjeta de propiedad?
  tipo_detectado: string;
  datos: DatosVehiculoTarjeta;
  campos_no_leidos: string[];
  confianza: ConfianzaOcrVehiculo;
  nota: string | null;
};

const DATOS_VACIOS: DatosVehiculoTarjeta = {
  placa: null,
  marca: null,
  modelo: null,
  anio: null,
  tipo: null,
};

const TIPOS_VALIDOS: TipoVehiculo[] = ['sedan', 'coupe', 'suv', 'camioneta7', 'lujo_auto', 'lujo_camioneta'];

// Mapa MUY conservador de "clase de vehículo" (tal como la imprime el RUNT en la
// tarjeta de propiedad) a nuestros 6 segmentos de alquiler. A propósito NO
// mapeamos "camioneta" (en Colombia puede ser pickup, SUV grande o station wagon
// según la tarjeta) ni distinguimos lujo/coupé (eso depende de la marca/modelo,
// no de la clase RUNT): mejor dejar el campo en null y que el propietario elija,
// que adivinar y publicar con la categoría equivocada (afecta el precio sugerido).
const CLASE_A_TIPO: Record<string, TipoVehiculo> = {
  automovil: 'sedan',
  campero: 'suv',
};

function quitarAcentos(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^(null|n\/a|na|no legible|ilegible|desconocido|-{1,})$/i.test(s)) return null;
  return s;
}

/** Placa colombiana: 3 letras + 3 dígitos (carro) o 3 letras + 2 dígitos + 1 letra (moto). */
function placaValida(p: string): boolean {
  return /^[A-Z]{3}\d{2}[A-Z0-9]$/.test(p);
}

function anioValido(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(texto(v));
  if (!Number.isFinite(n)) return null;
  const anio = Math.trunc(n);
  const actual = new Date().getFullYear();
  if (anio < 1980 || anio > actual + 1) return null;
  return anio;
}

/**
 * Convierte la respuesta cruda de la IA en datos utilizables, descartando lo que
 * no pase un mínimo de cordura. Preferimos dejar un campo vacío (que el
 * propietario lo escriba) antes que autocompletar con basura.
 */
function normalizar(raw: Record<string, unknown>): LecturaTarjetaPropiedad {
  const noLeidos = new Set<string>(
    Array.isArray(raw.campos_no_leidos)
      ? raw.campos_no_leidos.filter((c): c is string => typeof c === 'string')
      : []
  );

  let placa = texto(raw.placa);
  if (placa) {
    placa = placa.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!placaValida(placa)) {
      placa = null;
      noLeidos.add('placa');
    }
  }

  const marca = texto(raw.marca)?.slice(0, 60) || null;
  const modelo = texto(raw.modelo)?.slice(0, 60) || null;
  if (!marca) noLeidos.add('marca');
  if (!modelo) noLeidos.add('línea/referencia');

  const anio = anioValido(raw.anio);
  if (!anio && raw.anio) noLeidos.add('año modelo');

  let tipo: TipoVehiculo | null = null;
  const tipoDirecto = texto(raw.tipo)?.toLowerCase();
  if (tipoDirecto && TIPOS_VALIDOS.includes(tipoDirecto as TipoVehiculo)) {
    tipo = tipoDirecto as TipoVehiculo;
  } else {
    const clase = texto(raw.clase_vehiculo);
    if (clase) {
      const clave = quitarAcentos(clase.toLowerCase()).trim();
      tipo = CLASE_A_TIPO[clave] || null;
    }
  }

  const confianzaRaw = texto(raw.confianza)?.toLowerCase();
  const confianza: ConfianzaOcrVehiculo =
    confianzaRaw === 'alta' || confianzaRaw === 'baja' ? confianzaRaw : 'media';

  const tipoDetectado = texto(raw.tipo_detectado) || 'desconocido';
  const coincideTipo = raw.coincide_tipo === true;

  return {
    es_legible: raw.es_legible !== false,
    coincide_tipo: coincideTipo,
    tipo_detectado: tipoDetectado,
    datos: { ...DATOS_VACIOS, placa, marca, modelo, anio, tipo },
    campos_no_leidos: [...noLeidos],
    confianza,
    nota: texto(raw.nota),
  };
}

const INSTRUCCIONES = `
Eres un asistente que TRANSCRIBE datos de la tarjeta de propiedad (licencia de tránsito)
de un vehículo colombiano, para agilizar la publicación de un vehículo en DrivePass, una
plataforma de alquiler de carros en Medellín. Tu única tarea es leer lo que está impreso en
las imágenes. NO verificas autenticidad ni que el vehículo le pertenezca a nadie.

Te muestro dos fotos: el FRENTE y el REVERSO de la tarjeta de propiedad del vehículo.

Devuelve un JSON con EXACTAMENTE esta estructura (sin markdown, sin texto adicional):

{
  "es_legible": <true si alcanzas a leer datos del documento en al menos una de las dos fotos, false si ambas están muy borrosas, oscuras, cortadas o no se ve nada>,
  "coincide_tipo": <true si las imágenes realmente son de una tarjeta de propiedad vehicular colombiana, false si son otra cosa>,
  "tipo_detectado": "<Tarjeta de propiedad|Licencia de tránsito|Otro documento|No es un documento>",
  "placa": "<placa del vehículo SIN espacios ni guiones, en mayúsculas (ej. 'ABC123'), o null>",
  "marca": "<marca del vehículo tal como aparece impresa (ej. 'Toyota', 'Chevrolet'), o null>",
  "modelo": "<línea o referencia del vehículo (ej. 'Corolla', 'Onix'), SIN incluir la marca, o null>",
  "anio": "<año modelo del vehículo, 4 dígitos, o null>",
  "clase_vehiculo": "<la 'clase de vehículo' EXACTAMENTE como aparece impresa en el documento (ej. 'Automóvil', 'Campero', 'Camioneta', 'Station Wagon'), o null si no se lee>",
  "campos_no_leidos": ["<etiqueta en español de cada dato que NO pudiste leer con seguridad>"],
  "confianza": "<alta|media|baja>",
  "nota": "<una frase en español explicando qué dificultó la lectura, o null si todo se leyó bien>"
}

REGLAS INNEGOCIABLES:
- NUNCA inventes, adivines ni completes un dato "plausible". Si no lo lees con seguridad, ponlo en null y agrégalo a "campos_no_leidos".
- Si dudas entre dos dígitos o dos letras, el campo va en null.
- "confianza": "alta" solo si leíste con nitidez ambas fotos; "baja" si están borrosas, con reflejos, cortadas o el documento está muy desgastado.
- "clase_vehiculo": transcribe TAL CUAL está impreso, no lo traduzcas ni lo interpretes — nosotros decidimos qué hacer con ese texto.
- Si las imágenes no son el documento esperado, pon "coincide_tipo": false y deja los datos en null.
- No incluyas ningún comentario fuera del JSON.`;

/**
 * Lee las fotos de frente y reverso de una tarjeta de propiedad y devuelve los
 * datos transcritos para pre-llenar el formulario de publicación de un vehículo.
 * Recibe los bytes directamente: las imágenes NO se guardan en disco ni en
 * Cloudinary — se mandan a la IA y se descartan.
 */
export async function leerTarjetaPropiedad(
  frente: Buffer, frenteMedia: MediaTypeImagen,
  reverso: Buffer, reversoMedia: MediaTypeImagen,
): Promise<LecturaTarjetaPropiedad> {
  const anthropic = getAnthropic();

  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: MediaTypeImagen; data: string } };

  const content: ContentBlock[] = [
    { type: 'text', text: 'Foto 1 — frente de la tarjeta de propiedad:' },
    { type: 'image', source: { type: 'base64', media_type: frenteMedia, data: frente.toString('base64') } },
    { type: 'text', text: 'Foto 2 — reverso de la tarjeta de propiedad:' },
    { type: 'image', source: { type: 'base64', media_type: reversoMedia, data: reverso.toString('base64') } },
    { type: 'text', text: INSTRUCCIONES },
  ];

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1200,
    messages: [{ role: 'user', content: content as Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'] }],
  });

  const text = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('La IA no devolvió JSON válido');

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error('No se pudo parsear la respuesta de la IA');
  }

  return normalizar(raw);
}
