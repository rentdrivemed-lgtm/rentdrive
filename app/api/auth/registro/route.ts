import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signToken, UserPayload } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const {
    nombre, correo, password, rol,
    tipo_documento, documento_identidad, fecha_nacimiento,
    celular, direccion, ciudad, numero_licencia,
    emergencia_nombre, emergencia_tel,
  } = await req.json();

  if (!nombre || !correo || !password) {
    return NextResponse.json({ error: 'Nombre, correo y contraseña son requeridos' }, { status: 400 });
  }

  const rolFinal = ['propietario', 'usuario'].includes(rol) ? rol : 'usuario';

  const db = getDb();
  const exists = await db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo);
  if (exists) {
    return NextResponse.json({ error: 'El correo ya está registrado' }, { status: 409 });
  }

  const hash = bcrypt.hashSync(password, 10);
  const contacto_emergencia = JSON.stringify({
    nombre: emergencia_nombre || '',
    telefono: emergencia_tel || '',
  });

  const result = await db.prepare(`
    INSERT INTO usuarios
      (nombre, correo, password, rol,
       tipo_documento, documento_identidad, fecha_nacimiento,
       celular, direccion, ciudad, numero_licencia, contacto_emergencia)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nombre, correo, hash, rolFinal,
    tipo_documento || 'cedula',
    documento_identidad || '',
    fecha_nacimiento || '',
    celular || '',
    direccion || '',
    ciudad || 'Medellín',
    numero_licencia || '',
    contacto_emergencia,
  );

  const payload: UserPayload = {
    id: Number(result.lastInsertRowid),
    nombre,
    correo,
    rol: rolFinal as UserPayload['rol'],
  };

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
  res.cookies.set('token', token, { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 });
  return res;
}
