import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { extraerGasto } from '@/lib/gastos-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

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
