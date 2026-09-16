import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { registrarAuditoria, permisosDe } from '@/lib/permisos';
import {
  categoriaPorPasajeros, anioBusValido, resetearTarifasBusACategoria,
  CAPACIDAD_MIN_PASAJEROS, CAPACIDAD_MAX_PASAJEROS,
} from '@/lib/busCotizador';
import { filtrarVehiculos } from '@/lib/vehiculo-publico';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const categoriaParam = searchParams.get('categoria');
  const pasajerosParam = searchParams.get('pasajeros');
  const propietarioId = searchParams.get('propietarioId');
  // Mismo query param que ya usa GET /api/vehiculos (ver app/dashboard/admin/page.tsx):
  // distingue "el admin está en su panel de gestión" de "el admin navega la vitrina pública
  // como cualquier visitante".
  const panelAdmin = searchParams.get('panelAdmin') === '1';

  // Si no viene `categoria` explícita pero sí `pasajeros`, se sugiere la categoría acorde
  // a la cantidad de pasajeros solicitada (§7.1 del spec) y se filtra por esa.
  const categoria = categoriaParam || (pasajerosParam ? categoriaPorPasajeros(Number(pasajerosParam)) : null);

  // Sesión + permiso de área, resueltos una sola vez: deciden qué buses se listan (abajo) y
  // qué campos sensibles pueden salir en la respuesta (un bus es una fila de `vehiculos`,
  // así que arrastra los mismos `documentos` del propietario — ver lib/vehiculo-publico.ts).
  const sesion = await getCurrentUser();
  const esAdminConPermiso = !!sesion && sesion.rol === 'admin' && adminTieneArea(db, sesion.id, 'buses');

  let query = `
    SELECT v.*, u.nombre as propietario_nombre
    FROM vehiculos v
    JOIN usuarios u ON v.propietario_id = u.id
    WHERE v.tipo = 'bus' AND v.archivado = 0
  `;
  const params: unknown[] = [];

  if (categoria) { query += ' AND v.bus_categoria = ?'; params.push(categoria); }

  if (propietarioId) {
    query += ' AND v.propietario_id = ?';
    params.push(Number(propietarioId));

    // Mismo criterio que GET /api/vehiculos: el propio dueño (o un admin con la sección
    // "buses") ve TODOS sus buses, incluidos los no disponibles o en revisión de contenido.
    // Cualquier otro visitante solo ve lo mismo que ve la vitrina pública.
    const esDueño = !!sesion && sesion.id === Number(propietarioId);
    const puedeVerTodos = esDueño || esAdminConPermiso;
    if (!puedeVerTodos) query += ' AND v.disponible = 1 AND v.contenido_revision = 0';
  } else {
    // Listado principal sin propietarioId: público, salvo que sea el admin con la sección
    // "buses" navegando SU panel de administración (panelAdmin=1) — ahí sí ve los buses
    // pendientes de aprobación (disponible=0), igual que ya hace GET /api/vehiculos.
    if (panelAdmin && esAdminConPermiso) {
      query += ' AND v.contenido_revision = 0';
    } else {
      query += ' AND v.disponible = 1 AND v.contenido_revision = 0';
    }
  }

  const buses = db.prepare(query).all(...params) as Record<string, unknown>[];
  // Igual que GET /api/vehiculos: los campos privados del propietario solo salen para el
  // dueño de CADA bus o para el admin con la sección "buses".
  const ctx = { usuarioId: sesion?.id ?? null, esAdminConPermiso };
  return NextResponse.json({ buses: filtrarVehiculos(buses, ctx) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (user.rol !== 'propietario' && user.rol !== 'admin')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const db = getDb();
  if (user.rol === 'admin' && !adminTieneArea(db, user.id, 'buses')) return sinPermisoArea();

  const body = await req.json().catch(() => ({}));
  const { marca, modelo, anio, placa, capacidad_pasajeros, ubicacion, descripcion, propietario_id } = body;

  // Un propietario solo puede registrar buses a su propio nombre; un admin con la sección
  // "buses" puede registrarlo a nombre de un propietario real (mismo espíritu que otras
  // altas administrativas del proyecto — ver lib/panel.ts miembrosEquipo/objetivo por id).
  let propietarioId: number;
  if (user.rol === 'propietario') {
    propietarioId = user.id;
  } else {
    const pid = Number(propietario_id);
    if (!pid) return NextResponse.json({ error: 'Falta propietario_id' }, { status: 400 });
    const propietario = db.prepare("SELECT id FROM usuarios WHERE id = ? AND rol = 'propietario'").get(pid) as { id: number } | undefined;
    if (!propietario) return NextResponse.json({ error: 'El propietario indicado no existe.' }, { status: 400 });
    propietarioId = propietario.id;
  }

  if (!marca || !modelo || !placa) {
    return NextResponse.json({ error: 'Faltan datos requeridos (marca, modelo, año, placa).' }, { status: 400 });
  }

  // Validación estricta de `anio` (hallazgo QA/revisor-código, ronda post-Etapa 2): antes
  // era solo `Number(anio) > 0`, más débil que PUT /api/vehiculos/[id] (dejaba pasar strings
  // como "0x7e8" que `Number()` sí parsea). Ver lib/busCotizador.ts (anioBusValido).
  const anioNum = anioBusValido(anio);
  if (anioNum === null) {
    return NextResponse.json({ error: 'Año de bus inválido.' }, { status: 400 });
  }

  const capacidad = Number(capacidad_pasajeros);
  if (!Number.isInteger(capacidad) || capacidad < CAPACIDAD_MIN_PASAJEROS || capacidad > CAPACIDAD_MAX_PASAJEROS) {
    return NextResponse.json(
      { error: `La capacidad de pasajeros debe ser un número entero entre ${CAPACIDAD_MIN_PASAJEROS} y ${CAPACIDAD_MAX_PASAJEROS}.` },
      { status: 400 },
    );
  }

  // Filtro de lenguaje inapropiado en la descripción (texto libre público) — mismo criterio
  // que POST /api/vehiculos: se rechaza el request completo con un mensaje claro en vez de
  // mandarlo a revisión manual silenciosa (hallazgo QA/revisor-código, ronda post-Etapa 2:
  // este endpoint no aplicaba el filtro que ya usa el resto del proyecto).
  // ELIMINADO (16-sep-2026, decisión del dueño): el filtro rechazaba descripciones
  // legítimas — "cono" estaba en la lista para atrapar "coño" (la normalización quita
  // la tilde de la ñ) y un vehículo lleva CONOS de seguridad en el kit de carretera;
  // "hp" estaba por el insulto y también son los caballos de fuerza. Se le ofreció
  // quitar solo las ambiguas o marcar para revisión sin bloquear, y eligió eliminarlo.

  const categoria = categoriaPorPasajeros(capacidad);
  const placaNorm = (placa || '').toString().toUpperCase().trim();

  // Todo (bus + copia de las 3 tarifas iniciales desde la referencia) en una sola
  // transacción: o queda todo creado, o no queda nada (evita un bus a medio configurar
  // si algo falla a mitad de camino). La copia de tarifas (§2 y §6 del spec) vive en
  // `resetearTarifasBusACategoria` (lib/busCotizador.ts), compartida con PUT /api/buses/[id]
  // (que la reutiliza cuando `capacidad_pasajeros` cambia de categoría) — ver ese archivo
  // para el detalle de la copia condicional.
  const crear = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO vehiculos
        (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion,
         placa, capacidad_pasajeros, bus_categoria, disponible)
      VALUES (?, ?, ?, ?, 'bus', ?, 0, ?, ?, ?, ?, 0)
    `).run(
      propietarioId, marca, modelo, anioNum,
      ubicacion || 'Medellín', descripcion || '',
      placaNorm, capacidad, categoria,
    );
    const busId = Number(result.lastInsertRowid);

    resetearTarifasBusACategoria(db, busId, categoria);

    return busId;
  });

  let busId: number;
  try {
    busId = crear();
  } catch (e) {
    console.error('[buses] No se pudo crear el bus:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo registrar el bus. Intenta de nuevo.' }, { status: 500 });
  }

  const nivelActor = user.rol === 'admin' ? (permisosDe(db, user.id).nivel ?? undefined) : undefined;
  registrarAuditoria(db, { ...user, nivel: nivelActor }, {
    area: 'buses', accion: 'crear_bus', entidad: 'vehiculo', entidad_id: busId,
    detalle: `${marca} ${modelo} ${anioNum} (${placaNorm}) — categoría ${categoria}, propietario #${propietarioId}`,
  });

  return NextResponse.json({ id: busId, bus_categoria: categoria }, { status: 201 });
}
