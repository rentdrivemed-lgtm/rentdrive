// Helper de servidor para proteger rutas de API por nivel administrativo.
// Solo lo importan rutas de API (server) — NO usar en componentes de cliente.
import { NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { getCurrentUser, type UserPayload } from './auth';
import { getDb } from './db';
import { nivelDe, puede, type AdminNivel } from './permisos';

export type GuardOk = { user: UserPayload; nivel: AdminNivel; db: Database.Database };

// Devuelve { user, nivel, db } si el usuario es admin y su nivel puede acceder al área,
// o { error: NextResponse } (403) en caso contrario.
export async function guardArea(area: string): Promise<GuardOk | { error: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
  }
  const db = getDb();
  const nivel = nivelDe(db, user.id);
  if (!puede(nivel, area)) {
    return { error: NextResponse.json({ error: 'No tienes permiso para esta sección.' }, { status: 403 }) };
  }
  return { user, nivel, db };
}
