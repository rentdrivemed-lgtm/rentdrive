// Verificación de correo por código de un solo uso (OTP) — activación de cuenta.
//
// Mismo patrón de diseño que la verificación de leads de propietarios
// (app/api/leads-propietarios/{route,verificar,reenviar}.ts + columnas
// codigo/codigo_expira/codigo_generado_at/codigo_intentos/verificado en
// leads_propietarios), adaptado a cuentas de usuario reales: expiración,
// límite de intentos y reenvío con cooldown guardados en la propia fila de
// `usuarios` (columnas `correo_*`, ver migración en lib/db.ts).
//
// Diferencia clave con el flujo de leads (anónimo, identificado por un id
// público en el body): aquí el usuario ya tiene sesión, así que el código
// SIEMPRE se compara contra el correo del usuario autenticado (getCurrentUser()
// en los route handlers) — nunca contra un id que llegue en el body. Evita
// que alguien intente verificar/reenviar el código de otra cuenta.
import { randomInt } from 'crypto';
import { getDb } from './db';
import { emailHabilitado } from './email';

export const CODIGO_CORREO_NO_VERIFICADO = 'correo_no_verificado';
export const MENSAJE_CORREO_NO_VERIFICADO = 'Verifica tu correo antes de continuar.';

export const CODIGO_VIGENCIA_MIN = 20;
export const MAX_INTENTOS = 5;
export const REENVIO_COOLDOWN_SEGUNDOS = 45;

export function generarCodigoCorreo(): string {
  // crypto.randomInt (CSPRNG del propio Node) en vez de Math.random(): un OTP de
  // 6 dígitos generado con un PRNG no criptográfico es, en teoría, predecible.
  return String(randomInt(100000, 1000000));
}

export function expiraEnMinutos(min: number, desde: Date = new Date()): string {
  return new Date(desde.getTime() + min * 60_000).toISOString();
}

export function mensajeCodigoCorreo(nombre: string, codigo: string): string {
  return `Hola ${nombre.split(' ')[0]}, tu código para verificar tu correo en RentDrive es: ${codigo}. Vence en ${CODIGO_VIGENCIA_MIN} minutos.`;
}

type FilaCorreoVerificado = { correo_verificado: number };

/**
 * true si la cuenta debe quedar bloqueada para reservar/publicar por no haber
 * verificado su correo todavía.
 *
 * Kill switch deliberado: si el envío de correo no está configurado
 * (`emailHabilitado()` === false, ver lib/email.ts — falta RESEND_API_KEY), el
 * gate queda INERTE y nunca bloquea a nadie. Mismo criterio que
 * WHATSAPP_ENABLED apagado no rompe el resto del sistema: no tiene sentido
 * exigirle a un usuario nuevo un código que la plataforma no puede enviarle
 * hoy. En cuanto se configure RESEND_API_KEY, el gate se activa solo (sin
 * tocar código) para todas las cuentas que sigan con `correo_verificado = 0`.
 */
export function correoNoVerificado(userId: number): boolean {
  if (!emailHabilitado()) return false;
  const db = getDb();
  const fila = db.prepare('SELECT correo_verificado FROM usuarios WHERE id = ?').get(userId) as FilaCorreoVerificado | undefined;
  if (!fila) return true;
  return !fila.correo_verificado;
}
