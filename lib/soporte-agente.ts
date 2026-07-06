// Motor del chat de soporte in-app: propietarios y clientes pueden escribirle a
// "DrivePass" con sus dudas y el asistente responde en el momento, usando las
// mismas herramientas de consulta que el asistente de WhatsApp más un
// conocimiento amplio de las políticas reales de la plataforma. Cuando no puede
// resolver algo con confianza, escala la conversación a un administrador humano
// en vez de inventar una respuesta.
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from './anthropic';
import { getDb } from './db';
import { herramientasParaRol, ejecutarHerramienta, type UsuarioAgente, type ToolParam } from './agente-herramientas';
import { comisionPlataforma } from './contabilidad';
import { HORAS_LIMITE_GRATIS, PCT_CANCELACION_TARDIA, HORAS_GRACIA_NO_SHOW, PCT_NO_SHOW } from './cancelacion';
import { MIN_NOCHES_RESERVA, MIN_DIAS_ABIERTOS_SEMANA, MIN_FINES_DE_SEMANA_MES, MAX_MESES_CERRADOS_ANIO, MIN_DISPONIBILIDAD_ANUAL_PCT } from './disponibilidad-reglas';

type CreateParams = Parameters<Anthropic['messages']['create']>[0];
type MessageParam = CreateParams['messages'][number];

const MAX_ITERACIONES = 6;
const MAX_HISTORIAL = 10;

const HERRAMIENTA_ESCALAR: ToolParam = {
  name: 'escalar_a_administrador',
  description: 'Úsala cuando NO puedas resolver la duda con las herramientas disponibles o con tu conocimiento de las políticas de DrivePass: quejas, reclamos de dinero, negociaciones especiales, problemas técnicos, disputas entre propietario y cliente, o cualquier cosa que necesite criterio humano. Un administrador la revisará pronto. Úsala también si la persona pide explícitamente hablar con una persona.',
  input_schema: {
    type: 'object',
    properties: { motivo: { type: 'string', description: 'Resumen breve (1-2 frases) de qué necesita resolver un humano' } },
    required: ['motivo'],
  },
};

function construirSystemPrompt(usuario: UsuarioAgente): string {
  const db = getDb();
  const rolTexto = usuario.rol === 'propietario' ? 'propietario de vehículo(s)' : 'cliente que alquila vehículos';
  const comision = (comisionPlataforma(db) * 100).toFixed(0);

  return `Eres el asistente de soporte de DrivePass (alquiler de carros entre particulares en Medellín, Colombia), respondiendo dentro del chat de la app. Hablas con ${usuario.nombre}, quien es ${rolTexto}. Solo tienes acceso a SUS PROPIOS datos — nunca inventes ni asumas datos de otras personas.

Responde en español, de forma natural, cálida y breve — como si fueras una persona real de soporte, no un robot leyendo políticas. Usa las herramientas para consultar datos reales (reservas, pagos, disponibilidad) antes de responder algo específico de la cuenta de la persona — nunca inventes fechas, montos ni estados.

POLÍTICAS REALES DE DRIVEPASS (úsalas para responder preguntas generales):
- Cancelación de una reserva: gratis si se cancela con ${HORAS_LIMITE_GRATIS}h o más de anticipación a la hora de recogida. Con menos anticipación, se cobra ${PCT_CANCELACION_TARDIA}% del total.
- No-show (el cliente no se presenta): el vehículo se guarda ${HORAS_GRACIA_NO_SHOW}h de gracia tras la hora de recogida; pasado ese tiempo se cobra ${PCT_NO_SHOW}% del total y el vehículo queda libre para otro alquiler.
- Alquiler mínimo: ${MIN_NOCHES_RESERVA} noches por reserva.
- Comisión actual de la plataforma: ${comision}% del valor del alquiler (el resto es para el propietario, se liquida después de confirmado el pago).
- Reglas de disponibilidad del propietario (su calendario): se recomienda mínimo ${MIN_DIAS_ABIERTOS_SEMANA} días abiertos por semana, mínimo ${MIN_FINES_DE_SEMANA_MES} fines de semana disponibles al mes, máximo ${MAX_MESES_CERRADOS_ANIO} meses completamente cerrados al año, y mínimo ${(MIN_DISPONIBILIDAD_ANUAL_PCT * 100).toFixed(0)}% de disponibilidad anual — esto es guía visible en su calendario, hoy no bloquea el guardado.
- Documentos: cédula/pasaporte y licencia de conducción (frente y dorso si no es pasaporte) se verifican con IA; los propietarios suben cédula, tarjeta de propiedad, SOAT, tecno-mecánica y seguro todo riesgo de su vehículo.
- Pico y placa: la app avisa automáticamente si el vehículo reservado tiene restricción ese día.
- Pagos: hoy no hay pasarela de pago real conectada — los cobros/pagos se calculan y se notifican, y el equipo de DrivePass los gestiona manualmente.
- Programa de referidos "Invita y gana" (si está activo): cada usuario tiene un código para compartir: quien invita gana un crédito cuando su referido completa su primera reserva pagada; el referido gana un descuento de bienvenida al registrarse con el código.

IMPORTANTE:
- Si la pregunta es sobre SUS PROPIOS datos (¿cuándo es mi reserva?, ¿cuánto me deben pagar?, ¿qué días tengo libres?), usa las herramientas.
- Si no puedes resolver la duda con las herramientas o estas políticas — quejas, reclamos de dinero específicos, disputas, algo técnico que no controlas, o cualquier cosa donde adivinar sería riesgoso — usa la herramienta escalar_a_administrador y avísale a la persona con calidez que un administrador la va a contactar pronto. No inventes una solución que no puedas garantizar.
- Si la persona tiene varios vehículos o reservas y no especifica cuál, pregunta primero en vez de adivinar.`;
}

export type RespuestaSoporte = { respuesta: string; escalar: boolean; motivo?: string };

export async function responderMensajeSoporte(usuario: UsuarioAgente, mensajeTexto: string, historial: MessageParam[]): Promise<RespuestaSoporte> {
  const anthropic = getAnthropic();
  const tools = [...herramientasParaRol(usuario.rol), HERRAMIENTA_ESCALAR];
  const system = construirSystemPrompt(usuario);

  const messages: MessageParam[] = [...historial, { role: 'user', content: mensajeTexto }];
  let escalar = false;
  let motivo = '';

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
      const respuesta = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : 'No pude generar una respuesta. Un administrador va a revisar tu mensaje pronto.';
      return { respuesta, escalar, motivo: motivo || undefined };
    }

    messages.push({ role: 'assistant', content: resp.content });

    const toolResults = [];
    for (const block of bloquesHerramienta) {
      if (block.type !== 'tool_use') continue;
      let resultado: unknown;
      if (block.name === 'escalar_a_administrador') {
        escalar = true;
        motivo = String((block.input as { motivo?: string })?.motivo || 'El asistente no pudo resolver la duda.');
        resultado = { ok: true, mensaje: 'Escalado — dile a la persona que un administrador la contactará pronto.' };
      } else {
        try {
          resultado = await ejecutarHerramienta(usuario, block.name, (block.input || {}) as Record<string, unknown>);
        } catch (e) {
          resultado = { error: e instanceof Error ? e.message : 'error al consultar' };
        }
      }
      toolResults.push({ type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(resultado) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    respuesta: 'Tu pregunta necesita varios pasos y no logré resolverla del todo — la puse en manos de un administrador, te contactamos pronto.',
    escalar: true,
    motivo: motivo || 'El asistente agotó los intentos sin resolver la duda.',
  };
}

// ── Conversación persistente (una por solicitante) ──────────────────────────
export type ConversacionSoporte = { id: number; solicitante_id: number; solicitante_rol: string; estado: string; motivo_escalada: string };

export function obtenerOCrearConversacion(usuarioId: number, rol: 'propietario' | 'usuario'): ConversacionSoporte {
  const db = getDb();
  const existente = db.prepare('SELECT * FROM conversaciones_soporte WHERE solicitante_id = ?').get(usuarioId) as ConversacionSoporte | undefined;
  if (existente) return existente;
  const result = db.prepare('INSERT INTO conversaciones_soporte (solicitante_id, solicitante_rol) VALUES (?, ?)').run(usuarioId, rol);
  return db.prepare('SELECT * FROM conversaciones_soporte WHERE id = ?').get(Number(result.lastInsertRowid)) as ConversacionSoporte;
}

export function cargarHistorialSoporte(conversacionId: number): MessageParam[] {
  const db = getDb();
  const filas = db.prepare(
    'SELECT remitente_tipo, contenido FROM mensajes_soporte WHERE conversacion_id = ? ORDER BY id DESC LIMIT ?'
  ).all(conversacionId, MAX_HISTORIAL) as Array<{ remitente_tipo: string; contenido: string }>;

  return filas.reverse().map(f => ({
    role: f.remitente_tipo === 'solicitante' ? 'user' as const : 'assistant' as const,
    content: f.contenido,
  }));
}
