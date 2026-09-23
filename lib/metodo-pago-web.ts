// Cómo dice el cliente que va a pagar cuando reserva POR LA WEB.
//
// Es una cosa DISTINTA de `METODOS_PAGO` (lib/reserva-core.ts): allí el cobro ya
// ocurrió y el empleado del mostrador registra cómo entró la plata. Acá la reserva nace
// `pago_estado: 'pendiente'` y esto es solo la INTENCIÓN del cliente, para que el
// equipo sepa qué esperar cuando vaya a confirmarla.
//
// ── Por qué existe (sep-2026) ───────────────────────────────────────────────
// Hasta ahora el checkout EXIGÍA tarjeta de crédito —16 dígitos, titular, vencimiento
// y CVV— para poder reservar, y eso dejaba fuera a quien paga en efectivo, que es buena
// parte de los clientes. Además esos campos NUNCA viajaron al servidor: no hay pasarela
// conectada, así que el formulario validaba el formato de una tarjeta que nadie cobraba
// y la reserva quedaba igual de pendiente de pago que con cualquier otro método. El
// cobro ocurre fuera de la plataforma en los tres casos.
//
// ⚠️ Módulo PURO, y por eso vive aparte de lib/reserva-core.ts: lo importa el checkout,
// que es un componente 'use client', y reserva-core es server-only (better-sqlite3).

export const METODOS_PAGO_WEB = ['tarjeta', 'efectivo', 'transferencia'] as const;
export type MetodoPagoWeb = typeof METODOS_PAGO_WEB[number];

export function esMetodoPagoWeb(v: unknown): v is MetodoPagoWeb {
  return typeof v === 'string' && (METODOS_PAGO_WEB as readonly string[]).includes(v);
}

/** Etiqueta legible, la misma en el checkout y en el panel. */
export const METODO_PAGO_WEB_LABEL: Record<MetodoPagoWeb, string> = {
  tarjeta: 'Tarjeta de crédito',
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
};

/** Ayuda que se le muestra al cliente debajo de cada opción. */
export const METODO_PAGO_WEB_AYUDA: Record<MetodoPagoWeb, string> = {
  tarjeta: 'Te pediremos los datos de la tarjeta abajo.',
  efectivo: 'Pagas al recoger el vehículo. No necesitas tarjeta.',
  transferencia: 'Te enviamos los datos de la cuenta al confirmar la reserva.',
};
