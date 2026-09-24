// Comprueba el andamio de la suite: que la base en memoria levanta el esquema REAL y
// que las restricciones que las demás pruebas dan por ciertas están de verdad ahí.
import { describe, it, expect } from 'vitest';
import { baseDePrueba, crearUsuario } from './util/db';

describe('base de pruebas', () => {
  it('levanta el esquema real, con las tablas de contratos', () => {
    const db = baseDePrueba();
    const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const nombres = new Set(tablas.map(t => t.name));
    for (const t of ['usuarios', 'vehiculos', 'reservas', 'contratos', 'contrato_firmas', 'auditoria']) {
      expect(nombres.has(t), `falta la tabla ${t}`).toBe(true);
    }
    db.close();
  });

  it('respeta el CHECK de rol de usuarios', () => {
    const db = baseDePrueba();
    expect(() => crearUsuario(db, { rol: 'inventado' })).toThrow();
    db.close();
  });

  it('crea cuentas con el perfil completo salvo que se pida lo contrario', () => {
    const db = baseDePrueba();
    const id = crearUsuario(db);
    const u = db.prepare('SELECT nombre, documento_identidad, ciudad, direccion, correo FROM usuarios WHERE id = ?')
      .get(id) as Record<string, string>;
    for (const [campo, valor] of Object.entries(u)) {
      expect(String(valor || '').trim(), `${campo} vacío`).not.toBe('');
    }

    const sinCiudad = crearUsuario(db, { ciudad: '' });
    expect(db.prepare('SELECT ciudad FROM usuarios WHERE id = ?').get(sinCiudad)).toEqual({ ciudad: '' });
    db.close();
  });
});
