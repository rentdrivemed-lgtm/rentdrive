// Lectura asistida del documento en el REGISTRO.
//
// ⚠️ IMPORTANTE — EXTRAER NO ES VERIFICAR.
// Este módulo solo TRANSCRIBE lo que se ve en una foto para pre-llenar el
// formulario de registro y ahorrarle tipeo a la persona. NO prueba que el
// documento sea auténtico, ni que le pertenezca a quien lo sube, ni habilita
// ningún permiso. El flujo de verificación de identidad sigue siendo
// `lib/verificacion-docs.ts` (documentos de la reserva + revisión del equipo):
// esa es la única autoridad. Nadie debe marcar un usuario como verificado,
// aprobado o "identidad confirmada" a partir de lo que devuelve este archivo.
//
// Los datos que salen de aquí SIEMPRE se le muestran a la persona para que los
// confirme o corrija antes de enviarlos: la IA se equivoca con fotos borrosas,
// reflejos o documentos desgastados.

import { getAnthropic } from './anthropic';
import { validarDocumentoIdentidad } from './validacion';

export type TipoDocumentoRegistro = 'cedula' | 'licencia';
export type ConfianzaOcr = 'alta' | 'media' | 'baja';
export type MediaTypeImagen = 'image/jpeg' | 'image/png' | 'image/webp';

export type TipoDocId = 'cedula' | 'cedula_ext' | 'pasaporte';

export type DatosRegistro = {
  nombre: string | null;
  tipo_documento: TipoDocId | null;
  documento_identidad: string | null;
  fecha_nacimiento: string | null;      // YYYY-MM-DD
  numero_licencia: string | null;
  categoria_licencia: string | null;
};

export type LecturaDocumento = {
  es_legible: boolean;
  coincide_tipo: boolean;               // ¿la foto es del tipo de documento que se pidió?
  tipo_detectado: string;
  datos: DatosRegistro;
  campos_no_leidos: string[];           // etiquetas legibles de lo que NO se pudo leer
  confianza: ConfianzaOcr;
  nota: string | null;
};

const DATOS_VACIOS: DatosRegistro = {
  nombre: null,
  tipo_documento: null,
  documento_identidad: null,
  fecha_nacimiento: null,
  numero_licencia: null,
  categoria_licencia: null,
};

const TIPOS_DOC_ID: TipoDocId[] = ['cedula', 'cedula_ext', 'pasaporte'];

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // La IA a veces devuelve marcadores en vez de null cuando no lee algo.
  if (/^(null|n\/a|na|no legible|ilegible|desconocido|-{1,})$/i.test(s)) return null;
  return s;
}

/** Solo acepta fechas YYYY-MM-DD reales y con una edad humanamente posible. */
function fechaNacimientoValida(v: unknown): string | null {
  const s = texto(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== s) return null; // descarta 2000-02-31 y similares
  const anios = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  // Nota: NO se filtra por mayoría de edad aquí a propósito. Si la persona es
  // menor, el dato se muestra tal cual y la validación de registro la rechaza.
  if (anios < 10 || anios > 110) return null;
  return s;
}

/**
 * Convierte la respuesta cruda de la IA en datos utilizables, descartando lo que
 * no pase las mismas validaciones que exige el registro. Preferimos dejar un
 * campo vacío (que la persona escriba) antes que autocompletar con basura.
 */
function normalizar(raw: Record<string, unknown>, tipoPedido: TipoDocumentoRegistro): LecturaDocumento {
  const noLeidos = new Set<string>(
    Array.isArray(raw.campos_no_leidos)
      ? raw.campos_no_leidos.filter((c): c is string => typeof c === 'string')
      : []
  );

  let tipoDocumento: TipoDocId | null = null;
  const tipoRaw = texto(raw.tipo_documento)?.toLowerCase();
  if (tipoRaw && TIPOS_DOC_ID.includes(tipoRaw as TipoDocId)) tipoDocumento = tipoRaw as TipoDocId;

  let documento = texto(raw.documento_identidad);
  if (documento) {
    // La cédula colombiana es solo dígitos; pasaporte/extranjería admiten letras.
    documento = tipoDocumento === 'pasaporte'
      ? documento.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      : documento.replace(/\D/g, '');
    if (validarDocumentoIdentidad(tipoDocumento || 'cedula', documento)) {
      documento = null;
      noLeidos.add('número de documento');
    }
  }

  let licencia = texto(raw.numero_licencia);
  if (licencia) {
    licencia = licencia.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (licencia.length < 4 || licencia.length > 20) {
      licencia = null;
      noLeidos.add('número de licencia');
    }
  }

  // Igual que en app/api/admin/usuarios/route.ts: tope defensivo de longitud,
  // la IA no debería devolver algo tan largo pero no cuesta nada acotarlo.
  const nombre = texto(raw.nombre)?.slice(0, 120) || null;
  const nacimiento = fechaNacimientoValida(raw.fecha_nacimiento);
  if (!nombre) noLeidos.add('nombre');
  if (!nacimiento && raw.fecha_nacimiento) noLeidos.add('fecha de nacimiento');

  const confianzaRaw = texto(raw.confianza)?.toLowerCase();
  const confianza: ConfianzaOcr =
    confianzaRaw === 'alta' || confianzaRaw === 'baja' ? confianzaRaw : 'media';

  const tipoDetectado = texto(raw.tipo_detectado) || 'desconocido';
  const coincideTipo = raw.coincide_tipo === true;

  return {
    es_legible: raw.es_legible !== false,
    coincide_tipo: coincideTipo,
    tipo_detectado: tipoDetectado,
    datos: {
      ...DATOS_VACIOS,
      nombre,
      tipo_documento: tipoPedido === 'cedula' ? tipoDocumento : null,
      documento_identidad: tipoPedido === 'cedula' ? documento : null,
      fecha_nacimiento: nacimiento,
      numero_licencia: tipoPedido === 'licencia' ? licencia : null,
      categoria_licencia: tipoPedido === 'licencia' ? texto(raw.categoria_licencia) : null,
    },
    campos_no_leidos: [...noLeidos],
    confianza,
    nota: texto(raw.nota),
  };
}

function instrucciones(tipo: TipoDocumentoRegistro): string {
  const esperado = tipo === 'cedula'
    ? 'un documento de identidad (cédula de ciudadanía colombiana, cédula de extranjería o pasaporte)'
    : 'una licencia de conducción colombiana (pase)';

  return `
Eres un asistente que TRANSCRIBE datos de documentos para agilizar el registro en DrivePass,
una plataforma colombiana de alquiler de vehículos (Medellín). Tu única tarea es leer lo que
está impreso en la imagen. NO verificas autenticidad ni identidad.

La persona dice que la imagen de arriba es ${esperado}.

Devuelve un JSON con EXACTAMENTE esta estructura (sin markdown, sin texto adicional):

{
  "es_legible": <true si alcanzas a leer datos del documento, false si está muy borrosa, oscura, cortada o no se ve nada>,
  "coincide_tipo": <true si la imagen realmente es ${esperado}, false si es otra cosa>,
  "tipo_detectado": "<Cédula de ciudadanía|Cédula de extranjería|Pasaporte|Licencia de conducción|Otro documento|No es un documento>",
  "nombre": "<nombre completo del titular en orden natural 'Nombres Apellidos' (NO 'Apellidos Nombres'), con mayúscula inicial en cada palabra (ej. 'María Fernanda Gómez Restrepo'), o null>",
  "tipo_documento": "<cedula|cedula_ext|pasaporte>, o null si la imagen no es un documento de identidad",
  "documento_identidad": "<número del documento SIN puntos ni espacios, o null>",
  "fecha_nacimiento": "<fecha de nacimiento en formato YYYY-MM-DD, o null>",
  "numero_licencia": "<número de la licencia de conducción, o null si la imagen no es una licencia>",
  "categoria_licencia": "<categoría de la licencia: B1, B2, C1, A2, etc., o null>",
  "campos_no_leidos": ["<etiqueta en español de cada dato que NO pudiste leer con seguridad, ej. 'fecha de nacimiento'>"],
  "confianza": "<alta|media|baja>",
  "nota": "<una frase en español explicando qué dificultó la lectura, o null si todo se leyó bien>"
}

REGLAS INNEGOCIABLES:
- NUNCA inventes, adivines ni completes un dato "plausible". Si no lo lees con seguridad, ponlo en null y agrégalo a "campos_no_leidos".
- Si dudas entre dos dígitos o dos letras, el campo va en null. Es preferible que la persona lo escriba a que quede un dato errado.
- "confianza": "alta" solo si leíste con nitidez; "baja" si la foto está borrosa, con reflejos, cortada o el documento está desgastado.
- La cédula colombiana suele imprimir el número con puntos (ej. 1.017.234.567): devuélvelo sin puntos.
- En la cédula, los apellidos aparecen ARRIBA y los nombres ABAJO. En "nombre" devuélvelos en orden natural: primero nombres, después apellidos.
- Si la imagen no es el documento esperado, pon "coincide_tipo": false y deja los datos en null.
- No incluyas ningún comentario fuera del JSON.`;
}

/**
 * Lee una foto de documento y devuelve los datos transcritos para pre-llenar el
 * formulario de registro. Recibe los bytes directamente: la imagen NO se guarda
 * en disco ni en Cloudinary — se manda a la IA y se descarta (la persona todavía
 * no tiene cuenta, así que almacenarla sería recolectar datos sensibles de
 * alguien que quizá nunca se registre).
 */
export async function leerDocumentoRegistro(
  imagen: Buffer,
  mediaType: MediaTypeImagen,
  tipo: TipoDocumentoRegistro,
): Promise<LecturaDocumento> {
  const anthropic = getAnthropic();

  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: MediaTypeImagen; data: string } };

  const content: ContentBlock[] = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imagen.toString('base64') } },
    { type: 'text', text: instrucciones(tipo) },
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

  return normalizar(raw, tipo);
}
