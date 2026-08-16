import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { getDb } from '@/lib/db';
import { signToken, UserPayload } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { asignarCodigoReferido, vincularReferido } from '@/lib/referidos';

// Mismo Client ID en frontend (NEXT_PUBLIC_GOOGLE_CLIENT_ID, usado por Google Identity
// Services para pedir el `credential`) y aquí en el servidor como `audience` al
// verificar la firma. No hace falta un Client Secret: solo verificamos un ID token
// (JWT) firmado por Google, no hacemos el intercambio de código de autorización.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

export async function POST(req: NextRequest) {
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

  if (!user) {
    // ¿Ya existe una cuenta con este correo (creada con contraseña)? Google ya
    // verificó el correo, así que vinculamos automáticamente sin fricción extra
    // (decisión de producto confirmada con el dueño). Comprobamos el estado ANTES
    // de escribir el UPDATE que vincula el google_id (no dejar rastro en una
    // cuenta inactiva antes de rechazar el login).
    const porCorreo = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo) as Record<string, unknown> | undefined;
    if (porCorreo) {
      if (porCorreo.estado_cuenta === 'inactiva') {
        return NextResponse.json({ error: 'Cuenta inactiva' }, { status: 403 });
      }
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

  if (user.estado_cuenta === 'inactiva') {
    return NextResponse.json({ error: 'Cuenta inactiva' }, { status: 403 });
  }

  const tokenPayload: UserPayload = {
    id: Number(user.id),
    nombre: user.nombre as string,
    correo: user.correo as string,
    rol: user.rol as UserPayload['rol'],
  };

  const token = signToken(tokenPayload);
  const res = NextResponse.json({ user: tokenPayload }, { status: esNuevo ? 201 : 200 });
  res.cookies.set('token', token, { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 });
  return res;
}
