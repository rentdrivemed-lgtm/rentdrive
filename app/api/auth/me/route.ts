import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { validarCelular, validarDireccion, validarDocumentoIdentidad } from '@/lib/validacion';
import { referidoHabilitado } from '@/lib/referidos';

const CAMPOS_SELECT = 'tipo_documento, documento_identidad, celular, celular_indicativo, direccion, ciudad, cedula_url, cedula_url_dorso, banco, numero_cuenta, certificado_bancario_url, codigo_referido, creditos_referido, admin_nivel';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  // Devolvemos también el perfil ampliado desde la BD (el JWT solo trae lo básico).
  const db = getDb();
  const fila = db.prepare(`SELECT ${CAMPOS_SELECT} FROM usuarios WHERE id = ?`).get(user.id) as Record<string, unknown> | undefined;

  return NextResponse.json({ user: { ...user, ...(fila || {}), referido_habilitado: referidoHabilitado(db) } });
}

// Campos que el usuario puede editar de su propio perfil.
const CAMPOS_EDITABLES = ['tipo_documento', 'documento_identidad', 'celular', 'celular_indicativo', 'direccion', 'ciudad', 'cedula_url', 'cedula_url_dorso', 'banco', 'numero_cuenta', 'certificado_bancario_url'] as const;

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

  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body) {
      sets.push(`${campo} = ?`);
      valores.push(body[campo] == null ? '' : String(body[campo]));
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
