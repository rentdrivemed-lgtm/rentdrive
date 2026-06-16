// Envío de WhatsApp para notificaciones de operaciones.
//
// Por ahora el único canal disponible es el "bridge" local de hermes
// (POST http://localhost:3000/send { chatId, message }). El envío está
// APAGADO por defecto: solo se intenta si WHATSAPP_ENABLED está activo.
// Así el tablero de operaciones funciona aunque no haya canal configurado,
// y cada intento queda registrado como "enviado" o "no enviado: <razón>".
//
// Variables de entorno (.env.local):
//   WHATSAPP_ENABLED=true            -> activa el envío real
//   WHATSAPP_BRIDGE_URL=http://localhost:3000  -> URL del bridge (opcional)

const BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'http://localhost:3000';

export function whatsappHabilitado(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.WHATSAPP_ENABLED || '').toLowerCase());
}

// Convierte un celular colombiano a un chatId de WhatsApp (JID).
// Acepta "300 123 4567", "+57 300...", "57300...", etc.
export function aChatId(celular: string): string | null {
  const digits = (celular || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  // 10 dígitos que empiezan en 3 -> celular CO sin indicativo: anteponer 57.
  const full = digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits;
  return `${full}@s.whatsapp.net`;
}

export type ResultadoEnvio = { enviado: boolean; detalle: string };

export async function enviarWhatsapp(celular: string, mensaje: string): Promise<ResultadoEnvio> {
  if (!whatsappHabilitado()) {
    return { enviado: false, detalle: 'no enviado: WhatsApp deshabilitado (define WHATSAPP_ENABLED=true)' };
  }
  const chatId = aChatId(celular);
  if (!chatId) return { enviado: false, detalle: 'no enviado: celular inválido o vacío' };

  try {
    const res = await fetch(`${BRIDGE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: mensaje }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }));
      return { enviado: false, detalle: `no enviado: bridge respondió ${res.status}${d.error ? ` (${d.error})` : ''}` };
    }
    return { enviado: true, detalle: 'enviado' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error desconocido';
    return { enviado: false, detalle: `no enviado: ${msg}` };
  }
}
