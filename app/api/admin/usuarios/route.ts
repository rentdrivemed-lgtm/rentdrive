import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import bcrypt from 'bcryptjs';

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

  const body = await req.json() as { id?: number; estado_cuenta?: string; nueva_contrasena?: string };
  const { id, estado_cuenta, nueva_contrasena } = body;
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const db = getDb();

  if (nueva_contrasena) {
    if (nueva_contrasena.length < 6) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
    }
    const hash = await bcrypt.hash(nueva_contrasena, 12);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hash, id);
    return NextResponse.json({ ok: true });
  }

  if (estado_cuenta) {
    db.prepare('UPDATE usuarios SET estado_cuenta = ? WHERE id = ?').run(estado_cuenta, id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
}
