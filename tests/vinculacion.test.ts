// El camino completo de la vinculación: cuándo se emite sola, cuándo NO, que salga ya
// suscrita por la sociedad, y que la puerta de operar se cierre solo cuando debe.
import { describe, it, expect, beforeEach } from 'vitest';
import { baseDePrueba, crearUsuario, type DB } from './util/db';
import {
  emitirVinculacionSiProcede, estadoVinculacion, vinculacionAlDia, vinculacionVigente,
  faltantesVinculacion, armarDatosVinculacion,
} from '@/lib/contratos-vinculacion';
import { leerFirmas } from '@/lib/contratos-firma';
import { esSelloInstitucional } from '@/lib/contratos-sello-agente';

process.env.FIRMA_SECRET = 'secreto-de-prueba-suficientemente-largo';

const ACTOR = { id: null, nombre: 'Registro automático', nivel: 'sistema' };

describe('emisión automática de la vinculación', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('emite a un cliente con el perfil completo, ya suscrita por la sociedad', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    const r = emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);

    expect(r?.ok).toBe(true);
    const vigente = vinculacionVigente(db, id, 'vinculacion-cliente');
    expect(vigente).not.toBeNull();

    const firmas = leerFirmas(db, vigente!.id);
    const agente = firmas.find(f => f.rol === 'agente')!;
    expect(agente.firmada_en).not.toBe('');
    expect(esSelloInstitucional(agente)).toBe(true);
  });

  it('emite el documento que le toca a cada rol, y ninguno al admin', () => {
    const cliente = crearUsuario(db, { rol: 'usuario' });
    const propietario = crearUsuario(db, { rol: 'propietario' });
    const admin = crearUsuario(db, { rol: 'admin' });

    emitirVinculacionSiProcede(db, cliente, 'usuario', ACTOR);
    emitirVinculacionSiProcede(db, propietario, 'propietario', ACTOR);
    expect(emitirVinculacionSiProcede(db, admin, 'admin', ACTOR)).toBeNull();

    expect(vinculacionVigente(db, cliente, 'vinculacion-cliente')).not.toBeNull();
    expect(vinculacionVigente(db, propietario, 'vinculacion-propietario')).not.toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM contratos').get()).toEqual({ n: 2 });
  });

  // El punto delicado de toda la etapa: emitir con el perfil a medias deja un contrato
  // que su titular NO puede firmar nunca sin que un administrador lo anule y reemita.
  it('NO emite mientras al perfil le falte un dato del documento', () => {
    for (const hueco of [{ ciudad: '' }, { direccion: '' }, { documento: '' }]) {
      const id = crearUsuario(db, { rol: 'usuario', ...hueco });
      expect(emitirVinculacionSiProcede(db, id, 'usuario', ACTOR), JSON.stringify(hueco)).toBeNull();
      expect(vinculacionVigente(db, id, 'vinculacion-cliente'), JSON.stringify(hueco)).toBeNull();
    }
  });

  it('lo emite en cuanto el perfil se completa', () => {
    const id = crearUsuario(db, { rol: 'usuario', ciudad: '' });
    expect(emitirVinculacionSiProcede(db, id, 'usuario', ACTOR)).toBeNull();

    db.prepare('UPDATE usuarios SET ciudad = ? WHERE id = ?').run('Medellín', id);
    expect(emitirVinculacionSiProcede(db, id, 'usuario', ACTOR)?.ok).toBe(true);
  });

  it('es idempotente: llamarlo en cada visita no emite un segundo contrato', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);
    emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);
    emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);

    expect(db.prepare('SELECT COUNT(*) AS n FROM contratos').get()).toEqual({ n: 1 });
  });

  it('no emite a una cuenta archivada', () => {
    const id = crearUsuario(db, { rol: 'usuario', estado_cuenta: 'archivada' });
    const r = emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);
    expect(r === null || r.ok === false).toBe(true);
    expect(vinculacionVigente(db, id, 'vinculacion-cliente')).toBeNull();
  });

  it('enumera los faltantes que hay que completar antes de firmar', () => {
    const id = crearUsuario(db, { rol: 'usuario', ciudad: '', direccion: '' });
    const faltan = faltantesVinculacion(armarDatosVinculacion(db, id)!).map(f => f.ruta);
    expect(faltan).toContain('titular.ciudad');
    expect(faltan).toContain('titular.direccion');
  });
});

describe('puerta de operar', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('deja pasar a quien todavía no tiene contrato emitido', () => {
    // Es lo que evita que el despliegue deje a toda la plataforma sin poder operar.
    const id = crearUsuario(db, { rol: 'usuario' });
    expect(vinculacionAlDia(db, id, 'usuario')).toBe(true);
  });

  it('bloquea a quien tiene contrato emitido y sin firmar', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);
    expect(vinculacionAlDia(db, id, 'usuario')).toBe(false);
  });

  it('el sello de la empresa NO desbloquea: lo que cuenta es la firma del titular', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);
    const vigente = vinculacionVigente(db, id, 'vinculacion-cliente')!;

    // La sociedad ya suscribió (lo hace la emisión). El titular no.
    expect(leerFirmas(db, vigente.id).find(f => f.rol === 'agente')!.firmada_en).not.toBe('');
    expect(vinculacionAlDia(db, id, 'usuario')).toBe(false);
  });

  it('deja pasar cuando el titular firma', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirVinculacionSiProcede(db, id, 'usuario', ACTOR);
    const vigente = vinculacionVigente(db, id, 'vinculacion-cliente')!;

    db.prepare("UPDATE contrato_firmas SET firmada_en = '2026-09-24 10:00:00' WHERE contrato_id = ? AND rol = 'cliente'")
      .run(vigente.id);

    expect(vinculacionAlDia(db, id, 'usuario')).toBe(true);
  });

  it('un admin nunca queda bloqueado', () => {
    const id = crearUsuario(db, { rol: 'admin' });
    expect(vinculacionAlDia(db, id, 'admin')).toBe(true);
  });

  it('el estado que lee la pantalla refleja lo mismo que la puerta', () => {
    const id = crearUsuario(db, { rol: 'propietario' });
    emitirVinculacionSiProcede(db, id, 'propietario', ACTOR);
    const e = estadoVinculacion(db, id, 'propietario');

    expect(e.tipo).toBe('vinculacion-propietario');
    expect(e.contratoId).not.toBeNull();
    expect(e.firmadoPorTitular).toBe(false);
    expect(e.completo).toBe(false);          // falta el titular
    expect(vinculacionAlDia(db, id, 'propietario')).toBe(e.firmadoPorTitular);
  });
});
