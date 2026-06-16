import { promises as fs } from 'fs';
import path from 'path';
import { getAnthropic } from './anthropic';

// ── Tipos del veredicto ──────────────────────────────────────────────
export type ResultadoRegla = 'pasa' | 'falla' | 'no_aplica';
export type Veredicto = 'aprobado' | 'rechazado' | 'revision';
export type Confianza = 'alta' | 'media' | 'baja';

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
  clave: string;            // soat | tecnomecanica | tarjeta_propiedad | cedula | licencia
  etiqueta: string;
  es_legible: boolean;
  tipo_detectado: string;   // qué documento parece ser realmente
  datos_extraidos: DatosExtraidos;
  verificaciones: Chequeo[];
  veredicto: Veredicto;
  confianza: Confianza;
  motivo: string;
};

export type VerificacionResultado = {
  documentos: DocResultado[];
  cruces: Chequeo[];        // chequeos entre documentos (placa consistente, nombres que coinciden)
  resumen: string;
  veredicto_global: Veredicto;
};

export type DocEntrada = { clave: string; etiqueta: string; url: string };

// ── Lectura de archivos (imagen o PDF) desde public/uploads ──────────
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

async function leerArchivo(url: string): Promise<ContentBlock | null> {
  if (!url) return null;
  const rel = url.replace(/^\/+/, '');                 // "uploads/doc-xxx.png"
  const abs = path.join(process.cwd(), 'public', rel);
  let buf: Buffer;
  try { buf = await fs.readFile(abs); } catch { return null; }
  const ext = path.extname(abs).toLowerCase();
  const data = buf.toString('base64');
  if (ext === '.pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  const media = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: media, data } };
}

// ── Esquema de salida estructurada (JSON Schema, modo estricto) ──────
const SUBESQUEMA_DATOS = {
  type: 'object',
  additionalProperties: false,
  required: ['placa', 'numero_documento', 'nombre_titular', 'fecha_expedicion', 'fecha_vencimiento', 'vigente', 'entidad_emisora', 'categoria_licencia', 'otros'],
  properties: {
    placa: { type: ['string', 'null'] },
    numero_documento: { type: ['string', 'null'] },
    nombre_titular: { type: ['string', 'null'] },
    fecha_expedicion: { type: ['string', 'null'] },
    fecha_vencimiento: { type: ['string', 'null'] },
    vigente: { type: ['boolean', 'null'] },
    entidad_emisora: { type: ['string', 'null'] },
    categoria_licencia: { type: ['string', 'null'] },
    otros: { type: ['string', 'null'] },
  },
} as const;

const SUBESQUEMA_CHEQUEO = {
  type: 'object',
  additionalProperties: false,
  required: ['regla', 'resultado', 'detalle'],
  properties: {
    regla: { type: 'string' },
    resultado: { type: 'string', enum: ['pasa', 'falla', 'no_aplica'] },
    detalle: { type: 'string' },
  },
} as const;

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentos', 'cruces', 'resumen', 'veredicto_global'],
  properties: {
    documentos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clave', 'etiqueta', 'es_legible', 'tipo_detectado', 'datos_extraidos', 'verificaciones', 'veredicto', 'confianza', 'motivo'],
        properties: {
          clave: { type: 'string' },
          etiqueta: { type: 'string' },
          es_legible: { type: 'boolean' },
          tipo_detectado: { type: 'string' },
          datos_extraidos: SUBESQUEMA_DATOS,
          verificaciones: { type: 'array', items: SUBESQUEMA_CHEQUEO },
          veredicto: { type: 'string', enum: ['aprobado', 'rechazado', 'revision'] },
          confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
          motivo: { type: 'string' },
        },
      },
    },
    cruces: { type: 'array', items: SUBESQUEMA_CHEQUEO },
    resumen: { type: 'string' },
    veredicto_global: { type: 'string', enum: ['aprobado', 'rechazado', 'revision'] },
  },
} as const;

// ── Contexto para construir el prompt ────────────────────────────────
export type ContextoVerificacion = {
  placa?: string;
  propietario?: { nombre?: string; documento?: string };
  arrendatario?: { nombre?: string; documento?: string; licencia?: string };
};

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function construirInstrucciones(ctx: ContextoVerificacion): string {
  const lineas: string[] = [];
  lineas.push('Eres un verificador experto de documentos de alquiler de vehículos en Colombia para DrivePass.');
  lineas.push(`La fecha de hoy es ${hoyISO()} (úsala para evaluar vigencias).`);
  lineas.push('Vas a revisar las imágenes de documentos adjuntas. Para CADA documento adjunto extrae sus datos y valida las reglas. Sé estricto pero justo. Si una imagen está borrosa, recortada o no corresponde al documento esperado, márcala como no legible y veredicto "revision".');
  lineas.push('');
  lineas.push('DATOS DE REFERENCIA contra los que debes contrastar:');
  if (ctx.placa) lineas.push(`- Placa del vehículo registrado: ${ctx.placa}`);
  if (ctx.propietario?.nombre) lineas.push(`- Nombre del propietario (arrendador) registrado: ${ctx.propietario.nombre}`);
  if (ctx.propietario?.documento) lineas.push(`- Documento del propietario registrado: ${ctx.propietario.documento}`);
  if (ctx.arrendatario?.nombre) lineas.push(`- Nombre del arrendatario registrado: ${ctx.arrendatario.nombre}`);
  if (ctx.arrendatario?.documento) lineas.push(`- Documento del arrendatario registrado: ${ctx.arrendatario.documento}`);
  if (ctx.arrendatario?.licencia) lineas.push(`- N.º de licencia del arrendatario registrado: ${ctx.arrendatario.licencia}`);
  lineas.push('');
  lineas.push('REGLAS POR DOCUMENTO:');
  lineas.push('- SOAT: debe estar VIGENTE (fecha de vencimiento posterior a hoy) y la placa debe coincidir con la registrada.');
  lineas.push('- Tecnomecánica (revisión técnico-mecánica): vigente y placa que coincide.');
  lineas.push('- Tarjeta de propiedad: la placa debe coincidir y el propietario que figura debe coincidir con el nombre/documento del arrendador registrado.');
  lineas.push('- Seguro todo riesgo: vigente y placa que coincide (es opcional).');
  lineas.push('- Cédula de ciudadanía: el número y el nombre deben coincidir con la persona registrada (arrendatario o arrendador según corresponda).');
  lineas.push('- Licencia de conducción: vigente, el nombre debe coincidir con la cédula, y la categoría debe permitir conducir automóvil.');
  lineas.push('');
  lineas.push('CRUCES entre documentos (repórtalos en "cruces"): la placa debe ser la misma en SOAT, tecnomecánica y tarjeta; el nombre de la tarjeta de propiedad debe coincidir con el del arrendador; el nombre de la licencia debe coincidir con el de la cédula del arrendatario.');
  lineas.push('Si se adjunta la "Cédula del propietario (arrendador)", contrasta la tarjeta de propiedad CONTRA esa cédula (foto contra foto): el nombre y el número de documento del propietario en la tarjeta deben coincidir con los de la cédula adjunta, no solo con los datos de texto registrados. Si no coinciden, repórtalo como falla en "cruces".');
  lineas.push('');
  lineas.push('Para cada documento: "veredicto" = "aprobado" solo si TODAS sus reglas pasan; "rechazado" si una regla clave falla (vencido, placa o nombre que NO coincide); "revision" si hay dudas, baja calidad o datos no legibles. "confianza" = "alta" solo si la imagen es clara y los datos son inequívocos. No inventes datos: si no puedes leer un campo, ponlo en null y baja la confianza.');
  return lineas.join('\n');
}

// ── Llamada principal a Claude ───────────────────────────────────────
export async function verificarDocumentos(
  ctx: ContextoVerificacion,
  docs: DocEntrada[],
): Promise<VerificacionResultado> {
  const content: ContentBlock[] = [{ type: 'text', text: construirInstrucciones(ctx) }];

  for (const d of docs) {
    const archivo = await leerArchivo(d.url);
    content.push({ type: 'text', text: `\n=== Documento a revisar — clave="${d.clave}", etiqueta="${d.etiqueta}" ===` });
    if (archivo) content.push(archivo);
    else content.push({ type: 'text', text: '(no se pudo cargar la imagen de este documento)' });
  }
  content.push({ type: 'text', text: '\nDevuelve el resultado en el formato estructurado solicitado. Incluye un objeto en "documentos" por cada documento adjunto, usando su misma "clave" y "etiqueta".' });

  const anthropic = getAnthropic();
  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: ESQUEMA },
    },
    messages: [{ role: 'user', content }],
  } as Parameters<typeof anthropic.messages.create>[0]);

  const message = resp as unknown as { content: { type: string; text?: string }[] };
  const bloque = message.content.find(b => b.type === 'text');
  if (!bloque?.text) throw new Error('La verificación no devolvió contenido.');
  return JSON.parse(bloque.text) as VerificacionResultado;
}

// ── Lógica HÍBRIDA: decide qué auto-aprobar y qué mandar a revisión ──
// Auto-aprueba solo documentos con veredicto "aprobado", confianza "alta" y
// sin ninguna verificación en "falla". Todo lo demás queda para revisión humana.
export function decisionHibrida(doc: DocResultado): 'auto_aprobado' | 'revision_humana' {
  const sinFallas = doc.verificaciones.every(v => v.resultado !== 'falla');
  if (doc.veredicto === 'aprobado' && doc.confianza === 'alta' && doc.es_legible && sinFallas) {
    return 'auto_aprobado';
  }
  return 'revision_humana';
}
