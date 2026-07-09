import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { extraerGasto } from '@/lib/gastos-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;

  if (!tieneClaveAnthropic()) {
    return NextResponse.json(
      { error: 'La extracción con IA no está disponible: falta configurar ANTHROPIC_API_KEY en el servidor. Puedes registrar el gasto manualmente.' },
      { status: 503 },
    );
  }

  const { url } = await req.json().catch(() => ({ url: '' }));
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Falta la URL del comprobante' }, { status: 400 });
  }

  try {
    const datos = await extraerGasto(url);
    return NextResponse.json({ datos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al leer el documento';
    return NextResponse.json({ error: `No se pudo extraer la información: ${msg}` }, { status: 500 });
  }
}
