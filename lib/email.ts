// Envío de correo (verificación de la calculadora de propietarios).
// Igual que WhatsApp/Claude Vision: si falta la API key, el endpoint responde
// amable en vez de reventar — no configures nada más para que arranque el resto de la app.
export function emailHabilitado(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export type ResultadoEnvio = { enviado: boolean; detalle: string };

export async function enviarCorreo(destino: string, asunto: string, textoPlano: string): Promise<ResultadoEnvio> {
  if (!emailHabilitado()) return { enviado: false, detalle: 'RESEND_API_KEY no configurada' };

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const remitente = process.env.RESEND_FROM || 'RentDrive <onboarding@resend.dev>';
    const { error } = await resend.emails.send({ from: remitente, to: destino, subject: asunto, text: textoPlano });
    if (error) return { enviado: false, detalle: error.message };
    return { enviado: true, detalle: 'enviado' };
  } catch (e) {
    return { enviado: false, detalle: e instanceof Error ? e.message : 'error desconocido' };
  }
}
