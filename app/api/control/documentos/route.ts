import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { esSocio, registrarAuditoria } from '@/lib/permisos';
import { uploadFile } from '@/lib/storage';
import { notificarEquipo } from '@/lib/panel';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VISIBILIDADES = ['socios', 'socios_secretaria', 'todos'];

function tipoDeContentType(ct: string): string {
  if (ct === 'application/pdf') return 'pdf';
  if (ct.startsWith('image/')) return 'img';
  if (ct.includes('sheet') || ct.includes('excel') || ct.includes('csv')) return 'xls';
  return 'otro';
}

// GET — documentos visibles para el nivel del usuario.
export async function GET() {
  const g = await guardArea('documentos');
  if ('error' in g) return g.error;
  const { db, nivel } = g;

  // La secretaría no ve los documentos marcados "solo socios".
  const filtro = esSocio(nivel) ? '' : "AND visible_para != 'socios'";
  const documentos = db.prepare(
    `SELECT * FROM documentos_equipo WHERE estado = 'activo' ${filtro} ORDER BY updated_at DESC, id DESC`
  ).all();
  return NextResponse.json({ documentos });
}

// POST — subir documento (archivo o link).
export async function POST(req: NextRequest) {
  const g = await guardArea('documentos');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const form = await req.formData();
  const nombre = String(form.get('nombre') || '').trim();
  let visible_para = String(form.get('visible_para') || 'todos');
  if (!VISIBILIDADES.includes(visible_para)) visible_para = 'todos';
  // La secretaría no puede crear documentos reservados a socios.
  if (visible_para === 'socios' && !esSocio(nivel)) visible_para = 'socios_secretaria';

  const link = String(form.get('link') || '').trim();
  const file = form.get('file') as File | null;

  let archivo_url = '';
  let tipo = 'otro';

  if (file && file.size > 0) {
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'Máximo 20 MB por archivo.' }, { status: 400 });
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const base = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const up = await uploadFile(`${base}.${ext}`, file.type || 'application/octet-stream', await file.arrayBuffer());
      archivo_url = up.url;
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo subir el archivo.' }, { status: 500 });
    }
    tipo = tipoDeContentType(file.type || '');
  } else if (link) {
    archivo_url = link;
    tipo = 'link';
  } else {
    return NextResponse.json({ error: 'Sube un archivo o pega un enlace.' }, { status: 400 });
  }

  const nombreFinal = nombre || (file ? file.name : 'Documento');
  const info = db.prepare(
    `INSERT INTO documentos_equipo (nombre, archivo_url, tipo, visible_para, subido_por, subido_por_nombre)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(nombreFinal, archivo_url, tipo, visible_para, user.id, user.nombre || '');
  const id = Number(info.lastInsertRowid);

  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'documentos', accion: 'subir_documento', entidad: 'documento', entidad_id: id, detalle: `Subió "${nombreFinal}" (${visible_para})`,
  });
  notificarEquipo(db, { tipo: 'documento_nuevo', titulo: 'Nuevo documento', mensaje: nombreFinal, excepto: user.id, soloSocios: visible_para === 'socios', referencia_id: id, referencia_tipo: 'documento' });

  const documento = db.prepare('SELECT * FROM documentos_equipo WHERE id = ?').get(id);
  return NextResponse.json({ ok: true, documento });
}

// PUT — editar nombre / visibilidad.
export async function PUT(req: NextRequest) {
  const g = await guardArea('documentos');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const doc = db.prepare('SELECT * FROM documentos_equipo WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
  if (doc.visible_para === 'socios' && !esSocio(nivel)) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.nombre === 'string' && body.nombre.trim()) { sets.push('nombre = ?'); vals.push(body.nombre.trim()); }
  if (VISIBILIDADES.includes(body.visible_para)) {
    let v = body.visible_para;
    if (v === 'socios' && !esSocio(nivel)) v = 'socios_secretaria';
    sets.push('visible_para = ?'); vals.push(v);
  }
  if (!sets.length) return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });
  sets.push("updated_at = datetime('now','localtime')");
  db.prepare(`UPDATE documentos_equipo SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'documentos', accion: 'editar_documento', entidad: 'documento', entidad_id: id, detalle: `Editó "${doc.nombre}"`,
  });
  const documento = db.prepare('SELECT * FROM documentos_equipo WHERE id = ?').get(id);
  return NextResponse.json({ ok: true, documento });
}

// PATCH — registrar apertura de un documento (auditoría: quién lo abrió).
export async function PATCH(req: NextRequest) {
  const g = await guardArea('documentos');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const doc = db.prepare('SELECT nombre, visible_para FROM documentos_equipo WHERE id = ?').get(id) as { nombre: string; visible_para: string } | undefined;
  if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
  if (doc.visible_para === 'socios' && !esSocio(nivel)) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'documentos', accion: 'abrir_documento', entidad: 'documento', entidad_id: id, detalle: `Abrió "${doc.nombre}"`,
  });
  return NextResponse.json({ ok: true });
}

// DELETE ?id= — archivar (soft delete) documento.
export async function DELETE(req: NextRequest) {
  const g = await guardArea('documentos');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const id = Number(new URL(req.url).searchParams.get('id'));
  const doc = db.prepare('SELECT nombre, visible_para FROM documentos_equipo WHERE id = ?').get(id) as { nombre: string; visible_para: string } | undefined;
  if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
  if (doc.visible_para === 'socios' && !esSocio(nivel)) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });
  db.prepare("UPDATE documentos_equipo SET estado = 'archivado', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'documentos', accion: 'eliminar_documento', entidad: 'documento', entidad_id: id, detalle: `Archivó "${doc.nombre}"`,
  });
  return NextResponse.json({ ok: true });
}
