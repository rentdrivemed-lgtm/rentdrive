// El sello institucional: que suscriba lo que debe, que no invente un trazo humano,
// que no se pueda pedir desde fuera y que respete las mismas defensas que la firma de
// una persona (integridad, exclusión de vías, idempotencia).
import { describe, it, expect, beforeEach } from 'vitest';
import { baseDePrueba, crearUsuario, type DB } from './util/db';
import { generarContratoVinculacion } from '@/lib/contratos-vinculacion';
import {
  sellarBloquesDelAgente, esSelloInstitucional, METODO_SELLO_INSTITUCIONAL, NOMBRE_INSTITUCIONAL,
} from '@/lib/contratos-sello-agente';
import { leerContrato, leerFirmas, verificarSelloFirma, esMetodoFirma } from '@/lib/contratos-firma';

// `FIRMA_SECRET` hace falta para calcular el sello HMAC.
process.env.FIRMA_SECRET = 'secreto-de-prueba-suficientemente-largo';

const ACTOR = { id: null, nombre: 'Registro automático', nivel: 'sistema' };

function contratoDeVinculacion(db: DB, rol: 'usuario' | 'propietario' = 'usuario'): number {
  const usuarioId = crearUsuario(db, { rol });
  const tipo = rol === 'usuario' ? 'vinculacion-cliente' : 'vinculacion-propietario';
  const r = generarContratoVinculacion(db, usuarioId, tipo, ACTOR);
  if (!r.ok) throw new Error(`no se pudo emitir: ${r.error}`);
  return r.contratoId;
}

describe('sello institucional', () => {
  let db: DB;
  beforeEach(() => { db = baseDePrueba(); });

  it('suscribe el bloque de EL AGENTE y deja el del titular pendiente', () => {
    const id = contratoDeVinculacion(db);
    const r = sellarBloquesDelAgente(db, id, { motivo: 'emisión automática al registrarse' });

    expect(r).toMatchObject({ ok: true, sellados: 1 });

    const firmas = leerFirmas(db, id);
    const agente = firmas.find(f => f.rol === 'agente')!;
    const titular = firmas.find(f => f.rol !== 'agente')!;

    expect(agente.firmada_en).not.toBe('');
    expect(titular.firmada_en).toBe('');
  });

  it('no finge una firma humana: sin persona y sin imagen', () => {
    const id = contratoDeVinculacion(db);
    sellarBloquesDelAgente(db, id, { motivo: 'prueba' });
    const agente = leerFirmas(db, id).find(f => f.rol === 'agente')!;

    expect(agente.firmada_por_id).toBeNull();
    expect(agente.firma_imagen).toBe('');
    expect(agente.firma_nombre_confirmado).toBe(NOMBRE_INSTITUCIONAL);
    expect(agente.firma_metodo).toBe(METODO_SELLO_INSTITUCIONAL);
    expect(esSelloInstitucional(agente)).toBe(true);
  });

  it('el método del sello no es pedible desde una petición HTTP', () => {
    // `esMetodoFirma` es el guardia de la ruta de firma. Si algún día admitiera el
    // sello, cualquiera podría suscribir documentos a nombre de la sociedad.
    expect(esMetodoFirma(METODO_SELLO_INSTITUCIONAL)).toBe(false);
  });

  it('el sello verifica como cualquier otra firma', () => {
    const id = contratoDeVinculacion(db);
    sellarBloquesDelAgente(db, id, { motivo: 'prueba' });
    const contrato = leerContrato(db, id)!;
    const agente = leerFirmas(db, id).find(f => f.rol === 'agente')!;

    expect(verificarSelloFirma(contrato, agente).ok).toBe(true);
  });

  it('deja de verificar si alguien altera el texto del contrato', () => {
    const id = contratoDeVinculacion(db);
    sellarBloquesDelAgente(db, id, { motivo: 'prueba' });
    db.prepare('UPDATE contratos SET texto = ? WHERE id = ?').run('TEXTO SUPLANTADO', id);

    const contrato = leerContrato(db, id)!;
    const agente = leerFirmas(db, id).find(f => f.rol === 'agente')!;
    expect(verificarSelloFirma(contrato, agente).ok).toBe(false);
  });

  it('es idempotente: sellar dos veces no duplica ni falla', () => {
    const id = contratoDeVinculacion(db);
    const primera = sellarBloquesDelAgente(db, id, { motivo: 'prueba' });
    const segunda = sellarBloquesDelAgente(db, id, { motivo: 'prueba' });

    expect(primera).toMatchObject({ ok: true, sellados: 1, yaEstaban: 0 });
    expect(segunda).toMatchObject({ ok: true, sellados: 0, yaEstaban: 1 });
  });

  it('no sella un documento anulado', () => {
    const id = contratoDeVinculacion(db);
    db.prepare("UPDATE contratos SET estado = 'anulado' WHERE id = ?").run(id);
    expect(sellarBloquesDelAgente(db, id, { motivo: 'prueba' })).toMatchObject({ ok: false, status: 409 });
  });

  it('no sella un documento que se firmó en papel', () => {
    const id = contratoDeVinculacion(db);
    db.prepare("UPDATE contratos SET via_firma = 'papel' WHERE id = ?").run(id);
    expect(sellarBloquesDelAgente(db, id, { motivo: 'prueba' })).toMatchObject({ ok: false, status: 409 });
  });

  it('no deja el contrato «firmado» mientras falte el titular', () => {
    const id = contratoDeVinculacion(db);
    sellarBloquesDelAgente(db, id, { motivo: 'prueba' });
    expect(leerContrato(db, id)!.estado).toBe('pendiente');
  });

  it('deja rastro en la bitácora de quién suscribió y por qué', () => {
    const id = contratoDeVinculacion(db);
    sellarBloquesDelAgente(db, id, { motivo: 'emisión automática al registrarse' });

    const fila = db.prepare(
      "SELECT * FROM auditoria WHERE accion = 'sellar_agente_automatico' AND entidad_id = ?"
    ).get(id) as Record<string, unknown> | undefined;

    expect(fila, 'no quedó rastro en la bitácora').toBeTruthy();
    expect(String(fila!.detalle)).toContain('emisión automática al registrarse');
    expect(String(fila!.detalle)).toContain(NOMBRE_INSTITUCIONAL);
  });

  it('devuelve 404 si el documento no existe', () => {
    expect(sellarBloquesDelAgente(db, 99999, { motivo: 'prueba' })).toMatchObject({ ok: false, status: 404 });
  });
});
