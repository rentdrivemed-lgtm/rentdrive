// GET /api/panel/bandeja — la vista HOY del panel unificado, en UNA sola petición.
//
// Agregador propio a propósito (ver lib/bandeja.ts): el navegador NO arma esta lista
// con diez peticiones. Aquí se decide, con los permisos EFECTIVOS releídos de la base
// (`guardArea` → `permisosDe`), qué fuentes se consultan siquiera.
//
// El área `panel` abre la bandeja; el contenido de cada fila lo abre su propia área
// (reservas, vehiculos, operaciones, contabilidad, contratos, soporte).
import { NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { construirBandeja } from '@/lib/bandeja';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await guardArea('panel');
  if ('error' in g) return g.error;
  const { db, nivel, permisos } = g;

  const bandeja = construirBandeja(db, nivel, permisos);
  return NextResponse.json(bandeja);
}
