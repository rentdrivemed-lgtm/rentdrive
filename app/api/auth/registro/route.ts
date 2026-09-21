import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signToken, UserPayload } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { validarCelular, validarDocumentoIdentidad, PAIS_TEL_DEFAULT } from '@/lib/validacion';
import { asignarCodigoReferido, vincularReferido } from '@/lib/referidos';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { consumirIntento, ipCliente } from '@/lib/limite-tasa';
import { generarCodigoCorreo, expiraEnMinutos, CODIGO_VIGENCIA_MIN } from '@/lib/verificacion-correo';
import { esUrlDeStorageValida } from '@/lib/storage';
import { emitirYNotificarVinculacion } from '@/lib/contratos-vinculacion';
import bcrypt from 'bcryptjs';

// Límite por IP: crear cuentas es gratis para quien registra pero NO para quien
// recibe el correo de bienvenida/verificación de forma no solicitada (spam,
// costo y reputación del dominio en Resend). 5/hora por IP es generoso para un
// uso legítimo (una familia, una oficina) y corta el registro masivo con
// correos ajenos. Mismo patrón que app/api/registro/extraer-documento.
const IP_MAX_REGISTROS = 5;
const IP_VENTANA_MS = 60 * 60 * 1000; // 1 hora

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

  const espera = consumirIntento(`registro:${ipCliente(req)}`, IP_MAX_REGISTROS, IP_VENTANA_MS);
  if (espera !== null) {
    return NextResponse.json(
      { error: `Demasiados registros seguidos desde tu conexión. Intenta de nuevo en ${Math.ceil(espera / 60)} minuto(s).` },
      { status: 429 },
    );
  }

  // Registro corto a propósito: aquí solo se piden los datos indispensables para
  // crear la cuenta. La dirección, la ciudad y el contacto de emergencia se piden
  // más adelante, en el flujo de reserva (app/api/reservas), que es cuando de
  // verdad se necesitan para la operación.
  const {
    nombre, correo, password, rol,
    tipo_documento, documento_identidad, fecha_nacimiento,
    celular, celular_indicativo, numero_licencia,
    codigo_referido, cedula_url, cedula_url_dorso, licencia_url,
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

  // cedula_url / cedula_url_dorso / licencia_url (opcionales): vienen del atajo de foto del registro
  // (app/(auth)/registro/page.tsx → POST /api/registro/extraer-documento, que ya
  // subió la imagen a nuestro storage y devolvió `urlGuardada`). Quien llenó el
  // formulario a mano simplemente no manda estos campos. Se valida que la URL
  // realmente venga de nuestro storage (Cloudinary) antes de guardarla — mismo
  // chequeo que ya exige lib/storage.ts para los documentos de vehículo — así una
  // request directa al endpoint (curl) no puede inyectar cualquier URL arbitraria
  // en el perfil de la cuenta recién creada. Si no es válida, se ignora en
  // silencio (no bloquea el registro, que es opcional).
  //
  // `cedula_url_dorso` (reverso) se trata EXACTAMENTE igual que el frente: mismo
  // origen (tipo 'cedula_dorso' del mismo endpoint), misma validación de storage y
  // mismo carácter opcional. No se exige en el registro porque el atajo de foto
  // completo es opcional — la exigencia real del dorso vive donde se necesita el
  // documento: al reservar (app/api/reservas) y en el perfil del propietario
  // (PUT /api/auth/me). Guardarlo acá es lo que evita volver a pedirlo allá.
  const cedulaUrlFinal = typeof cedula_url === 'string' && cedula_url && esUrlDeStorageValida(cedula_url) ? cedula_url : '';
  const cedulaUrlDorsoFinal = typeof cedula_url_dorso === 'string' && cedula_url_dorso && esUrlDeStorageValida(cedula_url_dorso) ? cedula_url_dorso : '';
  const licenciaUrlFinal = typeof licencia_url === 'string' && licencia_url && esUrlDeStorageValida(licencia_url) ? licencia_url : '';

  // Código de verificación de correo (activación de cuenta) — se genera y guarda
  // ya en el INSERT, igual que leads_propietarios lo hace en su propio POST.
  // Ver lib/verificacion-correo.ts.
  const codigoCorreo = generarCodigoCorreo();
  const ahora = new Date();
  const codigoExpira = expiraEnMinutos(CODIGO_VIGENCIA_MIN, ahora);

  // direccion, ciudad y contacto_emergencia quedan vacíos a propósito: el flujo de
  // reserva los detecta vacíos y los pide ahí. Ojo si alguien piensa en poner
  // 'Medellín' por defecto en ciudad — eso haría que nunca se le pregunte.
  const result = await db.prepare(`
    INSERT INTO usuarios
      (nombre, correo, password, rol,
       tipo_documento, documento_identidad, fecha_nacimiento,
       celular, celular_indicativo, direccion, ciudad, numero_licencia, contacto_emergencia,
       cedula_url, cedula_url_dorso, licencia_url,
       correo_verificado, correo_codigo, correo_codigo_expira, correo_codigo_generado_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
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
    cedulaUrlFinal,
    cedulaUrlDorsoFinal,
    licenciaUrlFinal,
    codigoCorreo, codigoExpira, ahora.toISOString(),
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

  // Contrato de vinculación: se EMITE aquí, al crear la cuenta, y queda esperando que
  // la persona ponga su trazo desde su propio perfil (ver lib/contratos-vinculacion.ts).
  // No se da por firmado con una casilla: marcar «leí y acepto» y firmar no son lo
  // mismo, y lo que hace oponible el documento es el trazo con su sello de integridad.
  //
  // `emitirYNotificarVinculacion` no lanza: si falla, la cuenta queda creada igual y el
  // documento se puede emitir después desde el panel. Perder un registro por esto sería
  // peor que emitir el contrato un minuto más tarde.
  emitirYNotificarVinculacion(db, nuevoId, rolFinal, { id: nuevoId, nombre, correo });

  // El correo de bienvenida y el código de activación van en el mismo envío (evita
  // mandar dos correos separados). El registro NUNCA se bloquea si el envío falla —
  // igual que leads-propietarios, si `enviarCorreo` no está configurado (falta
  // RESEND_API_KEY) el código queda en el log del servidor para poder seguir
  // probando, y lib/verificacion-correo.ts (`correoNoVerificado`) desactiva el gate
  // por completo mientras el envío real no esté disponible.
  try {
    const rolLabel = rolFinal === 'propietario' ? 'propietario' : 'usuario';
    const bienvenida = `Hola ${nombre.split(' ')[0]}, tu cuenta de ${rolLabel} en RentDrive quedó creada con este correo. ` +
      (rolFinal === 'propietario'
        ? 'Ya puedes publicar tu vehículo y empezar a generar ingresos.'
        : 'Ya puedes buscar y reservar vehículos en Medellín.');
    const verificacion = `\n\nPara activar tu cuenta, verifica tu correo con este código: ${codigoCorreo}. Vence en ${CODIGO_VIGENCIA_MIN} minutos.`;
    const envio = await enviarCorreo(correo, '¡Bienvenido a RentDrive! Verifica tu correo', bienvenida + verificacion);
    if (!envio.enviado) {
      console.log(`[registro] Código de verificación de correo para ${correo}: ${codigoCorreo} (envío real falló: ${envio.detalle})`);
    }
  } catch (e) {
    // No bloquear el registro si el correo falla.
    console.error('[registro] No se pudo enviar el correo de bienvenida/verificación:', e instanceof Error ? e.message : e);
  }

  const token = signToken(payload);
  const res = NextResponse.json({ user: payload }, { status: 201 });
  res.cookies.set('token', token, {
    httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
  });
  return res;
}
