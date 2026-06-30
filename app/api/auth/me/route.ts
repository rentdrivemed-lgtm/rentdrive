import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  // Devolvemos también el perfil ampliado desde la BD (el JWT solo trae lo básico).
  const db = getDb();
  const fila = db.prepare(
    'SELECT tipo_documento, documento_identidad, celular, direccion, ciudad, cedula_url, banco, numero_cuenta, certificado_bancario_url FROM usuarios WHERE id = ?'
  ).get(user.id) as Record<string, unknown> | undefined;

  return NextResponse.json({ user: { ...user, ...(fila || {}) } });
}

// Campos que el usuario puede editar de su propio perfil.
const CAMPOS_EDITABLES = ['tipo_documento', 'documento_identidad', 'celular', 'direccion', 'ciudad', 'cedula_url', 'banco', 'numero_cuenta', 'certificado_bancario_url'] as const;

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body) {
      sets.push(`${campo} = ?`);
      valores.push(body[campo] == null ? '' : String(body[campo]));
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No hay campos para actualizar.' }, { status: 400 });
  }

  const db = getDb();
  db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...valores, user.id);

  const fila = db.prepare(
    'SELECT tipo_documento, documento_identidad, celular, direccion, ciudad, cedula_url, banco, numero_cuenta, certificado_bancario_url FROM usuarios WHERE id = ?'
  ).get(user.id) as Record<string, unknown> | undefined;

  return NextResponse.json({ ok: true, perfil: fila || {} });
}
