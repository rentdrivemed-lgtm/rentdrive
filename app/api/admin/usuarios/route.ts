import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria, normalizarNivel, esNivel, NIVEL_LABEL } from '@/lib/permisos';

export async function GET() {
  const g = await guardArea('usuarios');
  if ('error' in g) return g.error;
  const { db } = g;
  const usuarios = db.prepare(`
    SELECT id, nombre, correo, rol, admin_nivel, estado_cuenta, created_at,
           tipo_documento, documento_identidad, fecha_nacimiento,
           celular, celular_indicativo, direccion, ciudad, numero_licencia, contacto_emergencia,
           cedula_url, cedula_url_dorso
    FROM usuarios
    ORDER BY created_at DESC
  `).all();
  return NextResponse.json({ usuarios });
}

// Crear una cuenta de equipo (rol='admin' con un nivel: socio / secretaria / principal).
export async function POST(req: NextRequest) {
  const g = await guardArea('usuarios_gestion');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const nombre = String(body.nombre || '').trim().slice(0, 120);
  const correo = String(body.correo || '').trim().toLowerCase();
  const password = String(body.password || '');
  const adminNivel = normalizarNivel(body.admin_nivel);

  if (!nombre) return NextResponse.json({ error: 'Falta el nombre.' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return NextResponse.json({ error: 'Correo inválido.' }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });

  const existe = db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo);
  if (existe) return NextResponse.json({ error: 'Ya existe una cuenta con ese correo.' }, { status: 409 });

  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare(
    "INSERT INTO usuarios (nombre, correo, password, rol, admin_nivel, estado_cuenta) VALUES (?, ?, ?, 'admin', ?, 'activa')"
  ).run(nombre, correo, hash, adminNivel);
  const id = Number(info.lastInsertRowid);

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'usuarios', accion: 'crear_cuenta_equipo', entidad: 'usuario', entidad_id: id,
    detalle: `Creó a ${nombre} (${correo}) como ${NIVEL_LABEL[adminNivel]}`,
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const g = await guardArea('usuarios_gestion');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json() as { id?: number; estado_cuenta?: string; nueva_contrasena?: string; admin_nivel?: string };
  const { id, estado_cuenta, nueva_contrasena, admin_nivel } = body;
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const objetivo = db.prepare('SELECT id, nombre, correo, rol, admin_nivel FROM usuarios WHERE id = ?').get(id) as
    { id: number; nombre: string; correo: string; rol: string; admin_nivel: string } | undefined;
  if (!objetivo) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  if (nueva_contrasena) {
    if (nueva_contrasena.length < 6) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
    }
    const hash = await bcrypt.hash(nueva_contrasena, 12);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hash, id);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: 'resetear_clave', entidad: 'usuario', entidad_id: id,
      detalle: `Reseteó la contraseña de ${objetivo.nombre} (${objetivo.correo})`,
    });
    return NextResponse.json({ ok: true });
  }

  if (admin_nivel !== undefined) {
    if (objetivo.rol !== 'admin') return NextResponse.json({ error: 'El nivel solo aplica a cuentas de administración.' }, { status: 400 });
    if (!esNivel(admin_nivel)) return NextResponse.json({ error: 'Nivel inválido.' }, { status: 400 });
    if (objetivo.id === user.id && admin_nivel !== 'principal') {
      return NextResponse.json({ error: 'No puedes quitarte a ti mismo el nivel principal.' }, { status: 400 });
    }
    db.prepare('UPDATE usuarios SET admin_nivel = ? WHERE id = ?').run(admin_nivel, id);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: 'cambiar_nivel', entidad: 'usuario', entidad_id: id,
      detalle: `Cambió el nivel de ${objetivo.nombre} de ${NIVEL_LABEL[normalizarNivel(objetivo.admin_nivel)]} a ${NIVEL_LABEL[admin_nivel]}`,
    });
    return NextResponse.json({ ok: true });
  }

  if (estado_cuenta) {
    if (objetivo.id === user.id && estado_cuenta === 'inactiva') {
      return NextResponse.json({ error: 'No puedes desactivar tu propia cuenta.' }, { status: 400 });
    }
    db.prepare('UPDATE usuarios SET estado_cuenta = ? WHERE id = ?').run(estado_cuenta, id);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: estado_cuenta === 'inactiva' ? 'desactivar_cuenta' : 'activar_cuenta', entidad: 'usuario', entidad_id: id,
      detalle: `${estado_cuenta === 'inactiva' ? 'Desactivó' : 'Activó'} a ${objetivo.nombre} (${objetivo.correo})`,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
}
