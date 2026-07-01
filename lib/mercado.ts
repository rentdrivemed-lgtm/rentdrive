import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export type PreciosTipo = {
  sedan: number | null;
  suv: number | null;
  compacto: number | null;
  pickup: number | null;
  encontrado: boolean;
  nota: string;
};

export async function extraerPreciosPagina(url: string, nombre: string): Promise<PreciosTipo> {
  const fallback: PreciosTipo = { sedan: null, suv: null, compacto: null, pickup: null, encontrado: false, nota: '' };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...fallback, nota: 'ANTHROPIC_API_KEY no configurada' };
  }

  let textContent = '';
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CO,es;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });
    const html = await resp.text();
    // Strip scripts/styles and extract text
    textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 45000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error de red';
    return { ...fallback, nota: `No se pudo acceder: ${msg}` };
  }

  if (!textContent || textContent.length < 100) {
    return { ...fallback, nota: 'Página vacía o requiere JavaScript para renderizar' };
  }

  try {
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Eres un extractor de precios de alquiler de vehículos. Analiza el siguiente texto extraído de la página web de "${nombre}" (${url}) y extrae los precios de alquiler diario en Colombia (Medellín o Colombia en general).

Texto de la página:
${textContent}

Devuelve SOLO JSON válido, sin markdown ni explicaciones:
{
  "sedan": <precio_dia_en_COP o null>,
  "suv": <precio_dia_en_COP o null>,
  "compacto": <precio_dia_en_COP o null>,
  "pickup": <precio_dia_en_COP o null>,
  "encontrado": <true si encontraste al menos un precio, false si no>,
  "nota": "<explica brevemente qué encontraste o por qué no pudiste extraer precios>"
}

Reglas:
- Si los precios están en USD, conviértelos a COP usando 1 USD = 4200 COP
- Si el sitio requiere JavaScript o no tiene precios visibles en el HTML, pon encontrado:false y explícalo en nota
- Usa el precio más económico disponible de cada categoría
- Si no hay categoría exacta, aproxima (ej: "económico" → compacto, "intermedio" → sedan, "SUV"/"camioneta" → suv)`,
      }],
    });

    const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as PreciosTipo;
      return parsed;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error de IA';
    return { ...fallback, nota: `Error al analizar con IA: ${msg}` };
  }

  return { ...fallback, nota: 'No se pudo parsear la respuesta de la IA' };
}

export function calcularPrecioObjetivo(
  preciosMercado: PreciosTipo[],
  tipo: 'sedan' | 'suv' | 'compacto' | 'pickup',
  ajustePct: number
): number | null {
  const precios = preciosMercado
    .map(p => p[tipo])
    .filter((v): v is number => v !== null && v > 0);

  if (precios.length === 0) return null;

  const promedio = precios.reduce((a, b) => a + b, 0) / precios.length;
  return Math.round((promedio * (1 + ajustePct / 100)) / 1000) * 1000; // redondear a miles
}
