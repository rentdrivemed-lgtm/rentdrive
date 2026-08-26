import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { validarCelular, validarDireccion, validarDocumentoIdentidad, validarNombreContacto, validarTelefonoContacto } from '@/lib/validacion';
import { referidoHabilitado } from '@/lib/referidos';

// contacto_emergencia se devuelve para que el flujo de reserva sepa si ya lo
// tiene guardado y no se lo vuelva a pedir. También se puede editar desde acá
// (CAMPOS_EDITABLES abajo): es la única vía de autoservicio que tiene hoy un
// usuario con un contacto de emergencia legacy inválido para corregirlo, ya que
// no hay página de perfil dedicada para ese campo todavía.
const CAMPOS_SELECT = 'tipo_documento, documento_identidad, celular, celular_indicativo, direccion, ciudad, contacto_emergencia, cedula_url, cedula_url_dorso, banco, numero_cuenta, certificado_bancario_url, codigo_referido, creditos_referido, admin_nivel, permisos_extra';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  // Devolvemos también el perfil ampliado desde la BD (el JWT solo trae lo básico).
  const db = getDb();
  const fila = db.prepare(`SELECT ${CAMPOS_SELECT} FROM usuarios WHERE id = ?`).get(user.id) as Record<string, unknown> | undefined;

  return NextResponse.json({ user: { ...user, ...(fila || {}), referido_habilitado: referidoHabilitado(db) } });
}

// Campos que el usuario puede editar de su propio perfil.
// contacto_emergencia se maneja aparte porque es un objeto (nombre + teléfono),
// no un string plano como el resto: se serializa a JSON al guardar.
const CAMPOS_EDITABLES = ['tipo_documento', 'documento_identidad', 'celular', 'celular_indicativo', 'direccion', 'ciudad', 'cedula_url', 'cedula_url_dorso', 'banco', 'numero_cuenta', 'certificado_bancario_url', 'contacto_emergencia'] as const;

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

  const db = getDb();
  db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...valores, user.id);

  const fila = db.prepare(`SELECT ${CAMPOS_SELECT} FROM usuarios WHERE id = ?`).get(user.id) as Record<string, unknown> | undefined;

  return NextResponse.json({ ok: true, perfil: fila || {} });
}
