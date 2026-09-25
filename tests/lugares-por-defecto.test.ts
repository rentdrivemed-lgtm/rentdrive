// El punto de atención como lugar predeterminado: cuándo se aplica, cuándo NO, y que
// quede escrito en la reserva que se asignó en vez de elegirse.
import { describe, it, expect } from 'vitest';
import {
  lugarPuntoAtencion, lugarSinElegir, lugarValido,
  MUNICIPIO_PUNTO_ATENCION, HORA_PUNTO_ATENCION_DEFECTO,
} from '@/lib/lugares';
import { validarLugaresReserva } from '@/lib/reserva-core';

const MEDELLIN = { municipio: 'medellin', barrio: 'Laureles', direccion: 'Calle 1 # 2-3', hora: '10:00' };

describe('el punto de atención como predeterminado', () => {
  it('es un lugar válido, con su dirección fija y sin recargo', () => {
    const l = lugarPuntoAtencion();
    expect(lugarValido(l)).toBe(true);
    expect(l.municipio).toBe(MUNICIPIO_PUNTO_ATENCION);
    expect(l.direccion).not.toBe('');
    expect(l.hora).toBe(HORA_PUNTO_ATENCION_DEFECTO);
  });

  it('se aplica cuando no se eligió NINGUNO de los dos', () => {
    const r = validarLugaresReserva(null, null, { permitirPorDefecto: true });
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.porDefecto).toBe(true);
      expect(r.lugares.recogida.municipio).toBe(MUNICIPIO_PUNTO_ATENCION);
      expect(r.lugares.entrega.municipio).toBe(MUNICIPIO_PUNTO_ATENCION);
    }
  });

  it('respeta la hora que la persona escogió en el aviso', () => {
    const r = validarLugaresReserva({ ...lugarPuntoAtencion(''), hora: '15:30' }, null, { permitirPorDefecto: true });
    if (!('error' in r)) expect(r.lugares.recogida.hora).toBe('15:30');
  });

  // El punto que importa: rellenar UNO solo sería decidir a espaldas de quien eligió.
  it('NO rellena el que falta si ya eligió el otro: eso es un olvido suyo', () => {
    const r = validarLugaresReserva(MEDELLIN, null, { permitirPorDefecto: true });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.status).toBe(400);
  });

  it('sin permitirlo, seguir sin lugar es un 400 como siempre', () => {
    // La vía de mostrador no lo usa: ahí hay un empleado que pregunta.
    const r = validarLugaresReserva(null, null);
    expect('error' in r).toBe(true);
  });

  it('cuando sí eligió, no se marca como asignado por defecto', () => {
    const r = validarLugaresReserva(MEDELLIN, MEDELLIN, { permitirPorDefecto: true });
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.porDefecto).toBe(false);
      expect(r.lugares.recogida.municipio).toBe('medellin');
    }
  });

  it('reconoce un lugar sin elegir', () => {
    expect(lugarSinElegir(null)).toBe(true);
    expect(lugarSinElegir({ municipio: '', barrio: '', direccion: '', hora: '' })).toBe(true);
    expect(lugarSinElegir(MEDELLIN)).toBe(false);
  });
});
