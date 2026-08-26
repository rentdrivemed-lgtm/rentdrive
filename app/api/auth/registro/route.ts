import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signToken, UserPayload } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { validarCelular, validarDocumentoIdentidad, PAIS_TEL_DEFAULT } from '@/lib/validacion';
import { asignarCodigoReferido, vincularReferido } from '@/lib/referidos';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import bcrypt from 'bcryptjs';

function calcularEdad(fechaNac: string): number {
  if (!fechaNac) return 0;
  const hoy = new Date();
  const nac = new Date(fechaNac);
  if (Number.isNaN(nac.getTime())) return 0;
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

export async function POST(req: NextRequest) {
  const csrfError = bloqueadoPorCsrf(req);
  if (csrfError) return csrfError;

  // Registro corto a propósito: aquí solo se piden los datos indispensables para
  // crear la cuenta. La dirección, la ciudad y el contacto de emergencia se piden
  // más adelante, en el flujo de reserva (app/api/reservas), que es cuando de
  // verdad se necesitan para la operación.
  const {
    nombre, correo, password, rol,
    tipo_documento, documento_identidad, fecha_nacimiento,
    celular, celular_indicativo, numero_licencia,
    codigo_referido,
  } = await req.json();

  if (!nombre || !correo || !password) {
    return NextResponse.json({ error: 'Nombre, correo y contraseña son requeridos' }, { status: 400 });
  }

  // Validación autoritativa: el frontend valida para dar feedback inmediato,
  // pero esto es lo que realmente impide crear cuentas con datos ficticios.
  const errDoc = validarDocumentoIdentidad(tipo_documento || 'cedula', documento_identidad || '');
  if (errDoc) return NextResponse.json({ error: errDoc }, { status: 400 });

  const errCel = validarCelular(celular_indicativo || PAIS_TEL_DEFAULT, celular || '');
  if (errCel) return NextResponse.json({ error: errCel }, { status: 400 });

  // La mayoría de edad NO se relaja: es requisito real para alquilar un vehículo.
  if (!fecha_nacimiento || calcularEdad(fecha_nacimiento) < 18) {
    return NextResponse.json({ error: 'Debes ser mayor de 18 años para registrarte.' }, { status: 400 });
  }

  const rolFinal = ['propietario', 'usuario'].includes(rol) ? rol : 'usuario';

  const db = getDb();
  const exists = await db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo);
  if (exists) {
    return NextResponse.json({ error: 'El correo ya está registrado' }, { status: 409 });
  }

  const hash = bcrypt.hashSync(password, 10);

  // direccion, ciudad y contacto_emergencia quedan vacíos a propósito: el flujo de
  // reserva los detecta vacíos y los pide ahí. Ojo si alguien piensa en poner
  // 'Medellín' por defecto en ciudad — eso haría que nunca se le pregunte.
  const result = await db.prepare(`
    INSERT INTO usuarios
      (nombre, correo, password, rol,
       tipo_documento, documento_identidad, fecha_nacimiento,
       celular, celular_indicativo, direccion, ciudad, numero_licencia, contacto_emergencia)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nombre, correo, hash, rolFinal,
    tipo_documento || 'cedula',
    documento_identidad || '',
    fecha_nacimiento || '',
    celular || '',
    celular_indicativo || PAIS_TEL_DEFAULT,
    '',
    '',
    numero_licencia || '',
    '{}',
  );

  const nuevoId = Number(result.lastInsertRowid);
  const payload: UserPayload = {
    id: nuevoId,
    nombre,
    correo,
    rol: rolFinal as UserPayload['rol'],
  };

  try {
    asignarCodigoReferido(db, nuevoId, nombre);
    if (codigo_referido) vincularReferido(db, nuevoId, String(codigo_referido));
  } catch (e) {
    console.error('[registro] No se pudo procesar el código de referido:', e instanceof Error ? e.message : e);
  }

  try {
    const rolLabel = rolFinal === 'propietario' ? 'propietario' : 'usuario';
    await enviarCorreo(correo, '¡Bienvenido a RentDrive!',
      `Hola ${nombre.split(' ')[0]}, tu cuenta de ${rolLabel} en RentDrive quedó creada con este correo. ` +
      (rolFinal === 'propietario'
        ? 'Ya puedes publicar tu vehículo y empezar a generar ingresos.'
        : 'Ya puedes buscar y reservar vehículos en Medellín.'));
  } catch (e) {
    // No bloquear el registro si el correo falla.
    console.error('[registro] No se pudo enviar el correo de bienvenida:', e instanceof Error ? e.message : e);
  }

  const token = signToken(payload);
  const res = NextResponse.json({ user: payload }, { status: 201 });
  res.cookies.set('token', token, {
    httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
  });
  return res;
}
