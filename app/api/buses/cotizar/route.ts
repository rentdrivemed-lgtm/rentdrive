import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { notificarUsuarios } from '@/lib/panel';
import { consumirIntento, ipCliente } from '@/lib/limite-tasa';
import { cotizarTrayecto, cotizarHoras, adminsConAreaBuses, normalizarDestino, COL_DESTINO, type CategoriaBus } from '@/lib/busCotizador';

export const dynamic = 'force-dynamic';

// Rate limit por IP: endpoint público sin sesión, escribe en BD y dispara notificaciones
// en cada llamada — 20 cotizaciones/hora es suficiente para un cliente real explorando
// varias combinaciones (distintos destinos/horas) sin abrir la puerta a que alguien
// bombardee el endpoint para llenar de ruido las notificaciones/bandeja de un propietario.
const RATE_MAX = 20;
const RATE_VENTANA_MS = 60 * 60 * 1000;

// Techos defensivos de km/horas del cotizador PÚBLICO (hallazgo auditor-seguridad, ronda
// post-Etapa 2): antes solo se exigía `Number.isFinite(...) && > 0`, sin techo — un valor
// absurdo (ej. 10 millones de km) no rompe la cuenta (Math.round de un número finito), pero
// sí puede generar un total sin sentido que quede archivado como cotización real y llegue
// por notificación al propietario/admin. 5000km cubre cualquier trayecto nacional real;
// 720h (30 días) cubre cualquier contrato de disponibilidad razonable.
const KM_MAXIMO = 5000;
const HORAS_MAXIMO = 720;

export async function POST(req: NextRequest) {
  const ip = ipCliente(req);
  const espera = consumirIntento(`buses-cotizar:${ip}`, RATE_MAX, RATE_VENTANA_MS);
  if (espera !== null) {
    return NextResponse.json(
      { error: `Muchas solicitudes seguidas. Espera ${Math.ceil(espera / 60)} minuto(s) e inténtalo de nuevo.` },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  const vehiculoId = Number(body.vehiculoId);
  const modo = body.modo;
  if (!vehiculoId || !['destino', 'trayecto', 'horas'].includes(modo)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  }

  const bus = db.prepare(`
    SELECT id, propietario_id, bus_categoria, marca, modelo, placa, disponible, archivado, contenido_revision
    FROM vehiculos WHERE id = ? AND tipo = 'bus'
  `).get(vehiculoId) as {
    id: number; propietario_id: number; bus_categoria: string | null; marca: string; modelo: string; placa?: string;
    disponible: number; archivado: number; contenido_revision: number;
  } | undefined;

  if (!bus || Number(bus.archivado) === 1 || Number(bus.contenido_revision) === 1 || Number(bus.disponible) !== 1) {
    return NextResponse.json({ error: 'Este bus no está disponible para cotizar.' }, { status: 404 });
  }
  if (!bus.bus_categoria) {
    return NextResponse.json({ error: 'Este bus no tiene una categoría asignada.' }, { status: 400 });
  }
  const categoria = bus.bus_categoria as CategoriaBus;

  const conRecargo = body.conRecargo === true;
  const clienteNombre = String(body.clienteNombre || '').trim().slice(0, 200);
  const clienteTelefono = String(body.clienteTelefono || '').trim().slice(0, 40);
  const fechaServicio = String(body.fechaServicio || '').trim().slice(0, 20);

  let tarifaAplicada = 0;
  let recargoValor = 0;
  let total = 0;
  let destino: string | null = null;
  let km: number | null = null;
  let horas: number | null = null;
  let referencial = false; // se marca true cuando el bus no tiene tarifa propia y se usó la referencia de su categoría

  if (modo === 'destino') {
    // Mismo límite de largo que clienteNombre (texto libre público, ver arriba).
    destino = String(body.destino || '').trim().slice(0, 200);
    if (!destino) return NextResponse.json({ error: 'Falta el destino' }, { status: 400 });

    // Búsqueda insensible a mayúsculas/tildes: se trae todo lo cargado para este bus (volumen
    // pequeño por bus) y se compara en JS con `normalizarDestino` — `COLLATE NOCASE` de SQLite
    // no resuelve tildes/diacríticos, solo mayúsculas ASCII, así que no alcanza aquí. Ver
    // comentario de `normalizarDestino` en lib/busCotizador.ts.
    const destinoNorm = normalizarDestino(destino);
    const filasVeh = db.prepare('SELECT destino, tarifa_base, tarifa_30 FROM bus_tarifas_destino_veh WHERE vehiculo_id = ?')
      .all(vehiculoId) as { destino: string; tarifa_base: number; tarifa_30: number }[];
    let fila = filasVeh.find(f => normalizarDestino(f.destino) === destinoNorm) as
      { tarifa_base: number; tarifa_30: number } | undefined;

    if (!fila) {
      // Sin tarifa propia para este destino: se cotiza contra la referencia de su
      // categoría (§7.2 del spec), marcada como referencial ("sujeta a confirmación del
      // propietario") en la respuesta. Mismo criterio de normalización que arriba: se traen
      // todas las referencias activas (~300 filas, aceptable para un endpoint público con
      // rate-limit de 20/hora) y se compara en JS.
      const col = COL_DESTINO[categoria];
      const refs = db.prepare(`SELECT destino, ${col.base} AS tarifa_base, ${col.recargo} AS tarifa_30 FROM bus_tarifas_destino_ref WHERE activo = 1`)
        .all() as { destino: string; tarifa_base: number | null; tarifa_30: number | null }[];
      const ref = refs.find(r => normalizarDestino(r.destino) === destinoNorm);
      if (!ref || ref.tarifa_base == null) {
        return NextResponse.json(
          { error: 'No hay tarifa cargada para ese destino todavía. Prueba con "Por trayecto" o "Por horas".' },
          { status: 404 },
        );
      }
      fila = { tarifa_base: ref.tarifa_base, tarifa_30: ref.tarifa_30 ?? ref.tarifa_base };
      referencial = true;
    }

    const base = Math.round(fila.tarifa_base);
    total = Math.round(conRecargo ? fila.tarifa_30 : fila.tarifa_base);
    tarifaAplicada = base;
    recargoValor = conRecargo ? Math.max(0, total - base) : 0;
  } else if (modo === 'trayecto') {
    km = Number(body.km);
    if (!Number.isFinite(km) || km <= 0) return NextResponse.json({ error: 'Kilómetros inválidos' }, { status: 400 });
    if (km > KM_MAXIMO) return NextResponse.json({ error: `Los kilómetros no pueden superar ${KM_MAXIMO}.` }, { status: 400 });

    let fila = db.prepare('SELECT valor_km, tarifa_minima FROM bus_valor_km_veh WHERE vehiculo_id = ?')
      .get(vehiculoId) as { valor_km: number; tarifa_minima: number } | undefined;

    if (!fila) {
      // Sin tarifa propia de km para este bus: se cotiza contra la referencia de su
      // categoría, marcada como referencial en la respuesta (mismo patrón que 'destino').
      const ref = db.prepare('SELECT valor_km, tarifa_minima FROM bus_valor_km_ref WHERE categoria = ?')
        .get(categoria) as { valor_km: number | null; tarifa_minima: number | null } | undefined;
      if (!ref || !ref.valor_km) {
        return NextResponse.json(
          { error: 'No hay tarifa por kilómetro cargada todavía para este bus. Prueba con "Por destino" o "Por horas".' },
          { status: 404 },
        );
      }
      fila = { valor_km: ref.valor_km, tarifa_minima: ref.tarifa_minima ?? 0 };
      referencial = true;
    }

    const sinRecargo = Math.round(Math.max(km * fila.valor_km, fila.tarifa_minima));
    total = cotizarTrayecto(km, fila.valor_km, fila.tarifa_minima, conRecargo);
    tarifaAplicada = fila.valor_km;
    recargoValor = conRecargo ? Math.max(0, total - sinRecargo) : 0;
  } else {
    horas = Number(body.horas);
    if (!Number.isFinite(horas) || horas <= 0) return NextResponse.json({ error: 'Horas inválidas' }, { status: 400 });
    if (horas > HORAS_MAXIMO) return NextResponse.json({ error: `Las horas no pueden superar ${HORAS_MAXIMO}.` }, { status: 400 });

    let fila = db.prepare('SELECT tarifa_hora, minimo_horas FROM bus_tarifas_hora_veh WHERE vehiculo_id = ?')
      .get(vehiculoId) as { tarifa_hora: number; minimo_horas: number } | undefined;

    if (!fila) {
      // Sin tarifa propia de hora para este bus: se cotiza contra la referencia de su
      // categoría, marcada como referencial en la respuesta (mismo patrón que 'destino').
      const ref = db.prepare('SELECT tarifa_hora, minimo_horas FROM bus_tarifas_hora_ref WHERE categoria = ?')
        .get(categoria) as { tarifa_hora: number | null; minimo_horas: number | null } | undefined;
      if (!ref || !ref.tarifa_hora) {
        return NextResponse.json(
          { error: 'No hay tarifa por hora cargada todavía para este bus. Prueba con "Por destino" o "Por trayecto".' },
          { status: 404 },
        );
      }
      fila = { tarifa_hora: ref.tarifa_hora, minimo_horas: ref.minimo_horas ?? 4 };
      referencial = true;
    }

    const horasEfectivas = Math.max(horas, fila.minimo_horas);
    const sinRecargo = Math.round(horasEfectivas * fila.tarifa_hora);
    total = cotizarHoras(horas, fila.tarifa_hora, fila.minimo_horas, conRecargo);
    tarifaAplicada = fila.tarifa_hora;
    recargoValor = conRecargo ? Math.max(0, total - sinRecargo) : 0;
  }

  const numero = `BUS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const result = db.prepare(`
    INSERT INTO cotizaciones_bus
      (numero, vehiculo_id, categoria, modo, destino, km, horas, con_recargo, tarifa_aplicada, recargo_valor, total, cliente_nombre, cliente_telefono, fecha_servicio, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nueva')
  `).run(
    numero, vehiculoId, categoria, modo, destino, km, horas,
    conRecargo ? 1 : 0, tarifaAplicada, recargoValor, total,
    clienteNombre, clienteTelefono, fechaServicio,
  );
  const cotizacionId = Number(result.lastInsertRowid);

  const busLabel = `${bus.marca} ${bus.modelo}${bus.placa ? ` (${bus.placa})` : ''}`;
  const totalFmt = total.toLocaleString('es-CO');

  notificarUsuarios(db, [bus.propietario_id], {
    tipo: 'cotizacion_bus_nueva', titulo: '🚌 Nueva cotización para tu bus',
    mensaje: `${clienteNombre || 'Un cliente'} cotizó ${busLabel} (${modo}). Total: $${totalFmt}.`,
    referencia_id: cotizacionId, referencia_tipo: 'cotizacion_bus',
  });

  const admins = adminsConAreaBuses(db);
  if (admins.length) {
    notificarUsuarios(db, admins, {
      tipo: 'cotizacion_bus_nueva', titulo: '🚌 Nueva cotización de bus',
      mensaje: `${busLabel}: ${clienteNombre || 'cliente'} cotizó por ${modo}. Total: $${totalFmt}.`,
      referencia_id: cotizacionId, referencia_tipo: 'cotizacion_bus',
    });
  }

  return NextResponse.json({
    numero, modo, destino, km, horas, conRecargo,
    tarifaAplicada, recargoValor, total, referencial, categoria,
  }, { status: 201 });
}
