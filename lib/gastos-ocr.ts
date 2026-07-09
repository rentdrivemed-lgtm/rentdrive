import { getAnthropic } from './anthropic';

export type CategoriaGasto = 'fijo' | 'variable' | 'servicio' | 'producto' | 'otro';
export type Confianza = 'alta' | 'media' | 'baja';

export type GastoExtraido = {
  proveedor: string | null;
  nit_proveedor: string | null;
  numero_factura: string | null;
  fecha: string | null;          // YYYY-MM-DD
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  categoria_sugerida: CategoriaGasto | null;
  descripcion: string | null;
  metodo_pago: string | null;
  moneda: string | null;
  confianza: Confianza;
  nota_ia: string | null;
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

const CATEGORIAS: CategoriaGasto[] = ['fijo', 'variable', 'servicio', 'producto', 'otro'];

function aNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Limpia formatos colombianos: "$ 1.234.567,89" -> 1234567.89
  let s = String(v).replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  if (tieneComa && tienePunto) {
    // El último separador es el decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (tieneComa) {
    // Coma sola: en Colombia suele ser separador de miles; solo decimal si hay 1-2 dígitos tras la última coma
    const dec = s.length - s.lastIndexOf(',') - 1;
    s = dec > 0 && dec <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (tienePunto) {
    const dec = s.length - s.lastIndexOf('.') - 1;
    if (!(dec > 0 && dec <= 2)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrae los datos de un gasto (factura / recibo / comprobante) desde una imagen o PDF
 * usando Claude vision. Devuelve datos para pre-llenar el formulario; el admin confirma.
 */
export async function extraerGasto(url: string): Promise<GastoExtraido> {
  const anthropic = getAnthropic();
  const { data, mediaType } = await fetchAsBase64(url);

  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: MediaType; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

  const content: ContentBlock[] = [];
  if (mediaType === 'application/pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
  } else {
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  }

  content.push({
    type: 'text',
    text: `
Eres un contador que digitaliza gastos de una empresa colombiana de alquiler de vehículos (DrivePass, Medellín).
El documento de arriba es una factura, recibo, cuenta de cobro o comprobante de un GASTO de la empresa.

Extrae la información y devuelve un JSON con EXACTAMENTE esta estructura (sin markdown, sin texto adicional):

{
  "proveedor": "<nombre del establecimiento/proveedor que emite la factura, o null>",
  "nit_proveedor": "<NIT o cédula del proveedor, o null>",
  "numero_factura": "<número de la factura/recibo, o null>",
  "fecha": "<fecha del documento en formato YYYY-MM-DD, o null>",
  "subtotal": <valor base antes de impuestos como número, o null>,
  "iva": <valor del IVA/impuesto como número, o null>,
  "total": <valor total a pagar como número, o null>,
  "categoria_sugerida": "<fijo|variable|servicio|producto|otro>",
  "descripcion": "<breve descripción de qué se compró o pagó, máx 100 caracteres, o null>",
  "metodo_pago": "<efectivo|tarjeta|transferencia|PSE|null>",
  "moneda": "<COP|USD|etc., o null>",
  "confianza": "<alta|media|baja>",
  "nota_ia": "<observación relevante si algo no es claro, o null>"
}

Guía para categoria_sugerida:
- "servicio": facturas de servicios públicos o recurrentes de proveedores (energía/EPM, agua, gas, internet, telefonía, arriendo de local/parqueadero, software/suscripciones, contador, vigilancia).
- "producto": compra de bienes tangibles (repuestos, llantas, aceite, herramientas, insumos de aseo, papelería, equipos).
- "fijo": nómina, seguros, cuotas de crédito u obligaciones que no cambian mes a mes.
- "variable": mantenimientos, combustible, lavado, peajes, comisiones, gastos ocasionales.
- "otro": cuando no encaje claramente.

Reglas de valores:
- Los montos son números SIN símbolos ni separadores de miles (ej. 1234567.89, no "$ 1.234.567").
- En Colombia el separador de miles suele ser el punto y el decimal la coma. Interpreta correctamente.
- Si solo ves el total y no el desglose, deja subtotal e iva en null y llena total.
- Usa confianza "alta" solo si lees los montos y la fecha con claridad; "baja" si la foto está borrosa o incompleta.`,
  });

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1500,
    messages: [{ role: 'user', content: content as Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'] }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('La IA no devolvió JSON válido');

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error('No se pudo parsear la respuesta de la IA');
  }

  const cat = typeof raw.categoria_sugerida === 'string' && CATEGORIAS.includes(raw.categoria_sugerida as CategoriaGasto)
    ? (raw.categoria_sugerida as CategoriaGasto) : null;
  const conf: Confianza = raw.confianza === 'alta' || raw.confianza === 'baja' ? raw.confianza : 'media';

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return {
    proveedor: str(raw.proveedor),
    nit_proveedor: str(raw.nit_proveedor),
    numero_factura: str(raw.numero_factura),
    fecha: str(raw.fecha),
    subtotal: aNumero(raw.subtotal),
    iva: aNumero(raw.iva),
    total: aNumero(raw.total),
    categoria_sugerida: cat,
    descripcion: str(raw.descripcion),
    metodo_pago: str(raw.metodo_pago),
    moneda: str(raw.moneda),
    confianza: conf,
    nota_ia: str(raw.nota_ia),
  };
}
