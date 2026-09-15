// Fórmula del neto que se le liquida al propietario. Módulo PURO: sin BD, sin imports
// de servidor — lo usan a la vez el servidor (lib/contabilidad.ts, la API de edición de
// liquidaciones) y el cliente (ContabilidadPanel → vista previa antes de guardar; panel
// del propietario → desglose de la cuenta de cobro). Una sola fuente de verdad para que
// la cifra que el admin ve antes de guardar sea EXACTAMENTE la que calcula el servidor,
// y la que firma el propietario sea EXACTAMENTE la que se le transfiere.

export type TipoConcepto = 'descuento' | 'adicional';

// Línea de ajuste sobre una liquidación. `monto` SIEMPRE se guarda/interpreta en
// positivo: el signo lo pone `tipo` (descuento resta, adicional suma). Así no existe
// la ambigüedad "descuento de -50.000" (que sumaría) que es fuente clásica de errores
// de plata.
export type ConceptoLinea = { tipo: TipoConcepto; monto: number };

export type TotalesLiquidacion = {
  bruto: number;
  comision_pct: number;
  comision_valor: number;
  total_descuentos: number;
  total_adicionales: number;
  neto: number;
};

// Criterio de redondeo (COP no tiene centavos en la práctica del negocio): TODO valor
// que se guarda —bruto, montos de conceptos, comisión y neto— se redondea a peso entero
// con Math.round, igual que ya hacía `generarLiquidacion` con la comisión. Al redondear
// cada término ANTES de sumar, el neto mostrado nunca difiere del neto guardado por
// arrastre de decimales.
export function redondearPeso(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

// Parser numérico ESTRICTO para todo valor de plata que llega de fuera (JSON del panel o
// de una llamada directa a la API).
//
// `Number()` de JavaScript es peligrosamente permisivo para esto: `Number(true) === 1`,
// `Number([5]) === 5`, `Number('0x10') === 22` (sic), `Number('') === 0`, `Number(' 7 ')
// === 7`. Combinado con `redondearPeso` —que devuelve 0 para todo lo no finito— eso hacía
// que `"abc"`, `{}` o `1e400` pasaran la validación convertidos en $0 y se guardaran como
// una base de liquidación válida, sin un solo error.
//
// Aquí solo se aceptan DOS formas: un `number` finito de verdad, o una cadena que sea
// EXACTAMENTE un decimal en notación normal (con signo opcional). Cualquier otra cosa
// —booleano, array, objeto, null, hex, notación científica, cadena vacía— devuelve null,
// y el llamador la rechaza con 400 en vez de coercionarla a cero.
export function valorNumerico(n: unknown): number | null {
  if (typeof n === 'number') return Number.isFinite(n) ? n : null;
  if (typeof n === 'string') {
    const t = n.trim();
    if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(t)) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

export function calcularTotalesLiquidacion(
  bruto: number, comisionPct: number, conceptos: ConceptoLinea[],
): TotalesLiquidacion {
  const b = redondearPeso(bruto);
  const pct = Number.isFinite(Number(comisionPct)) ? Number(comisionPct) : 0;
  const comisionValor = Math.round(b * pct);

  let descuentos = 0;
  let adicionales = 0;
  for (const c of conceptos || []) {
    // Math.abs: aunque la API ya rechaza montos negativos, un dato viejo/corrupto en BD
    // nunca debe invertir el signo de una línea sin que nadie se entere.
    const m = Math.abs(redondearPeso(c.monto));
    if (c.tipo === 'descuento') descuentos += m;
    // `else if` explícito (no `else`): un `tipo` desconocido —dato viejo, corrupto o
    // inyectado— se IGNORA en vez de sumar dinero por defecto. Un valor que no sabemos
    // interpretar nunca puede aumentar lo que se transfiere.
    else if (c.tipo === 'adicional') adicionales += m;
  }

  return {
    bruto: b,
    comision_pct: pct,
    comision_valor: comisionValor,
    total_descuentos: descuentos,
    total_adicionales: adicionales,
    neto: b - comisionValor - descuentos + adicionales,
  };
}

// Techo defensivo por línea: evita que un cero de más (o un dedo pegado en el teclado)
// convierta un descuento de $50.000 en uno de $50.000.000 sin que nada lo frene.
// $100.000.000 es varias veces el alquiler más caro del catálogo.
export const MONTO_MAX_CONCEPTO = 100_000_000;

// Se valida el valor CRUDO (antes de redondear) con el parser estricto, y además se exige
// que redondee a $1 o más: un concepto de $0,4 redondea a $0 —no mueve un peso— pero sí
// bastaba para "cambiar" la liquidación, anular una cuenta de cobro ya firmada y reemitirla
// (copiando la imagen de la firma cada vez), tantas veces como se quisiera.
export function montoConceptoValido(n: unknown): boolean {
  const v = valorNumerico(n);
  return v !== null && v > 0 && v <= MONTO_MAX_CONCEPTO && Math.round(v) >= 1;
}

// Mismo rango que acepta la comisión global (lib/contabilidad.ts → comisionPlataforma):
// estrictamente entre 0 y 1. Una comisión de 0% o de 100% se rechaza a propósito.
export function comisionPctValido(n: unknown): boolean {
  const v = valorNumerico(n);
  return v !== null && v > 0 && v < 1;
}

// El bruto de la liquidación es la base sobre la que se le paga al propietario. Puede
// corregirse (p. ej. el cliente pagó un extra en efectivo que no quedó en la reserva),
// pero nunca puede ser negativo ni absurdo.
export const BRUTO_MAX = 500_000_000;

// OJO: recibe el valor CRUDO, no `redondearPeso(valor)`. Validar después de redondear era
// inútil, porque `redondearPeso` ya había convertido cualquier basura en 0 y `brutoValido(0)`
// es true: un `{"bruto":"1'000.000"}` dejaba la base de liquidación en $0 sin error alguno.
export function brutoValido(n: unknown): boolean {
  const v = valorNumerico(n);
  return v !== null && v >= 0 && v <= BRUTO_MAX;
}

// ── Topes de texto y volumen ────────────────────────────────────────────────
// No hay riesgo de XSS (React escapa, los correos van en texto plano y jsPDF no interpreta
// markup), pero sin techo un `concepto` de 5 MB se guarda en `liquidacion_conceptos`, se
// copia al `conceptos_json` de la remisión vigente, al de la remisión anulada y al del PDF,
// y se sirve entero en cada carga del panel del propietario.
export const CONCEPTO_MAX_CHARS = 120;
export const MOTIVO_MAX_CHARS = 500;
// Conceptos que se pueden agregar/quitar en UNA sola edición. Veinte líneas de ajuste en
// un alquiler ya es absurdo; mil son un ataque de volumen.
export const MAX_LINEAS_POR_EDICION = 20;

// Techo del neto resultante (en valor absoluto: también acota el saldo en contra). Con
// BRUTO_MAX = 500M y hasta 20 conceptos de 100M, el neto podía llegar a miles de millones
// sin que nada lo frenara.
export const NETO_MAX_ABS = BRUTO_MAX;

export function netoValido(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= NETO_MAX_ABS;
}

export function etiquetaTipo(t: TipoConcepto): string {
  return t === 'descuento' ? 'Descuento' : 'Adicional';
}
