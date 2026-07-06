// Motor conversacional de WhatsApp (Fase 1: solo consultas de lectura).
// Identifica a quién escribe SOLO por el teléfono verificado del webhook (nunca por
// lo que diga el texto) y le da a Claude un set de herramientas acotado a su propio
// rol y a sus propios datos — un propietario nunca puede ver reservas de otro, etc.
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from './anthropic';
import { getDb } from './db';
import type { UsuarioWhatsapp } from './whatsapp';
import { herramientasParaRol, ejecutarHerramienta } from './agente-herramientas';

type CreateParams = Parameters<Anthropic['messages']['create']>[0];
type MessageParam = CreateParams['messages'][number];

const MAX_ITERACIONES = 5;
const MAX_HISTORIAL = 6; // últimos N mensajes (usuario+asistente) para dar continuidad

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
