// Cómo dice el cliente que va a pagar cuando reserva POR LA WEB.
//
// Es una cosa DISTINTA de `METODOS_PAGO` (lib/reserva-core.ts): allí el cobro ya
// ocurrió y el empleado del mostrador registra cómo entró la plata. Acá la reserva nace
// `pago_estado: 'pendiente'` y esto es solo la INTENCIÓN del cliente, para que el
// equipo sepa qué esperar cuando vaya a confirmarla.
//
// ── Por qué existe (sep-2026) ───────────────────────────────────────────────
// El checkout EXIGÍA tarjeta para poder reservar, y eso dejaba fuera a quien paga en
// efectivo, que es buena parte de los clientes.
//
// ⚠️ NO son tres métodos equivalentes, y la diferencia es dinero: con 'tarjeta' se cobra
// DE VERDAD en el momento, a través de Wompi, y la reserva puede quedar
// `pago_estado: 'pagado'` (ver app/api/reservas/route.ts). Con 'efectivo' y
// 'transferencia' no se pasa por la pasarela y la reserva queda 'pendiente': la plata
// entra al recoger el vehículo o por consignación, fuera de la plataforma.
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
