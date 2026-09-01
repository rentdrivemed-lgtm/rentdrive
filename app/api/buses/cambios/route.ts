import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { notificarUsuarios } from '@/lib/panel';

type CambioRow = {
  id: number; vehiculo_id: number; propietario_id: number; tipo: string; destino: string | null;
  categoria: string; valor_propuesto: string; estado: string;
};

// GET/PUT — cola de aprobación de cambios de tarifa (§4 del spec). Solo admin con la
// sección "buses": es la única entrada de decisión sobre dinero (tarifas visibles al
// cliente) fuera del auto-aprobado por banda.
export async function GET(req: NextRequest) {
  const g = await guardArea('buses');
  if ('error' in g) return g.error;
  const { db } = g;

  const estado = new URL(req.url).searchParams.get('estado');

  let query = `
    SELECT c.*, v.marca, v.modelo, v.placa, u.nombre AS propietario_nombre
    FROM bus_tarifas_cambios c
    JOIN vehiculos v ON c.vehiculo_id = v.id
    JOIN usuarios u ON c.propietario_id = u.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (estado) { query += ' AND c.estado = ?'; params.push(estado); }
  query += ' ORDER BY c.created_at DESC';

  const cambios = db.prepare(query).all(...params);
  return NextResponse.json({ cambios });
}

export async function PUT(req: NextRequest) {
  const g = await guardArea('buses');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const cambioId = Number(body.cambioId);
  const accion = body.accion;
  if (!cambioId || !['aprobar', 'rechazar'].includes(accion)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  }

  const cambio = db.prepare('SELECT * FROM bus_tarifas_cambios WHERE id = ?').get(cambioId) as CambioRow | undefined;
  if (!cambio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  if (cambio.estado !== 'pendiente') {
    return NextResponse.json({ error: 'Este cambio ya fue resuelto.' }, { status: 400 });
  }

  const bus = db.prepare('SELECT marca, modelo, placa FROM vehiculos WHERE id = ?')
    .get(cambio.vehiculo_id) as { marca: string; modelo: string; placa?: string } | undefined;
  const busLabel = bus ? `${bus.marca} ${bus.modelo}${bus.placa ? ` (${bus.placa})` : ''}` : `bus #${cambio.vehiculo_id}`;

  if (accion === 'aprobar') {
    let valorPropuesto: Record<string, number> = {};
    try { valorPropuesto = JSON.parse(cambio.valor_propuesto); } catch { valorPropuesto = {}; }

    try {
      if (cambio.tipo === 'destino') {
        db.prepare(`
          INSERT INTO bus_tarifas_destino_veh (vehiculo_id, destino, tarifa_base, tarifa_30)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(vehiculo_id, destino) DO UPDATE SET
            tarifa_base = excluded.tarifa_base, tarifa_30 = excluded.tarifa_30, updated_at = datetime('now')
        `).run(cambio.vehiculo_id, cambio.destino, valorPropuesto.tarifa_base, valorPropuesto.tarifa_30);
      } else if (cambio.tipo === 'hora') {
        db.prepare(`
          INSERT INTO bus_tarifas_hora_veh (vehiculo_id, tarifa_hora, minimo_horas, hora_adicional)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(vehiculo_id) DO UPDATE SET
            tarifa_hora = excluded.tarifa_hora, minimo_horas = excluded.minimo_horas, hora_adicional = excluded.hora_adicional
        `).run(cambio.vehiculo_id, valorPropuesto.tarifa_hora, valorPropuesto.minimo_horas, valorPropuesto.hora_adicional ?? 0);
      } else if (cambio.tipo === 'km') {
        db.prepare(`
          INSERT INTO bus_valor_km_veh (vehiculo_id, valor_km, tarifa_minima)
          VALUES (?, ?, ?)
          ON CONFLICT(vehiculo_id) DO UPDATE SET
            valor_km = excluded.valor_km, tarifa_minima = excluded.tarifa_minima
        `).run(cambio.vehiculo_id, valorPropuesto.valor_km, valorPropuesto.tarifa_minima ?? 0);
      } else {
        return NextResponse.json({ error: 'Tipo de cambio desconocido.' }, { status: 400 });
      }

      db.prepare(`UPDATE bus_tarifas_cambios SET estado = 'aprobada', revisado_por = ?, revisado_en = datetime('now') WHERE id = ?`)
        .run(user.id, cambioId);
    } catch (e) {
      console.error('[buses/cambios] no se pudo aprobar:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'No se pudo aprobar el cambio. Intenta de nuevo.' }, { status: 500 });
    }

    registrarAuditoria(db, { ...user, nivel }, {
      area: 'buses', accion: 'aprobar_tarifa_bus', entidad: 'bus_tarifas_cambios', entidad_id: cambioId,
      detalle: `Aprobó cambio de ${cambio.tipo} para ${busLabel}`,
    });

    notificarUsuarios(db, [cambio.propietario_id], {
      tipo: 'tarifa_bus_aprobada', titulo: '✅ Tu cambio de tarifa fue aprobado',
      mensaje: `${busLabel}: tu ajuste de ${cambio.tipo} ya está activo para tus clientes.`,
      referencia_id: cambioId, referencia_tipo: 'bus_tarifas_cambios',
    });

    return NextResponse.json({ ok: true });
  }

  // rechazar — NO toca la tarifa vigente.
  const motivo = String(body.motivo || '').trim().slice(0, 500);
  try {
    db.prepare(`UPDATE bus_tarifas_cambios SET estado = 'rechazada', motivo_admin = ?, revisado_por = ?, revisado_en = datetime('now') WHERE id = ?`)
      .run(motivo, user.id, cambioId);
  } catch (e) {
    console.error('[buses/cambios] no se pudo rechazar:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo rechazar el cambio. Intenta de nuevo.' }, { status: 500 });
  }

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'buses', accion: 'rechazar_tarifa_bus', entidad: 'bus_tarifas_cambios', entidad_id: cambioId,
    detalle: `Rechazó cambio de ${cambio.tipo} para ${busLabel}${motivo ? `: ${motivo}` : ''}`,
  });

  notificarUsuarios(db, [cambio.propietario_id], {
    tipo: 'tarifa_bus_rechazada', titulo: '❌ Tu cambio de tarifa fue rechazado',
    mensaje: `${busLabel}: tu ajuste de ${cambio.tipo} fue rechazado.${motivo ? ` Motivo: ${motivo}` : ''} Tu tarifa anterior sigue vigente.`,
    referencia_id: cambioId, referencia_tipo: 'bus_tarifas_cambios',
  });

  return NextResponse.json({ ok: true });
}
