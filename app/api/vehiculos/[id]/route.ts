import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const DOC_KEYS = ['soat', 'tecno', 'tarjeta', 'todo_riesgo'] as const;
const DOC_LABELS: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad', todo_riesgo: 'Seguro todo riesgo',
};

type DocRevision = { estado: string; nota: string };
type VehicleRow = { documentos: string; documentos_revisiones: string; propietario_id: number; marca: string; modelo: string; anio: number; placa?: string };

function computeEstado(docs: Record<string, { url?: string } | undefined>, revs: Record<string, DocRevision>): string {
  const uploaded = DOC_KEYS.filter(k => (docs[k] as { url?: string } | undefined)?.url);
  if (uploaded.length === 0) return 'sin_documentos';
  if (uploaded.some(k => revs[k]?.estado === 'denegado')) return 'denegado';
  if (uploaded.every(k => revs[k]?.estado === 'aprobado')) return 'aprobado';
  return 'en_revision';
}

/** Expande un rango 'YYYY-MM-DD'..'YYYY-MM-DD' (inclusive) en días, en hora local (sin desfase UTC). */
function* rangoDias(a: string, b: string): Generator<string> {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  if (!ay || !by) return;
  const cur = new Date(ay, am - 1, ad);
  const end = new Date(by, bm - 1, bd);
  while (cur <= end) {
    yield `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    cur.setDate(cur.getDate() + 1);
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const vehiculo = db.prepare(`
    SELECT v.*, u.nombre as propietario_nombre
    FROM vehiculos v JOIN usuarios u ON v.propietario_id = u.id
    WHERE v.id = ?
  `).get(Number(id));

  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Fechas ya ocupadas por reservas activas (rango inclusivo, igual que la verificación de conflictos del POST).
  const reservas = db.prepare(
    `SELECT fecha_inicio, fecha_fin FROM reservas WHERE vehiculo_id = ? AND estado NOT IN ('cancelada')`
  ).all(Number(id)) as { fecha_inicio: string; fecha_fin: string }[];

  const ocupadasSet = new Set<string>();
  for (const r of reservas) {
    for (const d of rangoDias(r.fecha_inicio, r.fecha_fin)) ocupadasSet.add(d);
  }

  return NextResponse.json({ vehiculo, ocupadas: [...ocupadasSet] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(Number(id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  if (user.rol !== 'admin' && Number(vehiculo.propietario_id) !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const body = await req.json();
  const isAdmin = user.rol === 'admin';

  // ── Admin: review individual document ──
  if (isAdmin && body.revisar_documento) {
    const { key, estado, nota } = body.revisar_documento as { key: string; estado: string; nota: string };

    const row = db.prepare('SELECT documentos, documentos_revisiones, propietario_id, marca, modelo, anio, placa FROM vehiculos WHERE id = ?').get(Number(id)) as VehicleRow | undefined;
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    let docs: Record<string, { url?: string } | undefined> = {};
    let revs: Record<string, DocRevision> = {};
    try { docs = JSON.parse(row.documentos || '{}'); } catch { /* */ }
    try { revs = JSON.parse(row.documentos_revisiones || '{}'); } catch { /* */ }

    revs[key] = { estado, nota: nota || '' };
    const newEstado = computeEstado(docs, revs);
    const newNota = DOC_KEYS
      .filter(k => revs[k]?.estado === 'denegado')
      .map(k => `${DOC_LABELS[k]}: ${revs[k]?.nota || 'Sin motivo'}`)
      .join('\n');

    db.prepare('UPDATE vehiculos SET documentos_revisiones = ?, documentos_estado = ?, documentos_nota = ? WHERE id = ?')
      .run(JSON.stringify(revs), newEstado, newNota, Number(id));

    if (estado === 'aprobado' || estado === 'denegado') {
      const vLabel = `${row.marca} ${row.modelo} ${row.anio}`;
      const docLabel = DOC_LABELS[key] || key;
      const titulo = estado === 'aprobado' ? '✅ Documento aprobado' : '❌ Documento rechazado';
      const mensaje = estado === 'aprobado'
        ? `Tu documento "${docLabel}" para ${vLabel} fue aprobado.`
        : `Tu documento "${docLabel}" para ${vLabel} fue rechazado.${nota ? ` Motivo: ${nota}` : ''}`;
      db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.propietario_id, `documento_${estado}`, titulo, mensaje, Number(id), 'vehiculo');
    }

    return NextResponse.json({ ok: true, documentos_estado: newEstado, documentos_nota: newNota, documentos_revisiones: JSON.stringify(revs) });
  }

  // Reglas de disponibilidad (ver lib/disponibilidad-reglas.ts): el propietario
  // las ve siempre en el panel de su calendario, pero NO se bloquean acá.
  // El calendario se guarda clic por clic — un propietario que recién empieza a
  // abrir un mes nuevo (ej. un solo día en septiembre) fallaría la regla semanal
  // de ESE mes hasta terminar de marcarlo, así que bloquear cada guardado
  // intermedio le impediría completar su propio calendario. Quedan como guía
  // visible, no como bloqueo duro.

  // ── Standard field update ──
  const ownFields = ['marca', 'modelo', 'anio', 'tipo', 'ubicacion', 'precio_dia', 'descripcion',
    'disponible', 'dias_disponibles', 'fotos_detalle', 'fotos', 'placa', 'documentos'];
  const adminOnlyFields = ['documentos_estado', 'documentos_nota', 'en_vitrina'];
  const allowed = isAdmin ? [...ownFields, ...adminOnlyFields] : ownFields;

  const pairs: string[] = [];
  const values: unknown[] = [];
  for (const f of allowed) {
    if (body[f] !== undefined) {
      pairs.push(`${f} = ?`);
      values.push(body[f]);
    }
  }

  if (!isAdmin && body.documentos !== undefined) {
    pairs.push('documentos_estado = ?'); values.push('en_revision');
    pairs.push('documentos_nota = ?');   values.push('');
    pairs.push('documentos_revisiones = ?'); values.push('{}');

    const adminRow = db.prepare("SELECT id FROM usuarios WHERE rol='admin' LIMIT 1").get() as { id: number } | undefined;
    if (adminRow) {
      const vRow = db.prepare('SELECT marca, modelo, anio, placa FROM vehiculos WHERE id = ?').get(Number(id)) as { marca: string; modelo: string; anio: number; placa?: string } | undefined;
      const vLabel = vRow
        ? `${vRow.marca} ${vRow.modelo} ${vRow.anio}${vRow.placa ? ` (${vRow.placa})` : ''}`
        : `Vehículo #${id}`;
      db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(adminRow.id, 'documentos_subidos', '📄 Documentos pendientes de revisión',
          `${user.nombre} subió documentos para ${vLabel}`, Number(id), 'vehiculo');
    }
  }

  if (pairs.length > 0) {
    db.prepare(`UPDATE vehiculos SET ${pairs.join(', ')} WHERE id = ?`).run(...values, Number(id));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(Number(id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  if (user.rol !== 'admin' && Number(vehiculo.propietario_id) !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  db.prepare('DELETE FROM vehiculos WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}
