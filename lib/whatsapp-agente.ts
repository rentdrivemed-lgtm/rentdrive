// Motor conversacional de WhatsApp (Fase 1: solo consultas de lectura).
// Identifica a quién escribe SOLO por el teléfono verificado del webhook (nunca por
// lo que diga el texto) y le da a Claude un set de herramientas acotado a su propio
// rol y a sus propios datos — un propietario nunca puede ver reservas de otro, etc.
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from './anthropic';
import { getDb } from './db';
import type { UsuarioWhatsapp } from './whatsapp';

type CreateParams = Parameters<Anthropic['messages']['create']>[0];
type MessageParam = CreateParams['messages'][number];
type ToolParam = NonNullable<CreateParams['tools']>[number];

const MAX_ITERACIONES = 5;
const MAX_HISTORIAL = 6; // últimos N mensajes (usuario+asistente) para dar continuidad

function schema(props: Record<string, unknown>, required: string[] = []) {
  return { type: 'object' as const, properties: props, required };
}

// ── Herramientas por rol ────────────────────────────────────────────────────
const HERRAMIENTAS_PROPIETARIO: ToolParam[] = [
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

const HERRAMIENTAS_USUARIO: ToolParam[] = [
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

const HERRAMIENTAS_ADMIN: ToolParam[] = [
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

function herramientasParaRol(rol: string): ToolParam[] {
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

async function ejecutarHerramienta(usuario: UsuarioWhatsapp, nombre: string, input: Record<string, unknown>): Promise<unknown> {
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

// ── Prompt de sistema ────────────────────────────────────────────────────────
function construirSystemPrompt(usuario: UsuarioWhatsapp): string {
  const rolTexto = usuario.rol === 'propietario' ? 'propietario de vehículo(s)' : usuario.rol === 'admin' ? 'administrador de DrivePass' : 'cliente que alquila vehículos';
  return `Eres el asistente de WhatsApp de DrivePass (alquiler de carros entre particulares en Medellín, Colombia). Hablas con ${usuario.nombre}, quien es ${rolTexto}. Solo tienes acceso a SUS PROPIOS datos, nunca inventes ni asumas datos de otras personas.

Responde en español, breve y natural para WhatsApp (mensajes cortos, sin tablas ni markdown pesado, emojis con moderación). Usa las herramientas para consultar datos reales antes de responder — nunca inventes fechas, montos ni estados.

IMPORTANTE — estás en la Fase 1 de este asistente: SOLO puedes consultar información (disponibilidad, calendario, pagos, estado de reservas). Todavía NO puedes agendar, bloquear días, agregar días a una reserva, cambiar estados ni cobrar nada. Si te piden algo que modifica datos, dilo con amabilidad y sugiere hacerlo por ahora desde la app (drivepasscol.com) — próximamente vas a poder hacer esas acciones por aquí también.

Si la persona tiene varios vehículos o reservas y no especifica cuál, pregunta primero en vez de adivinar.`;
}

// ── Historial de conversación ────────────────────────────────────────────────
export function cargarHistorial(telefono: string): MessageParam[] {
  const db = getDb();
  const filas = db.prepare(
    'SELECT entrante, respuesta FROM whatsapp_mensajes WHERE telefono = ? ORDER BY id DESC LIMIT ?'
  ).all(telefono, MAX_HISTORIAL / 2) as Array<{ entrante: string; respuesta: string }>;

  const historial: MessageParam[] = [];
  for (const f of filas.reverse()) {
    historial.push({ role: 'user', content: f.entrante });
    if (f.respuesta) historial.push({ role: 'assistant', content: f.respuesta });
  }
  return historial;
}

export function guardarMensaje(telefono: string, usuario: UsuarioWhatsapp | null, entrante: string, respuesta: string, waMessageId: string) {
  const db = getDb();
  db.prepare(
    'INSERT INTO whatsapp_mensajes (telefono, usuario_id, rol, entrante, respuesta, wa_message_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(telefono, usuario?.id ?? null, usuario?.rol ?? '', entrante, respuesta, waMessageId);
}

// ── Loop principal ───────────────────────────────────────────────────────────
export async function responderMensajeWhatsapp(usuario: UsuarioWhatsapp, mensajeTexto: string, historial: MessageParam[]): Promise<string> {
  const anthropic = getAnthropic();
  const tools = herramientasParaRol(usuario.rol);
  const system = construirSystemPrompt(usuario);

  const messages: MessageParam[] = [...historial, { role: 'user', content: mensajeTexto }];

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system,
      tools,
      messages,
    });

    const bloquesHerramienta = resp.content.filter(b => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || bloquesHerramienta.length === 0) {
      const textBlock = resp.content.find(b => b.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text.trim() : 'No pude generar una respuesta. Intenta de nuevo en un momento.';
    }

    messages.push({ role: 'assistant', content: resp.content });

    const toolResults = [];
    for (const block of bloquesHerramienta) {
      if (block.type !== 'tool_use') continue;
      let resultado: unknown;
      try {
        resultado = await ejecutarHerramienta(usuario, block.name, (block.input || {}) as Record<string, unknown>);
      } catch (e) {
        resultado = { error: e instanceof Error ? e.message : 'error al consultar' };
      }
      toolResults.push({ type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(resultado) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return 'Tu pregunta necesita varios pasos y no logré resolverla — intenta de nuevo o contáctanos directamente.';
}
