// Helpers compartidos para endpoints que reciben una foto (multipart) y la mandan
// a la IA sin guardarla en disco. Extraído de app/api/registro/extraer-documento/
// para reutilizarlo también en app/api/vehiculos/extraer-matricula/ (mismo patrón:
// límite de tamaño con corte por stream + tipo MIME real por bytes mágicos).

import { NextRequest } from 'next/server';

export type MediaTypeImagen = 'image/jpeg' | 'image/png' | 'image/webp';

export const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';

/** Detecta el formato real por los bytes mágicos, ignorando lo que declare el cliente. */
export function tipoRealImagen(buf: Buffer): MediaTypeImagen | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Lee el body multipart como STREAM, cortando en cuanto se supera `maxBytes`, en
 * vez de esperar a que `req.formData()` termine de bufferizar todo el cuerpo.
 *
 * Por qué hace falta además de un chequeo de Content-Length antes de llamar a esto:
 * ese header lo declara el cliente y es perfectamente válido no mandarlo (p. ej.
 * con Transfer-Encoding: chunked); si falta, ese chequeo nunca corre y
 * `await req.formData()` bufferizaría el cuerpo completo en memoria ANTES de que
 * el código llegue a revisar `file.size`. Envolver el stream en un
 * `TransformStream` que corta al vuelo cierra ese hueco: el límite se impone
 * mientras se está leyendo, sin depender de ningún header declarado por el cliente.
 *
 * Limitación conocida y verificada: esto limita bytes de RED (lo que via por el
 * stream), no garantiza un techo de memoria de proceso *exacto* — Node puede
 * mantener en buffer algunos chunks ya leídos antes de que el corte se propague,
 * y decodificar/reconstruir el FormData todavía usa memoria proporcional a lo ya
 * leído hasta el corte (como mucho `maxBytes` más el tamaño de un chunk). Es una
 * cota real y muy por debajo de "sin límite", pero no es una garantía de memoria
 * bit-exacta.
 */
export async function formDataConLimite(req: NextRequest, maxBytes: number): Promise<FormData> {
  const body = req.body;
  if (!body) return req.formData();

  let total = 0;
  const limitador = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(new Error(PAYLOAD_TOO_LARGE));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const streamLimitado = body.pipeThrough(limitador);
  const reqLimitada = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: streamLimitado,
    // Node/undici lo exige cuando el body es un stream (no hay red real de por
    // medio acá, pero el constructor de Request lo valida igual).
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  return reqLimitada.formData();
}
