import { NextRequest, NextResponse } from 'next/server';
import { buscarUsuarioPorTelefono, enviarWhatsapp, verificarFirmaWebhook, whatsappHabilitado } from '@/lib/whatsapp';
import { cargarHistorial, guardarMensaje, responderMensajeWhatsapp } from '@/lib/whatsapp-agente';
import { tieneClaveAnthropic } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Meta llama a este GET una sola vez, al configurar el webhook en el dashboard,
// para confirmar que el servidor es dueño de la URL.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge || '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

type MensajeEntrante = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
};

function extraerMensajes(payload: unknown): MensajeEntrante[] {
  try {
    const entradas = (payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: MensajeEntrante[] } }> }> })?.entry || [];
    const mensajes: MensajeEntrante[] = [];
    for (const entrada of entradas) {
      for (const cambio of entrada.changes || []) {
        for (const m of cambio.value?.messages || []) mensajes.push(m);
      }
    }
    return mensajes;
  } catch {
    return [];
  }
}

// Meta reintenta hasta 7 días si no respondemos 200 rápido — por eso SIEMPRE
// devolvemos 200 aquí (salvo firma inválida), y cualquier error interno solo
// queda en el log del servidor, nunca como respuesta no-200 a Meta.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verificarFirmaWebhook(raw, req.headers.get('x-hub-signature-256'))) {
    console.error('[whatsapp/webhook] Firma inválida — posible solicitud falsificada.');
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // payload no parseable, no hay nada que procesar
  }

  const mensajes = extraerMensajes(payload);

  for (const msg of mensajes) {
    procesarMensaje(msg).catch(e => console.error('[whatsapp/webhook] Error procesando mensaje:', e instanceof Error ? e.message : e));
  }

  return NextResponse.json({ ok: true });
}

async function procesarMensaje(msg: MensajeEntrante) {
  if (msg.type !== 'text' || !msg.text?.body) {
    if (whatsappHabilitado()) {
      await enviarWhatsapp(msg.from, 'Por ahora solo puedo leer mensajes de texto 🙂. Escríbeme tu pregunta.');
    }
    return;
  }

  const texto = msg.text.body.slice(0, 1000); // límite defensivo contra mensajes gigantes
  const usuario = buscarUsuarioPorTelefono(msg.from);

  if (!usuario) {
    const respuesta = 'No encontré una cuenta de DrivePass con este número. Si ya tienes cuenta, verifica que el celular registrado sea el mismo con el que escribes; si no, regístrate en drivepasscol.com.';
    guardarMensaje(msg.from, null, texto, respuesta, msg.id);
    if (whatsappHabilitado()) await enviarWhatsapp(msg.from, respuesta);
    return;
  }

  if (!tieneClaveAnthropic()) {
    const respuesta = 'El asistente de WhatsApp todavía no está activado. Por ahora consulta esta información desde drivepasscol.com.';
    guardarMensaje(msg.from, usuario, texto, respuesta, msg.id);
    if (whatsappHabilitado()) await enviarWhatsapp(msg.from, respuesta);
    return;
  }

  const historial = cargarHistorial(msg.from);
  let respuesta: string;
  try {
    respuesta = await responderMensajeWhatsapp(usuario, texto, historial);
  } catch (e) {
    console.error('[whatsapp/webhook] Error del asistente:', e instanceof Error ? e.message : e);
    respuesta = 'Tuve un problema respondiendo tu mensaje. Intenta de nuevo en un momento.';
  }

  guardarMensaje(msg.from, usuario, texto, respuesta, msg.id);
  if (whatsappHabilitado()) await enviarWhatsapp(msg.from, respuesta);
}
