// Política de cancelación de reservas — reglas de negocio de RentDrive.
export const HORAS_LIMITE_GRATIS = 72;
export const PCT_CANCELACION_TARDIA = 50;
export const HORAS_GRACIA_NO_SHOW = 3;
export const PCT_NO_SHOW = 100;

export type Lugar = { hora?: string };

/** Combina fecha_inicio (YYYY-MM-DD) + la hora de recogida (HH:MM) en un Date local.
 *  Si no hay hora registrada, asume el inicio del día. */
export function fechaHoraRecogida(fechaInicio: string, recogida?: Lugar | null): Date {
  const [y, m, d] = fechaInicio.split('-').map(Number);
  const hora = recogida?.hora || '00:00';
  const [hh, mm] = hora.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}

export type PoliticaCancelacion = {
  pct: number;
  horasRestantes: number;
  motivo: string;
};

/** Política si el propio arrendatario cancela (antes de la recogida). */
export function calcularPoliticaCancelacion(pickup: Date, ahora: Date = new Date()): PoliticaCancelacion {
  const horasRestantes = (pickup.getTime() - ahora.getTime()) / 3_600_000;
  if (horasRestantes >= HORAS_LIMITE_GRATIS) {
    return { pct: 0, horasRestantes, motivo: `Cancelada con ${Math.round(horasRestantes)}h de anticipación (≥ ${HORAS_LIMITE_GRATIS}h) — sin costo.` };
  }
  return { pct: PCT_CANCELACION_TARDIA, horasRestantes, motivo: `Cancelada con solo ${Math.max(0, Math.round(horasRestantes))}h de anticipación (< ${HORAS_LIMITE_GRATIS}h) — se cobra ${PCT_CANCELACION_TARDIA}% del total.` };
}

/** ¿Ya se cumplió la ventana de gracia de no-show (recogida + 3h) sin que el cliente llegara? */
export function esNoShowAplicable(pickup: Date, ahora: Date = new Date()): boolean {
  return ahora.getTime() > pickup.getTime() + HORAS_GRACIA_NO_SHOW * 3_600_000;
}

export function finVentanaNoShow(pickup: Date): Date {
  return new Date(pickup.getTime() + HORAS_GRACIA_NO_SHOW * 3_600_000);
}
