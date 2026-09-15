// ── Descarga HTTP acotada (solo servidor) ───────────────────────────────────
//
// Un único punto por el que el SERVIDOR baja archivos cuya dirección salió de la
// base de datos (fotos del servicio para el PDF del acta, documentos e imágenes
// para la IA). Antes cada llamador hacía `fetch(url)` + `await resp.arrayBuffer()`
// a pelo, y eso deja dos agujeros abiertos:
//
//  1. REDIRECCIONES. Aunque la URL guardada apunte a un host permitido, ese host
//     puede responder `302` hacia `http://169.254.169.254/…` o `http://10.0.0.5/`.
//     `fetch` sigue las redirecciones por defecto, así que la allowlist de destino
//     se evalúa sobre la primera URL y la petición termina en otra parte. Con
//     `redirect: 'manual'` la respuesta 3xx llega tal cual y se rechaza acá.
//  2. TAMAÑO. `arrayBuffer()` no tiene techo: bastaba con que una URL respondiera
//     un archivo gigante para que el proceso se quedara sin memoria (y el acta baja
//     hasta 16 fotos seguidas). Acá se mira `Content-Length` y, como un servidor
//     puede mentir u omitirlo, se corta leyendo el cuerpo por trozos.
//
// NO hace la allowlist de destino: eso lo decide cada llamador (las fotos de
// servicio con `esUrlFotoSegura` de lib/fotos-servicio.ts, que es el módulo puro
// compartido con las pantallas). Acá solo se acota lo que ya se decidió pedir.

export type OpcionesDescarga = {
  /** Corta la petición completa si el servidor remoto se queda colgado. */
  timeoutMs?: number;
  /** Tope duro del cuerpo. Se comprueba antes (Content-Length) y durante la lectura. */
  maxBytes?: number;
};

const TIMEOUT_POR_DEFECTO_MS = 20_000;
const MAX_BYTES_POR_DEFECTO = 15 * 1024 * 1024;

export type ArchivoDescargado = { buffer: Buffer; contentType: string };

function mb(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Baja `url` con tope de tiempo y de tamaño, y SIN seguir redirecciones.
 * Lanza con un mensaje legible si algo no cuadra: el llamador decide si eso es un
 * fallo del acta completa (no lo es: se anota la foto como no incrustada) o un
 * error para el usuario.
 */
export async function descargarAcotado(url: string, opts?: OpcionesDescarga): Promise<ArchivoDescargado> {
  const maxBytes = opts?.maxBytes ?? MAX_BYTES_POR_DEFECTO;
  const resp = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(opts?.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS),
  });

  // `redirect: 'manual'` devuelve la 3xx tal cual (y en algunos runtimes un
  // `type: 'opaqueredirect'` con status 0). Las dos cosas se rechazan: no se sigue
  // a un destino que no pasó por la allowlist del llamador.
  if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
    throw new Error(`No se pudo descargar ${url}: el servidor respondió una redirección (${resp.status}) y no se siguen redirecciones`);
  }
  if (!resp.ok) throw new Error(`No se pudo descargar ${url}: ${resp.status}`);

  const declarado = Number(resp.headers.get('content-length') || 0);
  if (declarado > maxBytes) {
    throw new Error(`El archivo pesa demasiado (${mb(declarado)}, máximo ${mb(maxBytes)})`);
  }

  const contentType = (resp.headers.get('content-type') || '').split(';')[0].trim();

  // Sin cuerpo legible por trozos (no debería pasar en Node 18+), se cae al camino
  // clásico pero con el Content-Length ya validado arriba.
  if (!resp.body) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`El archivo pesa demasiado (máximo ${mb(maxBytes)})`);
    return { buffer, contentType };
  }

  const trozos: Buffer[] = [];
  let total = 0;
  const lector = resp.body.getReader();
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Cancelar en cuanto se pasa: no se acumula el resto del archivo en memoria.
        throw new Error(`El archivo pesa demasiado (más de ${mb(maxBytes)})`);
      }
      trozos.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    await lector.cancel().catch(() => { /* ya terminó o ya falló */ });
  }

  return { buffer: Buffer.concat(trozos, total), contentType };
}
