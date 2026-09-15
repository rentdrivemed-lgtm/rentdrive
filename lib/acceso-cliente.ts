// Acceso a la cuenta de un cliente creada por el equipo (punto de atención).
//
// Problema a resolver: la reserva de mostrador crea la cuenta del cliente, pero
// el cliente no estuvo tecleando una contraseña. Hay que dejarlo entrar después a
// ver su reserva/factura sin que NADIE del equipo llegue a conocer su clave.
//
// Solución elegida (y por qué):
//   · La fila nace con una contraseña ALEATORIA que no se muestra ni se devuelve
//     en ninguna respuesta — existe solo para que `usuarios.password` no quede
//     vacío, que es lo que `perfilIncompleto` (lib/perfil.ts) exige para reservar.
//   · Se le manda al cliente, a SU correo, un enlace de un solo uso para que él
//     cree su contraseña. Reutiliza tal cual el flujo de "olvidé mi contraseña"
//     que ya existe (`usuarios.reset_token`/`reset_token_expira` →
//     /restablecer-password → POST /api/auth/restablecer-password), así que no
//     hay un segundo mecanismo de credenciales que mantener.
//   · El token NUNCA se devuelve al admin en la respuesta de la API. Si se le
//     devolviera, el empleado que registra la reserva podría fijar la contraseña
//     de la cuenta de ese cliente y entrar como él. Yendo solo por correo, el
//     único que puede activarla es el dueño del buzón.
//   · Si el cliente pierde el correo, puede usar "¿Olvidaste tu contraseña?" con
//     su correo, sin intervención del equipo.
//
// Vigencia más larga (72h) que la del reseteo normal (60 min): el correo de
// mostrador no lo pidió el cliente en ese instante, puede revisarlo al otro día.
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { appBaseUrl } from './operaciones';

type DB = Database.Database;

export const ACTIVACION_VIGENCIA_HORAS = 72;

/** Contraseña aleatoria que no conoce nadie (no se muestra, no se devuelve, no se loguea). */
export function passwordAleatoria(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Graba un token de un solo uso en la fila del usuario y lo devuelve.
 *
 * ROTACIÓN: `usuarios.reset_token` es UNA sola columna, compartida con
 * "olvidé mi contraseña" (POST /api/auth/olvide-password). Escribir aquí INVALIDA en
 * silencio cualquier enlace de reseteo en vuelo: si el cliente pidió su enlace hace
 * dos minutos y justo ahora se le crea una reserva en el mostrador, el correo viejo
 * deja de servir. Es la consecuencia buscada de reutilizar el mismo mecanismo (un solo
 * camino para fijar contraseña, no dos), y el daño máximo es que el cliente tenga que
 * volver a pedirlo — nunca al revés: el token nuevo se manda SOLO al buzón del titular,
 * así que rotarlo no le da acceso a nadie más. Lo que NO debe hacerse es "reusar el
 * token vivo que ya había": eso alargaría la vigencia de un token emitido por otro
 * flujo y, peor, lo haría legible desde acá.
 *
 * El token NUNCA se devuelve por la API ni se escribe en los logs de producción (ver
 * app/api/admin/reservas/route.ts).
 */
export function generarTokenActivacion(db: DB, usuarioId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + ACTIVACION_VIGENCIA_HORAS * 3600_000).toISOString();
  db.prepare('UPDATE usuarios SET reset_token = ?, reset_token_expira = ? WHERE id = ?').run(token, expira, usuarioId);
  return token;
}

/** Mismo destino que el correo de "olvidé mi contraseña". */
export function enlaceActivacion(token: string): string {
  const base = appBaseUrl() || 'http://localhost:3100';
  return `${base}/restablecer-password?token=${token}`;
}
