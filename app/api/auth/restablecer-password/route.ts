import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { token, nueva_password } = await req.json();
  if (!token || !nueva_password) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }
  if (nueva_password.length < 6) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, reset_token_expira FROM usuarios WHERE reset_token = ? AND reset_token != \'\'')
    .get(token) as { id: number; reset_token_expira: string } | undefined;

  if (!user) {
    return NextResponse.json({ error: 'El enlace no es válido o ya fue usado.' }, { status: 400 });
  }
  if (!user.reset_token_expira || new Date(user.reset_token_expira) < new Date()) {
    return NextResponse.json({ error: 'El enlace venció — solicita uno nuevo.' }, { status: 410 });
  }

  const hash = bcrypt.hashSync(nueva_password, 10);
  db.prepare("UPDATE usuarios SET password = ?, reset_token = '', reset_token_expira = '' WHERE id = ?").run(hash, user.id);

  return NextResponse.json({ ok: true });
}
