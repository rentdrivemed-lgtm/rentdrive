import { NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { miembrosEquipo } from '@/lib/panel';

export const dynamic = 'force-dynamic';

// GET — miembros del equipo (para asignar tareas, invitar a tableros, etc.).
export async function GET() {
  const g = await guardArea('panel');
  if ('error' in g) return g.error;
  const { db } = g;
  return NextResponse.json({ equipo: miembrosEquipo(db) });
}
