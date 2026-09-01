import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';

const ESTADOS_VALIDOS = ['nueva', 'contactada', 'confirmada', 'descartada'];

// GET — admin con la sección "buses" ve todas las cotizaciones; un propietario ve solo
// las de sus propios buses.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  const estado = new URL(req.url).searchParams.get('estado');

  let propietarioFiltro: number | null = null;
  if (user.rol === 'admin') {
    if (!adminTieneArea(db, user.id, 'buses')) return sinPermisoArea();
  } else if (user.rol === 'propietario') {
    propietarioFiltro = user.id;
  } else {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  let query = `
    SELECT c.*, v.marca, v.modelo, v.placa, v.propietario_id
    FROM cotizaciones_bus c
    JOIN vehiculos v ON c.vehiculo_id = v.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (propietarioFiltro) { query += ' AND v.propietario_id = ?'; params.push(propietarioFiltro); }
  if (estado) { query += ' AND c.estado = ?'; params.push(estado); }
  query += ' ORDER BY c.created_at DESC';

  const cotizaciones = db.prepare(query).all(...params);
  return NextResponse.json({ cotizaciones });
}

// PUT — marcar el estado comercial de una cotización (contactada/confirmada/descartada),
// mismo espíritu que otras colas de seguimiento del proyecto (SoportePanel / leads).
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  const id = Number(body.id);
  const estado = body.estado;
  if (!id || !ESTADOS_VALIDOS.includes(estado)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  }

  const cot = db.prepare(`
    SELECT c.id, v.propietario_id FROM cotizaciones_bus c JOIN vehiculos v ON c.vehiculo_id = v.id WHERE c.id = ?
  `).get(id) as { id: number; propietario_id: number } | undefined;
  if (!cot) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const esDueño = user.rol === 'propietario' && cot.propietario_id === user.id;
  const esAdminConPermiso = user.rol === 'admin' && adminTieneArea(db, user.id, 'buses');
  if (!esDueño && !esAdminConPermiso) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  db.prepare('UPDATE cotizaciones_bus SET estado = ? WHERE id = ?').run(estado, id);
  return NextResponse.json({ ok: true });
}
