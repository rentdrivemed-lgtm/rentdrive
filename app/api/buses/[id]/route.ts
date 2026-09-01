import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { registrarAuditoria, permisosDe } from '@/lib/permisos';
import { contieneLenguajeInapropiado } from '@/lib/moderacion';
import { eliminarVehiculoInteligente } from '@/lib/eliminar';
import { notificarUsuarios } from '@/lib/panel';
import {
  categoriaPorPasajeros, anioBusValido, resetearTarifasBusACategoria, adminsConAreaBuses,
  CAPACIDAD_MIN_PASAJEROS, CAPACIDAD_MAX_PASAJEROS, type CategoriaBus,
} from '@/lib/busCotizador';

// GET/PUT/DELETE de un bus individual (Etapa 2). Antes de este archivo no existía ningún
// endpoint para editar un bus después de creado: `disponible` quedaba hardcodeado a 0 en
// POST /api/buses (ver ese archivo) y nada podía cambiarlo, así que ningún bus podía
// aparecer en la vitrina (GET /api/buses público exige disponible=1) ni ser cotizado
// (POST /api/buses/cotizar exige disponible=1). Mismo patrón de ownership/admin que
// app/api/vehiculos/[id]/route.ts, adaptado: los buses no tienen el flujo de
// documentos/tecnomecánica de los carros, así que ese bloque no aplica aquí.

// GET — detalle de un bus. Público si está publicado (disponible=1, contenido_revision=0);
// si no, solo lo puede ver el propietario dueño o un admin con la sección "buses" (mismo
// criterio de "404 en vez de 403" que usa GET /api/vehiculos/[id] para no confirmarle a un
// tercero que el id existe).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const bus = db.prepare(`
    SELECT v.*, u.nombre as propietario_nombre
    FROM vehiculos v JOIN usuarios u ON v.propietario_id = u.id
    WHERE v.id = ? AND v.tipo = 'bus' AND v.archivado = 0
  `).get(Number(id)) as Record<string, unknown> | undefined;

  if (!bus) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const esPublico = Number(bus.disponible) === 1 && Number(bus.contenido_revision) === 0;
  if (!esPublico) {
    const user = await getCurrentUser();
    const esDueño = !!user && user.rol === 'propietario' && Number(bus.propietario_id) === user.id;
    const esAdminConPermiso = !!user && user.rol === 'admin' && adminTieneArea(db, user.id, 'buses');
    if (!esDueño && !esAdminConPermiso) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }
  }

  return NextResponse.json({ bus });
}

// PUT — el propietario dueño del bus (o un admin con la sección "buses") lo edita. Es la
// única vía para togglear `disponible` (0/1): sin este endpoint ningún bus podía llegar a
// disponible=1 después de creado.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const busInicial = db.prepare("SELECT * FROM vehiculos WHERE id = ? AND tipo = 'bus'").get(Number(id)) as Record<string, unknown> | undefined;
  if (!busInicial) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Ruta compartida: la usa el propietario dueño del bus Y el admin. Rama admin -> exige la
  // sección "buses" (nivel + excepciones por empleado); rama propietario -> sigue mandando
  // la pertenencia, sin tocar permisos de admin.
  const isAdmin = user.rol === 'admin';
  if (isAdmin) {
    if (!adminTieneArea(db, user.id, 'buses')) return sinPermisoArea();
  } else if (Number(busInicial.propietario_id) !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // ── A partir de aquí, TODO es síncrono (better-sqlite3 no usa promesas): mismo blindaje
  // anti-carrera que ya usa PUT /api/vehiculos/[id] y PUT /api/buses/tarifas-vehiculo — la
  // lectura fresca del bus corre DESPUÉS del único `await` de esta función (`await
  // req.json()`, justo arriba), así que no hay ninguna ventana para que otro request se
  // interponga entre "leer el estado vigente" y "escribir el nuevo".
  const bus = db.prepare("SELECT * FROM vehiculos WHERE id = ? AND tipo = 'bus'").get(Number(id)) as Record<string, unknown> | undefined;
  if (!bus) return NextResponse.json({ error: 'No encontrado' }, { status: 404 }); // pudo borrarse mientras se parseaba el body

  // ── Validación/normalización de `anio` — mismo patrón estricto que PUT /api/vehiculos/[id]
  // y POST /api/buses (ver lib/busCotizador.ts, anioBusValido). ──
  if (body.anio !== undefined) {
    const anioNum = anioBusValido(body.anio);
    if (anioNum === null) {
      return NextResponse.json({ error: 'Año de bus inválido.' }, { status: 400 });
    }
    body.anio = anioNum;
  }

  // ── Validación de `capacidad_pasajeros` (mismo rango que POST /api/buses) + recómputo de
  // `bus_categoria`: la categoría NUNCA se deja editar libremente (evita que un bus de 20
  // puestos se registre como "12 pasajeros" para verse más barato), así que si cambia la
  // capacidad, la categoría debe recomputarse en la MISMA escritura para no quedar
  // desincronizada (hallazgo QA/revisor-código, ronda post-Etapa 2). ──
  let nuevaCategoria: string | null = null;
  if (body.capacidad_pasajeros !== undefined) {
    const capacidad = Number(body.capacidad_pasajeros);
    if (!Number.isInteger(capacidad) || capacidad < CAPACIDAD_MIN_PASAJEROS || capacidad > CAPACIDAD_MAX_PASAJEROS) {
      return NextResponse.json(
        { error: `La capacidad de pasajeros debe ser un número entero entre ${CAPACIDAD_MIN_PASAJEROS} y ${CAPACIDAD_MAX_PASAJEROS}.` },
        { status: 400 },
      );
    }
    body.capacidad_pasajeros = capacidad;
    nuevaCategoria = categoriaPorPasajeros(capacidad);
  }

  // Filtro de lenguaje inapropiado en la descripción (texto libre público) — mismo criterio
  // que PUT /api/vehiculos/[id] y POST /api/buses.
  if (body.descripcion !== undefined) {
    const chequeoTexto = contieneLenguajeInapropiado(body.descripcion);
    if (chequeoTexto.encontrado) {
      return NextResponse.json(
        { error: 'Tu descripción contiene lenguaje inapropiado, por favor corrígela.' },
        { status: 400 },
      );
    }
  }

  // Normalización de placa — mismo criterio que POST /api/buses.
  if (body.placa !== undefined) {
    body.placa = String(body.placa || '').toUpperCase().trim();
  }

  // ── Campos editables ──
  // `bus_categoria` no se expone aquí: se deriva de `capacidad_pasajeros` (ver arriba), nunca
  // se recibe directo del cliente. `precio_dia` tampoco aplica a buses (queda en 0, ver
  // POST /api/buses — los buses se cotizan por tarifas_veh, no por precio_dia). Mismo campo
  // set para propietario y admin (a diferencia de vehiculos/[id], acá no hay hoy ningún campo
  // "solo admin" — no existe flujo de documentos/contenido_revision para buses todavía).
  // `fotos`/`fotos_detalle` NO están en este set (hallazgo QA/revisor-código/auditor-seguridad,
  // ronda post-Etapa 2): hoy no existe ningún flujo de subida/moderación de fotos de bus (a
  // diferencia de PUT /api/vehiculos/[id], que valida cada URL contra `fotosRegistradasEntre`/
  // `extraerUrlsFotos`/`normalizarUrlFoto` de lib/moderacion.ts y fuerza `contenido_revision=1`
  // si alguna viene marcada inapropiada). Dejar estos dos campos editables aquí permitiría
  // colar cualquier URL sin pasar por esa moderación. Se reactivarán cuando exista el flujo de
  // subida/moderación de fotos de bus (probablemente Stage 3/4, capa de UI).
  const allowed = ['marca', 'modelo', 'anio', 'ubicacion', 'descripcion', 'disponible',
    'placa', 'capacidad_pasajeros'];

  const pairs: string[] = [];
  const values: unknown[] = [];
  for (const f of allowed) {
    if (body[f] !== undefined) {
      pairs.push(`${f} = ?`);
      values.push(body[f]);
    }
  }
  if (nuevaCategoria !== null) {
    pairs.push('bus_categoria = ?');
    values.push(nuevaCategoria);
  }

  // ¿La categoría realmente CAMBIÓ (no solo se recalculó al mismo valor de siempre)? Solo en
  // ese caso hay que resincronizar tarifas — si el propietario editó `capacidad_pasajeros`
  // pero se quedó dentro del mismo rango de categoría, sus tarifas siguen siendo válidas tal
  // cual (hallazgo QA/revisor-código/auditor-seguridad, ronda post-Etapa 2).
  const categoriaCambio = nuevaCategoria !== null && nuevaCategoria !== bus.bus_categoria;

  if (pairs.length > 0) {
    // bus+tarifas en una sola transacción síncrona (better-sqlite3 no usa promesas, mismo
    // criterio que el resto de este archivo): si la re-copia de tarifas falla a mitad de
    // camino, el UPDATE del bus tampoco queda confirmado — nunca un bus con la categoría
    // nueva pero tarifas a medio resetear.
    const guardar = db.transaction(() => {
      db.prepare(`UPDATE vehiculos SET ${pairs.join(', ')} WHERE id = ?`).run(...values, Number(id));
      if (categoriaCambio && nuevaCategoria !== null) {
        // Re-copia (sobrescribiendo) las tarifas de referencia de la categoría NUEVA hacia
        // las tablas _veh de este bus — mismo patrón que usa POST /api/buses al crear un bus
        // (ver resetearTarifasBusACategoria en lib/busCotizador.ts). Sin esto, las tarifas ya
        // cargadas (incluidas las personalizadas del propietario) quedaban con los valores de
        // la categoría vieja, desincronizadas de la nueva.
        resetearTarifasBusACategoria(db, Number(id), nuevaCategoria as CategoriaBus);
      }
    });
    try {
      guardar();
    } catch (e) {
      console.error('[buses] No se pudo guardar el bus:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'No se pudo guardar el bus. Intenta de nuevo.' }, { status: 500 });
    }

    const nivelActor = isAdmin ? (permisosDe(db, user.id).nivel ?? undefined) : undefined;
    const busLabel = `${bus.marca} ${bus.modelo}${bus.placa ? ` (${bus.placa})` : ''}`;
    registrarAuditoria(db, { ...user, nivel: nivelActor }, {
      area: 'buses', accion: 'editar_bus', entidad: 'vehiculo', entidad_id: Number(id),
      detalle: `Editó ${busLabel}: ${allowed.filter(f => body[f] !== undefined).join(', ')}`
        + (categoriaCambio ? ` — categoría cambió de ${bus.bus_categoria} a ${nuevaCategoria}, tarifas reseteadas a los valores por defecto de la nueva categoría` : ''),
    });

    if (categoriaCambio) {
      // Aviso a los admins con la sección "buses" (mismo destinatario/criterio que ya usa
      // PUT /api/buses/tarifas-vehiculo): el propietario necesita saber que sus tarifas
      // personalizadas se perdieron y quedaron en los valores por defecto de la nueva
      // categoría, para revisarlas de nuevo si hacía falta.
      notificarUsuarios(db, adminsConAreaBuses(db), {
        tipo: 'bus_tarifas_reseteadas',
        titulo: '⚠️ Tarifas de bus reseteadas por cambio de categoría',
        mensaje: `${busLabel}: al cambiar la capacidad de pasajeros, su categoría pasó de ${bus.bus_categoria} a ${nuevaCategoria} y sus tarifas se resetearon a los valores por defecto de la nueva categoría. Revísalas si tenía tarifas personalizadas.`,
        referencia_id: Number(id), referencia_tipo: 'vehiculo',
      });
    }
  }

  return NextResponse.json({ ok: true, ...(nuevaCategoria !== null ? { bus_categoria: nuevaCategoria } : {}) });
}

// DELETE — mismo patrón "eliminar inteligente" que DELETE /api/vehiculos/[id] (lib/eliminar.ts):
// si el bus nunca tuvo historial de negocio real se borra de verdad, si no se archiva
// (reversible). `eliminarVehiculoInteligente` es genérica sobre la tabla `vehiculos` (no
// distingue tipo); `tieneHistorialVehiculo` (lib/eliminar.ts) SÍ reconoce explícitamente el
// caso de un bus con filas propias en bus_tarifas_destino_veh/bus_tarifas_hora_veh/
// bus_valor_km_veh/bus_tarifas_cambios/cotizaciones_bus (hallazgo QA/revisor-código, ronda
// post-Etapa 2: antes esa decisión dependía implícitamente de que el DELETE real fallara por
// una excepción de FK y cayera al catch genérico). Ese catch se mantiene igual como defensa en
// profundidad para cualquier FK que no se haya anticipado.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const bus = db.prepare("SELECT * FROM vehiculos WHERE id = ? AND tipo = 'bus'").get(Number(id)) as Record<string, unknown> | undefined;
  if (!bus) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Mismo criterio que el PUT: al admin se le exige la sección, al propietario la pertenencia.
  if (user.rol === 'admin') {
    if (!adminTieneArea(db, user.id, 'buses')) return sinPermisoArea();
  } else if (Number(bus.propietario_id) !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const resultado = eliminarVehiculoInteligente(db, Number(id));

  registrarAuditoria(db, user, {
    area: 'buses',
    accion: resultado === 'borrado' ? 'eliminar_bus' : 'archivar_bus',
    entidad: 'vehiculo', entidad_id: Number(id),
    detalle: resultado === 'borrado'
      ? `Eliminó (borrado real) ${bus.marca} ${bus.modelo} ${bus.anio} (${bus.placa || 's/placa'}) — sin historial de negocio`
      : `Archivó ${bus.marca} ${bus.modelo} ${bus.anio} (${bus.placa || 's/placa'}) — tiene historial, se conserva reversible`,
  });

  return NextResponse.json({ ok: true, resultado });
}
