// La autorización de tratamiento de datos que se firma al crear la cuenta: que se
// emita una sola por cuenta y con los consentimientos DENTRO del texto, que sin ellos
// no se emita, y que la puerta de operar se cierre solo cuando debe.
import { describe, it, expect, beforeEach } from 'vitest';
import { baseDePrueba, crearUsuario, type DB } from './util/db';
import {
  emitirYNotificarVinculacion, generarContratoVinculacion, estadoVinculacion,
  faltaAutorizacionDeDatos, vinculacionAlDia, vinculacionVigente,
  faltantesVinculacion, armarDatosVinculacion, rolTitularDeCuenta,
} from '@/lib/contratos-vinculacion';
import { leerContrato, leerFirmas } from '@/lib/contratos-firma';
import { esSelloInstitucional } from '@/lib/contratos-sello-agente';
import { TIPO_REGISTRO } from '@/lib/contratos-registro-texto';

process.env.FIRMA_SECRET = 'secreto-de-prueba-suficientemente-largo';

const ACTOR = { id: null, nombre: 'Registro automático', nivel: 'sistema' };
const CONSIENTE = { general: true, datosSensibles: true, comunicacionesComerciales: false };

describe('emisión de la autorización de datos', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('emite UN solo documento, el mismo tipo para cliente y propietario', () => {
    const cliente = crearUsuario(db, { rol: 'usuario' });
    const propietario = crearUsuario(db, { rol: 'propietario' });

    emitirYNotificarVinculacion(db, cliente, 'usuario', ACTOR, CONSIENTE);
    emitirYNotificarVinculacion(db, propietario, 'propietario', ACTOR, CONSIENTE);

    const tipos = db.prepare('SELECT tipo FROM contratos').all() as { tipo: string }[];
    expect(tipos).toHaveLength(2);
    expect(new Set(tipos.map(t => t.tipo))).toEqual(new Set([TIPO_REGISTRO]));
  });

  it('guarda al titular en la columna que le toca por su rol', () => {
    const cliente = crearUsuario(db, { rol: 'usuario' });
    const propietario = crearUsuario(db, { rol: 'propietario' });
    emitirYNotificarVinculacion(db, cliente, 'usuario', ACTOR, CONSIENTE);
    emitirYNotificarVinculacion(db, propietario, 'propietario', ACTOR, CONSIENTE);

    const delCliente = db.prepare('SELECT cliente_id, propietario_id FROM contratos WHERE cliente_id = ?').get(cliente);
    const delProp = db.prepare('SELECT cliente_id, propietario_id FROM contratos WHERE propietario_id = ?').get(propietario);
    expect(delCliente).toEqual({ cliente_id: cliente, propietario_id: null });
    expect(delProp).toEqual({ cliente_id: null, propietario_id: propietario });
    expect(rolTitularDeCuenta('propietario')).toBe('propietario');
    expect(rolTitularDeCuenta('usuario')).toBe('cliente');
  });

  it('al admin no le toca ninguno', () => {
    const admin = crearUsuario(db, { rol: 'admin' });
    expect(emitirYNotificarVinculacion(db, admin, 'admin', ACTOR, CONSIENTE)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM contratos').get()).toEqual({ n: 0 });
  });

  it('sale ya suscrita por la sociedad, con el titular pendiente', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);
    const vigente = vinculacionVigente(db, id, 'usuario')!;

    const firmas = leerFirmas(db, vigente.id);
    const agente = firmas.find(f => f.rol === 'agente')!;
    expect(esSelloInstitucional(agente)).toBe(true);
    expect(firmas.find(f => f.rol === 'cliente')!.firmada_en).toBe('');
  });

  // Los consentimientos van EN el texto: el sello se calcula sobre él, así que después
  // de firmar no se puede cambiar lo que la persona autorizó sin romper la integridad.
  it('escribe los consentimientos dentro del texto firmado', () => {
    const conComerciales = crearUsuario(db, { rol: 'usuario' });
    const sinComerciales = crearUsuario(db, { rol: 'usuario' });

    generarContratoVinculacion(db, conComerciales, 'usuario', ACTOR,
      { general: true, datosSensibles: true, comunicacionesComerciales: true });
    generarContratoVinculacion(db, sinComerciales, 'usuario', ACTOR, CONSIENTE);

    const a = leerContrato(db, vinculacionVigente(db, conComerciales, 'usuario')!.id)!.texto;
    const b = leerContrato(db, vinculacionVigente(db, sinComerciales, 'usuario')!.id)!.texto;

    expect(a).toContain('[X] Autorizo el envío de comunicaciones comerciales.');
    expect(b).toContain('[ ] Autorizo el envío de comunicaciones comerciales.');
    // El reforzado de la cláusula CUARTA va marcado en los dos: es condición para tener cuenta.
    expect(a).toContain('[X] Sí autorizo.');
    expect(b).toContain('[X] Sí autorizo.');
  });

  it('deja los consentimientos consultables en el snapshot', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    generarContratoVinculacion(db, id, 'usuario', ACTOR,
      { general: true, datosSensibles: true, comunicacionesComerciales: true });

    const fila = db.prepare('SELECT datos_json FROM contratos WHERE cliente_id = ?').get(id) as { datos_json: string };
    expect(JSON.parse(fila.datos_json).consentimientos)
      .toEqual({ general: true, datosSensibles: true, comunicacionesComerciales: true });
  });

  it('NO emite sin el consentimiento general ni sin el de datos sensibles', () => {
    const a = crearUsuario(db, { rol: 'usuario' });
    const b = crearUsuario(db, { rol: 'usuario' });

    expect(generarContratoVinculacion(db, a, 'usuario', ACTOR,
      { general: false, datosSensibles: true, comunicacionesComerciales: false }))
      .toMatchObject({ ok: false, status: 400 });

    expect(generarContratoVinculacion(db, b, 'usuario', ACTOR,
      { general: true, datosSensibles: false, comunicacionesComerciales: false }))
      .toMatchObject({ ok: false, status: 400 });

    expect(db.prepare('SELECT COUNT(*) AS n FROM contratos').get()).toEqual({ n: 0 });
  });

  it('el texto identifica al titular con su calidad según el rol', () => {
    const cliente = crearUsuario(db, { rol: 'usuario' });
    const propietario = crearUsuario(db, { rol: 'propietario' });
    generarContratoVinculacion(db, cliente, 'usuario', ACTOR, CONSIENTE);
    generarContratoVinculacion(db, propietario, 'propietario', ACTOR, CONSIENTE);

    const t1 = leerContrato(db, vinculacionVigente(db, cliente, 'usuario')!.id)!.texto;
    const t2 = leerContrato(db, vinculacionVigente(db, propietario, 'propietario')!.id)!.texto;
    expect(t1).toContain('en calidad de Arrendatario');
    expect(t2).toContain('en calidad de Propietario');
    // La razón social correcta, no la del modelo del abogado.
    expect(t1).toContain('DRIVEPASS COL S.A.S.');
    expect(t1).not.toContain('DRIVEPASS S.A.S. —');
  });

  it('es idempotente: no emite un segundo documento a la misma cuenta', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);
    expect(db.prepare('SELECT COUNT(*) AS n FROM contratos').get()).toEqual({ n: 1 });
  });

  it('deja la notificación en la campana de SU titular y de nadie más', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    const otro = crearUsuario(db, { rol: 'usuario' });
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);

    const avisos = db.prepare('SELECT destinatario_id FROM notificaciones').all() as { destinatario_id: number }[];
    expect(avisos).toHaveLength(1);
    expect(avisos[0].destinatario_id).toBe(id);
    expect(avisos.some(a => a.destinatario_id === otro)).toBe(false);
  });

  it('enumera los faltantes del perfil que impiden firmar', () => {
    const id = crearUsuario(db, { rol: 'usuario', ciudad: '', direccion: '' });
    const faltan = faltantesVinculacion(armarDatosVinculacion(db, id, 'usuario')!).map(f => f.ruta);
    expect(faltan).toContain('titular.ciudad');
    expect(faltan).toContain('titular.direccion');
  });
});

describe('cuentas que todavía no han autorizado', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('se detecta que hay que pedírselo, sin emitir nada por su cuenta', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    expect(faltaAutorizacionDeDatos(db, id, 'usuario')).toBe(true);
    // Un consentimiento no se fabrica: comprobarlo no puede emitir el documento.
    expect(db.prepare('SELECT COUNT(*) AS n FROM contratos').get()).toEqual({ n: 0 });
  });

  it('deja de pedirse en cuanto autoriza', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);
    expect(faltaAutorizacionDeDatos(db, id, 'usuario')).toBe(false);
  });

  it('a un admin nunca se le pide', () => {
    const id = crearUsuario(db, { rol: 'admin' });
    expect(faltaAutorizacionDeDatos(db, id, 'admin')).toBe(false);
  });
});

describe('puerta de operar', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('deja pasar a quien todavía no tiene documento emitido', () => {
    // Es lo que evita que el despliegue deje sin operar a toda la plataforma.
    const id = crearUsuario(db, { rol: 'usuario' });
    expect(vinculacionAlDia(db, id, 'usuario')).toBe(true);
  });

  it('bloquea a quien lo tiene emitido y sin firmar', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);
    expect(vinculacionAlDia(db, id, 'usuario')).toBe(false);
  });

  it('el sello de la sociedad NO desbloquea: cuenta la firma del titular', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);
    const vigente = vinculacionVigente(db, id, 'usuario')!;

    expect(leerFirmas(db, vigente.id).find(f => f.rol === 'agente')!.firmada_en).not.toBe('');
    expect(vinculacionAlDia(db, id, 'usuario')).toBe(false);
  });

  it('deja pasar cuando el titular firma', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    emitirYNotificarVinculacion(db, id, 'usuario', ACTOR, CONSIENTE);
    const vigente = vinculacionVigente(db, id, 'usuario')!;
    db.prepare("UPDATE contrato_firmas SET firmada_en = '2026-09-24 10:00:00' WHERE contrato_id = ? AND rol = 'cliente'")
      .run(vigente.id);

    expect(vinculacionAlDia(db, id, 'usuario')).toBe(true);
  });

  it('un admin nunca queda bloqueado', () => {
    const id = crearUsuario(db, { rol: 'admin' });
    expect(vinculacionAlDia(db, id, 'admin')).toBe(true);
  });

  it('el estado que lee la pantalla concuerda con la puerta', () => {
    const id = crearUsuario(db, { rol: 'propietario' });
    emitirYNotificarVinculacion(db, id, 'propietario', ACTOR, CONSIENTE);
    const e = estadoVinculacion(db, id, 'propietario');

    expect(e.tipo).toBe(TIPO_REGISTRO);
    expect(e.contratoId).not.toBeNull();
    expect(e.firmadoPorTitular).toBe(false);
    expect(e.pendiente).toBe(true);
    expect(vinculacionAlDia(db, id, 'propietario')).toBe(e.firmadoPorTitular);
  });

  it('«pendiente» también cubre a quien aún no ha autorizado', () => {
    const id = crearUsuario(db, { rol: 'usuario' });
    const e = estadoVinculacion(db, id, 'usuario');
    expect(e.contratoId).toBeNull();
    expect(e.pendiente).toBe(true);
  });
});
