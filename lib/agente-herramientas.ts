// Herramientas de consulta compartidas por los asistentes con IA de DrivePass
// (WhatsApp y el chat de soporte in-app). Cada rol solo puede consultar SUS
// PROPIOS datos — la identidad viene siempre de la sesión/canal verificado,
// nunca de lo que la persona diga en el texto.
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from './db';

type CreateParams = Parameters<Anthropic['messages']['create']>[0];
export type ToolParam = NonNullable<CreateParams['tools']>[number];

export type UsuarioAgente = { id: number; nombre: string; correo: string; rol: string };

function schema(props: Record<string, unknown>, required: string[] = []) {
  return { type: 'object' as const, properties: props, required };
}

// ── Herramientas por rol ────────────────────────────────────────────────────
export const HERRAMIENTAS_PROPIETARIO: ToolParam[] = [
  {
    name: 'mis_vehiculos',
    description: 'Lista los vehículos publicados por este propietario (id, marca, modelo, año, placa). Úsala primero si no sabes de cuál vehículo habla la persona, o si tiene varios.',
    input_schema: schema({}),
  },
  {
    name: 'disponibilidad_vehiculo',
    description: 'Muestra las reservas que ocupan un vehículo en un mes dado, y si el propietario restringió manualmente los días disponibles de ese carro.',
    input_schema: schema({
      vehiculo_id: { type: 'integer', description: 'ID del vehículo (de mis_vehiculos)' },
      mes: { type: 'string', description: 'Mes a consultar, formato YYYY-MM. Si no lo dan, usa el mes actual.' },
    }, ['vehiculo_id', 'mes']),
  },
  {
    name: 'estado_pagos',
    description: 'Cuánto le deben pagar a este propietario (reservas con pago pendiente) y el total ya pagado recientemente.',
    input_schema: schema({}),
  },
  {
    name: 'detalle_reserva',
    description: 'Detalle completo de una reserva de uno de los vehículos de este propietario (fechas, cliente, estado, pago, total).',
    input_schema: schema({ reserva_id: { type: 'integer' } }, ['reserva_id']),
  },
];

export const HERRAMIENTAS_USUARIO: ToolParam[] = [
  {
    name: 'mis_reservas',
    description: 'Lista las reservas de este cliente (opcionalmente filtradas por estado).',
    input_schema: schema({
      estado: { type: 'string', description: "pendiente | confirmada | en_curso | completada | cancelada (opcional, si no lo dan trae todas)" },
    }),
  },
  {
    name: 'detalle_reserva',
    description: 'Detalle completo de una reserva de este cliente (fechas, vehículo, estado, pago, total).',
    input_schema: schema({ reserva_id: { type: 'integer' } }, ['reserva_id']),
  },
];

export const HERRAMIENTAS_ADMIN: ToolParam[] = [
  {
    name: 'calendario_reservas',
    description: 'Todas las reservas en un rango de fechas, con vehículo, propietario y cliente.',
    input_schema: schema({
      desde: { type: 'string', description: 'YYYY-MM-DD (opcional)' },
      hasta: { type: 'string', description: 'YYYY-MM-DD (opcional)' },
    }),
  },
  {
    name: 'pagos_pendientes',
    description: 'Total de pagos pendientes a propietarios, agrupado por propietario.',
    input_schema: schema({}),
  },
  {
    name: 'buscar_reserva',
    description: 'Busca reservas por placa del vehículo, nombre del cliente o nombre del propietario.',
    input_schema: schema({ texto: { type: 'string' } }, ['texto']),
  },
];

export function herramientasParaRol(rol: string): ToolParam[] {
  if (rol === 'propietario') return HERRAMIENTAS_PROPIETARIO;
  if (rol === 'admin') return HERRAMIENTAS_ADMIN;
  return HERRAMIENTAS_USUARIO;
}

// ── Ejecución de herramientas (siempre acotada al usuario identificado) ─────
type ReservaFila = Record<string, unknown>;

function reservasQueSolapan(vehiculoId: number, desde: string, hasta: string): ReservaFila[] {
  const db = getDb();
  return db.prepare(`
    SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.pago_estado, r.total, u.nombre AS cliente
    FROM reservas r JOIN usuarios u ON r.usuario_id = u.id
    WHERE r.vehiculo_id = ? AND r.estado != 'cancelada'
      AND NOT (r.fecha_fin < ? OR r.fecha_inicio > ?)
    ORDER BY r.fecha_inicio
  `).all(vehiculoId, desde, hasta) as ReservaFila[];
}

function rangoMes(mes: string): { desde: string; hasta: string } {
  const m = /^(\d{4})-(\d{2})$/.test(mes) ? mes : new Date().toISOString().slice(0, 7);
  const [y, mm] = m.split('-').map(Number);
  const desde = `${m}-01`;
  const ultimoDia = new Date(y, mm, 0).getDate();
  const hasta = `${m}-${String(ultimoDia).padStart(2, '0')}`;
  return { desde, hasta };
}

export async function ejecutarHerramienta(usuario: UsuarioAgente, nombre: string, input: Record<string, unknown>): Promise<unknown> {
  const db = getDb();

  if (usuario.rol === 'propietario') {
    if (nombre === 'mis_vehiculos') {
      return db.prepare('SELECT id, marca, modelo, anio, placa FROM vehiculos WHERE propietario_id = ?').all(usuario.id);
    }
    if (nombre === 'disponibilidad_vehiculo') {
      const vehiculoId = Number(input.vehiculo_id);
      const v = db.prepare('SELECT id, marca, modelo, dias_disponibles FROM vehiculos WHERE id = ? AND propietario_id = ?').get(vehiculoId, usuario.id) as { id: number; marca: string; modelo: string; dias_disponibles: string } | undefined;
      if (!v) return { error: 'Ese vehículo no existe o no es tuyo.' };
      const { desde, hasta } = rangoMes(String(input.mes || ''));
      const reservas = reservasQueSolapan(vehiculoId, desde, hasta);
      let diasAbiertos: string[] = [];
      try { diasAbiertos = JSON.parse(v.dias_disponibles || '[]'); } catch { diasAbiertos = []; }
      const diasAbiertosDelMes = diasAbiertos.filter(d => d >= desde && d <= hasta);
      return {
        vehiculo: `${v.marca} ${v.modelo}`, mes: `${desde} a ${hasta}`,
        reservas,
        restriccion_manual: diasAbiertos.length === 0
          ? 'El propietario no restringió manualmente los días — solo bloquean las reservas.'
          : `El propietario solo abrió estos días en todo el calendario (dentro de este mes): ${diasAbiertosDelMes.join(', ') || 'ninguno este mes'}.`,
      };
    }
    if (nombre === 'estado_pagos') {
      const rows = db.prepare(`
        SELECT r.id, r.fecha_inicio, r.fecha_fin, r.total, r.pago_estado, v.marca, v.modelo, u.nombre AS cliente
        FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id JOIN usuarios u ON r.usuario_id = u.id
        WHERE v.propietario_id = ? AND r.estado != 'cancelada'
        ORDER BY r.fecha_fin DESC LIMIT 20
      `).all(usuario.id) as ReservaFila[];
      const pendientes = rows.filter(r => r.pago_estado === 'pendiente');
      const totalPendiente = pendientes.reduce((s, r) => s + Number(r.total || 0), 0);
      return { total_pendiente: totalPendiente, reservas_pendientes: pendientes, reservas_recientes: rows.slice(0, 10) };
    }
    if (nombre === 'detalle_reserva') {
      const r = db.prepare(`
        SELECT r.*, v.marca, v.modelo, v.placa, u.nombre AS cliente, u.celular AS cliente_celular
        FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id JOIN usuarios u ON r.usuario_id = u.id
        WHERE r.id = ? AND v.propietario_id = ?
      `).get(Number(input.reserva_id), usuario.id);
      return r || { error: 'Esa reserva no existe o no es de uno de tus vehículos.' };
    }
  }

  if (usuario.rol === 'usuario') {
    if (nombre === 'mis_reservas') {
      const estado = input.estado ? String(input.estado) : null;
      const rows = estado
        ? db.prepare(`
            SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.pago_estado, r.total, v.marca, v.modelo, v.placa
            FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id
            WHERE r.usuario_id = ? AND r.estado = ? ORDER BY r.fecha_inicio DESC LIMIT 20
          `).all(usuario.id, estado)
        : db.prepare(`
            SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.pago_estado, r.total, v.marca, v.modelo, v.placa
            FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id
            WHERE r.usuario_id = ? ORDER BY r.fecha_inicio DESC LIMIT 20
          `).all(usuario.id);
      return rows;
    }
    if (nombre === 'detalle_reserva') {
      const r = db.prepare(`
        SELECT r.*, v.marca, v.modelo, v.placa, p.nombre AS propietario, p.celular AS propietario_celular
        FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id JOIN usuarios p ON v.propietario_id = p.id
        WHERE r.id = ? AND r.usuario_id = ?
      `).get(Number(input.reserva_id), usuario.id);
      return r || { error: 'Esa reserva no existe o no es tuya.' };
    }
  }

  if (usuario.rol === 'admin') {
    if (nombre === 'calendario_reservas') {
      const desde = String(input.desde || '0000-01-01');
      const hasta = String(input.hasta || '9999-12-31');
      return db.prepare(`
        SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.pago_estado, r.total,
               v.marca, v.modelo, v.placa, p.nombre AS propietario, u.nombre AS cliente
        FROM reservas r
        JOIN vehiculos v ON r.vehiculo_id = v.id
        JOIN usuarios p ON v.propietario_id = p.id
        JOIN usuarios u ON r.usuario_id = u.id
        WHERE r.estado != 'cancelada' AND NOT (r.fecha_fin < ? OR r.fecha_inicio > ?)
        ORDER BY r.fecha_inicio LIMIT 40
      `).all(desde, hasta);
    }
    if (nombre === 'pagos_pendientes') {
      const rows = db.prepare(`
        SELECT p.nombre AS propietario, r.total, v.marca, v.modelo, r.fecha_fin
        FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id JOIN usuarios p ON v.propietario_id = p.id
        WHERE r.pago_estado = 'pendiente' AND r.estado != 'cancelada'
      `).all() as ReservaFila[];
      const porPropietario: Record<string, number> = {};
      for (const r of rows) {
        const k = String(r.propietario);
        porPropietario[k] = (porPropietario[k] || 0) + Number(r.total || 0);
      }
      return { por_propietario: porPropietario, detalle: rows };
    }
    if (nombre === 'buscar_reserva') {
      const q = `%${String(input.texto || '')}%`;
      return db.prepare(`
        SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.pago_estado, r.total,
               v.marca, v.modelo, v.placa, p.nombre AS propietario, u.nombre AS cliente
        FROM reservas r
        JOIN vehiculos v ON r.vehiculo_id = v.id
        JOIN usuarios p ON v.propietario_id = p.id
        JOIN usuarios u ON r.usuario_id = u.id
        WHERE v.placa LIKE ? OR u.nombre LIKE ? OR p.nombre LIKE ?
        ORDER BY r.fecha_inicio DESC LIMIT 20
      `).all(q, q, q);
    }
  }

  return { error: `Herramienta desconocida: ${nombre}` };
}
