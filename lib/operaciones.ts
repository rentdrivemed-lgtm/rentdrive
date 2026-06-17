import type Database from 'better-sqlite3';
import { lugarResumen, type Lugar } from './lugares';
import { compararFotosVehiculo, type InspeccionResultado } from './inspeccion-vehiculo';

type DB = Database.Database;

export type PlantillaTarea = { tipo: string; titulo: string; detalle: string; orden: number };

export type DetalleServicio = {
  reserva_id: number;
  usuario_id: number;
  usuario_nombre: string;
  usuario_celular: string;
  propietario_id: number;
  propietario_nombre: string;
  vehiculo_id: number;
  marca: string;
  modelo: string;
  placa: string;
  fecha_inicio: string;
  fecha_fin: string;
  total: number;
  recogida: string;
  entrega: string;
};

export function plantillaTareas(reserva: { recogida?: unknown; entrega?: unknown; fecha_inicio: string; fecha_fin: string }): PlantillaTarea[] {
  const parseLugar = (v: unknown): Lugar | null => {
    if (!v) return null;
    try { return (typeof v === 'string' ? JSON.parse(v) : v) as Lugar; } catch { return null; }
  };
  const recogidaStr = lugarResumen(parseLugar(reserva.recogida));
  const entregaStr = lugarResumen(parseLugar(reserva.entrega));
  return [
    { tipo: 'preparacion', titulo: 'Lavar el vehículo', detalle: '', orden: 1 },
    { tipo: 'preparacion', titulo: 'Tanquear el vehículo', detalle: '', orden: 2 },
    { tipo: 'entrega', titulo: 'Entregar vehículo al cliente', detalle: `Lugar: ${recogidaStr} — Fecha: ${reserva.fecha_inicio}`, orden: 3 },
    { tipo: 'recepcion', titulo: 'Recibir vehículo del cliente', detalle: `Lugar: ${entregaStr} — Fecha: ${reserva.fecha_fin}`, orden: 4 },
    { tipo: 'inspeccion', titulo: 'Inspección de daños (IA)', detalle: 'Subir fotos de salida y entrada para comparar con IA', orden: 5 },
  ];
}

export function crearOperacionParaReserva(db: DB, reservaId: number): { creada: boolean; operacionId: number } {
  const existe = db.prepare('SELECT id FROM operaciones WHERE reserva_id = ?').get(reservaId) as { id: number } | undefined;
  if (existe) return { creada: false, operacionId: existe.id };

  const reserva = db.prepare('SELECT fecha_inicio, fecha_fin, recogida, entrega FROM reservas WHERE id = ?').get(reservaId) as { fecha_inicio: string; fecha_fin: string; recogida: string; entrega: string } | undefined;
  if (!reserva) throw new Error(`Reserva ${reservaId} no encontrada`);

  const ins = db.prepare("INSERT INTO operaciones (reserva_id, estado) VALUES (?, 'pendiente')").run(reservaId);
  const operacionId = Number(ins.lastInsertRowid);

  const tareas = plantillaTareas(reserva);
  const insTarea = db.prepare('INSERT INTO operacion_tareas (operacion_id, tipo, titulo, detalle, estado, orden) VALUES (?, ?, ?, ?, ?, ?)');
  for (const t of tareas) {
    insTarea.run(operacionId, t.tipo, t.titulo, t.detalle, 'pendiente', t.orden);
  }

  return { creada: true, operacionId };
}

export function getConfig(db: DB, clave: string): string {
  const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave) as { valor: string } | undefined;
  return row?.valor ?? '';
}

export function setConfig(db: DB, clave: string, valor: string): void {
  db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor);
}

export function cargarDetalleServicio(db: DB, reservaId: number): DetalleServicio | null {
  const row = db.prepare(`
    SELECT r.id AS reserva_id, r.usuario_id, u.nombre AS usuario_nombre, COALESCE(u.celular,'') AS usuario_celular,
           v.propietario_id, p.nombre AS propietario_nombre,
           r.vehiculo_id, v.marca, v.modelo, COALESCE(v.placa,'') AS placa,
           r.fecha_inicio, r.fecha_fin, r.total,
           COALESCE(r.recogida,'{}') AS recogida, COALESCE(r.entrega,'{}') AS entrega
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios u ON r.usuario_id = u.id
    JOIN usuarios p ON v.propietario_id = p.id
    WHERE r.id = ?
  `).get(reservaId) as DetalleServicio | undefined;
  return row ?? null;
}

export function recomputarEstadoOperacion(db: DB, opId: number, mensajeroId: number | null): void {
  const tareas = db.prepare('SELECT estado FROM operacion_tareas WHERE operacion_id = ?').all(opId) as { estado: string }[];
  const total = tareas.length;
  const hechas = tareas.filter(t => t.estado === 'hecho').length;
  let nuevoEstado: string;
  if (total > 0 && hechas === total) {
    nuevoEstado = 'finalizada';
  } else if (hechas > 0) {
    nuevoEstado = 'en_proceso';
  } else {
    nuevoEstado = mensajeroId ? 'asignada' : 'pendiente';
  }
  db.prepare("UPDATE operaciones SET estado = ? WHERE id = ? AND estado != 'finalizada'").run(nuevoEstado, opId);
}

export function mensajeAdmin(det: DetalleServicio): string {
  return [
    '🚗 *Nuevo servicio DrivePass*',
    '',
    `*Vehículo:* ${det.marca} ${det.modelo}${det.placa ? ` (${det.placa})` : ''}`,
    `*Cliente:* ${det.usuario_nombre}`,
    `*Fechas:* ${det.fecha_inicio} → ${det.fecha_fin}`,
    '',
    'Asigna un mensajero en el panel de Operaciones.',
  ].join('\n');
}

export function mensajeMensajero(det: DetalleServicio, tareas: { titulo: string; detalle: string }[], enlace?: string): string {
  const listaTareas = tareas.map(t => `• ${t.titulo}${t.detalle ? `: ${t.detalle}` : ''}`).join('\n');
  const lines = [
    '🚗 *Servicio asignado — DrivePass*',
    '',
    `*Vehículo:* ${det.marca} ${det.modelo}${det.placa ? ` (${det.placa})` : ''}`,
    `*Cliente:* ${det.usuario_nombre}`,
    `*Fechas:* ${det.fecha_inicio} → ${det.fecha_fin}`,
  ];
  if (listaTareas) { lines.push('', '*Tareas:*', listaTareas); }
  if (enlace) { lines.push('', `*Panel de servicio:* ${enlace}`); }
  return lines.join('\n');
}

export function appBaseUrl(): string {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  return '';
}

export async function ejecutarInspeccion(db: DB, opId: number): Promise<InspeccionResultado> {
  const op = db.prepare('SELECT fotos_salida, fotos_entrada, reserva_id FROM operaciones WHERE id = ?').get(opId) as { fotos_salida: string; fotos_entrada: string; reserva_id: number } | undefined;
  if (!op) throw new Error('Operación no encontrada');

  const fotosSalida: string[] = JSON.parse(op.fotos_salida || '[]');
  const fotosEntrada: string[] = JSON.parse(op.fotos_entrada || '[]');
  if (fotosSalida.length === 0) throw new Error('No hay fotos de salida para comparar');
  if (fotosEntrada.length === 0) throw new Error('No hay fotos de entrada para comparar');

  const vehiculo = db.prepare(`
    SELECT v.marca, v.modelo, COALESCE(v.placa,'') AS placa
    FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id WHERE r.id = ?
  `).get(op.reserva_id) as { marca: string; modelo: string; placa: string } | undefined;

  const resultado = await compararFotosVehiculo(
    { vehiculo: vehiculo ? `${vehiculo.marca} ${vehiculo.modelo}` : '', placa: vehiculo?.placa },
    fotosSalida,
    fotosEntrada,
  );

  db.prepare('UPDATE operaciones SET inspeccion_ia = ?, inspeccion_estado = ? WHERE id = ?')
    .run(JSON.stringify(resultado), resultado.hay_danos_nuevos ? 'con_danos' : 'sin_danos', opId);

  return resultado;
}
