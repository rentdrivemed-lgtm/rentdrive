// Comparación en tiempo constante del secreto de cron (`CRON_SECRET`).
// Estos endpoints (pico y placa, chequeo de mercado) aceptan una segunda puerta de
// entrada sin sesión para que un cron externo los dispare, y uno de ellos manda
// WhatsApp masivo a clientes/propietarios reales. Comparar con `===` filtra el
// secreto carácter a carácter por el tiempo de respuesta (timing attack teórico);
// `crypto.timingSafeEqual` compara en tiempo constante, pero exige que los dos
// buffers midan lo mismo o lanza — por eso se rechaza primero por longitud (sin
// comparar) en vez de dejar que la excepción decida.
import { timingSafeEqual } from 'crypto';

export function secretoCronValido(recibido: string | null | undefined, esperado: string | undefined): boolean {
  if (!esperado || !recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
