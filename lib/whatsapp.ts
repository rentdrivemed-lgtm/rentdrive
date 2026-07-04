// WhatsApp Business Cloud API (Meta) — https://developers.facebook.com/docs/whatsapp/cloud-api
// Requiere WHATSAPP_ENABLED=true + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN en .env.local.
// Igual que Claude Vision/Resend: si falta algo, responde amable en vez de reventar.
import crypto from 'crypto';
import { getDb } from './db';

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

/**
 * Verifica la firma que Meta manda en cada webhook (header `X-Hub-Signature-256`),
 * calculada con HMAC-SHA256 sobre el cuerpo crudo usando el App Secret de Meta.
 * Sin esto, cualquiera podría mandar un POST al webhook fingiendo ser un número
 * de teléfono ajeno y sacar información de otra persona.
 *
 * Si WHATSAPP_APP_SECRET no está configurado, se deja pasar (para poder seguir
 * desarrollando localmente) — pero es OBLIGATORIO configurarlo antes de producción.
 */
export function verificarFirmaWebhook(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type UsuarioWhatsapp = { id: number; nombre: string; correo: string; rol: string };

function numeroCompletoUsuario(indicativo: string, celular: string): string {
  const dial = (indicativo || '').replace(/\D/g, '');
  const num = (celular || '').replace(/\D/g, '');
  if (!dial && num.length === 10 && num.startsWith('3')) return `57${num}`;
  return `${dial || '57'}${num}`;
}

/**
 * Identifica quién escribe SOLO por el número verificado del webhook — nunca por
 * lo que la persona diga en el texto (eso sería fácil de falsificar: "soy el
 * propietario del carro X" no debe otorgar acceso a los datos de ese carro).
 */
export function buscarUsuarioPorTelefono(waFrom: string): UsuarioWhatsapp | null {
  const digits = (waFrom || '').replace(/\D/g, '');
  if (!digits) return null;
  const db = getDb();
  const usuarios = db.prepare(
    "SELECT id, nombre, correo, rol, celular, celular_indicativo FROM usuarios WHERE estado_cuenta = 'activa' AND celular != ''"
  ).all() as Array<{ id: number; nombre: string; correo: string; rol: string; celular: string; celular_indicativo: string }>;

  for (const u of usuarios) {
    if (numeroCompletoUsuario(u.celular_indicativo, u.celular) === digits) {
      return { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol };
    }
  }
  return null;
}
