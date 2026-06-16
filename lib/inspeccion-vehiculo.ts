// Inspección de daños por comparación de fotos (salida vs. entrada) con Claude vision.
// Compara el estado del vehículo cuando sale de la sede contra cuando lo devuelven
// y detecta daños NUEVOS: rayones, abolladuras, vidrios rotos, hundidos, etc.
import { promises as fs } from 'fs';
import path from 'path';
import { getAnthropic } from './anthropic';

export type HallazgoDano = {
  tipo: string;          // rayon | abolladura | vidrio_roto | hundido | llanta | faro | espejo | otro
  ubicacion: string;     // p.ej. "puerta delantera izquierda", "parachoques trasero"
  descripcion: string;
  confianza: 'alta' | 'media' | 'baja';
};

export type InspeccionResultado = {
  hay_danos_nuevos: boolean;
  severidad_general: 'ninguna' | 'leve' | 'moderada' | 'grave';
  hallazgos: HallazgoDano[];
  zonas_no_comparables: string;   // áreas que no se pudieron comparar (ángulo/falta de foto)
  resumen: string;
  recomendacion: string;
};

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

async function leerImagen(url: string): Promise<ContentBlock | null> {
  if (!url) return null;
  const rel = url.replace(/^\/+/, '');
  const abs = path.join(process.cwd(), 'public', rel);
  let buf: Buffer;
  try { buf = await fs.readFile(abs); } catch { return null; }
  const ext = path.extname(abs).toLowerCase();
  const media = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } };
}

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hay_danos_nuevos', 'severidad_general', 'hallazgos', 'zonas_no_comparables', 'resumen', 'recomendacion'],
  properties: {
    hay_danos_nuevos: { type: 'boolean' },
    severidad_general: { type: 'string', enum: ['ninguna', 'leve', 'moderada', 'grave'] },
    hallazgos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'ubicacion', 'descripcion', 'confianza'],
        properties: {
          tipo: { type: 'string' },
          ubicacion: { type: 'string' },
          descripcion: { type: 'string' },
          confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
        },
      },
    },
    zonas_no_comparables: { type: 'string' },
    resumen: { type: 'string' },
    recomendacion: { type: 'string' },
  },
} as const;

export type ContextoInspeccion = { vehiculo?: string; placa?: string };

function instrucciones(ctx: ContextoInspeccion): string {
  const l: string[] = [];
  l.push('Eres un inspector experto de daños de vehículos para DrivePass (alquiler de carros).');
  if (ctx.vehiculo) l.push(`Vehículo: ${ctx.vehiculo}${ctx.placa ? ` (placa ${ctx.placa})` : ''}.`);
  l.push('Recibirás dos grupos de fotos del MISMO vehículo:');
  l.push('1) Fotos de SALIDA: estado cuando el carro salió de la sede (estado de referencia).');
  l.push('2) Fotos de ENTRADA: estado cuando el cliente lo devolvió.');
  l.push('Tu tarea: comparar y detectar DAÑOS NUEVOS visibles en las fotos de ENTRADA que NO estaban en las de SALIDA: rayones, abolladuras, hundidos, vidrios/espejos rotos o estrellados, faros dañados, llantas, golpes de pintura, etc.');
  l.push('Sé riguroso pero honesto. NO inventes daños. Solo reporta lo que realmente se ve nuevo.');
  l.push('Considera que las fotos pueden tener distinto ángulo, distancia o iluminación: si una zona no es comparable (no hay foto equivalente, reflejo, suciedad o sombra que impide ver), NO la marques como daño; en su lugar descríbela en "zonas_no_comparables".');
  l.push('La suciedad, el polvo, las gotas de agua o los reflejos NO son daños.');
  l.push('Para cada hallazgo indica tipo, ubicación en el vehículo, una descripción breve y tu nivel de confianza.');
  l.push('"severidad_general": ninguna si no hay daños nuevos; leve (rayones superficiales), moderada (abolladuras/varios rayones), grave (vidrios rotos, choques, hundidos importantes).');
  l.push('"recomendacion": qué debería hacer el operador (p. ej. cobrar al cliente, documentar, sin novedad).');
  return l.join('\n');
}

export async function compararFotosVehiculo(
  ctx: ContextoInspeccion,
  fotosSalida: string[],
  fotosEntrada: string[],
): Promise<InspeccionResultado> {
  const content: ContentBlock[] = [{ type: 'text', text: instrucciones(ctx) }];

  content.push({ type: 'text', text: `\n=== FOTOS DE SALIDA (referencia, ${fotosSalida.length}) ===` });
  for (const url of fotosSalida) {
    const img = await leerImagen(url);
    if (img) content.push(img);
  }
  content.push({ type: 'text', text: `\n=== FOTOS DE ENTRADA (devolución, ${fotosEntrada.length}) ===` });
  for (const url of fotosEntrada) {
    const img = await leerImagen(url);
    if (img) content.push(img);
  }
  content.push({ type: 'text', text: '\nDevuelve el resultado en el formato estructurado solicitado.' });

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
  if (!bloque?.text) throw new Error('La inspección no devolvió contenido.');
  return JSON.parse(bloque.text) as InspeccionResultado;
}
