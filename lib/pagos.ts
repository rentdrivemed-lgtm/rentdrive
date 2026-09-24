// Cliente de la pasarela Wompi — cobros y fuentes de pago (tarjeta tokenizada)
import crypto from 'crypto';

const BASE_URL = process.env.WOMPI_BASE_URL || 'https://sandbox.wompi.co/v1';
// La llave pública no es secreta (Wompi la expone al navegador para tokenizar tarjetas),
// por eso reutilizamos la misma variable NEXT_PUBLIC_ también aquí en el servidor.
const PUBLIC_KEY = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || '';
const EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET || '';
const INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET || '';

export type EstadoTransaccion = 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR' | 'VOIDED';

export type Transaccion = {
  id: string;
  status: EstadoTransaccion;
  amount_in_cents: number;
  reference: string;
  // Presente cuando el método de pago es tarjeta — lo usa el checkout para
  // guardar marca/últimos 4 sin haber visto nunca el número real (el widget de
  // Wompi es quien lo capturó).
  payment_method?: { extra?: { brand?: string; last_four?: string } };
};

class ErrorWompi extends Error {
  constructor(message: string, public detalle?: unknown) { super(message); }
}

async function llamarWompi<T>(path: string, opts: { method?: string; body?: unknown; llave?: string } = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.llave ? { Authorization: `Bearer ${opts.llave}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.reason || json?.error?.messages?.[0] || 'Error al comunicarse con Wompi';
    throw new ErrorWompi(msg, json);
  }
  return json as T;
}

export async function obtenerTokensAceptacion(): Promise<{ acceptanceToken: string; personalAuthToken: string | null }> {
  const json = await llamarWompi<{ data: {
    presigned_acceptance: { acceptance_token: string };
    presigned_personal_data_auth?: { acceptance_token: string };
  } }>(`/merchants/${PUBLIC_KEY}`);
  return {
    acceptanceToken: json.data.presigned_acceptance.acceptance_token,
    personalAuthToken: json.data.presigned_personal_data_auth?.acceptance_token || null,
  };
}

export async function crearFuentePago(params: {
  token: string; correo: string; acceptanceToken: string; personalAuthToken: string | null;
}): Promise<{ id: number; bin: string; ultimos4: string }> {
  const json = await llamarWompi<{ data: {
    id: number;
    public_data?: { bin?: string; last_four?: string };
  } }>('/payment_sources', {
    method: 'POST',
    llave: PRIVATE_KEY,
    body: {
      type: 'CARD',
      token: params.token,
      customer_email: params.correo,
      acceptance_token: params.acceptanceToken,
      ...(params.personalAuthToken ? { accept_personal_auth: params.personalAuthToken } : {}),
    },
  });
  return {
    id: json.data.id,
    bin: json.data.public_data?.bin || '',
    ultimos4: json.data.public_data?.last_four || '',
  };
}

/**
 * Marca de la tarjeta a partir del BIN (los primeros dígitos) — se usa cuando
 * se guarda una tarjeta SIN cobrarla (ver /guardar-tarjeta), así que no hay
 * una transacción de la que sacar `payment_method.extra.brand` como en el
 * checkout normal (app/api/reservas/route.ts).
 */
export function marcaPorBin(bin: string): string {
  if (/^4/.test(bin)) return 'VISA';
  if (/^5[1-5]/.test(bin) || /^2[2-7]/.test(bin)) return 'MASTERCARD';
  if (/^3[47]/.test(bin)) return 'AMEX';
  return '';
}

export async function crearTransaccion(params: {
  montoEnCentavos: number; referencia: string; correo: string; acceptanceToken: string;
  fuentePagoId?: number; tokenTarjeta?: string; recurrente?: boolean;
}): Promise<Transaccion> {
  const paymentMethod = params.fuentePagoId
    ? { installments: 1 }
    : { type: 'CARD', token: params.tokenTarjeta, installments: 1 };

  // Wompi exige la firma de integridad también en transacciones creadas por API
  // directa (no solo en el widget): SHA256(referencia + monto + moneda + secreto).
  const signature = crypto
    .createHash('sha256')
    .update(`${params.referencia}${params.montoEnCentavos}COP${INTEGRITY_SECRET}`)
    .digest('hex');

  const json = await llamarWompi<{ data: Transaccion }>('/transactions', {
    method: 'POST',
    llave: PRIVATE_KEY,
    body: {
      amount_in_cents: params.montoEnCentavos,
      currency: 'COP',
      customer_email: params.correo,
      reference: params.referencia,
      acceptance_token: params.acceptanceToken,
      signature,
      payment_method: paymentMethod,
      ...(params.fuentePagoId ? { payment_source_id: params.fuentePagoId } : {}),
      // COF (Credential On File): le indica al banco que el titular ya autorizó
      // este cobro de antemano (tarjeta guardada), lo que sube la tasa de aprobación
      // y evita que exija un reto 3DS que el cliente no está presente para resolver.
      // Solo tiene efecto en tarjetas Visa/Mastercard con procesador RBM; en cualquier
      // otro caso Wompi lo ignora sin error.
      ...(params.recurrente !== undefined ? { recurrent: params.recurrente } : {}),
    },
  });
  return json.data;
}

export async function consultarTransaccion(id: string): Promise<Transaccion> {
  const json = await llamarWompi<{ data: Transaccion }>(`/transactions/${id}`, { llave: PRIVATE_KEY });
  return json.data;
}

// Reversa una transacción de tarjeta ya aprobada (usado al rechazar una reserva
// cuyo alquiler ya se cobró). Solo aplica a tarjeta y dentro de la ventana que
// permite Wompi; si falla, quien llama debe avisarle al admin para reembolso manual.
export async function anularTransaccion(id: string): Promise<Transaccion> {
  const json = await llamarWompi<{ data: Transaccion }>(`/transactions/${id}/void`, { method: 'POST', llave: PRIVATE_KEY });
  return json.data;
}

// Las transacciones con tarjeta en Wompi normalmente resuelven en segundos, pero
// pueden quedar en PENDING un instante. Esperamos un resultado final antes de
// responderle al cliente, sin bloquear indefinidamente (el webhook es la fuente
// de verdad final si esto se agota).
export async function esperarResultadoTransaccion(id: string, intentos = 5, esperaMs = 1200): Promise<Transaccion> {
  let actual = await consultarTransaccion(id);
  for (let i = 0; i < intentos && actual.status === 'PENDING'; i++) {
    await new Promise(r => setTimeout(r, esperaMs));
    actual = await consultarTransaccion(id);
  }
  return actual;
}

function valorAnidado(obj: unknown, ruta: string): string {
  const partes = ruta.split('.');
  let actual: unknown = obj;
  for (const p of partes) {
    if (actual == null || typeof actual !== 'object') return '';
    actual = (actual as Record<string, unknown>)[p];
  }
  return actual == null ? '' : String(actual);
}

// Valida la firma de un evento de webhook (X-Event-Checksum / signature.checksum)
export function verificarFirmaEvento(evento: {
  data: unknown;
  timestamp: number;
  signature: { properties: string[]; checksum: string };
}): boolean {
  if (!EVENTS_SECRET) return false;
  const valores = evento.signature.properties.map(p => valorAnidado((evento.data as Record<string, unknown>), p));
  const cadena = valores.join('') + evento.timestamp + EVENTS_SECRET;
  const checksum = crypto.createHash('sha256').update(cadena).digest('hex');
  return checksum.toLowerCase() === evento.signature.checksum.toLowerCase();
}

export { PUBLIC_KEY as WOMPI_PUBLIC_KEY };
