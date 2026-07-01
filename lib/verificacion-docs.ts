import { getAnthropic } from './anthropic';

export type ResultadoRegla = 'pasa' | 'falla' | 'no_aplica';
export type Veredicto    = 'aprobado' | 'rechazado' | 'revision';
export type Confianza    = 'alta' | 'media' | 'baja';

export type DatosExtraidos = {
  placa: string | null;
  numero_documento: string | null;
  nombre_titular: string | null;
  fecha_expedicion: string | null;
  fecha_vencimiento: string | null;
  vigente: boolean | null;
  entidad_emisora: string | null;
  categoria_licencia: string | null;
  otros: string | null;
};
export type Chequeo = { regla: string; resultado: ResultadoRegla; detalle: string };
export type DocResultado = {
  clave: string; etiqueta: string;
  es_legible: boolean; tipo_detectado: string;
  datos_extraidos: DatosExtraidos;
  verificaciones: Chequeo[];
  veredicto: Veredicto; confianza: Confianza; motivo: string;
};
export type VerificacionResultado = {
  documentos: DocResultado[];
  cruces: Chequeo[];
  resumen: string;
  veredicto_global: Veredicto;
};
export type DocEntrada = { clave: string; etiqueta: string; url: string };
export type ContextoVerificacion = {
  placa?: string;
  propietario?: { nombre?: string; documento?: string };
  arrendatario?: { nombre?: string; documento?: string; licencia?: string };
};

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf';

async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: MediaType }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`No se pudo descargar ${url}: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ct = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const allowed: MediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  const mediaType: MediaType = allowed.includes(ct as MediaType) ? (ct as MediaType) : 'image/jpeg';
  return { data: buf.toString('base64'), mediaType };
}

const DATOS_VACIOS: DatosExtraidos = {
  placa: null, numero_documento: null, nombre_titular: null,
  fecha_expedicion: null, fecha_vencimiento: null, vigente: null,
  entidad_emisora: null, categoria_licencia: null, otros: null,
};

export async function verificarDocumentos(
  ctx: ContextoVerificacion,
  docs: DocEntrada[],
): Promise<VerificacionResultado> {
  const anthropic = getAnthropic();

  // Descargar todas las imágenes en paralelo
  const archivos = await Promise.all(
    docs.map(async doc => {
      try {
        const { data, mediaType } = await fetchAsBase64(doc.url);
        return { doc, data, mediaType, ok: true };
      } catch (e) {
        return { doc, data: '', mediaType: 'image/jpeg' as MediaType, ok: false, error: String(e) };
      }
    })
  );

  // Contexto textual
  const ctxLines: string[] = ['Contexto del propietario/vehículo:'];
  if (ctx.placa)                    ctxLines.push(`- Placa registrada: ${ctx.placa}`);
  if (ctx.propietario?.nombre)      ctxLines.push(`- Nombre propietario: ${ctx.propietario.nombre}`);
  if (ctx.propietario?.documento)   ctxLines.push(`- Documento propietario: ${ctx.propietario.documento}`);
  if (ctx.arrendatario?.nombre)     ctxLines.push(`- Nombre arrendatario: ${ctx.arrendatario.nombre}`);
  if (ctx.arrendatario?.documento)  ctxLines.push(`- Documento arrendatario: ${ctx.arrendatario.documento}`);
  if (ctx.arrendatario?.licencia)   ctxLines.push(`- Licencia registrada: ${ctx.arrendatario.licencia}`);

  // Construir contenido del mensaje
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: MediaType; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

  const content: ContentBlock[] = [];

  content.push({ type: 'text', text: ctxLines.join('\n') });

  for (const a of archivos) {
    content.push({ type: 'text', text: `\n--- ${a.doc.etiqueta} (clave: ${a.doc.clave}) ---` });
    if (!a.ok) {
      content.push({ type: 'text', text: `[Error al cargar: ${a.error}]` });
      continue;
    }
    if (a.mediaType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
    }
  }

  content.push({
    type: 'text',
    text: `
Eres un experto verificador de documentos para una plataforma colombiana de alquiler de vehículos (DrivePass, Medellín).

Analiza cada documento presentado arriba y devuelve un JSON con EXACTAMENTE esta estructura (sin markdown, sin texto adicional):

{
  "documentos": [
    {
      "clave": "<igual a la clave indicada>",
      "etiqueta": "<nombre del documento>",
      "es_legible": <true|false>,
      "tipo_detectado": "<SOAT|Tecno-mecánica|Tarjeta de propiedad|Seguro todo riesgo|Cédula|Licencia de conducción|Desconocido>",
      "datos_extraidos": {
        "placa": "<placa o null>",
        "numero_documento": "<número o null>",
        "nombre_titular": "<nombre o null>",
        "fecha_expedicion": "<YYYY-MM-DD o null>",
        "fecha_vencimiento": "<YYYY-MM-DD o null>",
        "vigente": <true si no ha vencido al ${new Date().toISOString().split('T')[0]}, false si venció, null si no aplica>,
        "entidad_emisora": "<aseguradora/entidad o null>",
        "categoria_licencia": "<B1, B2, C1, etc. o null>",
        "otros": "<nota adicional relevante o null>"
      },
      "verificaciones": [
        { "regla": "<nombre de la regla>", "resultado": "<pasa|falla|no_aplica>", "detalle": "<explicación>" }
      ],
      "veredicto": "<aprobado|rechazado|revision>",
      "confianza": "<alta|media|baja>",
      "motivo": "<resumen breve del veredicto>"
    }
  ],
  "cruces": [
    { "regla": "<nombre del cruce>", "resultado": "<pasa|falla|no_aplica>", "detalle": "<explicación>" }
  ],
  "resumen": "<resumen global de 1-2 oraciones>",
  "veredicto_global": "<aprobado|rechazado|revision>"
}

Reglas de verificación por tipo de documento:
- SOAT: vigente, placa coincide con el contexto, nombre del propietario o aseguradora visible
- Tecno-mecánica: vigente, placa coincide, emitida por el RUNT o CDA autorizado
- Tarjeta de propiedad: placa coincide, nombre del titular coincide con el propietario del contexto
- Seguro todo riesgo: vigente, placa o nombre del titular visible
- Cédula: número coincide con el documento del contexto, legible, no manipulada
- Licencia de conducción: número coincide con el contexto, vigente, categoría visible

Cruces entre documentos (si hay más de uno):
- La placa en SOAT debe coincidir con la placa en la tarjeta de propiedad
- El nombre del titular en la tarjeta de propiedad debe coincidir con la cédula del propietario
- La fecha de vigencia del SOAT debe cubrir el período actual

Usa "revision" cuando algo es legible pero no puedes confirmar con certeza.
Usa "rechazado" solo cuando hay un problema claro (vencido, datos no coinciden, documento falso/manipulado).
Usa confianza "alta" solo cuando puedes leer claramente los datos y todo cuadra.`,
  });

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    messages: [{ role: 'user', content: content as Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'] }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';

  // Extraer JSON de la respuesta
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('La IA no devolvió JSON válido');

  let resultado: VerificacionResultado;
  try {
    resultado = JSON.parse(match[0]) as VerificacionResultado;
  } catch {
    throw new Error('No se pudo parsear la respuesta de la IA');
  }

  // Rellenar campos faltantes defensivamente
  for (const d of resultado.documentos) {
    d.datos_extraidos = { ...DATOS_VACIOS, ...d.datos_extraidos };
    d.verificaciones  = d.verificaciones ?? [];
  }
  resultado.cruces          = resultado.cruces ?? [];
  resultado.resumen         = resultado.resumen ?? '';
  resultado.veredicto_global = resultado.veredicto_global ?? 'revision';

  return resultado;
}

export function decisionHibrida(doc: DocResultado): 'auto_aprobado' | 'revision_humana' {
  const sinFallas = doc.verificaciones.every(v => v.resultado !== 'falla');
  if (doc.veredicto === 'aprobado' && doc.confianza === 'alta' && doc.es_legible && sinFallas) {
    return 'auto_aprobado';
  }
  return 'revision_humana';
}
