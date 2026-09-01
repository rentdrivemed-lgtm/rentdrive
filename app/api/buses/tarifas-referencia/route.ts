import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { BUS_CATEGORIAS, type CategoriaBus } from '@/lib/busCotizador';

function esCategoriaValida(v: unknown): v is CategoriaBus {
  return typeof v === 'string' && BUS_CATEGORIAS.some(c => c.codigo === v);
}

// Columnas del tarifario de referencia por destino (las 12 de la tabla del PDF, §1/§3 del
// spec). Se listan explícitas (en vez de interpolar) para el UPDATE/INSERT de abajo.
const CAMPOS_CATEGORIA = [
  'px12', 'px12_30', 'px14', 'px14_30', 'px16', 'px16_30',
  'px19', 'px19_30', 'px22_25', 'px22_25_30', 'px30_42', 'px30_42_30',
] as const;

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// GET/PUT — solo admin con la sección "buses" (tarifario de referencia = punto de partida
// y banda de comparación de TODOS los buses, no algo que un propietario deba poder tocar).
export async function GET() {
  const g = await guardArea('buses');
  if ('error' in g) return g.error;
  const { db } = g;

  const destinos = db.prepare('SELECT * FROM bus_tarifas_destino_ref ORDER BY destino').all();
  const horas = db.prepare('SELECT * FROM bus_tarifas_hora_ref').all();
  const km = db.prepare('SELECT * FROM bus_valor_km_ref').all();

  return NextResponse.json({ destinos, horas, km });
}

export async function PUT(req: NextRequest) {
  const g = await guardArea('buses');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const tipo = body.tipo;

  if (tipo === 'destino') {
    const destino = String(body.destino || '').trim();
    if (!destino) return NextResponse.json({ error: 'Falta el destino' }, { status: 400 });

    const valores = CAMPOS_CATEGORIA.map(c => numOrNull(body[c]));
    const km = numOrNull(body.km);
    // Mismo límite de largo que clienteNombre/destino en cotizar/route.ts (texto libre).
    const observaciones = String(body.observaciones || '').slice(0, 200);
    const activo = body.activo === undefined ? 1 : (Number(body.activo) ? 1 : 0);

    // Upsert por `destino` (columna UNIQUE): si ya existe una fila con ese destino se
    // actualiza, si no se crea. Se usa el nombre del destino como llave natural (más simple
    // y menos propenso a error que exigir un `id` que el cliente deba llevar de un lado a
    // otro) — mismo criterio que sugiere el spec.
    try {
      db.prepare(`
        INSERT INTO bus_tarifas_destino_ref
          (destino, km, ${CAMPOS_CATEGORIA.join(', ')}, observaciones, activo)
        VALUES (?, ?, ${CAMPOS_CATEGORIA.map(() => '?').join(', ')}, ?, ?)
        ON CONFLICT(destino) DO UPDATE SET
          km = excluded.km,
          ${CAMPOS_CATEGORIA.map(c => `${c} = excluded.${c}`).join(', ')},
          observaciones = excluded.observaciones,
          activo = excluded.activo,
          updated_at = datetime('now')
      `).run(destino, km, ...valores, observaciones, activo);
    } catch (e) {
      console.error('[buses/tarifas-referencia] no se pudo guardar destino:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'No se pudo guardar el destino. Intenta de nuevo.' }, { status: 500 });
    }

    const fila = db.prepare('SELECT * FROM bus_tarifas_destino_ref WHERE destino = ?').get(destino) as { id: number } | undefined;

    registrarAuditoria(db, { ...user, nivel }, {
      area: 'buses', accion: 'editar_tarifario_referencia', entidad: 'bus_tarifas_destino_ref', entidad_id: fila?.id ?? null,
      detalle: `Destino "${destino}" del tarifario de referencia`,
    });

    return NextResponse.json({ ok: true, fila });
  }

  if (tipo === 'hora' || tipo === 'km') {
    const categoria = body.categoria;
    if (!esCategoriaValida(categoria)) {
      return NextResponse.json({ error: 'Categoría inválida' }, { status: 400 });
    }

    if (tipo === 'hora') {
      const tarifa_hora = Number(body.tarifa_hora) || 0;
      const minimo_horas = Number(body.minimo_horas) || 0;
      const hora_adicional = Number(body.hora_adicional) || 0;
      if (tarifa_hora < 0 || minimo_horas < 0 || hora_adicional < 0) {
        return NextResponse.json({ error: 'Los valores no pueden ser negativos.' }, { status: 400 });
      }

      // Try/catch consistente con la rama 'destino' de arriba (hallazgo QA/revisor-código,
      // ronda post-Etapa 2: esta rama y la de 'km' no atrapaban un fallo del INSERT/ON CONFLICT).
      try {
        db.prepare(`
          INSERT INTO bus_tarifas_hora_ref (categoria, tarifa_hora, minimo_horas, hora_adicional)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(categoria) DO UPDATE SET
            tarifa_hora = excluded.tarifa_hora, minimo_horas = excluded.minimo_horas, hora_adicional = excluded.hora_adicional
        `).run(categoria, tarifa_hora, minimo_horas, hora_adicional);
      } catch (e) {
        console.error('[buses/tarifas-referencia] no se pudo guardar tarifa por hora:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'No se pudo guardar la tarifa por hora. Intenta de nuevo.' }, { status: 500 });
      }

      registrarAuditoria(db, { ...user, nivel }, {
        area: 'buses', accion: 'editar_tarifario_referencia', entidad: 'bus_tarifas_hora_ref', entidad_id: null,
        detalle: `Tarifa por hora de referencia (${categoria}): $${tarifa_hora}/h, mínimo ${minimo_horas}h`,
      });
    } else {
      const valor_km = Number(body.valor_km) || 0;
      const tarifa_minima = Number(body.tarifa_minima) || 0;
      if (valor_km < 0 || tarifa_minima < 0) {
        return NextResponse.json({ error: 'Los valores no pueden ser negativos.' }, { status: 400 });
      }

      try {
        db.prepare(`
          INSERT INTO bus_valor_km_ref (categoria, valor_km, tarifa_minima, calculado_de_tarifario)
          VALUES (?, ?, ?, 0)
          ON CONFLICT(categoria) DO UPDATE SET
            valor_km = excluded.valor_km, tarifa_minima = excluded.tarifa_minima, calculado_de_tarifario = 0
        `).run(categoria, valor_km, tarifa_minima);
      } catch (e) {
        console.error('[buses/tarifas-referencia] no se pudo guardar valor por km:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'No se pudo guardar el valor por km. Intenta de nuevo.' }, { status: 500 });
      }

      registrarAuditoria(db, { ...user, nivel }, {
        area: 'buses', accion: 'editar_tarifario_referencia', entidad: 'bus_valor_km_ref', entidad_id: null,
        detalle: `Valor por km de referencia (${categoria}): $${valor_km}/km, mínimo $${tarifa_minima}`,
      });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Tipo inválido (debe ser destino, hora o km).' }, { status: 400 });
}
