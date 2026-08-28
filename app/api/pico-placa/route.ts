import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getConfig } from '@/lib/operaciones';
import { parsePicoPlaca } from '@/lib/pico-placa';

export const dynamic = 'force-dynamic';

// Lectura liviana y NO sensible de la config de pico y placa (es información pública del
// gobierno de Medellín, no financiera). A diferencia de GET /api/config —exclusivo para
// admins, porque expone claves sensibles como comisión de la plataforma y NIT—, este
// endpoint solo devuelve {activo, vigencia, dias} y es público (sin sesión), igual que
// GET /api/vehiculos/[id]: lo necesita cualquier visitante que vea la ficha de un vehículo
// para saber si aplica restricción antes de reservar. No requiere rol admin ni cookie.
export async function GET() {
  const db = getDb();
  const pp = parsePicoPlaca(getConfig(db, 'pico_placa'));
  return NextResponse.json(pp);
}
