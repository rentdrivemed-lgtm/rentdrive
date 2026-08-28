import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { MAX_INTENTOS } from '@/lib/verificacion-correo';

// Verifica el código de activación de cuenta (OTP) contra el usuario AUTENTICADO
// (nunca contra un id que llegue en el body — a diferencia de leads-propietarios,
// aquí ya hay sesión, así que es la fuente de identidad). Mismo patrón de
// expiración + límite de intentos que app/api/leads-propietarios/verificar.
type FilaCodigo = {
  correo_codigo: string | null;
  correo_codigo_expira: string | null;
  correo_codigo_intentos: number | null;
  correo_verificado: number;
};

export async function POST(req: NextRequest) {
  const csrfError = bloqueadoPorCsrf(req);
  if (csrfError) return csrfError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const codigo = (body.codigo || '').toString().trim();
  if (!codigo) return NextResponse.json({ ok: false, error: 'Falta el código' }, { status: 400 });

  const db = getDb();
  const fila = db.prepare(
    'SELECT correo_codigo, correo_codigo_expira, correo_codigo_intentos, correo_verificado FROM usuarios WHERE id = ?'
  ).get(user.id) as FilaCodigo | undefined;

  if (!fila) return NextResponse.json({ ok: false, error: 'Usuario no encontrado' }, { status: 404 });
  if (fila.correo_verificado) return NextResponse.json({ ok: true });

  if ((fila.correo_codigo_intentos || 0) >= MAX_INTENTOS) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos — pide un código nuevo.' }, { status: 429 });
  }
  if (!fila.correo_codigo_expira || new Date(fila.correo_codigo_expira) < new Date()) {
    return NextResponse.json({ ok: false, error: 'El código venció — pide uno nuevo.' }, { status: 410 });
  }

  db.prepare('UPDATE usuarios SET correo_codigo_intentos = correo_codigo_intentos + 1 WHERE id = ?').run(user.id);

  if (!fila.correo_codigo || codigo !== fila.correo_codigo) {
    return NextResponse.json({ ok: false, error: 'Código incorrecto.' }, { status: 400 });
  }

  db.prepare(
    "UPDATE usuarios SET correo_verificado = 1, correo_codigo = '', correo_codigo_expira = '' WHERE id = ?"
  ).run(user.id);

  return NextResponse.json({ ok: true });
}
