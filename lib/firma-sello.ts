// ── Primitivas compartidas del sello de integridad de las firmas ────────────
//
// Extraídas de lib/contabilidad.ts (bloque «Sello de integridad de la firma»)
// cuando apareció el SEGUNDO documento firmable de la plataforma: los contratos
// digitales (lib/contratos-firma.ts). Las dos familias de documentos tienen que
// usar el MISMO secreto y la MISMA comparación en tiempo constante; duplicarlas
// habría abierto la puerta a que una se endureciera y la otra no.
//
// Lo que NO vive aquí, a propósito, es la BASE CANÓNICA: cada documento sella
// cosas distintas (la cuenta de cobro sella importes y desglose; el contrato
// sella el texto íntegro del documento) y mezclarlas en una sola función haría
// que un cambio en un documento invalidara los sellos del otro.
//
// Qué es y qué NO es (vale para las dos familias): es un MAC con secreto de
// SERVIDOR. Detecta que una fila firmada se alteró DESPUÉS de la firma por parte
// de alguien que puede escribir en la tabla pero no conoce `FIRMA_SECRET`. NO es
// una firma digital del firmante (no hay clave suya de por medio) ni prueba nada
// frente a quien controle el servidor entero.
//
// ⚠️ Módulo de SERVIDOR (usa `crypto` de Node y `process.env`): no importar desde
// un componente 'use client'.

import { createHmac, timingSafeEqual } from 'crypto';

// Secreto del MAC. Mismo criterio exacto que `JWT_SECRET` en lib/auth.ts: obligatorio en
// producción (si falta, truena explícito en el primer uso real en vez de sellar en
// silencio con un valor conocido), con un valor de desarrollo para que el entorno local
// siga funcionando sin configurar nada.
//
// ⚠️ DESPLIEGUE: hay que crear `FIRMA_SECRET` en Railway ANTES de desplegar esto. Sin la
// variable, en producción no se podrá firmar ninguna cuenta de cobro nueva NI ningún
// contrato (error 500 explícito). Las firmas v1 de cuentas de cobro que ya existen se
// siguen verificando y pagando sin el secreto.
const FIRMA_SECRET_DEV = 'rentdrive-dev-firma-secret';

export function firmaSecreto(): string {
  const s = (process.env.FIRMA_SECRET || '').trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FIRMA_SECRET no está configurado. Es obligatorio en producción para sellar los documentos firmados.');
  }
  return FIRMA_SECRET_DEV;
}

/** HMAC-SHA256 en hexadecimal de `base` con el secreto del servidor. */
export function sellarHmac(base: string): string {
  return createHmac('sha256', firmaSecreto()).update(base).digest('hex');
}

/**
 * Comparación en tiempo constante. Los dos valores son hexadecimales del mismo
 * largo o ni se comparan (una diferencia de longitud ya delata que no coinciden,
 * y `timingSafeEqual` lanza si los búferes miden distinto).
 */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
