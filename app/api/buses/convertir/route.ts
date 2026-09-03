import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { registrarAuditoria, permisosDe } from '@/lib/permisos';
import {
  categoriaPorPasajeros, resetearTarifasBusACategoria,
  CAPACIDAD_MIN_PASAJEROS, CAPACIDAD_MAX_PASAJEROS,
} from '@/lib/busCotizador';

// POST /api/buses/convertir — convierte un vehículo YA registrado (carro normal) en bus,
// sin pedirle al propietario que vuelva a escribir marca/modelo/placa/año/ubicación desde
// cero (pedido explícito de Victor: "cuando le doy en bus me pide registro de nuevo").
// Reutiliza el mismo vehículo (misma fila de `vehiculos`, mismo id): solo cambia `tipo` a
// 'bus', pide la `capacidad_pasajeros` que le falta y copia las tarifas iniciales de su
// categoría — mismo criterio de "alta" que ya usa POST /api/buses para un bus nuevo.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (user.rol !== 'propietario' && user.rol !== 'admin')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const db = getDb();
  if (user.rol === 'admin' && !adminTieneArea(db, user.id, 'buses')) return sinPermisoArea();

  const body = await req.json().catch(() => ({}));
  const vehiculoIdNum = Number(body.vehiculoId);
  if (!vehiculoIdNum) {
    return NextResponse.json({ error: 'Falta vehiculoId.' }, { status: 400 });
  }

  // ── A partir de aquí, TODO es síncrono (better-sqlite3 no usa promesas): mismo blindaje
  // anti-carrera que ya usa PUT /api/buses/[id] — la lectura fresca del vehículo corre
  // DESPUÉS del único `await` de esta función (`await req.json()`, justo arriba), así que
  // no hay ninguna ventana para que otro request se interponga entre "leer el estado
  // vigente" y "escribir el nuevo". ──
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(vehiculoIdNum) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Ruta compartida: la usa el propietario dueño del vehículo Y el admin. Mismo criterio
  // "404 en vez de 403" que usa el resto del módulo de buses para no confirmarle a un
  // tercero que el id existe (ver GET /api/buses/[id]).
  const isAdmin = user.rol === 'admin';
  if (!isAdmin && Number(vehiculo.propietario_id) !== user.id) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }

  if (vehiculo.tipo === 'bus') {
    return NextResponse.json({ error: 'Este vehículo ya es un bus.' }, { status: 400 });
  }
  if (Number(vehiculo.archivado) === 1) {
    return NextResponse.json({ error: 'No se puede convertir un vehículo archivado.' }, { status: 400 });
  }

  // Chequeo de reservas activas/próximas como carro: a diferencia de GET /api/vehiculos/[id]
  // (que excluye solo 'cancelada' para calcular fechas ocupadas), acá se filtra
  // específicamente a los estados activos/próximos ('pendiente','confirmada','en_curso') —
  // un carro con historial de rentas ya 'completada' SÍ debe poder convertirse; lo que no se
  // permite es convertir un carro que un cliente tiene reservado ahora mismo o va a recoger
  // pronto, porque dejaría de existir como carro en pleno servicio.
  const reservaActiva = db.prepare(
    "SELECT id FROM reservas WHERE vehiculo_id = ? AND estado IN ('pendiente','confirmada','en_curso') LIMIT 1",
  ).get(vehiculoIdNum);
  if (reservaActiva) {
    return NextResponse.json(
      { error: 'Este vehículo tiene reservas activas o próximas como carro — no se puede convertir a bus mientras tanto.' },
      { status: 400 },
    );
  }

  const capacidad = Number(body.capacidad_pasajeros);
  if (!Number.isInteger(capacidad) || capacidad < CAPACIDAD_MIN_PASAJEROS || capacidad > CAPACIDAD_MAX_PASAJEROS) {
    return NextResponse.json(
      { error: `La capacidad de pasajeros debe ser un número entero entre ${CAPACIDAD_MIN_PASAJEROS} y ${CAPACIDAD_MAX_PASAJEROS}.` },
      { status: 400 },
    );
  }

  const categoria = categoriaPorPasajeros(capacidad);

  // Bus+tarifas en una sola transacción síncrona (mismo criterio que POST /api/buses y
  // PUT /api/buses/[id]): o queda todo convertido, o no queda nada. `disponible=0` fuerza
  // al propietario a revisar/activar el bus explícitamente después de ver sus tarifas
  // copiadas, igual que un bus nuevo. `precio_dia=0` porque los buses no se cotizan por
  // precio/día sino por las tarifas_veh (ver POST /api/buses). También se limpian
  // `valor_comercial`/`precio_ajuste_pct`/`precio_manual` (columnas del modelo de precio de
  // CARRO, ver lib/precioMercado.ts) para no dejar basura de su vida anterior como carro —
  // un bus no usa ninguno de esos campos.
  //
  // Deliberado: NO se tocan `fotos`/`fotos_detalle`/`documentos`/reservas históricas — es el
  // mismo vehículo (mismo id), solo cambia de tipo; ese historial se queda como estaba.
  const convertir = db.transaction(() => {
    db.prepare(`
      UPDATE vehiculos
      SET tipo = 'bus', capacidad_pasajeros = ?, bus_categoria = ?, disponible = 0,
          precio_dia = 0, valor_comercial = 0, precio_ajuste_pct = 0, precio_manual = 0
      WHERE id = ? AND propietario_id = ?
    `).run(capacidad, categoria, vehiculoIdNum, vehiculo.propietario_id);

    resetearTarifasBusACategoria(db, vehiculoIdNum, categoria);
  });

  try {
    convertir();
  } catch (e) {
    console.error('[buses] No se pudo convertir el vehículo a bus:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo convertir el vehículo a bus. Intenta de nuevo.' }, { status: 500 });
  }

  const nivelActor = isAdmin ? (permisosDe(db, user.id).nivel ?? undefined) : undefined;
  registrarAuditoria(db, { ...user, nivel: nivelActor }, {
    area: 'buses', accion: 'convertir_vehiculo_a_bus', entidad: 'vehiculo', entidad_id: vehiculoIdNum,
    detalle: `Convirtió ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} (${vehiculo.placa || 's/placa'}, era tipo '${vehiculo.tipo}') a bus — categoría ${categoria}, propietario #${vehiculo.propietario_id}`,
  });

  return NextResponse.json({ ok: true, bus_categoria: categoria });
}
