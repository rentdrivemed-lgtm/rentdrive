import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { getDb } from '@/lib/db';
import { signToken, UserPayload } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { asignarCodigoReferido, vincularReferido } from '@/lib/referidos';
import { bloqueadoPorCsrf } from '@/lib/csrf';

// Mismo Client ID en frontend (NEXT_PUBLIC_GOOGLE_CLIENT_ID, usado por Google Identity
// Services para pedir el `credential`) y aquí en el servidor como `audience` al
// verificar la firma. No hace falta un Client Secret: solo verificamos un ID token
// (JWT) firmado por Google, no hacemos el intercambio de código de autorización.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

// Invariante real (no solo en el camino de "primer vínculo"): una cuenta admin
// NUNCA entra por Google, y una cuenta inactiva nunca entra por ningún medio. Se
// aplica en los dos puntos donde `user` puede resolverse (por google_id directo, o
// por correo antes de vincular) y otra vez al final como defensa en profundidad.
// Mensaje genérico a propósito: uno distinto para "es admin" filtraría esa
// información a quien solo controle el correo.
function accesoGoogleBloqueado(u: Record<string, unknown>): NextResponse | null {
  // Cualquier estado distinto de 'activa' (inactiva o archivada) bloquea el acceso.
  if (u.rol === 'admin' || u.estado_cuenta !== 'activa') {
    return NextResponse.json({ error: 'No pudimos iniciar sesión con Google.' }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const csrfError = bloqueadoPorCsrf(req);
  if (csrfError) return csrfError;

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'El login con Google no está configurado.' }, { status: 503 });
  }

  const { credential, rol, codigo_referido: codigoReferido } = await req.json().catch(() => ({}));
  if (!credential || typeof credential !== 'string') {
    return NextResponse.json({ error: 'Falta el token de Google.' }, { status: 400 });
  }

  const client = new OAuth2Client(GOOGLE_CLIENT_ID);
  let payload: TokenPayload | undefined;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    // Firma inválida, expirado, audience distinto, etc. — nunca confiar en el JWT sin verificar.
    return NextResponse.json({ error: 'Token de Google inválido.' }, { status: 401 });
  }

  if (!payload || !payload.sub || !payload.email) {
    return NextResponse.json({ error: 'Token de Google inválido.' }, { status: 401 });
  }
  if (payload.email_verified !== true) {
    return NextResponse.json({ error: 'Tu correo de Google no está verificado.' }, { status: 400 });
  }

  const googleId = payload.sub;
  const correo = payload.email;
  const nombre = payload.name || correo.split('@')[0];

  const db = getDb();
  let user = db.prepare('SELECT * FROM usuarios WHERE google_id = ?').get(googleId) as Record<string, unknown> | undefined;
  let esNuevo = false;

  // Si el google_id ya está vinculado a una fila, el chequeo aplica igual que a
  // cualquier otro camino (por si alguna vez una cuenta admin terminó con
  // google_id seteado, a mano o por una versión anterior del flujo).
  if (user) {
    const bloqueo = accesoGoogleBloqueado(user);
    if (bloqueo) return bloqueo;
  }

  if (!user) {
    // ¿Ya existe una cuenta con este correo (creada con contraseña)? Google ya
    // verificó el correo, así que vinculamos automáticamente sin fricción extra
    // (decisión de producto confirmada con el dueño), salvo que esté bloqueada
    // (admin/inactiva) — chequeado ANTES de escribir el UPDATE que vincula el
    // google_id, para no dejar rastro en una cuenta que de todos modos vamos a
    // rechazar.
    const porCorreo = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo) as Record<string, unknown> | undefined;
    if (porCorreo) {
      const bloqueo = accesoGoogleBloqueado(porCorreo);
      if (bloqueo) return bloqueo;
      db.prepare('UPDATE usuarios SET google_id = ? WHERE id = ?').run(googleId, porCorreo.id);
      user = { ...porCorreo, google_id: googleId };
    }
  }

  if (!user) {
    esNuevo = true;
    const rolFinal = rol === 'propietario' ? 'propietario' : 'usuario';
    const result = db.prepare(`
      INSERT INTO usuarios (nombre, correo, password, rol, google_id)
      VALUES (?, ?, '', ?, ?)
    `).run(nombre, correo, rolFinal, googleId);
    user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;

    try {
      asignarCodigoReferido(db, Number(user.id), nombre);
      if (codigoReferido) vincularReferido(db, Number(user.id), String(codigoReferido));
    } catch (e) {
      console.error('[auth/google] No se pudo procesar el código de referido:', e instanceof Error ? e.message : e);
    }

    try {
      const rolLabel = rolFinal === 'propietario' ? 'propietario' : 'usuario';
      await enviarCorreo(correo, '¡Bienvenido a RentDrive!',
        `Hola ${nombre.split(' ')[0]}, tu cuenta de ${rolLabel} en RentDrive quedó creada con Google. ` +
        (rolFinal === 'propietario'
          ? 'Ya puedes publicar tu vehículo y empezar a generar ingresos.'
          : 'Ya puedes buscar y reservar vehículos en Medellín.'));
    } catch (e) {
      console.error('[auth/google] No se pudo enviar el correo de bienvenida:', e instanceof Error ? e.message : e);
    }
  }

  // Defensa en profundidad: cubre el camino de cuenta recién creada (por
  // construcción nunca es admin/inactiva) y actúa de red de seguridad si algo
  // arriba cambia en el futuro.
  const bloqueoFinal = accesoGoogleBloqueado(user);
  if (bloqueoFinal) return bloqueoFinal;

  const tokenPayload: UserPayload = {
    id: Number(user.id),
    nombre: user.nombre as string,
    correo: user.correo as string,
    rol: user.rol as UserPayload['rol'],
  };

  const token = signToken(tokenPayload);
  const res = NextResponse.json({ user: tokenPayload }, { status: esNuevo ? 201 : 200 });
  res.cookies.set('token', token, {
    httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
  });
  return res;
}
