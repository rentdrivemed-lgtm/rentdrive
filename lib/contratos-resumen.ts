// ── Qué es cada documento, en español llano ─────────────────────────────────
//
// Un resumen corto que se muestra ENCIMA del texto legal, antes de firmar.
//
// No sustituye al documento ni lo modifica: lo que se firma y lo que el sello cubre
// sigue siendo el texto íntegro del abogado. Esto es lo que se lee primero, para que
// nadie firme sin saber qué acaba de aceptar — que es justo lo que pasa cuando la
// primera pantalla es un muro de cláusulas.
//
// El caso que lo motivó es el PAGARÉ: la palabra asusta, la gente no sabe qué está
// firmando, y lo que de verdad necesita saber cabe en tres frases.
//
// ⚠️ Módulo PURO: lo importan las pantallas 'use client'.

import type { TipoDocumento } from './contratos-datos';

export type ResumenDocumento = {
  /** Una frase: qué es. */
  queEs: string;
  /** Para qué sirve, desde el lado de quien firma. */
  paraQue: string;
  /** Lo que conviene que sepa antes de firmar, incluido lo incómodo. */
  loQueDebesSaber: string[];
};

export const RESUMENES: Partial<Record<TipoDocumento, ResumenDocumento>> = {
  'pagare': {
    queEs: 'Un compromiso de pago por si algo queda pendiente al devolver el carro.',
    paraQue:
      'Cubre lo que llegue después del alquiler y no esté pagado: daños que no cubra la póliza, '
      + 'multas o comparendos de tus días de uso, peajes o combustible pendientes.',
    loQueDebesSaber: [
      'Si devuelves el carro sin novedades y sin deudas, este documento no se usa nunca.',
      'Va en blanco a propósito: el monto se llena solo si de verdad queda algo por cobrar, '
        + 'y la carta de instrucciones es lo que fija cómo puede llenarse.',
      'Te avisaremos antes de usarlo, con el detalle de lo que se cobra y por qué.',
      'Firmas dos partes de una vez: el pagaré y la carta de instrucciones que lo limita.',
    ],
  },
  'arrendamiento': {
    queEs: 'El contrato de alquiler del vehículo, sin conductor.',
    paraQue: 'Fija tus obligaciones como arrendatario y las de DrivePass mientras tengas el carro.',
    loQueDebesSaber: [
      'Es el marco de la relación por este vehículo: las fechas y el precio de cada alquiler van en el otrosí.',
      'Se firma una vez por carro; si vuelves a alquilar el mismo, no lo repites.',
    ],
  },
  'otrosi-arrendamiento': {
    queEs: 'Las condiciones concretas de ESTE alquiler.',
    paraQue: 'Deja por escrito las fechas, el precio, el depósito y quién puede conducir.',
    loQueDebesSaber: [
      'Es lo que cambia en cada alquiler; el contrato de fondo no se vuelve a firmar.',
    ],
  },
  'agencia': {
    queEs: 'El contrato por el que DrivePass administra y alquila tu vehículo.',
    paraQue: 'Fija la comisión, cómo se liquida y qué hace cada parte.',
    loQueDebesSaber: [
      'Se firma una sola vez por carro. En cada alquiler solo firmas el otrosí con sus condiciones.',
      'Lleva una constancia aparte sobre la póliza y los riesgos que no ampara: son dos firmas tuyas.',
    ],
  },
  'otrosi-agencia': {
    queEs: 'Las condiciones concretas de ESTE alquiler de tu vehículo.',
    paraQue: 'Deja por escrito la tarifa, el plazo y la comisión que se causa en esta operación.',
    loQueDebesSaber: [
      'Hace parte del contrato de agencia que ya firmaste; no lo reemplaza.',
    ],
  },
  'acta-entrega': {
    queEs: 'La constancia del estado del carro al entregarlo y al devolverlo.',
    paraQue: 'Deja registrado con fotos cómo estaba en cada momento, para que nadie discuta después.',
    loQueDebesSaber: [
      'Se firma dos veces: al recibir el carro y al devolverlo. Entre una y otra queda abierta, y eso es normal.',
    ],
  },
};

export function resumenDe(tipo: TipoDocumento | string): ResumenDocumento | null {
  return RESUMENES[tipo as TipoDocumento] ?? null;
}
