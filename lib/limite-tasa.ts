// Limitador de tasa en memoria (ventana fija por clave).
//
// Pensado para endpoints públicos que cuestan plata por invocación (ej. leer un
// documento con IA antes de que la persona tenga cuenta). NO es un limitador
// distribuido: el estado vive en el proceso de Node, así que se reinicia con cada
// redeploy y no se comparte si algún día hay más de una instancia. Para el
// tamaño actual del despliegue (una sola instancia en Railway) es suficiente y
// evita meter Redis solo para esto. Si en el futuro hay varias instancias, el
// límite efectivo se multiplica por el número de instancias — hay que moverlo a
// un store compartido.

type Ventana = { conteo: number; expira: number };

const cubos = new Map<string, Ventana>();
let ultimaLimpieza = 0;

// La memoria se libera de forma perezosa: cada minuto (como mucho) se barren las
// ventanas vencidas. Sin esto, un atacante que rote IPs haría crecer el Map sin
// techo.
function limpiar(ahora: number) {
  if (ahora - ultimaLimpieza < 60_000) return;
  ultimaLimpieza = ahora;
  for (const [clave, v] of cubos) {
    if (v.expira <= ahora) cubos.delete(clave);
  }
}

/**
 * Consume un intento para `clave`.
 * Devuelve los segundos que faltan para poder reintentar si se pasó del límite,
 * o null si el intento está permitido.
 */
export function consumirIntento(clave: string, max: number, ventanaMs: number): number | null {
  const ahora = Date.now();
  limpiar(ahora);

  const actual = cubos.get(clave);
  if (!actual || actual.expira <= ahora) {
    cubos.set(clave, { conteo: 1, expira: ahora + ventanaMs });
    return null;
  }
  if (actual.conteo >= max) {
    return Math.max(1, Math.ceil((actual.expira - ahora) / 1000));
  }
  actual.conteo++;
  return null;
}

/**
 * IP del cliente detrás del proxy de Railway. `x-forwarded-for` es falsificable
 * por quien hable directo con el servidor, pero en Railway el borde lo reescribe,
 * así que el primer valor es la IP real del visitante. Se usa solo para limitar
 * tasa (nunca para autorizar).
 */
export function ipCliente(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const primera = xff.split(',')[0].trim();
    if (primera) return primera;
  }
  return req.headers.get('x-real-ip')?.trim() || 'desconocida';
}
