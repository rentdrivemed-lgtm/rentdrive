// La frontera entre VER y GESTIONAR un contrato.
//
// La secretaría atiende el mostrador y tiene que poder responder «¿por qué no puedo
// entregar este carro?». Pero anular un documento contractual es otra cosa. Estas
// pruebas fijan esa línea para que no se afloje por descuido al tocar los permisos.
import { describe, it, expect, beforeEach } from 'vitest';
import { baseDePrueba, crearUsuario, crearAdmin, type DB } from './util/db';
import { accesoContrato } from '@/lib/contratos-acceso';
import { AREA_NIVELES } from '@/lib/permisos';

/** Un admin del nivel dado. Sus áreas salen del nivel, que es lo que de verdad rige. */
function admin(db: DB, nivel: 'principal' | 'socio' | 'secretaria'): number {
  return crearAdmin(db, nivel);
}

function usuario(id: number, nombre = 'x') {
  return { id, nombre, correo: `${id}@x.com`, rol: 'admin' as const };
}

describe('ver un contrato no es gestionarlo', () => {
  let db: DB;
  let partes: { cliente_id: number; propietario_id: number };

  beforeEach(() => {
    db = baseDePrueba();
    partes = {
      cliente_id: crearUsuario(db, { rol: 'usuario' }),
      propietario_id: crearUsuario(db, { rol: 'propietario' }),
    };
  });

  it('la secretaría VE el documento', () => {
    const id = admin(db, 'secretaria');
    const a = accesoContrato(db, usuario(id), partes);
    expect(a.puedeVer, 'la secretaría debería poder ver').toBe(true);
  });

  // El punto de toda la prueba.
  it('la secretaría NO puede gestionarlo: ni anular, ni emitir, ni editar datos', () => {
    const id = admin(db, 'secretaria');
    const a = accesoContrato(db, usuario(id), partes);
    expect(a.puedeGestionar, 'la secretaría NO debe poder anular').toBe(false);
  });

  it('la secretaría tampoco suscribe en nombre de la sociedad', () => {
    const id = admin(db, 'secretaria');
    expect(accesoContrato(db, usuario(id), partes).puedeFirmarComoAgente).toBe(false);
  });

  it('el socio ve y gestiona, pero no firma por la sociedad', () => {
    const id = admin(db, 'socio');
    const a = accesoContrato(db, usuario(id), partes);
    expect(a.puedeVer).toBe(true);
    expect(a.puedeGestionar).toBe(true);
    // Suscribir a nombre de DRIVEPASS COL S.A.S. es solo del principal.
    expect(a.puedeFirmarComoAgente).toBe(false);
  });

  it('el principal puede todo', () => {
    const id = admin(db, 'principal');
    const a = accesoContrato(db, usuario(id), partes);
    expect(a.puedeVer).toBe(true);
    expect(a.puedeGestionar).toBe(true);
    expect(a.puedeFirmarComoAgente).toBe(true);
  });

  it('las PARTES ven su propio documento sin ser del equipo', () => {
    const cliente = accesoContrato(
      db, { id: partes.cliente_id, nombre: 'c', correo: 'c@x.com', rol: 'usuario' }, partes,
    );
    expect(cliente.puedeVer).toBe(true);
    expect(cliente.parte).toBe('cliente');
    expect(cliente.puedeGestionar).toBe(false);
  });

  it('un tercero no ve nada', () => {
    const ajeno = crearUsuario(db, { rol: 'usuario' });
    const a = accesoContrato(db, { id: ajeno, nombre: 'x', correo: 'x@x.com', rol: 'usuario' }, partes);
    expect(a.puedeVer).toBe(false);
    expect(a.parte).toBeNull();
  });
});

describe('las áreas dicen lo que se espera', () => {
  it('la secretaría atiende el mostrador: reservas, operaciones y ver contratos', () => {
    const areas = AREA_NIVELES as Record<string, string[]>;
    expect(areas.reservas).toContain('secretaria');
    expect(areas.operaciones, 'debe poder hacer el reporte fotográfico').toContain('secretaria');
    expect(areas.contratos_ver).toContain('secretaria');
  });

  it('pero no gestiona contratos ni suscribe por la sociedad', () => {
    const areas = AREA_NIVELES as Record<string, string[]>;
    expect(areas.contratos).not.toContain('secretaria');
    expect(areas.contratos_firmar_agente).not.toContain('secretaria');
    expect(areas.contratos_firmar_agente).toEqual(['principal']);
  });
});
