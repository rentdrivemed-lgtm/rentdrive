import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }
  const db = getDb();
  const usuarios = await db.prepare(`
    SELECT id, nombre, correo, rol, estado_cuenta, created_at,
           tipo_documento, documento_identidad, fecha_nacimiento,
           celular, direccion, ciudad, numero_licencia, contacto_emergencia,
           cedula_url
    FROM usuarios
    ORDER BY created_at DESC
  `).all();
  return NextResponse.json({ usuarios });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }
  const { id, estado_cuenta } = await req.json();
  const db = getDb();
  await db.prepare('UPDATE usuarios SET estado_cuenta = ? WHERE id = ?').run(estado_cuenta, id);
  return NextResponse.json({ ok: true });
}
