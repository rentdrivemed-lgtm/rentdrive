// WhatsApp bridge helper
export function whatsappHabilitado(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.WHATSAPP_ENABLED || '').toLowerCase());
}
export function aChatId(celular: string): string | null {
  const digits = (celular || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  const full = digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits;
  return `${full}@s.whatsapp.net`;
}
export type ResultadoEnvio = { enviado: boolean; detalle: string };
export async function enviarWhatsapp(celular: string, mensaje: string): Promise<ResultadoEnvio> {
  if (!whatsappHabilitado()) return { enviado: false, detalle: 'no enviado', };
  void celular; void mensaje;
  return { enviado: false, detalle: 'not implemented' };
}