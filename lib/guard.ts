// Helper de servidor para proteger rutas de API por nivel administrativo.
// Solo lo importan rutas de API (server) — NO usar en componentes de cliente.
import { NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { getCurrentUser, type UserPayload } from './auth';
import { getDb } from './db';
import { permisosDe, puede, type AdminNivel, type PermisosExtra } from './permisos';

export type GuardOk = { user: UserPayload; nivel: AdminNivel; db: Database.Database; permisos: PermisosExtra };

// Devuelve { user, nivel, permisos, db } si el usuario es admin y puede acceder al área,
// o { error: NextResponse } (403) en caso contrario.
// El permiso efectivo = matriz por nivel + excepciones por empleado (usuarios.permisos_extra).
// El servidor es la única fuente de verdad: que la UI oculte una pestaña es cosmético.
export async function guardArea(area: string): Promise<GuardOk | { error: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
  }
  const db = getDb();
  const { nivel, extra } = permisosDe(db, user.id);
  if (!puede(nivel, area, extra)) {
    return { error: NextResponse.json({ error: 'No tienes permiso para esta sección.' }, { status: 403 }) };
  }
  return { user, nivel, db, permisos: extra };
}
