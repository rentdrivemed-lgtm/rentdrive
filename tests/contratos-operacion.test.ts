// Los cuatro documentos de una operación: que se emitan en el orden correcto, que los
// marcos se reutilicen entre reservas, que los otrosíes citen a su padre de verdad, y
// que no se entregue un vehículo con firmas pendientes.
import { describe, it, expect, beforeEach } from 'vitest';
import { baseDePrueba, crearUsuario, type DB } from './util/db';
import {
  emitirDocumentosDeLaOperacion, marcoVigente, firmasPendientesDeLaOperacion,
  bloqueoParaEntregar, avisarFirmasPendientes,
} from '@/lib/contratos-operacion';
import { leerContrato, leerFirmas } from '@/lib/contratos-firma';
import { esSelloInstitucional } from '@/lib/contratos-sello-agente';

process.env.FIRMA_SECRET = 'secreto-de-prueba-suficientemente-largo';

const ACTOR = { id: 1, nombre: 'Equipo DrivePass', nivel: 'principal' };

type Escenario = { propietarioId: number; clienteId: number; vehiculoId: number; reservaId: number };

function escenario(db: DB, opts: { cliente?: number; vehiculo?: number } = {}): Escenario {
  const propietarioId = crearUsuario(db, { rol: 'propietario' });
  const clienteId = opts.cliente ?? crearUsuario(db, { rol: 'usuario' });

  const vehiculoId = opts.vehiculo ?? Number(db.prepare(`
    INSERT INTO vehiculos (propietario_id, marca, modelo, anio, precio_dia, placa)
    VALUES (?, 'Renault', 'Duster', 2022, 200000, ?)
  `).run(propietarioId, `ABC${Math.floor(Math.random() * 900) + 100}`).lastInsertRowid);

  const reservaId = Number(db.prepare(`
    INSERT INTO reservas (usuario_id, vehiculo_id, fecha_inicio, fecha_fin, total, estado)
    VALUES (?, ?, '2026-10-01', '2026-10-05', 800000, 'confirmada')
  `).run(clienteId, vehiculoId).lastInsertRowid);

  return { propietarioId, clienteId, vehiculoId, reservaId };
}

describe('emisión de los documentos de la operación', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('emite los cuatro, en orden, y en la relación que le toca a cada uno', () => {
    const e = escenario(db);
    const r = emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);

    expect(r.ok).toBe(true);
    expect(r.documentos.map(d => d.tipo)).toEqual([
      'agencia', 'arrendamiento', 'otrosi-agencia', 'otrosi-arrendamiento',
    ]);

    const filas = db.prepare('SELECT tipo, reserva_id, vehiculo_id FROM contratos ORDER BY id').all() as
      { tipo: string; reserva_id: number | null; vehiculo_id: number }[];

    // Los dos MARCOS viven sin reserva; los dos otrosíes cuelgan de ella.
    expect(filas.find(f => f.tipo === 'agencia')!.reserva_id).toBeNull();
    expect(filas.find(f => f.tipo === 'arrendamiento')!.reserva_id).toBeNull();
    expect(filas.find(f => f.tipo === 'otrosi-agencia')!.reserva_id).toBe(e.reservaId);
    expect(filas.find(f => f.tipo === 'otrosi-arrendamiento')!.reserva_id).toBe(e.reservaId);
  });

  it('el otrosí cita el NÚMERO REAL de su marco, no un consecutivo inventado', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);

    const agencia = marcoVigente(db, 'agencia', {
      id: e.reservaId, vehiculo_id: e.vehiculoId, usuario_id: e.clienteId, propietario_id: e.propietarioId,
    })!;
    const otrosi = db.prepare("SELECT id FROM contratos WHERE tipo = 'otrosi-agencia'").get() as { id: number };
    const texto = leerContrato(db, otrosi.id)!.texto;

    const datos = JSON.parse(leerContrato(db, otrosi.id)!.datos_json);
    expect(datos.numeros.contratoAgencia).toBe(agencia.numero);
    expect(texto).toContain('CONTRATO DE AGENCIA COMERCIAL');
  });

  it('la sociedad queda suscrita en los cuatro, y las personas no', () => {
    const e = escenario(db);
    const r = emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);

    for (const doc of r.documentos) {
      const firmas = leerFirmas(db, doc.contratoId);
      const agente = firmas.filter(f => f.rol === 'agente' && f.momento === 'suscripcion');
      expect(agente.length, `${doc.tipo} sin bloque de agente`).toBeGreaterThan(0);
      for (const f of agente) {
        expect(f.firmada_en, `${doc.tipo}/${f.bloque} sin sellar`).not.toBe('');
        expect(esSelloInstitucional(f)).toBe(true);
      }
      for (const f of firmas.filter(x => x.rol !== 'agente')) {
        expect(f.firmada_en, `${doc.tipo}/${f.bloque} no debería estar firmado`).toBe('');
      }
    }
  });

  it('reutiliza el marco del vehículo en la segunda reserva: el propietario no refirma', () => {
    const primera = escenario(db);
    emitirDocumentosDeLaOperacion(db, primera.reservaId, ACTOR);

    // Otro cliente, el MISMO vehículo.
    const segunda = escenario(db, { vehiculo: primera.vehiculoId });
    const r = emitirDocumentosDeLaOperacion(db, segunda.reservaId, ACTOR);

    expect(r.ok).toBe(true);
    const porTipo = Object.fromEntries(r.documentos.map(d => [d.tipo, d.yaExistia]));
    expect(porTipo['agencia'], 'el marco de agencia debería reutilizarse').toBe(true);
    // Cliente distinto ⇒ marco de arrendamiento nuevo (el marco nombra la placa y a él).
    expect(porTipo['arrendamiento']).toBe(false);

    expect(db.prepare("SELECT COUNT(*) AS n FROM contratos WHERE tipo = 'agencia'").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM contratos WHERE tipo = 'otrosi-agencia'").get()).toEqual({ n: 2 });
  });

  it('el mismo cliente y el mismo vehículo reutilizan los DOS marcos', () => {
    const primera = escenario(db);
    emitirDocumentosDeLaOperacion(db, primera.reservaId, ACTOR);

    const segunda = escenario(db, { vehiculo: primera.vehiculoId, cliente: primera.clienteId });
    const r = emitirDocumentosDeLaOperacion(db, segunda.reservaId, ACTOR);

    const porTipo = Object.fromEntries(r.documentos.map(d => [d.tipo, d.yaExistia]));
    expect(porTipo['agencia']).toBe(true);
    expect(porTipo['arrendamiento']).toBe(true);
    expect(porTipo['otrosi-agencia']).toBe(false);
    expect(porTipo['otrosi-arrendamiento']).toBe(false);
  });

  it('es idempotente: confirmar dos veces no duplica ningún documento', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);

    expect(db.prepare('SELECT COUNT(*) AS n FROM contratos').get()).toEqual({ n: 4 });
  });

  it('una reserva que no existe se rechaza con 404', () => {
    expect(emitirDocumentosDeLaOperacion(db, 99999, ACTOR)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('bloqueo de la entrega', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('no deja entregar mientras falten firmas, y dice cuáles', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);

    const bloqueo = bloqueoParaEntregar(db, e.reservaId);
    expect(bloqueo).not.toBeNull();
    expect(bloqueo!.motivo).toContain('faltan firmas');
    // El motivo nombra documentos concretos, no un genérico.
    expect(bloqueo!.motivo).toMatch(/(CAG|CAR|OAG|OAR)-\d{6}/);
  });

  it('deja entregar cuando todas las de suscripción están puestas', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);

    db.prepare("UPDATE contrato_firmas SET firmada_en = '2026-09-24 10:00:00' WHERE momento = 'suscripcion'").run();
    expect(bloqueoParaEntregar(db, e.reservaId)).toBeNull();
  });

  it('las firmas del ACTA no bloquean la entrega: se recogen después', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);
    db.prepare("UPDATE contrato_firmas SET firmada_en = '2026-09-24 10:00:00' WHERE momento = 'suscripcion'").run();

    // Un acta con sus cuatro bloques pendientes no puede impedir entregar el vehículo:
    // dos de ellos se firman en la devolución, que todavía no ha ocurrido.
    const pendientes = firmasPendientesDeLaOperacion(db, e.reservaId);
    expect(pendientes.every(p => p.rol !== 'codeudor')).toBe(true);
    expect(bloqueoParaEntregar(db, e.reservaId)).toBeNull();
  });
});

describe('aviso de firmas pendientes', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('avisa a cada parte por SU campana, una sola vez', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);
    const { avisados } = avisarFirmasPendientes(db, e.reservaId);

    expect(new Set(avisados)).toEqual(new Set([e.propietarioId, e.clienteId]));

    const avisos = db.prepare('SELECT destinatario_id FROM notificaciones').all() as { destinatario_id: number }[];
    // Uno por persona aunque le falten varios documentos.
    expect(avisos).toHaveLength(2);
  });

  it('no avisa de los bloques de la sociedad', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);

    const pendientes = firmasPendientesDeLaOperacion(db, e.reservaId);
    expect(pendientes.every(p => p.rol !== 'agente'), 'el sello ya suscribió a la sociedad').toBe(true);
  });

  it('no deja rastro en el chat compartido entre propietario y cliente', () => {
    const e = escenario(db);
    emitirDocumentosDeLaOperacion(db, e.reservaId, ACTOR);
    avisarFirmasPendientes(db, e.reservaId);

    // Decirle en el chat a uno que le faltan firmas se lo contaría también al otro.
    expect(db.prepare('SELECT COUNT(*) AS n FROM mensajes').get()).toEqual({ n: 0 });
  });
});
