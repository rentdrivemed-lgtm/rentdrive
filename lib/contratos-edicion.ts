// ── Editar los DATOS de un contrato (y REGENERAR su texto) ──────────────────
//
// Lo que se edita son los DATOS. El TEXTO LEGAL no se toca nunca: las cláusulas las
// redactó un abogado, viven en lib/contratos-plantillas.ts y el sello HMAC de cada
// firma cubre el texto íntegro precisamente para que nadie pueda alterarlas después.
// Aquí, al cambiar un dato, el texto se VUELVE A GENERAR desde la plantilla con los
// datos nuevos — jamás se edita el texto ya generado.
//
// Tres reglas que este archivo hace cumplir, en este orden:
//
//  1. SOLO MIENTRAS ESTÉ SIN FIRMAR. Un contrato firmado no se edita: se anula y se
//     reemite (`anularContrato`, que ya existía). Y si ya tiene vía de firma elegida
//     —papel o digital— tampoco, porque elegir vía significa que el acto de firma ya
//     empezó. La comprobación es doble: la amable de `motivoNoEditable` y el UPDATE
//     condicionado de `guardarDatosContrato`, que es el que de verdad cierra la
//     puerta frente a dos peticiones simultáneas.
//
//  2. CADA DATO SE GUARDA EN SU CASA (ver lib/contratos-campos.ts):
//     lo del vehículo en `vehiculos`, lo de la persona en `usuarios`, y lo que es de
//     ESTA operación en `contratos.overrides_json`. Así, el dato que se escribe hoy
//     ya sale lleno en el siguiente contrato del mismo carro o del mismo cliente.
//
//  3. TODO CAMBIO DEJA RASTRO. Una línea de bitácora POR CAMPO, con el valor
//     anterior, el nuevo, quién y cuándo, dentro de la misma transacción: es un
//     documento legal, o queda el rastro o no se guarda el cambio.
//
// ⚠️ Server-only (better-sqlite3): no importar desde un componente 'use client'.
// El catálogo, la validación y la vista previa de lo impreso viven en el módulo PURO
// lib/contratos-campos.ts justamente para que la pantalla los pueda usar.

import type Database from 'better-sqlite3';
import { armarDatosContrato, generarDocumento } from './contratos';
import {
  CAMPOS_CONTRATO, TITULOS_DOCUMENTO, esPendiente, faltantesDe, valorEnRuta,
  type DatosContrato,
} from './contratos-datos';
import {
  CAMPOS_EDITABLES, GRUPOS, MAX_CONDUCTORES, campoEditable, comoSeImprime, esEscribible,
  parsearOverrides, validarCampo, validarCoherencia, validarConductor,
  type ConductorOverride, type DefCampoEditable, type OverridesContrato, type ValorCampo, type ValoresCampos,
} from './contratos-campos';
import {
  ahoraLocalContrato, faltantesCongelados, firmanteEsperado, leerContrato, leerFirmas,
  type ActorContrato, type ContratoRow, type ErrorOperacion, type FaltanteCongelado,
} from './contratos-firma';
import { bloquesDe } from './contratos-bloques';
import { registrarAuditoriaEstricta } from './permisos';

type DB = Database.Database;

const err = (status: number, error: string): ErrorOperacion => ({ ok: false, status, error });

// ── ¿Se puede editar? ───────────────────────────────────────────────────────

/**
 * Por qué NO se pueden editar los datos de este documento, o `''` si sí se puede.
 *
 * Un documento con vía de firma elegida ya no admite cambios ni aunque le falten
 * trazos: si se imprimió para firmar a mano, el papel que está sobre el mostrador
 * dejaría de coincidir con el texto de la base.
 */
export function motivoNoEditable(c: ContratoRow, firmasPuestas: number): string {
  if (c.estado === 'anulado') {
    return 'Este documento está anulado. Emite uno nuevo si necesitas cambiar sus datos.';
  }
  if (c.estado === 'firmado') {
    return 'Este documento ya está firmado y no se puede modificar. Para cambiarlo hay que anularlo y emitirlo de nuevo.';
  }
  if (c.via_firma === 'papel') {
    return 'Este documento se firmó en papel y su escaneado ya está registrado: no se puede modificar. Anúlalo y emite uno nuevo.';
  }
  if (c.via_firma === 'digital' || firmasPuestas > 0) {
    return 'Este documento ya tiene firmas electrónicas: no se puede modificar. Anúlalo y emite uno nuevo.';
  }
  return '';
}

// ── Lectura: la pantalla de datos ───────────────────────────────────────────

export type CampoLeido = {
  clave: string;
  etiqueta: string;
  grupo: string;
  tipo: string;
  ayuda: string;
  soloLectura: boolean;
  seCambiaEn: string;
  opciones: readonly { valor: string; etiqueta: string }[];
  /** Lo guardado, tal cual, para meterlo en el formulario. */
  valor: string;
  /** Cómo va a salir IMPRESO hoy en el documento (letras y cifras). */
  impreso: string;
  /** ¿Hoy sale en blanco en el documento? */
  falta: boolean;
  /** ¿Su ausencia impide firmar ESTE documento? (ver contratos-firma → faltantesQueBloquean) */
  bloquea: boolean;
  /**
   * ¿ESTE documento imprime este dato? Los seis documentos de una reserva comparten
   * las mismas fichas, así que desde aquí se puede completar el chasis aunque el
   * pagaré no lo mencione — pero hay que poder ver cuál es cuál.
   */
  enEsteDocumento: boolean;
  /** Dónde queda guardado, dicho en palabras. Lo pidió el dueño: hay que poder verlo. */
  seGuardaEn: string;
};

export type GrupoLeido = { clave: string; titulo: string; nota: string; campos: CampoLeido[] };

export type DatosContratoLeidos = {
  contrato: {
    id: number; tipo: string; titulo: string; numero: string; version: number;
    estado: string; datos_revision: number;
    datos_editados_en: string; datos_editados_por_nombre: string;
  };
  editable: boolean;
  /** Vacío si `editable`. Si no, la razón en palabras. */
  motivo: string;
  grupos: GrupoLeido[];
  conductores: ConductorOverride[];
  maxConductores: number;
  /** Cifras que se recalculan solas a partir del canon. No se editan una por una. */
  derivados: {
    dias: number; canonDiario: number; canonTotal: number; ivaActivo: boolean; ivaTarifa: number;
    ivaCanon: number; totalArrendatario: number; comisionPct: number; comisionValor: number;
    netoPropietario: number; penaMoraDiaria: number; clausulaPenalArrendamiento: number; deposito: number;
    canonRecaudado: number; ajusteRedondeoCanon: number;
  };
  /** Avisos de coherencia sobre los datos que hay guardados AHORA. */
  avisos: string[];
};

function textoDe(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? String(v) : '';
  const s = String(v).trim();
  return esPendiente(s) ? '' : s;
}

/** Los conductores autorizados y lo demás de la operación no salen de este documento. */
const DESTINO_SOLO_ESTE_DOCUMENTO = 'Solo este documento';

function donde(c: DefCampoEditable): string {
  switch (c.destino) {
    case 'vehiculo': return 'Ficha del vehículo (sirve para sus próximos contratos)';
    case 'usuario_cliente': return 'Ficha del cliente (sirve para sus próximos contratos)';
    case 'usuario_propietario': return 'Ficha del propietario (sirve para sus próximos contratos)';
    case 'contrato': return DESTINO_SOLO_ESTE_DOCUMENTO;
  }
}

/** Los valores crudos guardados para ESTE contrato, campo por campo. */
function valoresGuardados(db: DB, c: ContratoRow, ov: OverridesContrato): Record<string, string> {
  const columnasPorTabla: Record<string, string[]> = { vehiculos: [], usuarios_c: [], usuarios_p: [] };
  for (const def of CAMPOS_EDITABLES) {
    if (def.destino === 'vehiculo') columnasPorTabla.vehiculos.push(def.columna);
    if (def.destino === 'usuario_cliente') columnasPorTabla.usuarios_c.push(def.columna);
    if (def.destino === 'usuario_propietario') columnasPorTabla.usuarios_p.push(def.columna);
  }
  const sel = (tabla: string, cols: string[], id: number) => {
    if (!cols.length) return {} as Record<string, unknown>;
    const lista = cols.map(x => `COALESCE(${x}, '') AS ${x}`).join(', ');
    return (db.prepare(`SELECT ${lista} FROM ${tabla} WHERE id = ?`).get(id) as Record<string, unknown>) || {};
  };
  const veh = sel('vehiculos', columnasPorTabla.vehiculos, c.vehiculo_id);
  const cli = sel('usuarios', columnasPorTabla.usuarios_c, c.cliente_id);
  const pro = sel('usuarios', columnasPorTabla.usuarios_p, c.propietario_id);

  const out: Record<string, string> = {};
  for (const def of CAMPOS_EDITABLES) {
    if (def.destino === 'vehiculo') out[def.clave] = textoDe(veh[def.columna]);
    else if (def.destino === 'usuario_cliente') out[def.clave] = textoDe(cli[def.columna]);
    else if (def.destino === 'usuario_propietario') out[def.clave] = textoDe(pro[def.columna]);
    else if (def.override) out[def.clave] = textoDe(ov[def.override] as unknown);
    else out[def.clave] = '';
  }
  return out;
}

/**
 * Todo lo que la pantalla de datos necesita: los grupos con sus campos, lo guardado,
 * cómo va a salir impreso, qué falta, qué bloquea la firma y las cifras derivadas.
 * `null` si el documento no existe.
 */
export function leerDatosContrato(db: DB, contratoId: number): DatosContratoLeidos | null {
  const c = leerContrato(db, contratoId);
  if (!c) return null;

  const ov = parsearOverrides(c.overrides_json);
  const datos = armarDatosContrato(db, c.reserva_id, { overrides: ov });
  const firmasPuestas = leerFirmas(db, contratoId).filter(f => !!f.firmada_en).length;
  const motivo = motivoNoEditable(c, firmasPuestas);

  const guardados = valoresGuardados(db, c, ov);
  // Dos listas distintas a propósito: lo que está EN BLANCO se mira sobre todos los
  // documentos de la reserva (las fichas son las mismas), y lo que BLOQUEA se mira solo
  // sobre ESTE documento — al pagaré no le falta el número de chasis.
  const faltantes = datos ? faltantesDe(datos) : [];
  const faltantesDeEste = datos ? faltantesDe(datos, c.tipo) : [];
  const rutasBloqueantes = new Set(faltantesDeEste.filter(f => f.enBD).map(f => f.ruta));
  const rutasFaltantes = new Set(faltantes.map(f => f.ruta));
  const rutasDeEsteTipo = new Set(
    CAMPOS_CONTRATO.filter(cc => cc.documentos.includes(c.tipo)).map(cc => cc.ruta),
  );
  // Una ruta que el inventario no nombra (el canon, el kilometraje, la dirección del
  // propietario) se da por presente: no hay motivo para esconderla.
  const rutasDelInventario = new Set(CAMPOS_CONTRATO.map(cc => cc.ruta));

  const grupos: GrupoLeido[] = GRUPOS.map(g => ({
    clave: g.clave,
    titulo: g.titulo,
    nota: g.nota,
    campos: CAMPOS_EDITABLES.filter(def => def.grupo === g.clave).map(def => {
      const bruto = datos ? valorEnRuta(datos, def.ruta) : '';
      const impreso = datos ? comoSeImprime(def, textoDe(bruto) || guardados[def.clave] || '') : '';
      return {
        clave: def.clave,
        etiqueta: def.etiqueta,
        grupo: def.grupo,
        tipo: def.tipo,
        ayuda: def.ayuda || '',
        soloLectura: !esEscribible(def),
        seCambiaEn: def.seCambiaEn || '',
        opciones: def.opciones || [],
        // En los campos de solo lectura y en los de la operación sin parche, lo que se
        // muestra es lo que dice hoy el documento; en los demás, lo guardado en la ficha.
        valor: guardados[def.clave] || (def.destino === 'contrato' ? '' : textoDe(bruto)),
        impreso,
        falta: rutasFaltantes.has(def.ruta),
        bloquea: rutasBloqueantes.has(def.ruta),
        enEsteDocumento: !rutasDelInventario.has(def.ruta) || rutasDeEsteTipo.has(def.ruta),
        seGuardaEn: donde(def),
      };
    }),
  }));

  const valoresActuales: ValoresCampos = {};
  for (const [k, v] of Object.entries(guardados)) valoresActuales[k] = v;
  const avisos = datos
    ? validarCoherencia(valoresActuales, {
      entrega: datos.operacion.entrega.fecha,
      restitucion: datos.operacion.restitucion.fecha,
    }).avisos
    : [];

  return {
    contrato: {
      id: c.id, tipo: c.tipo, titulo: TITULOS_DOCUMENTO[c.tipo] || c.tipo, numero: c.numero,
      version: c.version, estado: c.estado, datos_revision: Number(c.datos_revision) || 0,
      datos_editados_en: c.datos_editados_en || '',
      datos_editados_por_nombre: c.datos_editados_por_nombre || '',
    },
    editable: motivo === '',
    motivo,
    grupos,
    conductores: ov.conductores ?? [],
    maxConductores: MAX_CONDUCTORES,
    derivados: {
      dias: datos?.derivados.dias ?? 0,
      canonDiario: datos?.derivados.canonDiario ?? 0,
      canonTotal: datos?.derivados.canonTotal ?? 0,
      ivaActivo: datos?.derivados.iva.activo ?? false,
      ivaTarifa: datos?.derivados.iva.tarifa ?? 0,
      ivaCanon: datos?.derivados.ivaCanon ?? 0,
      totalArrendatario: datos?.derivados.totalArrendatario ?? 0,
      comisionPct: datos?.derivados.comisionPct ?? 0,
      comisionValor: datos?.derivados.comisionValor ?? 0,
      netoPropietario: datos?.derivados.netoPropietario ?? 0,
      penaMoraDiaria: datos?.derivados.penaMoraDiaria ?? 0,
      clausulaPenalArrendamiento: datos?.derivados.clausulaPenalArrendamiento ?? 0,
      deposito: datos?.derivados.deposito ?? 0,
      canonRecaudado: datos?.origen.canonRecaudado ?? 0,
      ajusteRedondeoCanon: datos?.origen.ajusteRedondeoCanon ?? 0,
    },
    avisos,
  };
}

// ── Escritura ───────────────────────────────────────────────────────────────

export type CambioAplicado = {
  clave: string;
  etiqueta: string;
  destino: string;
  antes: string;
  despues: string;
};

export type GuardarOk = {
  ok: true;
  contrato: ContratoRow;
  cambios: CambioAplicado[];
  faltantes: FaltanteCongelado[];
  avisos: string[];
};

export type EntradaGuardar = {
  /** clave de campo → valor crudo, tal como se escribió en el formulario. */
  campos: Record<string, unknown>;
  /** Lista completa de conductores autorizados. `undefined` = no se tocan. */
  conductores?: unknown;
  /** Revisión de datos que el editor tenía en pantalla. */
  revision?: number;
};

/** Nombre de columna salido del catálogo, no del usuario. Se comprueba igual. */
function columnaSegura(col: string): boolean {
  return /^[a-z_]{2,40}$/.test(col);
}

/**
 * Guarda los datos, REGENERA el texto desde la plantilla y recalcula lo derivado.
 *
 * Todo ocurre en UNA transacción: los datos, la regeneración, la resincronización de
 * los bloques de firma y la bitácora. Si algo falla, no se guarda nada.
 */
export function guardarDatosContrato(
  db: DB, contratoId: number, actor: ActorContrato, entrada: EntradaGuardar,
): GuardarOk | ErrorOperacion {
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return err(404, 'El documento no existe.');

  const firmas = leerFirmas(db, contratoId);
  const motivo = motivoNoEditable(contrato, firmas.filter(f => !!f.firmada_en).length);
  if (motivo) return err(409, motivo);

  const revisionActual = Number(contrato.datos_revision) || 0;
  if (entrada.revision !== undefined && Number(entrada.revision) !== revisionActual) {
    return err(409, 'Alguien más cambió estos datos mientras los editabas. Recarga la pantalla para no pisar su trabajo.');
  }

  const ovActual = parsearOverrides(contrato.overrides_json);
  const datosAntes = armarDatosContrato(db, contrato.reserva_id, { overrides: ovActual });
  if (!datosAntes) return err(404, 'La reserva de este documento ya no existe.');

  // ── 1 · Validar campo por campo ──
  const guardadosAntes = valoresGuardados(db, contrato, ovActual);
  const nuevos: Array<{ def: DefCampoEditable; valor: ValorCampo; antes: string }> = [];
  const valoresFinales: ValoresCampos = { ...guardadosAntes };

  for (const [clave, crudo] of Object.entries(entrada.campos || {})) {
    const def = campoEditable(clave);
    if (!def) return err(400, `El campo «${clave}» no existe.`);
    if (!esEscribible(def)) {
      return err(400, `«${def.etiqueta}» no se edita desde aquí: se cambia en ${def.seCambiaEn || 'otra pantalla'}.`);
    }
    const v = validarCampo(def, crudo);
    if (!v.ok) return err(400, v.error);
    valoresFinales[clave] = v.valor;
    const antes = guardadosAntes[clave] ?? '';
    const despues = typeof v.valor === 'number' ? (v.valor ? String(v.valor) : '') : v.valor;
    if (antes !== despues) nuevos.push({ def, valor: v.valor, antes });
  }

  // ── 2 · Conductores autorizados (la lista entera, o no se tocan) ──
  let conductores: ConductorOverride[] | undefined;
  if (entrada.conductores !== undefined) {
    if (!Array.isArray(entrada.conductores)) return err(400, 'La lista de conductores autorizados no es válida.');
    if (entrada.conductores.length > MAX_CONDUCTORES) {
      return err(400, `No se pueden registrar más de ${MAX_CONDUCTORES} conductores autorizados.`);
    }
    const lista: ConductorOverride[] = [];
    for (let i = 0; i < entrada.conductores.length; i++) {
      const r = validarConductor(entrada.conductores[i], i);
      if (!r.ok) return err(400, r.error);
      lista.push(r.valor);
    }
    conductores = lista;
  }

  // ── 3 · Coherencia entre campos ──
  const coherencia = validarCoherencia(valoresFinales, {
    entrega: datosAntes.operacion.entrega.fecha,
    restitucion: datosAntes.operacion.restitucion.fecha,
  });
  if (coherencia.errores.length > 0) return err(400, coherencia.errores[0]);

  const conductoresAntes = ovActual.conductores ?? [];
  const cambioConductores = conductores !== undefined
    && JSON.stringify(conductores) !== JSON.stringify(conductoresAntes);
  if (nuevos.length === 0 && !cambioConductores) {
    return err(400, 'No hay ningún cambio que guardar.');
  }

  // ── 4 · El parche de la operación, ya con lo nuevo ──
  const ovNuevo: OverridesContrato = { ...ovActual };
  for (const { def, valor } of nuevos) {
    if (def.destino !== 'contrato' || !def.override) continue;
    const vacio = valor === '' || valor === 0;
    if (vacio) delete ovNuevo[def.override];
    else if (def.override === 'canonDiario' || def.override === 'deposito') ovNuevo[def.override] = Number(valor);
    else if (def.override !== 'conductores') ovNuevo[def.override] = String(valor);
  }
  if (conductores !== undefined) {
    if (conductores.length) ovNuevo.conductores = conductores;
    else delete ovNuevo.conductores;
  }

  // ── 5 · Dónde va a escribirse cada cosa ──
  const escrituras = planearEscrituras(contrato, nuevos);

  const cuando = ahoraLocalContrato();
  const cambios: CambioAplicado[] = nuevos.map(({ def, valor, antes }) => ({
    clave: def.clave,
    etiqueta: def.etiqueta,
    destino: donde(def),
    antes,
    despues: typeof valor === 'number' ? (valor ? String(valor) : '') : valor,
  }));
  if (cambioConductores) {
    cambios.push({
      clave: 'operacion.conductores',
      etiqueta: 'Conductores autorizados',
      destino: DESTINO_SOLO_ESTE_DOCUMENTO,
      antes: conductoresAntes.map(c => `${c.nombre} (${c.documento})`).join('; ') || 'ninguno',
      despues: (conductores ?? []).map(c => `${c.nombre} (${c.documento})`).join('; ') || 'ninguno',
    });
  }

  // Todo —escribir las fichas, regenerar el texto, resincronizar los bloques y dejar el
  // rastro— ocurre dentro de UNA transacción. Si la generación del texto falla (una
  // fecha imposible, una cifra fuera de rango), la excepción revierte también los datos
  // que se acababan de escribir: no queda una ficha a medio cambiar con un documento
  // que dice otra cosa.
  type Regenerado = { texto: string; datos: DatosContrato; faltantes: FaltanteCongelado[] };
  let aplicado: { estado: 'ok'; regenerado: Regenerado } | { estado: 'cerrado' };
  try {
    aplicado = db.transaction((): { estado: 'ok'; regenerado: Regenerado } | { estado: 'cerrado' } => {
    // Escribir en la ficha de cada quien: el vehículo, el cliente, el propietario.
    for (const e of escrituras) {
      if (!columnaSegura(e.columna)) throw new Error(`columna no válida: ${e.columna}`);
      const upd = db.prepare(`UPDATE ${e.tabla} SET ${e.columna} = ? WHERE id = ?`).run(e.valor, e.id);
      if (upd.changes !== 1) throw new Error(`no se pudo actualizar ${e.tabla}#${e.id}`);
    }

    // El snapshot se vuelve a LEER DE LA BASE, ya con las fichas escritas, en vez de
    // parchearlo en memoria. Es la diferencia entre el documento que se guarda ahora y
    // el que saldría al recargar la página: con un parche en memoria hay que reproducir
    // a mano el formato de `armarDatosContrato` (los puntos del documento de identidad,
    // las mayúsculas de la marca…) y a la primera diferencia el texto guardado deja de
    // coincidir con el que se regeneraría. Leyendo, hay una sola forma posible.
    const datos = armarDatosContrato(db, contrato.reserva_id, { overrides: ovNuevo });
    if (!datos) throw new Error('la reserva de este documento ya no existe');
    const doc = generarDocumento(contrato.tipo, datos);
    const regenerado: Regenerado = { texto: doc.texto, datos: doc.datos, faltantes: faltantesCongelados(doc.faltantes) };

    // El documento: texto regenerado, snapshot nuevo, huecos recalculados y parche.
    // El UPDATE va CONDICIONADO al estado y a la vía: si otra petición firmó o registró
    // el papel mientras tanto, aquí no se actualiza ninguna fila y todo se revierte.
    const upd = db.prepare(`
      UPDATE contratos SET
        texto = ?, datos_json = ?, faltantes_json = ?, overrides_json = ?,
        datos_revision = datos_revision + 1,
        datos_editados_en = ?, datos_editados_por = ?, datos_editados_por_nombre = ?
      WHERE id = ? AND estado = 'pendiente' AND via_firma = ''
    `).run(
      regenerado.texto, JSON.stringify(regenerado.datos), JSON.stringify(regenerado.faltantes),
      JSON.stringify(ovNuevo), cuando, actor.id, actor.nombre || '', contratoId,
    );
    if (upd.changes !== 1) return { estado: 'cerrado' };

    resincronizarBloques(db, contrato, regenerado.datos);

    // Bitácora ESTRICTA, UNA LÍNEA POR CAMPO: qué campo, valor anterior, valor nuevo,
    // quién y cuándo. Es un documento legal; si el rastro no cabe, el cambio no ocurre.
    for (const c of cambios) {
      registrarAuditoriaEstricta(db, { id: actor.id, nombre: actor.nombre, correo: actor.correo, nivel: actor.nivel }, {
        area: 'contratos', accion: 'editar_datos_contrato', entidad: 'contrato', entidad_id: contratoId,
        detalle: `${contrato.numero} · «${c.etiqueta}»: «${c.antes || '(vacío)'}» → «${c.despues || '(vacío)'}»`
          + ` · se guarda en: ${c.destino}`,
      });
    }
    registrarAuditoriaEstricta(db, { id: actor.id, nombre: actor.nombre, correo: actor.correo, nivel: actor.nivel }, {
      area: 'contratos', accion: 'regenerar_contrato', entidad: 'contrato', entidad_id: contratoId,
      detalle: `Regeneró el texto de ${contrato.numero} (${TITULOS_DOCUMENTO[contrato.tipo]}) con ${cambios.length} dato(s) modificado(s)`
        + ` · ${regenerado.faltantes.length} campo(s) siguen en blanco`,
    });
    return { estado: 'ok', regenerado };
    })();
  } catch (e) {
    return err(400, `Con esos datos no se puede generar el documento: ${e instanceof Error ? e.message : 'revisa los valores.'}`);
  }

  if (aplicado.estado === 'cerrado') {
    return err(409, 'El documento dejó de ser editable mientras se guardaba (lo firmaron, lo anularon o registraron su firma en papel).');
  }

  return {
    ok: true,
    contrato: leerContrato(db, contratoId)!,
    cambios,
    faltantes: aplicado.regenerado.faltantes,
    avisos: coherencia.avisos,
  };
}

// ── Piezas internas ─────────────────────────────────────────────────────────

type Escritura = { tabla: 'vehiculos' | 'usuarios'; columna: string; id: number; valor: string | number };

/** A qué fila y a qué columna va cada campo cambiado. */
function planearEscrituras(c: ContratoRow, nuevos: Array<{ def: DefCampoEditable; valor: ValorCampo }>): Escritura[] {
  const out: Escritura[] = [];
  for (const { def, valor } of nuevos) {
    if (def.destino === 'vehiculo') out.push({ tabla: 'vehiculos', columna: def.columna, id: c.vehiculo_id, valor });
    else if (def.destino === 'usuario_cliente') out.push({ tabla: 'usuarios', columna: def.columna, id: c.cliente_id, valor });
    else if (def.destino === 'usuario_propietario') out.push({ tabla: 'usuarios', columna: def.columna, id: c.propietario_id, valor });
  }
  return out;
}

/**
 * Vuelve a abrir los bloques de firma del documento con el snapshot nuevo.
 *
 * Hace falta por dos razones: los conductores autorizados AÑADEN bloques al pagaré, y
 * el nombre y el documento que cada bloque espera se congelaron al emitir (si al
 * cliente le acaban de escribir la cédula, el bloque tiene que esperar esa cédula).
 *
 * Es seguro borrarlos y rehacerlos porque aquí solo se llega con el documento SIN
 * NINGUNA FIRMA (lo garantiza `motivoNoEditable` y lo vuelve a comprobar el UPDATE
 * condicionado); aun así se verifica una vez más antes de borrar: si apareciera una
 * firma, se lanza y la transacción entera se revierte.
 */
function resincronizarBloques(db: DB, contrato: ContratoRow, datos: DatosContrato): void {
  const firmadas = db.prepare(
    "SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND firmada_en <> ''"
  ).get(contrato.id) as { n: number };
  if ((Number(firmadas?.n) || 0) > 0) throw new Error('el documento ya tiene firmas');

  db.prepare('DELETE FROM contrato_firmas WHERE contrato_id = ?').run(contrato.id);
  const ins = db.prepare(`
    INSERT INTO contrato_firmas (
      contrato_id, bloque, etiqueta, rol, momento, orden,
      usuario_esperado_id, nombre_esperado, documento_esperado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const b of bloquesDe(contrato.tipo, datos.operacion.conductores.map(c => c.nombre))) {
    const quien = firmanteEsperado(datos, b);
    ins.run(contrato.id, b.clave, b.etiqueta, b.rol, b.momento, b.orden, quien.usuarioId, quien.nombre, quien.documento);
  }
}
