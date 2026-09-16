// ── Quién firma qué, y en qué momento ───────────────────────────────────────
//
// Un documento NO tiene «una firma»: tiene VARIOS bloques de firma, de personas
// distintas y —en el caso del acta— recogidos en momentos distintos. Este archivo
// es el inventario de esos bloques, leído directamente del texto que redactó el
// abogado (lib/contratos-plantillas.ts).
//
// ⚠️ Módulo PURO: sin BD, sin `fs`, sin `crypto`. Lo importan por igual la ruta de
// API que crea las firmas pendientes y las pantallas 'use client' que las pintan.
//
// ── Por qué el acta tiene CUATRO bloques y no dos ───────────────────────────
// El acta es «de entrega Y devolución»: su texto trae dos encabezados separados
// («FIRMAS DE LA ENTREGA» y «FIRMAS DE LA DEVOLUCIÓN») porque la segunda se recoge
// días después, en otro lugar, y su declaración dice cosas distintas (la de
// devolución advierte expresamente que NO es paz y salvo). Meterlas en una sola
// firma haría que el arrendatario aceptara en el mostrador, el día de la entrega,
// el estado con el que devolverá el carro una semana más tarde.

import type { TipoDocumento } from './contratos-datos';

/**
 * Quién es la persona que tiene que poner ESE trazo.
 *
 *   · 'agente'      → DRIVEPASS COL S.A.S. por su representante legal. Lo firma un
 *                     administrador con el permiso `contratos_firmar_agente`.
 *   · 'cliente'     → el arrendatario / otorgante del pagaré (reservas.usuario_id).
 *   · 'propietario' → el empresario / arrendador (vehiculos.propietario_id).
 *   · 'codeudor'    → codeudor solidario del pagaré. No tiene cuenta en la
 *                     plataforma: ver la nota de `BLOQUES_CODEUDOR_PENDIENTES`.
 */
export type RolFirmante = 'agente' | 'cliente' | 'propietario' | 'codeudor';

/**
 * Cuándo se recoge el trazo. Solo el acta usa los tres valores; los demás
 * documentos se firman íntegros en el acto de suscripción.
 */
export type MomentoFirma = 'suscripcion' | 'entrega' | 'devolucion';

export type DefBloqueFirma = {
  /** Identificador estable del bloque dentro del documento. Es la clave en BD. */
  clave: string;
  /** Cómo se llama el bloque en el texto: «EL ARRENDATARIO». */
  etiqueta: string;
  rol: RolFirmante;
  momento: MomentoFirma;
  /** Orden en que aparecen los bloques al pie del documento. */
  orden: number;
  /** Aclaración para quien va a firmar. Se muestra en pantalla. */
  nota?: string;
};

const AGENTE_NOTA = 'Firma el representante legal de DRIVEPASS COL S.A.S.';

/**
 * Los bloques FIJOS de cada documento. Los codeudores del pagaré no están aquí
 * porque su número depende del snapshot (ver `bloquesCodeudor`).
 */
export const BLOQUES_FIRMA: Record<TipoDocumento, readonly DefBloqueFirma[]> = {
  // El contrato marco de agencia lo firman EL EMPRESARIO y EL AGENTE… y además su
  // ANEXO, que la cláusula décima séptima manda suscribir «por separado» y que solo
  // firma EL EMPRESARIO (es su constancia de que conoce los riesgos que la póliza no
  // ampara). Son dos actos distintos del mismo propietario, así que son dos bloques.
  'agencia': [
    { clave: 'empresario', etiqueta: 'EL EMPRESARIO', rol: 'propietario', momento: 'suscripcion', orden: 1 },
    { clave: 'agente', etiqueta: 'EL AGENTE', rol: 'agente', momento: 'suscripcion', orden: 2, nota: AGENTE_NOTA },
    {
      clave: 'empresario-anexo', etiqueta: 'EL EMPRESARIO (anexo de la póliza)', rol: 'propietario',
      momento: 'suscripcion', orden: 3,
      nota: 'Constancia separada de entrega y conocimiento de la póliza y de los riesgos no amparados (cláusula décima séptima).',
    },
  ],
  'otrosi-agencia': [
    { clave: 'empresario', etiqueta: 'EL EMPRESARIO', rol: 'propietario', momento: 'suscripcion', orden: 1 },
    { clave: 'agente', etiqueta: 'EL AGENTE', rol: 'agente', momento: 'suscripcion', orden: 2, nota: AGENTE_NOTA },
  ],
  'arrendamiento': [
    { clave: 'agente', etiqueta: 'EL AGENTE, por EL ARRENDADOR', rol: 'agente', momento: 'suscripcion', orden: 1, nota: AGENTE_NOTA },
    { clave: 'arrendatario', etiqueta: 'EL ARRENDATARIO', rol: 'cliente', momento: 'suscripcion', orden: 2 },
  ],
  'otrosi-arrendamiento': [
    { clave: 'agente', etiqueta: 'EL AGENTE, por EL ARRENDADOR', rol: 'agente', momento: 'suscripcion', orden: 1, nota: AGENTE_NOTA },
    { clave: 'arrendatario', etiqueta: 'EL ARRENDATARIO', rol: 'cliente', momento: 'suscripcion', orden: 2 },
  ],
  'acta-entrega': [
    { clave: 'entrega-agente', etiqueta: 'EL AGENTE (entrega)', rol: 'agente', momento: 'entrega', orden: 1, nota: AGENTE_NOTA },
    { clave: 'entrega-arrendatario', etiqueta: 'EL ARRENDATARIO (entrega)', rol: 'cliente', momento: 'entrega', orden: 2 },
    {
      clave: 'devolucion-agente', etiqueta: 'EL AGENTE (devolución)', rol: 'agente', momento: 'devolucion', orden: 3,
      nota: 'Se recoge el día en que se restituye el vehículo, no el de la entrega.',
    },
    {
      clave: 'devolucion-arrendatario', etiqueta: 'EL ARRENDATARIO (devolución)', rol: 'cliente', momento: 'devolucion', orden: 4,
      nota: 'Se recoge el día en que se restituye el vehículo. No constituye paz y salvo (ver la declaración de devolución).',
    },
  ],
  // El pagaré y su carta de instrucciones van en un mismo documento pero son dos
  // títulos: la carta declara ella misma que se otorga «en esta misma fecha» y trae
  // su propio bloque de firma. Se recogen por separado para que el trazo del pagaré
  // no se dé por extendido a la autorización de llenar los espacios en blanco.
  'pagare': [
    { clave: 'otorgante', etiqueta: 'EL OTORGANTE (pagaré)', rol: 'cliente', momento: 'suscripcion', orden: 1 },
    { clave: 'otorgante-carta', etiqueta: 'EL OTORGANTE (carta de instrucciones)', rol: 'cliente', momento: 'suscripcion', orden: 2 },
  ],
};

/** Prefijo de las claves de codeudor: 'codeudor-1', 'codeudor-2'… */
export const PREFIJO_BLOQUE_CODEUDOR = 'codeudor-';

/**
 * Bloques de los codeudores solidarios del pagaré, uno por codeudor del snapshot.
 *
 * ⚠️ HOY SIEMPRE DEVUELVE []: `DatosContrato.operacion.conductores` está vacío
 * porque la plataforma no registra conductores autorizados ni codeudores (ver el
 * inventario de lib/contratos-datos.ts). La función existe igual para que el
 * modelo de datos ya soporte el caso —el pagaré tiene una cláusula de solidaridad
 * y la carta de instrucciones obliga «a todos por igual»— y para que el día que se
 * registren codeudores no haya que rehacer la tabla de firmas.
 */
export function bloquesCodeudor(nombresCodeudores: readonly string[]): DefBloqueFirma[] {
  const base = BLOQUES_FIRMA['pagare'].length;
  return nombresCodeudores.map((nombre, i) => ({
    clave: `${PREFIJO_BLOQUE_CODEUDOR}${i + 1}`,
    etiqueta: `CODEUDOR SOLIDARIO — ${nombre}`,
    rol: 'codeudor' as const,
    momento: 'suscripcion' as const,
    orden: base + i + 1,
  }));
}

/** Todos los bloques de un documento, ya ordenados. */
export function bloquesDe(tipo: TipoDocumento, nombresCodeudores: readonly string[] = []): DefBloqueFirma[] {
  const fijos = [...BLOQUES_FIRMA[tipo]];
  const extra = tipo === 'pagare' ? bloquesCodeudor(nombresCodeudores) : [];
  return [...fijos, ...extra].sort((a, b) => a.orden - b.orden);
}

/** ¿Este rol depende de un momento posterior a la suscripción? */
export function esBloqueDeDevolucion(b: DefBloqueFirma): boolean {
  return b.momento === 'devolucion';
}
