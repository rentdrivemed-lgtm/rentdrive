// El reporte que alimenta el acta: que los datos se guarden bien, que quede quién
// intervino, que el cliente pueda confirmar o quede constancia de que no pudo, y que
// no se firme un momento del acta sin su reporte.
import { describe, it, expect, beforeEach } from 'vitest';
import { baseDePrueba, crearUsuario, type DB } from './util/db';
import {
  guardarMediciones, confirmarCliente, dejarConstancia, leerReporte, leerIntervenciones,
  puedeFirmarMomento, registrarIntervencion, combustibleTexto, parsearInventario,
  esNivelCombustible,
} from '@/lib/reporte-entrega';
import { ITEMS_ESTADO_VEHICULO } from '@/lib/contratos-datos';
import { armarDatosContrato, generarDocumento } from '@/lib/contratos';

const MENSAJERO = { usuarioId: null, nombre: 'Carlos Mensajero', rol: 'mensajero' };

function operacion(db: DB): { operacionId: number; clienteId: number } {
  const propietarioId = crearUsuario(db, { rol: 'propietario' });
  const clienteId = crearUsuario(db, { rol: 'usuario' });
  const vehiculoId = Number(db.prepare(
    "INSERT INTO vehiculos (propietario_id, marca, modelo, anio, precio_dia, placa) VALUES (?,'Renault','Duster',2022,200000,'XYZ123')"
  ).run(propietarioId).lastInsertRowid);
  const reservaId = Number(db.prepare(
    "INSERT INTO reservas (usuario_id, vehiculo_id, fecha_inicio, fecha_fin, total, estado) VALUES (?,?,'2026-10-01','2026-10-05',800000,'confirmada')"
  ).run(clienteId, vehiculoId).lastInsertRowid);
  const operacionId = Number(db.prepare(
    'INSERT INTO operaciones (reserva_id) VALUES (?)'
  ).run(reservaId).lastInsertRowid);
  return { operacionId, clienteId };
}

/** Deja el reporte de una fase completo: mediciones, inventario y una foto. */
function completar(db: DB, operacionId: number, fase: 'salida' | 'entrada') {
  const inventario = Object.fromEntries(
    ITEMS_ESTADO_VEHICULO.map(i => [i, { estado: 'B' as const, nota: '' }]),
  );
  guardarMediciones(db, operacionId, fase, { kilometraje: 45000, combustible: 4, inventario }, MENSAJERO);
  db.prepare(`UPDATE operaciones SET ${fase === 'salida' ? 'fotos_salida' : 'fotos_entrada'} = ? WHERE id = ?`)
    .run(JSON.stringify([{ casilla: 'tablero', url: 'x' }]), operacionId);
}

describe('mediciones del reporte', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('guarda kilometraje, combustible e inventario', () => {
    const { operacionId } = operacion(db);
    const r = guardarMediciones(db, operacionId, 'salida', {
      kilometraje: 45000,
      combustible: 6,
      inventario: { 'Carrocería y pintura': { estado: 'R', nota: 'rayón en la puerta' } },
    }, MENSAJERO);

    expect(r.ok).toBe(true);
    const leido = leerReporte(db, operacionId, 'salida')!;
    expect(leido.kilometraje).toBe(45000);
    expect(leido.combustible).toBe(6);
    expect(leido.inventario['Carrocería y pintura']).toEqual({ estado: 'R', nota: 'rayón en la puerta' });
  });

  it('se puede llenar a trozos sin borrar lo anterior', () => {
    const { operacionId } = operacion(db);
    guardarMediciones(db, operacionId, 'salida', { kilometraje: 45000 }, MENSAJERO);
    guardarMediciones(db, operacionId, 'salida', {
      inventario: { 'Rines y copas': { estado: 'B', nota: '' } },
    }, MENSAJERO);
    guardarMediciones(db, operacionId, 'salida', {
      inventario: { 'Llantas, estado y presión': { estado: 'M', nota: 'lisa' } },
    }, MENSAJERO);

    const r = leerReporte(db, operacionId, 'salida')!;
    expect(r.kilometraje).toBe(45000);
    expect(Object.keys(r.inventario).sort()).toEqual(['Llantas, estado y presión', 'Rines y copas']);
  });

  it('la entrega y la devolución no se pisan', () => {
    const { operacionId } = operacion(db);
    guardarMediciones(db, operacionId, 'salida', { kilometraje: 45000 }, MENSAJERO);
    guardarMediciones(db, operacionId, 'entrada', { kilometraje: 46200 }, MENSAJERO);

    expect(leerReporte(db, operacionId, 'salida')!.kilometraje).toBe(45000);
    expect(leerReporte(db, operacionId, 'entrada')!.kilometraje).toBe(46200);
  });

  it('rechaza un combustible fuera de la escala y un kilometraje absurdo', () => {
    const { operacionId } = operacion(db);
    expect(guardarMediciones(db, operacionId, 'salida', { combustible: 9 }, MENSAJERO))
      .toMatchObject({ ok: false, status: 400 });
    expect(guardarMediciones(db, operacionId, 'salida', { kilometraje: -5 }, MENSAJERO))
      .toMatchObject({ ok: false, status: 400 });
    expect(esNivelCombustible(4)).toBe(true);
    expect(esNivelCombustible(4.5)).toBe(false);
  });

  it('descarta ítems que no están en el catálogo del acta', () => {
    // Un JSON con claves inventadas no puede acabar impreso en un acta.
    const inv = parsearInventario(JSON.stringify({
      'Carrocería y pintura': { estado: 'B', nota: '' },
      'Item inventado': { estado: 'B', nota: '' },
    }));
    expect(Object.keys(inv)).toEqual(['Carrocería y pintura']);
  });

  it('el combustible se imprime como lo marca la aguja', () => {
    expect(combustibleTexto(0)).toBe('Vacío');
    expect(combustibleTexto(8)).toBe('Lleno');
    expect(combustibleTexto(5)).toBe('5/8');
    expect(combustibleTexto(null)).toBe('');
  });
});

describe('quién intervino', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('queda registrado con nombre, rol, fecha y qué hizo', () => {
    const { operacionId } = operacion(db);
    guardarMediciones(db, operacionId, 'salida', { kilometraje: 45000 }, MENSAJERO);

    const [i] = leerIntervenciones(db, operacionId);
    expect(i.nombre).toBe('Carlos Mensajero');
    expect(i.rol).toBe('mensajero');
    expect(i.usuarioId).toBeNull();          // entra por token, no tiene cuenta
    expect(i.cuando).not.toBe('');
    expect(i.detalle).toContain('kilometraje 45000');
  });

  it('distingue a quien entrega de quien recibe', () => {
    const { operacionId } = operacion(db);
    const secretaria = crearUsuario(db, { rol: 'admin' });

    guardarMediciones(db, operacionId, 'salida', { kilometraje: 45000 }, MENSAJERO);
    guardarMediciones(db, operacionId, 'entrada', { kilometraje: 46200 },
      { usuarioId: secretaria, nombre: 'Ana Secretaría', rol: 'secretaria' });

    const is = leerIntervenciones(db, operacionId);
    expect(is).toHaveLength(2);
    expect(is[0].rol).toBe('mensajero');
    expect(is[1].rol).toBe('secretaria');
    expect(is[1].usuarioId).toBe(secretaria);
  });

  it('registra las fotos como una intervención más', () => {
    const { operacionId } = operacion(db);
    registrarIntervencion(db, operacionId, MENSAJERO, 'fotos', 'salida', 'Tomó 7 fotografías');
    expect(leerIntervenciones(db, operacionId)[0].accion).toBe('fotos');
  });
});

describe('confirmación del cliente', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('confirma un reporte completo y queda su rastro', () => {
    const { operacionId, clienteId } = operacion(db);
    completar(db, operacionId, 'salida');

    expect(confirmarCliente(db, operacionId, 'salida', clienteId, 'Juan Cliente').ok).toBe(true);
    const r = leerReporte(db, operacionId, 'salida')!;
    expect(r.confirmadoEn).not.toBe('');
    expect(r.confirmadoPor).toBe(clienteId);
    expect(leerIntervenciones(db, operacionId).some(i => i.accion === 'confirmacion_cliente')).toBe(true);
  });

  it('NO deja confirmar un reporte incompleto', () => {
    const { operacionId, clienteId } = operacion(db);
    guardarMediciones(db, operacionId, 'salida', { kilometraje: 45000 }, MENSAJERO);
    expect(confirmarCliente(db, operacionId, 'salida', clienteId, 'Juan'))
      .toMatchObject({ ok: false, status: 409 });
  });

  // Lo importante: cambiar un dato después invalida lo que el cliente aceptó.
  it('una corrección posterior invalida la confirmación', () => {
    const { operacionId, clienteId } = operacion(db);
    completar(db, operacionId, 'salida');
    confirmarCliente(db, operacionId, 'salida', clienteId, 'Juan');

    guardarMediciones(db, operacionId, 'salida', { kilometraje: 45500 }, MENSAJERO);

    expect(leerReporte(db, operacionId, 'salida')!.confirmadoEn).toBe('');
  });

  it('si el cliente no puede, se deja constancia y la entrega sigue', () => {
    const { operacionId } = operacion(db);
    completar(db, operacionId, 'salida');

    const r = dejarConstancia(db, operacionId, 'salida',
      'El cliente no traía el celular y pidió recibir el carro igual.', MENSAJERO);
    expect(r.ok).toBe(true);

    const reporte = leerReporte(db, operacionId, 'salida')!;
    expect(reporte.constancia).toContain('no traía el celular');
    // La constancia NO bloquea: el acta ya se puede firmar.
    expect(puedeFirmarMomento(db, operacionId, 'entrega').puede).toBe(true);
  });

  it('la constancia exige un motivo de verdad', () => {
    const { operacionId } = operacion(db);
    completar(db, operacionId, 'salida');
    expect(dejarConstancia(db, operacionId, 'salida', 'no', MENSAJERO))
      .toMatchObject({ ok: false, status: 400 });
  });

  it('no se deja constancia sobre un reporte que el cliente ya confirmó', () => {
    const { operacionId, clienteId } = operacion(db);
    completar(db, operacionId, 'salida');
    confirmarCliente(db, operacionId, 'salida', clienteId, 'Juan');

    expect(dejarConstancia(db, operacionId, 'salida', 'motivo suficientemente largo', MENSAJERO))
      .toMatchObject({ ok: false, status: 409 });
  });
});

describe('puerta de la firma del acta', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('no deja firmar la entrega sin su reporte, y dice qué falta', () => {
    const { operacionId } = operacion(db);
    const r = puedeFirmarMomento(db, operacionId, 'entrega');

    expect(r.puede).toBe(false);
    if (!r.puede) {
      expect(r.motivo).toContain('las fotografías');
      expect(r.motivo).toContain('el kilometraje');
      expect(r.motivo).toContain('inventario');
    }
  });

  it('deja firmar la entrega en cuanto su reporte está completo', () => {
    const { operacionId } = operacion(db);
    completar(db, operacionId, 'salida');
    expect(puedeFirmarMomento(db, operacionId, 'entrega').puede).toBe(true);
  });

  // El punto que el encargo pedía que NO se tratara como error.
  it('la devolución sigue cerrada mientras el carro está alquilado, y eso es normal', () => {
    const { operacionId } = operacion(db);
    completar(db, operacionId, 'salida');

    expect(puedeFirmarMomento(db, operacionId, 'entrega').puede).toBe(true);
    expect(puedeFirmarMomento(db, operacionId, 'devolucion').puede).toBe(false);
  });

  it('un inventario a medias tampoco basta', () => {
    const { operacionId } = operacion(db);
    completar(db, operacionId, 'salida');
    // Se borra un ítem: el reporte deja de estar completo.
    const inv = leerReporte(db, operacionId, 'salida')!.inventario;
    delete inv[ITEMS_ESTADO_VEHICULO[0]];
    db.prepare('UPDATE operaciones SET inventario_salida = ? WHERE id = ?')
      .run(JSON.stringify(inv), operacionId);

    const r = puedeFirmarMomento(db, operacionId, 'entrega');
    expect(r.puede).toBe(false);
    if (!r.puede) expect(r.motivo).toContain('1 ítem(s) del inventario');
  });
});

describe('el acta imprime el reporte, no rayas', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('lleva el kilometraje, el combustible y el inventario ya anotados', () => {
    const { operacionId, clienteId } = operacion(db);
    completar(db, operacionId, 'salida');
    guardarMediciones(db, operacionId, 'salida', {
      inventario: { 'Carrocería y pintura': { estado: 'R', nota: 'rayón en la puerta derecha' } },
    }, MENSAJERO);
    confirmarCliente(db, operacionId, 'salida', clienteId, 'Juan Cliente');

    const reservaId = (db.prepare('SELECT reserva_id AS r FROM operaciones WHERE id = ?')
      .get(operacionId) as { r: number }).r;
    const datos = armarDatosContrato(db, reservaId)!;
    const texto = generarDocumento('acta-entrega', datos).texto;

    // Lo que antes salía en blanco para llenar a mano.
    expect(texto).toContain('45000');
    expect(texto).toContain('4/8');
    expect(texto).toContain('rayón en la puerta derecha');

    // Y la constancia de quién intervino, dentro del propio documento.
    expect(texto).toContain('INTERVENCIONES EN EL REPORTE');
    expect(texto).toContain('Carlos Mensajero');
    expect(texto).toContain('mensajero');
    expect(texto).toContain('confirmó el estado de la entrega');
  });

  it('dice la verdad cuando el cliente NO confirmó', () => {
    const { operacionId } = operacion(db);
    completar(db, operacionId, 'salida');
    dejarConstancia(db, operacionId, 'salida', 'El cliente no traía el celular a la mano.', MENSAJERO);

    const reservaId = (db.prepare('SELECT reserva_id AS r FROM operaciones WHERE id = ?')
      .get(operacionId) as { r: number }).r;
    const texto = generarDocumento('acta-entrega', armarDatosContrato(db, reservaId)!).texto;

    // El acta prefiere decir la verdad incómoda a afirmar una conformidad que no hubo.
    expect(texto).toContain('no confirmó el estado de la entrega');
    expect(texto).toContain('no traía el celular');
  });

  it('un ítem sin calificar sigue saliendo con su raya: el acta no inventa un «bueno»', () => {
    const { operacionId } = operacion(db);
    guardarMediciones(db, operacionId, 'salida', { kilometraje: 10 }, MENSAJERO);

    const reservaId = (db.prepare('SELECT reserva_id AS r FROM operaciones WHERE id = ?')
      .get(operacionId) as { r: number }).r;
    const texto = generarDocumento('acta-entrega', armarDatosContrato(db, reservaId)!).texto;
    expect(texto).toContain('___');
  });
});
