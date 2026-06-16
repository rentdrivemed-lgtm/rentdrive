// Lógica del módulo de operaciones / logística.
// Al confirmar una reserva se crea una "operación" (el servicio) con un
// checklist de tareas (lavar, tanquear, entregar, recibir, inspección).
import type Database from 'better-sqlite3';
import { lugarResumen, type Lugar } from './lugares';
import { compararFotosVehiculo, type InspeccionResultado } from './inspeccion-vehiculo';

type DB = Database.Database;

export type PlantillaTarea = { tipo: string; titulo: string; detalle: string; orden: number };

export type DetalleServicio = {
  reserva_id: number;
  marca: string; modelo: string; anio: number; placa: string;
  usuario_nombre: string; usuario_celular: string;
  fecha_inicio: string; fecha_fin: string;
  recogida: string; entrega: string;
  total: number; recargo: number;
};

function parseLugar(s: unknown): Lugar | null {
  try {
    const o = JSON.parse((s as string) || '{}');
    return o && o.municipio ? (o as Lugar) : null;
  } catch {
    return null;
  }
}

function pesos(n: number): string {
  return `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
}

// Checklist por defecto que genera cada servicio confirmado.
export function plantillaTareas(reserva: { recogida?: unknown; entrega?: unknown; fecha_inicio: string; fecha_fin: string }): PlantillaTarea[] {
  const recogida = lugarResumen(parseLugar(reserva.recogida));
  const entrega = lugarResumen(parseLugar(reserva.entrega));
  return [
    { tipo: 'lavar',      titulo: 'Lavar el vehículo',            detalle: 'Dejarlo limpio antes de entregarlo al cliente.', orden: 1 },
    { tipo: 'tanquear',   titulo: 'Tanquear / verificar gasolina', detalle: 'Verificar y registrar el nivel de combustible.',  orden: 2 },
    { tipo: 'entregar',   titulo: 'Entregar vehículo al cliente',  detalle: `${reserva.fecha_inicio} · ${recogida}`,          orden: 3 },
    { tipo: 'inspeccion', titulo: 'Inspección con fotos',          detalle: 'Registrar estado del vehículo (fotos antes y después).', orden: 4 },
    { tipo: 'recibir',    titulo: 'Recibir vehículo del cliente',  detalle: `${reserva.fecha_fin} · ${entrega}`,              orden: 5 },
  ];
}

// Crea la operación + tareas para una reserva. Idempotente: si ya existe, no duplica.
export function crearOperacionParaReserva(db: DB, reservaId: number): { creada: boolean; operacionId: number } {
  const existente = db.prepare('SELECT id FROM operaciones WHERE reserva_id = ?').get(reservaId) as { id: number } | undefined;
  if (existente) return { creada: false, operacionId: existente.id };

  const reserva = db.prepare('SELECT recogida, entrega, fecha_inicio, fecha_fin FROM reservas WHERE id = ?').get(reservaId) as
    { recogida?: string; entrega?: string; fecha_inicio: string; fecha_fin: string } | undefined;
  if (!reserva) throw new Error('Reserva no encontrada al crear la operación.');

  const ins = db.prepare("INSERT INTO operaciones (reserva_id, estado) VALUES (?, 'pendiente')").run(reservaId);
  const operacionId = Number(ins.lastInsertRowid);

  const insTarea = db.prepare('INSERT INTO operacion_tareas (operacion_id, tipo, titulo, detalle, orden) VALUES (?, ?, ?, ?, ?)');
  for (const t of plantillaTareas(reserva)) {
    insTarea.run(operacionId, t.tipo, t.titulo, t.detalle, t.orden);
  }
  return { creada: true, operacionId };
}

// Carga el detalle del servicio (para armar mensajes y el tablero).
export function cargarDetalleServicio(db: DB, reservaId: number): DetalleServicio | undefined {
  return db.prepare(`
    SELECT r.id AS reserva_id, v.marca, v.modelo, v.anio, COALESCE(v.placa,'') AS placa,
           u.nombre AS usuario_nombre, COALESCE(u.celular,'') AS usuario_celular,
           r.fecha_inicio, r.fecha_fin, COALESCE(r.recogida,'{}') AS recogida,
           COALESCE(r.entrega,'{}') AS entrega, r.total, COALESCE(r.recargo,0) AS recargo
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios  u ON r.usuario_id  = u.id
    WHERE r.id = ?
  `).get(reservaId) as DetalleServicio | undefined;
}

// Resumen del servicio (encabezado común de los mensajes de WhatsApp).
export function resumenServicio(d: DetalleServicio): string {
  const recogida = lugarResumen(parseLugar(d.recogida));
  const entrega = lugarResumen(parseLugar(d.entrega));
  const recargoTxt = d.recargo ? ` (incluye recargo ${pesos(d.recargo)})` : '';
  return [
    '🚗 *Nuevo servicio confirmado — DrivePass*',
    `Vehículo: ${d.marca} ${d.modelo} ${d.anio}${d.placa ? ` (${d.placa})` : ''}`,
    `Cliente: ${d.usuario_nombre}${d.usuario_celular ? ` · ${d.usuario_celular}` : ''}`,
    `Fechas: ${d.fecha_inicio} → ${d.fecha_fin}`,
    `Entrega al cliente: ${recogida}`,
    `Devolución del cliente: ${entrega}`,
    `Total: ${pesos(d.total)}${recargoTxt}`,
  ].join('\n');
}

// Mensaje para el administrador al confirmarse el servicio.
export function mensajeAdmin(d: DetalleServicio): string {
  return [
    resumenServicio(d),
    '',
    'Asigna un mensajero desde el tablero de Operaciones.',
  ].join('\n');
}

// URL base de la app (para los enlaces que se envían a los mensajeros).
export function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3100').replace(/\/+$/, '');
}

// Mensaje para el mensajero al ser asignado, con su checklist y su enlace personal.
export function mensajeMensajero(d: DetalleServicio, tareas: { titulo: string; detalle: string }[], enlace?: string): string {
  const lineas = [
    resumenServicio(d),
    '',
    '*Tus tareas:*',
    ...tareas.map(t => `• ${t.titulo}${t.detalle ? ` — ${t.detalle}` : ''}`),
    '',
    'Marca cada tarea como completada y sube las fotos en tu acceso.',
  ];
  if (enlace) lineas.push('', `👉 Abre tu servicio: ${enlace}`);
  return lineas.join('\n');
}

// Helpers de configuración (tabla config clave/valor).
export function getConfig(db: DB, clave: string): string {
  const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave) as { valor: string } | undefined;
  return row?.valor ?? '';
}

export function setConfig(db: DB, clave: string, valor: string): void {
  db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, valor);
}

// Recalcula el estado de la operación a partir de sus tareas y la asignación.
export function recomputarEstadoOperacion(db: DB, opId: number, mensajeroId: number | null): string {
  const tareas = db.prepare('SELECT estado FROM operacion_tareas WHERE operacion_id = ?').all(opId) as { estado: string }[];
  const total = tareas.length;
  const hechas = tareas.filter(t => t.estado === 'hecho').length;
  let estado: string;
  if (total > 0 && hechas === total) estado = 'finalizada';
  else if (hechas > 0) estado = 'en_proceso';
  else estado = mensajeroId ? 'asignada' : 'pendiente';
  db.prepare('UPDATE operaciones SET estado = ? WHERE id = ?').run(estado, opId);
  return estado;
}

// ── Inspección de daños (comparación de fotos con IA) ──
function parseArr(s: unknown): string[] {
  try { const a = JSON.parse((s as string) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}

export async function ejecutarInspeccion(db: DB, opId: number): Promise<InspeccionResultado> {
  const op = db.prepare('SELECT reserva_id, fotos_salida, fotos_entrada FROM operaciones WHERE id = ?').get(opId) as
    { reserva_id: number; fotos_salida: string; fotos_entrada: string } | undefined;
  if (!op) throw new Error('Operación no encontrada.');

  const salida = parseArr(op.fotos_salida);
  const entrada = parseArr(op.fotos_entrada);
  if (salida.length === 0) throw new Error('Faltan las fotos de SALIDA del vehículo.');
  if (entrada.length === 0) throw new Error('Faltan las fotos de ENTRADA (devolución) del vehículo.');

  const det = cargarDetalleServicio(db, op.reserva_id);
  const resultado = await compararFotosVehiculo(
    { vehiculo: det ? `${det.marca} ${det.modelo} ${det.anio}` : undefined, placa: det?.placa },
    salida, entrada,
  );
  const estado = resultado.hay_danos_nuevos ? 'con_danos' : 'sin_danos';
  db.prepare('UPDATE operaciones SET inspeccion_ia = ?, inspeccion_estado = ? WHERE id = ?')
    .run(JSON.stringify(resultado), estado, opId);
  return resultado;
}
