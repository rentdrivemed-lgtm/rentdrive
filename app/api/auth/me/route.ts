import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { validarCelular, validarDireccion, validarDocumentoIdentidad, validarNombreContacto, validarTelefonoContacto } from '@/lib/validacion';
import { esUrlDeStorageValida } from '@/lib/storage';
import { referidoHabilitado } from '@/lib/referidos';
import { correoNoVerificado } from '@/lib/verificacion-correo';

// contacto_emergencia se devuelve para que el flujo de reserva sepa si ya lo
// tiene guardado y no se lo vuelva a pedir. También se puede editar desde acá
// (CAMPOS_EDITABLES abajo): es la única vía de autoservicio que tiene hoy un
// usuario con un contacto de emergencia legacy inválido para corregirlo, ya que
// no hay página de perfil dedicada para ese campo todavía.
//
// fecha_nacimiento y el booleano derivado `password_configurada` (nunca la
// contraseña en sí) se agregaron para que el frontend detecte perfiles
// incompletos de cuentas creadas por Google (ver app/api/auth/completar-perfil
// y lib/perfil.ts, que es la autoridad real del lado servidor).
// licencia_url/licencia_url_dorso (nuevas, ver lib/db.ts): mismo criterio de
// cedula_url/cedula_url_dorso — se leen acá para que app/pago/page.tsx pueda
// precargar la licencia guardada (del atajo de registro o de una reserva
// anterior) en vez de pedirla de nuevo. No se agregan a CAMPOS_EDITABLES (abajo):
// hoy no hay ninguna pantalla de perfil que las edite directamente por esta vía
// (se llenan desde el registro, completar-perfil o al crear una reserva).
const CAMPOS_SELECT = "tipo_documento, documento_identidad, fecha_nacimiento, celular, celular_indicativo, direccion, ciudad, contacto_emergencia, cedula_url, cedula_url_dorso, licencia_url, licencia_url_dorso, banco, numero_cuenta, certificado_bancario_url, codigo_referido, creditos_referido, admin_nivel, permisos_extra, correo_verificado, dia_suelto_autorizado, CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END AS password_configurada";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  // Devolvemos también el perfil ampliado desde la BD (el JWT solo trae lo básico).
  const db = getDb();
  const fila = db.prepare(`SELECT ${CAMPOS_SELECT} FROM usuarios WHERE id = ?`).get(user.id) as Record<string, unknown> | undefined;

  const perfilCompleto = !!fila?.password_configurada && !!fila?.tipo_documento && !!fila?.documento_identidad && !!fila?.fecha_nacimiento;

  // `correo_pendiente` reusa la MISMA función que gatea POST /api/reservas y
  // POST /api/vehiculos (lib/verificacion-correo.ts): así el cliente nunca puede
  // quedar desincronizado con lo que el servidor realmente exige (incluye el
  // kill switch de emailHabilitado()===false, que desactiva el gate por completo).
  const correoPendiente = correoNoVerificado(user.id);

  return NextResponse.json({
    user: { ...user, ...(fila || {}), perfil_completo: perfilCompleto, correo_pendiente: correoPendiente, referido_habilitado: referidoHabilitado(db) },
  });
}

// Campos que el usuario puede editar de su propio perfil.
// contacto_emergencia se maneja aparte porque es un objeto (nombre + teléfono),
// no un string plano como el resto: se serializa a JSON al guardar.
const CAMPOS_EDITABLES = ['tipo_documento', 'documento_identidad', 'celular', 'celular_indicativo', 'direccion', 'ciudad', 'cedula_url', 'cedula_url_dorso', 'banco', 'numero_cuenta', 'certificado_bancario_url', 'contacto_emergencia'] as const;

// Campos de CAMPOS_EDITABLES que son URLs de un archivo subido por nosotros. Sin esto,
// `cedula_url`/`cedula_url_dorso` aceptaban CUALQUIER string (se guardaba tal cual y el
// admin lo termina renderizando como <img src>): bastaba un PUT a mano para "tener
// cédula" sin haber subido nada. Se valida SOLO lo que cambia respecto a lo guardado
// —mismo criterio que `documentosConUrlsValidas` en lib/storage.ts— para no dejar
// atascado a quien tenga una URL legada anterior a Cloudinary (`/uploads/...`), que
// nunca podría volver a guardar su perfil.
const CAMPOS_URL = ['cedula_url', 'cedula_url_dorso'] as const;

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Validación autoritativa en servidor — el frontend valida para dar feedback
  // inmediato, pero esto es lo que realmente impide guardar datos ficticios.
  if ('documento_identidad' in body) {
    const tipo = ('tipo_documento' in body ? body.tipo_documento : undefined) as string | undefined;
    const err = validarDocumentoIdentidad(tipo || 'cedula', String(body.documento_identidad || ''));
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  if ('celular' in body) {
    const indicativo = ('celular_indicativo' in body ? body.celular_indicativo : undefined) as string | undefined;
    const err = validarCelular(indicativo || '+57', String(body.celular || ''));
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  if ('direccion' in body && String(body.direccion || '').trim()) {
    const err = validarDireccion(String(body.direccion));
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  let contactoEmergenciaJson: string | null = null;
  if ('contacto_emergencia' in body) {
    const c = (body.contacto_emergencia || {}) as { nombre?: unknown; telefono?: unknown };
    const nombre = String(c.nombre ?? '').trim();
    const telefono = String(c.telefono ?? '').replace(/\D/g, '');
    const errNombre = validarNombreContacto(nombre);
    if (errNombre) return NextResponse.json({ error: errNombre }, { status: 400 });
    const errTelefono = validarTelefonoContacto(telefono);
    if (errTelefono) return NextResponse.json({ error: errTelefono }, { status: 400 });
    contactoEmergenciaJson = JSON.stringify({ nombre, telefono });
  }

  const db = getDb();
  const actual = db.prepare('SELECT rol, tipo_documento, cedula_url, cedula_url_dorso FROM usuarios WHERE id = ?')
    .get(user.id) as { rol?: string; tipo_documento?: string; cedula_url?: string; cedula_url_dorso?: string } | undefined;
  if (!actual) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  for (const campo of CAMPOS_URL) {
    if (!(campo in body)) continue;
    const valor = body[campo] == null ? '' : String(body[campo]);
    if (valor === (actual[campo] || '')) continue; // no cambió: se respeta lo que ya había
    if (valor && !esUrlDeStorageValida(valor)) {
      return NextResponse.json({ error: 'La foto del documento no es válida. Vuelve a subirla.' }, { status: 400 });
    }
  }

  // ── Documentos del PROPIETARIO: se piden, no se exigen para guardar ────────
  // ANTES esto rechazaba el guardado del perfil si faltaba la cédula (frente y
  // dorso). El dueño lo pidió al revés: "necesito que me permitas avanzar con el
  // registro de los propietarios y no lo limites, en caso de que no tenga uno de
  // los documentos permite continuar y subir despues".
  //
  // Y tenía razón por una razón concreta: al rechazar el guardado se perdía TODO
  // lo demás que la persona había llenado —dirección, celular, datos bancarios—
  // por un documento que quizá ni tenía a mano en ese momento. El formulario
  // castigaba el avance parcial, que es justo como se llena un perfil real.
  //
  // Dónde SÍ se exige, que es donde importa de verdad y ya está implementado:
  //   · publicar un vehículo y que salga a la vitrina depende de los documentos
  //     del VEHÍCULO (documentos_estado, ver PUT /api/vehiculos/[id]);
  //   · cobrarle una liquidación necesita sus datos bancarios;
  //   · la cédula es lo que permite verificar que la tarjeta de propiedad esté a
  //     su nombre, así que se le pide de forma visible en su panel hasta que la
  //     suba — pero no le bloquea el resto de su trabajo.
  //
  // O sea: se avisa, se recuerda, y se bloquea solo el paso que de verdad
  // depende del documento. Guardar el perfil no es ese paso.

  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body) {
      sets.push(`${campo} = ?`);
      valores.push(campo === 'contacto_emergencia' ? contactoEmergenciaJson : (body[campo] == null ? '' : String(body[campo])));
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No hay campos para actualizar.' }, { status: 400 });
  }

  db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...valores, user.id);

  const fila = db.prepare(`SELECT ${CAMPOS_SELECT} FROM usuarios WHERE id = ?`).get(user.id) as Record<string, unknown> | undefined;

  return NextResponse.json({ ok: true, perfil: fila || {} });
}
