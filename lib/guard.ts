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
  // `nivel === null` = la fila de este usuario ya no existe o no está `activa` (ver
  // lib/permisos.ts): el JWT puede seguir siendo válido hasta 7 días aunque la cuenta
  // se haya borrado o desactivado de verdad, así que esta es la revalidación real
  // contra el estado actual en BD. `puede()` ya deniega con `nivel: null`, pero el
  // chequeo explícito aquí también sirve para que TypeScript descarte `null` del tipo
  // de `nivel` en el `return` de abajo (que debe cumplir `GuardOk.nivel: AdminNivel`).
  if (nivel === null || !puede(nivel, area, extra)) {
    return { error: NextResponse.json({ error: 'No tienes permiso para esta sección.' }, { status: 403 }) };
  }
  return { user, nivel, db, permisos: extra };
}

// ── Endpoints compartidos entre roles ────────────────────────────────────────
// Hay rutas que atienden a varios roles a la vez: el cliente consulta SUS reservas,
// el propietario edita SUS vehículos y el admin ve/edita todo. Ahí `guardArea` no
// sirve: exige rol admin y le respondería 403 al cliente o al propietario legítimo.
//
// Estos dos helpers permiten partir el chequeo en dos ramas dentro de la misma ruta:
//   · rama de administración → exigir el área con `adminTieneArea` (nivel + excepciones);
//   · rama del dueño de los datos → dejar intacta la lógica de pertenencia que ya existía.
// Así, revocar una casilla cierra de verdad la puerta del admin sin tocar a nadie más.
export function adminTieneArea(db: Database.Database, userId: number, area: string): boolean {
  const { nivel, extra } = permisosDe(db, userId);
  // Igual que en `guardArea`: si `permisosDe` devolvió `nivel: null` (fila borrada o
  // no `activa`), `puede()` deniega sin excepción — no hace falta chequeo aparte aquí.
  return puede(nivel, area, extra);
}

// Respuesta única para "eres admin, pero esta sección no está entre tus permisos".
export function sinPermisoArea(): NextResponse {
  return NextResponse.json({ error: 'No tienes permiso para esta sección.' }, { status: 403 });
}
