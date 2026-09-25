// La política de cancelación tiene que decir lo mismo que el contrato de arrendamiento.
//
// Estuvo en 72 horas mientras el contrato decía 48: entre esas dos cifras el documento
// prometía devolver todo y el sistema retenía el 50 %. Estas pruebas fijan el plazo
// pactado para que no se vuelva a mover sin querer.
import { describe, it, expect } from 'vitest';
import {
  HORAS_LIMITE_GRATIS, PCT_CANCELACION_TARDIA, PCT_NO_SHOW, HORAS_GRACIA_NO_SHOW,
  calcularPoliticaCancelacion, esNoShowAplicable, fechaHoraRecogida,
} from '@/lib/cancelacion';

/** Una recogida a `horas` de distancia desde un momento fijo. */
function recogidaEn(horas: number): { pickup: Date; ahora: Date } {
  const ahora = new Date('2026-10-01T08:00:00');
  return { pickup: new Date(ahora.getTime() + horas * 3_600_000), ahora };
}

describe('política de cancelación', () => {
  it('el plazo es el del contrato: 48 horas', () => {
    expect(HORAS_LIMITE_GRATIS).toBe(48);
    expect(PCT_CANCELACION_TARDIA).toBe(50);
  });

  it('avisando con 48 horas o más no se cobra nada', () => {
    for (const horas of [48, 49, 72, 240]) {
      const { pickup, ahora } = recogidaEn(horas);
      expect(calcularPoliticaCancelacion(pickup, ahora).pct, `a ${horas}h`).toBe(0);
    }
  });

  // El tramo que se cobraba de más: el contrato lo devuelve íntegro.
  it('entre 48 y 72 horas NO se retiene nada', () => {
    for (const horas of [48.5, 60, 71.9]) {
      const { pickup, ahora } = recogidaEn(horas);
      expect(calcularPoliticaCancelacion(pickup, ahora).pct, `a ${horas}h`).toBe(0);
    }
  });

  it('dentro de las 48 horas se retiene el 50 %', () => {
    for (const horas of [47.9, 24, 2, 0.5]) {
      const { pickup, ahora } = recogidaEn(horas);
      expect(calcularPoliticaCancelacion(pickup, ahora).pct, `a ${horas}h`).toBe(50);
    }
  });

  // El contrato NO le da devolución a quien no comparece ni avisa, y acá se cobra el
  // 100 % pasadas 3 horas de gracia: más benigno que el contrato, que es como debe ser.
  it('el no-show se aplica pasada la hora de gracia, y no antes', () => {
    const { pickup, ahora } = recogidaEn(0);
    expect(esNoShowAplicable(pickup, ahora)).toBe(false);
    const justoAntes = new Date(pickup.getTime() + (HORAS_GRACIA_NO_SHOW - 0.1) * 3_600_000);
    expect(esNoShowAplicable(pickup, justoAntes)).toBe(false);
    const despues = new Date(pickup.getTime() + (HORAS_GRACIA_NO_SHOW + 0.1) * 3_600_000);
    expect(esNoShowAplicable(pickup, despues)).toBe(true);
    expect(PCT_NO_SHOW).toBe(100);
  });

  it('la hora de recogida sale del lugar elegido, no del inicio del día', () => {
    expect(fechaHoraRecogida('2026-10-01', { hora: '15:30' }).getHours()).toBe(15);
    // Sin hora registrada se asume el inicio del día: es lo más favorable al cliente,
    // porque le da más horas de anticipación para cancelar sin costo.
    expect(fechaHoraRecogida('2026-10-01', null).getHours()).toBe(0);
  });
});
