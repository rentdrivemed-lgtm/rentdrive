// WhatsApp Business Cloud API (Meta) — https://developers.facebook.com/docs/whatsapp/cloud-api
// Requiere WHATSAPP_ENABLED=true + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN en .env.local.
// Igual que Claude Vision/Resend: si falta algo, responde amable en vez de reventar.
const GRAPH_VERSION = 'v21.0';

export function whatsappHabilitado(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.WHATSAPP_ENABLED || '').toLowerCase());
}

/** Normaliza a dígitos con indicativo de país (asume Colombia +57 para celulares de 10 dígitos). */
function normalizarNumero(celular: string): string | null {
  const digits = (celular || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits;
}

export type ResultadoEnvio = { enviado: boolean; detalle: string };

async function llamarGraphAPI(body: Record<string, unknown>): Promise<ResultadoEnvio> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    return { enviado: false, detalle: 'Falta WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_ACCESS_TOKEN' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { enviado: false, detalle: data?.error?.message || `Graph API respondió ${res.status}` };
    }
    return { enviado: true, detalle: 'enviado' };
  } catch (e) {
    return { enviado: false, detalle: e instanceof Error ? e.message : 'error desconocido' };
  }
}

/**
 * Mensaje de texto libre. Solo lo entrega Meta si el destinatario te escribió en las
 * últimas 24h (ventana de servicio al cliente) — si no, usa `enviarWhatsappPlantilla`.
 */
export async function enviarWhatsapp(celular: string, mensaje: string): Promise<ResultadoEnvio> {
  if (!whatsappHabilitado()) return { enviado: false, detalle: 'WhatsApp desactivado (WHATSAPP_ENABLED)' };
  const to = normalizarNumero(celular);
  if (!to) return { enviado: false, detalle: 'Número de celular inválido' };
  return llamarGraphAPI({ messaging_product: 'whatsapp', to, type: 'text', text: { body: mensaje } });
}

/**
 * Mensaje por plantilla aprobada — necesario para primer contacto (ej. código de
 * verificación) fuera de la ventana de 24h. La plantilla debe existir y estar
 * aprobada en Meta Business Manager, con un único parámetro de texto en el cuerpo.
 */
export async function enviarWhatsappPlantilla(
  celular: string, plantilla: string, parametrosBody: string[], idioma = 'es'
): Promise<ResultadoEnvio> {
  if (!whatsappHabilitado()) return { enviado: false, detalle: 'WhatsApp desactivado (WHATSAPP_ENABLED)' };
  const to = normalizarNumero(celular);
  if (!to) return { enviado: false, detalle: 'Número de celular inválido' };
  return llamarGraphAPI({
    messaging_product: 'whatsapp', to, type: 'template',
    template: {
      name: plantilla,
      language: { code: idioma },
      components: [{ type: 'body', parameters: parametrosBody.map(text => ({ type: 'text', text })) }],
    },
  });
}

/** Envía el código de verificación: usa plantilla si está configurada (recomendado por Meta
 *  para códigos de un solo uso), y cae a texto libre si no — solo funcionará este último
 *  caso dentro de la ventana de 24h. */
export async function enviarWhatsappCodigo(celular: string, mensaje: string, codigo: string): Promise<ResultadoEnvio> {
  const plantilla = process.env.WHATSAPP_TEMPLATE_OTP;
  if (plantilla) return enviarWhatsappPlantilla(celular, plantilla, [codigo], process.env.WHATSAPP_TEMPLATE_LANG || 'es');
  return enviarWhatsapp(celular, mensaje);
}
