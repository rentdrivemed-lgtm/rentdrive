// El orden de la cadena del alta y, sobre todo, que a quien ya tenía cuenta NO se le
// corta el paso: la decisión del dueño fue insistir con avisos, no bloquear al entrar.
import { describe, it, expect } from 'vitest';
import { rutaSiguientePaso } from '@/lib/siguiente-paso';

const REGISTRO = { incluirFirma: true };
const LOGIN = { incluirFirma: false };
const alDia = { correo_pendiente: false, perfil_completo: true, vinculacion: { pendiente: false, contrato_id: null } };

describe('rutaSiguientePaso', () => {
  it('manda primero a verificar el correo', () => {
    const r = rutaSiguientePaso({ ...alDia, correo_pendiente: true }, '/dashboard/usuario', REGISTRO);
    expect(r).toBe('/verificar-correo?next=%2Fdashboard%2Fusuario');
  });

  it('el correo va ANTES que el perfil y que la firma', () => {
    const r = rutaSiguientePaso(
      { correo_pendiente: true, perfil_completo: false, vinculacion: { pendiente: true, contrato_id: 7 } },
      '/x', REGISTRO,
    );
    expect(r).toContain('/verificar-correo');
  });

  it('el perfil va ANTES que la firma: un contrato emitido a medias no se puede firmar', () => {
    const r = rutaSiguientePaso(
      { correo_pendiente: false, perfil_completo: false, vinculacion: { pendiente: true, contrato_id: 7 } },
      '/x', REGISTRO,
    );
    expect(r).toContain('/completar-perfil');
  });

  it('en el registro manda a firmar, conservando el destino', () => {
    const r = rutaSiguientePaso(
      { ...alDia, vinculacion: { pendiente: true, contrato_id: 42 } }, '/pago?vehiculo_id=3', REGISTRO,
    );
    expect(r).toBe('/contratos/42?bienvenida=1&next=%2Fpago%3Fvehiculo_id%3D3');
  });

  it('al iniciar sesión NO manda a firmar aunque esté pendiente', () => {
    const r = rutaSiguientePaso(
      { ...alDia, vinculacion: { pendiente: true, contrato_id: 42 } }, '/dashboard/usuario', LOGIN,
    );
    expect(r).toBe('/dashboard/usuario');
  });

  it('sin nada pendiente va al destino', () => {
    expect(rutaSiguientePaso(alDia, '/dashboard/propietario', REGISTRO)).toBe('/dashboard/propietario');
  });

  it('no manda a firmar si no hay contrato emitido todavía', () => {
    const r = rutaSiguientePaso({ ...alDia, vinculacion: { pendiente: true, contrato_id: null } }, '/x', REGISTRO);
    expect(r).toBe('/x');
  });

  it('sin usuario devuelve el destino tal cual', () => {
    expect(rutaSiguientePaso(null, '/x', REGISTRO)).toBe('/x');
    expect(rutaSiguientePaso(undefined, '/x', LOGIN)).toBe('/x');
  });
});
