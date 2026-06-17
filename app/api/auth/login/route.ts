import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signToken, UserPayload } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const { correo, password } = await req.json();

  if (!correo || !password) {
    return NextResponse.json({ error: 'Correo y contraseña requeridos' }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo) as Record<string, unknown> | undefined;

  if (!user || !bcrypt.compareSync(password, user.password as string)) {
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
  }

  if (user.estado_cuenta === 'inactiva') {
    return NextResponse.json({ error: 'Cuenta inactiva' }, { status: 403 });
  }

  const payload: UserPayload = {
    id: Number(user.id),
    nombre: user.nombre as string,
    correo: user.correo as string,
    rol: user.rol as UserPayload['rol'],
  };

  const token = signToken(payload);

  const res = NextResponse.json({ user: payload });
  res.cookies.set('token', token, { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 });
  return res;
}
