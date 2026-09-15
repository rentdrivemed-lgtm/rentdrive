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
 * Mira el estado de `clave` SIN consumir nada.
 * Devuelve los segundos que faltan para poder reintentar si el cubo ya está
 * lleno, o null si un intento estaría permitido.
 *
 * Existe para las acciones que se limitan con VARIOS cubos a la vez (ej. la
 * inspección con IA: cubo corto + diario + global). Consumiéndolos en cascada,
 * un rechazo del último gasta intentos de los anteriores, así que un actor
 * podría quemar su cuota diaria contra rechazos causados por el tráfico de
 * otros. Con esto se evalúan los tres primero y solo se consume si TODOS pasan.
 */
export function verificarIntento(clave: string, max: number): number | null {
  const ahora = Date.now();
  const actual = cubos.get(clave);
  if (!actual || actual.expira <= ahora) return null;
  if (actual.conteo >= max) return Math.max(1, Math.ceil((actual.expira - ahora) / 1000));
  return null;
}

/**
 * IP del cliente detrás del proxy de Railway. `x-forwarded-for` puede traer una
 * cadena de varios saltos ("cliente, proxy1, proxy2, ..."): cada proxy AGREGA su
 * valor al final de lo que recibió, no lo reemplaza. Con exactamente UN proxy
 * confiable delante de la app (el borde de Railway), el único valor en el que se
 * puede confiar es el ÚLTIMO: es el que puso ese proxy al recibir la conexión
 * directa, y un atacante no puede escribir nada después de su propio salto. El
 * PRIMER valor, en cambio, lo pone el cliente original en su request y lo puede
 * falsificar libremente (`X-Forwarded-For: 1.2.3.4` inventado). Se usa solo para
 * limitar tasa (nunca para autorizar).
 */
export function ipCliente(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const partes = xff.split(',').map(s => s.trim()).filter(Boolean);
    const ultima = partes.pop();
    if (ultima) return ultima;
  }
  return req.headers.get('x-real-ip')?.trim() || 'desconocida';
}
