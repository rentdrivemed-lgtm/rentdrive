import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea } from '@/lib/guard';
import { registrarAuditoria, permisosDe } from '@/lib/permisos';
import { notificarUsuarios } from '@/lib/panel';
import { getConfig } from '@/lib/operaciones';
import { dentroDeBanda, adminsConAreaBuses, COL_DESTINO, type CategoriaBus } from '@/lib/busCotizador';

const TOLERANCIA_DEFECTO = 20; // mismo fallback que sembrarConfigBuses() en lib/db.ts

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  const vehiculoId = Number(new URL(req.url).searchParams.get('vehiculoId'));
  if (!vehiculoId) return NextResponse.json({ error: 'Falta vehiculoId' }, { status: 400 });

  const bus = db.prepare("SELECT id, propietario_id, bus_categoria FROM vehiculos WHERE id = ? AND tipo = 'bus'")
    .get(vehiculoId) as { id: number; propietario_id: number; bus_categoria: string | null } | undefined;
  if (!bus) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const esDueño = user.rol === 'propietario' && bus.propietario_id === user.id;
  const esAdminConPermiso = user.rol === 'admin' && adminTieneArea(db, user.id, 'buses');
  if (!esDueño && !esAdminConPermiso) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const destinos = db.prepare('SELECT * FROM bus_tarifas_destino_veh WHERE vehiculo_id = ? ORDER BY destino').all(vehiculoId);
  const hora = db.prepare('SELECT * FROM bus_tarifas_hora_veh WHERE vehiculo_id = ?').get(vehiculoId) ?? null;
  const km = db.prepare('SELECT * FROM bus_valor_km_veh WHERE vehiculo_id = ?').get(vehiculoId) ?? null;
  const cambios = db.prepare('SELECT * FROM bus_tarifas_cambios WHERE vehiculo_id = ? ORDER BY created_at DESC').all(vehiculoId);

  return NextResponse.json({ destinos, hora, km, cambios });
}

// PUT — el propietario dueño del bus (o un admin con la sección "buses") propone un cambio
// de tarifa. Corre la lógica de banda de aprobación (§4 del spec) y, según el resultado,
// aplica el cambio de inmediato o lo deja pendiente de revisión.
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  // ── A partir de aquí, TODO es síncrono (better-sqlite3 no usa promesas): lectura del
  // estado actual, decisión de la banda y escritura corren en un solo turno de Node, sin
  // ninguna ventana para que otro request se interponga entre "leer el valor vigente" y
  // "escribir el nuevo" — mismo blindaje anti-carrera que ya usa PUT /api/vehiculos/[id]
  // (ver los comentarios "Blindaje anti-carrera" ahí). Esto decide dinero (tarifas), así
  // que no hay ningún `await` después de este punto.
  const vehiculoId = Number(body.vehiculoId);
  const tipo = body.tipo;
  if (!vehiculoId || !['destino', 'hora', 'km'].includes(tipo)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  }

  const bus = db.prepare("SELECT id, propietario_id, bus_categoria, marca, modelo, placa FROM vehiculos WHERE id = ? AND tipo = 'bus'")
    .get(vehiculoId) as { id: number; propietario_id: number; bus_categoria: string | null; marca: string; modelo: string; placa?: string } | undefined;
  if (!bus) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const esDueño = user.rol === 'propietario' && bus.propietario_id === user.id;
  const esAdminConPermiso = user.rol === 'admin' && adminTieneArea(db, user.id, 'buses');
  if (!esDueño && !esAdminConPermiso) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const categoria = bus.bus_categoria as CategoriaBus | null;
  if (!categoria) {
    // No debería pasar nunca (bus_categoria se calcula siempre al crear el bus, ver
    // POST /api/buses) — fail-safe defensivo.
    return NextResponse.json({ error: 'Este bus no tiene una categoría asignada.' }, { status: 400 });
  }

  // Bug de fallback (hallazgo QA/revisor-código, ronda post-Etapa 2): `Number('')` da `0`,
  // que SÍ pasa `Number.isFinite`, así que un config ausente/vacío caía en tolerancia=0 en
  // vez de en TOLERANCIA_DEFECTO=20 como documenta este comentario. Se exige además una
  // cadena no vacía (tras trim) antes de intentar `Number(...)`.
  const toleranciaConfigRaw = getConfig(db, 'TOLERANCIA_TARIFA_BUS').trim();
  const toleranciaConfig = toleranciaConfigRaw === '' ? NaN : Number(toleranciaConfigRaw);
  const tolerancia = Number.isFinite(toleranciaConfig) ? toleranciaConfig : TOLERANCIA_DEFECTO;

  const valores = body.valores || {};
  let valorAnterior: Record<string, number>;
  let valorPropuesto: Record<string, number>;
  let valorReferencia = 0;
  let valorComparado = 0; // campo más representativo de cada tipo, usado contra la referencia
  let destinoNombre: string | null = null;

  if (tipo === 'destino') {
    // Mismo límite de largo que clienteNombre/destino de cotizar/route.ts (texto libre).
    destinoNombre = String(body.destino || '').trim().slice(0, 200);
    if (!destinoNombre) return NextResponse.json({ error: 'Falta el destino' }, { status: 400 });

    const tarifa_base = Number(valores.tarifa_base);
    const tarifa_30 = Number(valores.tarifa_30);
    if (!Number.isFinite(tarifa_base) || tarifa_base <= 0 || !Number.isFinite(tarifa_30) || tarifa_30 <= 0) {
      return NextResponse.json({ error: 'Valores de tarifa inválidos.' }, { status: 400 });
    }
    valorPropuesto = { tarifa_base, tarifa_30 };

    const actual = db.prepare('SELECT tarifa_base, tarifa_30 FROM bus_tarifas_destino_veh WHERE vehiculo_id = ? AND destino = ?')
      .get(vehiculoId, destinoNombre) as { tarifa_base: number; tarifa_30: number } | undefined;
    valorAnterior = actual ? { tarifa_base: actual.tarifa_base, tarifa_30: actual.tarifa_30 } : { tarifa_base: 0, tarifa_30: 0 };

    // Campo de comparación contra la referencia: `tarifa_base` (el "+30%" es un recargo
    // derivado manualmente por el propietario, no un precio independiente — comparar la
    // base es lo que evita que alguien infle el recargo mientras mantiene la base "sana").
    const col = COL_DESTINO[categoria];
    const ref = db.prepare(`SELECT ${col.base} AS valor FROM bus_tarifas_destino_ref WHERE destino = ?`)
      .get(destinoNombre) as { valor: number | null } | undefined;
    valorReferencia = ref?.valor ?? 0;
    valorComparado = tarifa_base;
  } else if (tipo === 'hora') {
    const tarifa_hora = Number(valores.tarifa_hora);
    const minimo_horas = Number(valores.minimo_horas);
    const hora_adicional = Number(valores.hora_adicional) || 0;
    if (!Number.isFinite(tarifa_hora) || tarifa_hora <= 0 || !Number.isFinite(minimo_horas) || minimo_horas <= 0 || hora_adicional < 0) {
      return NextResponse.json({ error: 'Valores de tarifa inválidos.' }, { status: 400 });
    }
    valorPropuesto = { tarifa_hora, minimo_horas, hora_adicional };

    const actual = db.prepare('SELECT tarifa_hora, minimo_horas, hora_adicional FROM bus_tarifas_hora_veh WHERE vehiculo_id = ?')
      .get(vehiculoId) as { tarifa_hora: number; minimo_horas: number; hora_adicional: number } | undefined;
    valorAnterior = actual ? { ...actual } : { tarifa_hora: 0, minimo_horas: 0, hora_adicional: 0 };

    const ref = db.prepare('SELECT tarifa_hora FROM bus_tarifas_hora_ref WHERE categoria = ?').get(categoria) as { tarifa_hora: number } | undefined;
    valorReferencia = ref?.tarifa_hora ?? 0;
    valorComparado = tarifa_hora;
  } else {
    const valor_km = Number(valores.valor_km);
    const tarifa_minima = Number(valores.tarifa_minima) || 0;
    if (!Number.isFinite(valor_km) || valor_km <= 0 || tarifa_minima < 0) {
      return NextResponse.json({ error: 'Valores de tarifa inválidos.' }, { status: 400 });
    }
    valorPropuesto = { valor_km, tarifa_minima };

    const actual = db.prepare('SELECT valor_km, tarifa_minima FROM bus_valor_km_veh WHERE vehiculo_id = ?')
      .get(vehiculoId) as { valor_km: number; tarifa_minima: number } | undefined;
    valorAnterior = actual ? { ...actual } : { valor_km: 0, tarifa_minima: 0 };

    const ref = db.prepare('SELECT valor_km FROM bus_valor_km_ref WHERE categoria = ?').get(categoria) as { valor_km: number } | undefined;
    valorReferencia = ref?.valor_km ?? 0;
    valorComparado = valor_km;
  }

  // dentroDeBanda ya trata `valorReferencia <= 0` (categoría/destino sin referencia
  // cargada todavía) como fuera de banda — fail-safe: sin nada contra qué comparar, el
  // cambio va a revisión manual en vez de auto-aprobarse a ciegas.
  const aprobado = dentroDeBanda(valorComparado, valorReferencia, tolerancia);
  const estado = aprobado ? 'auto_aprobada' : 'pendiente';

  // El INSERT de auditoría (bus_tarifas_cambios, con estado='auto_aprobada' cuando aplica) y
  // la aplicación real de la tarifa a bus_tarifas_*_veh quedan en una ÚNICA transacción
  // (hallazgo QA/revisor-código, ronda post-Etapa 2): antes eran dos `try/catch` separados, así
  // que si la segunda escritura fallaba, la primera quedaba confirmada igual — el log decía
  // "auto_aprobada" aunque la tarifa nunca se hubiera aplicado de verdad. Si algo falla, ninguna
  // de las dos queda confirmada.
  let cambioId: number;
  try {
    const registrarYAplicar = db.transaction(() => {
      const cambioResult = db.prepare(`
        INSERT INTO bus_tarifas_cambios
          (vehiculo_id, propietario_id, tipo, destino, categoria, valor_referencia, tolerancia_aplicada, valor_anterior, valor_propuesto, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        vehiculoId, bus.propietario_id, tipo, destinoNombre, categoria,
        valorReferencia > 0 ? valorReferencia : null, tolerancia,
        JSON.stringify(valorAnterior), JSON.stringify(valorPropuesto), estado,
      );
      const id = Number(cambioResult.lastInsertRowid);

      if (aprobado) {
        if (tipo === 'destino') {
          db.prepare(`
            INSERT INTO bus_tarifas_destino_veh (vehiculo_id, destino, tarifa_base, tarifa_30)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(vehiculo_id, destino) DO UPDATE SET
              tarifa_base = excluded.tarifa_base, tarifa_30 = excluded.tarifa_30, updated_at = datetime('now')
          `).run(vehiculoId, destinoNombre, valorPropuesto.tarifa_base, valorPropuesto.tarifa_30);
        } else if (tipo === 'hora') {
          db.prepare(`
            INSERT INTO bus_tarifas_hora_veh (vehiculo_id, tarifa_hora, minimo_horas, hora_adicional)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(vehiculo_id) DO UPDATE SET
              tarifa_hora = excluded.tarifa_hora, minimo_horas = excluded.minimo_horas, hora_adicional = excluded.hora_adicional
          `).run(vehiculoId, valorPropuesto.tarifa_hora, valorPropuesto.minimo_horas, valorPropuesto.hora_adicional);
        } else {
          db.prepare(`
            INSERT INTO bus_valor_km_veh (vehiculo_id, valor_km, tarifa_minima)
            VALUES (?, ?, ?)
            ON CONFLICT(vehiculo_id) DO UPDATE SET
              valor_km = excluded.valor_km, tarifa_minima = excluded.tarifa_minima
          `).run(vehiculoId, valorPropuesto.valor_km, valorPropuesto.tarifa_minima);
        }
      }

      return id;
    });
    cambioId = registrarYAplicar();
  } catch (e) {
    console.error('[buses/tarifas-vehiculo] no se pudo registrar/aplicar el cambio:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo registrar el cambio de tarifa. Intenta de nuevo.' }, { status: 500 });
  }
  const busLabel = `${bus.marca} ${bus.modelo}${bus.placa ? ` (${bus.placa})` : ''}`;

  if (aprobado) {
    const nivelActor = user.rol === 'admin' ? (permisosDe(db, user.id).nivel ?? undefined) : undefined;
    registrarAuditoria(db, { ...user, nivel: nivelActor }, {
      area: 'buses', accion: 'tarifa_auto_aprobada', entidad: 'bus_tarifas_cambios', entidad_id: cambioId,
      detalle: `${busLabel}: ${tipo}${destinoNombre ? ` (${destinoNombre})` : ''} → ${JSON.stringify(valorPropuesto)}`,
    });

    notificarUsuarios(db, adminsConAreaBuses(db), {
      tipo: 'tarifa_bus_auto_aprobada',
      titulo: '✅ Tarifa de bus auto-aprobada',
      mensaje: `${busLabel}: se ajustó ${tipo} dentro del rango permitido y ya está activa. Puedes revisarla o revertirla.`,
      referencia_id: cambioId, referencia_tipo: 'bus_tarifas_cambios',
    });
  } else {
    notificarUsuarios(db, adminsConAreaBuses(db), {
      tipo: 'tarifa_bus_pendiente',
      titulo: '🕓 Cambio de tarifa de bus pendiente de aprobación',
      mensaje: `${busLabel}: propuso un cambio de ${tipo} fuera del rango permitido. Mientras tanto sigue vigente la tarifa anterior.`,
      referencia_id: cambioId, referencia_tipo: 'bus_tarifas_cambios',
    });
  }

  return NextResponse.json({ aplicado: aprobado, cambioId });
}
