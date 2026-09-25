// ── Cifras de los contratos: escala de comisión, IVA y derivados ────────────
//
// TODAS las cifras que aparecen en los seis documentos salen de aquí y de ningún
// otro lado. El otrosí de arrendamiento y el otrosí de agencia citan las MISMAS
// sumas (canon diario, canon total, IVA, comisión, saldo al propietario) y no
// pueden discrepar ni en un peso: por eso hay una sola función que las calcula
// —`calcularDerivados`— y los dos documentos imprimen su resultado.
//
// ⚠️ Módulo PURO: sin BD, sin `fs`. La configuración (IVA activo, tarifa) entra
// como parámetro; quien la lee de `config` es lib/contratos.ts.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️⚠️ HALLAZGO IMPORTANTE — LA COMISIÓN QUE SE LIQUIDA HOY NO ES LA QUE FIRMÓ
// EL PROPIETARIO.
//
// La cláusula cuarta del contrato de agencia comercial fija una ESCALA por
// duración del arrendamiento: 35 % a un (1) día, 33 % de dos (2) a seis (6),
// 31 % de siete (7) a veintinueve (29) y 30 % de treinta (30) en adelante, y
// añade que «en ningún caso podrá ubicarse por fuera de ese rango».
//
// `lib/contabilidad.ts` (`comisionPlataforma`) usa, en cambio, UN SOLO porcentaje
// global de `config.comision_plataforma_pct` (0.35 por defecto) para toda
// liquidación, sin mirar los días. Es decir: a un alquiler de treinta días se le
// está descontando 35 % cuando el contrato dice 30 %.
//
// Este módulo implementa la escala del contrato y la usa SOLO para generar los
// documentos. **No toca el cálculo de las liquidaciones existentes** a propósito:
// eso mueve plata ya liquidada y es una decisión del dueño, no de una fase de
// plantillas. La diferencia se puede medir con `comparacionComision()`.
// ─────────────────────────────────────────────────────────────────────────────

// ── Constantes que los documentos traen fijas ───────────────────────────────

// ── Depósito de garantía ────────────────────────────────────────────────────
//
// Cláusula octava de agencia / sexta de arrendamiento. El monto DEPENDE DE CÓMO se
// deje: con tarjeta de crédito basta la mitad, porque el cupo queda retenido en el
// propio plástico y el riesgo de recuperación es menor que con plata en efectivo.
//
// ⚠️ EL SISTEMA TODAVÍA NO SABE SI UNA TARJETA ES DE CRÉDITO O DE DÉBITO. Los métodos
// de pago son 'tarjeta | efectivo | transferencia' en la web y
// 'efectivo | transferencia | datafono | otro' en el mostrador, y de Wompi solo se
// guarda la marca (Visa, Mastercard), no el tipo. Por eso el valor por defecto es el
// ALTO: equivocarse hacia arriba se corrige devolviendo, y hacia abajo deja a la
// empresa sin garantía. Cuando el depósito sea con tarjeta de crédito, el equipo lo
// ajusta en la operación desde «Completar los datos del documento», que ya admite
// `deposito` (ver lib/contratos-edicion.ts).

/** Depósito cuando se deja en efectivo, por transferencia o con tarjeta débito. */
export const DEPOSITO_GARANTIA_ESTANDAR = 2_000_000;

/** Depósito cuando se deja con tarjeta de CRÉDITO: el cupo queda retenido en la tarjeta. */
export const DEPOSITO_GARANTIA_TARJETA_CREDITO = 1_000_000;

/** Modalidades de depósito que reconoce el negocio. */
export type ModalidadDeposito = 'estandar' | 'tarjeta_credito';

export function depositoSegun(modalidad: ModalidadDeposito): number {
  return modalidad === 'tarjeta_credito' ? DEPOSITO_GARANTIA_TARJETA_CREDITO : DEPOSITO_GARANTIA_ESTANDAR;
}

/**
 * Valor por defecto cuando nadie ha dicho la modalidad.
 *
 * Es el ALTO a propósito: ver la nota de arriba.
 */
export const DEPOSITO_GARANTIA = DEPOSITO_GARANTIA_ESTANDAR;

/** Pena por cada día o fracción de mora en la restitución: 200 % del canon diario (cláusula décima segunda del arrendamiento). */
export const PENA_MORA_PCT = 200;

/** Cláusula penal del arrendamiento: 30 % del canon total pactado (cláusula décima quinta). */
export const CLAUSULA_PENAL_ARRENDAMIENTO_PCT = 30;

/**
 * Cláusula penal del contrato de agencia: 20 % del «valor total del contrato»
 * (cláusula décima cuarta).
 *
 * ⚠️ OJO con la base: su parágrafo primero NO define ese valor como el canon de
 * una operación, sino como «la sumatoria de las comisiones causadas a favor de EL
 * AGENTE durante el período anual en curso» (proyectada a doce meses si el
 * incumplimiento ocurre antes de que termine el período, y 5 SMLMV si ocurre
 * antes de la primera comisión). Por eso `clausulaPenalAgencia` recibe esa base
 * y no la calcula sola: el dato anual no lo tiene esta función. Hoy ninguno de
 * los seis documentos imprime esta cifra —la cláusula solo enuncia el 20 %—, así
 * que no entra en `calcularDerivados`.
 */
export const CLAUSULA_PENAL_AGENCIA_PCT = 20;

/** 20 % sobre la base anual de comisiones definida en el parágrafo primero de la cláusula décima cuarta. */
export function clausulaPenalAgencia(baseComisionesAnuales: number): number {
  return redondear(baseComisionesAnuales * CLAUSULA_PENAL_AGENCIA_PCT / 100);
}

// ── IVA configurable ────────────────────────────────────────────────────────
//
// El dueño pidió poder cobrar IVA o no «mientras organizamos la contabilidad».
// Se guarda en la tabla `config` con dos claves:
//   · `iva_activo` → 'true' | 'false'
//   · `iva_pct`    → PORCENTAJE ENTERO en texto ('19'), NO fracción.
//
// La convención de porcentaje entero es la misma de `TOLERANCIA_TARIFA_BUS` y la
// contraria a `comision_plataforma_pct` (que sí es fracción, 0.35). Se eligió
// entero porque es lo que el documento imprime en letras —«a la tarifa del
// diecinueve por ciento (19%)»— y porque `porcentajeEnLetras` solo admite
// enteros: una tarifa de 19,5 % no se podría escribir en letras como lo exige el
// documento.
//
// POR DEFECTO VA APAGADO. Hoy el precio de la plataforma (`vehiculos.precio_dia`)
// es un valor único que el cliente paga completo: `reservas.total` NO lleva una
// línea de IVA ni la factura la separa. Si el contrato dijera que al canon «se
// adiciona el IVA», estaría cobrando algo que no se recaudó.

export type ConfigIva = { activo: boolean; tarifa: number };

export const IVA_TARIFA_DEFECTO = 19;
export const IVA_ACTIVO_DEFECTO = false;
export const IVA_POR_DEFECTO: ConfigIva = { activo: IVA_ACTIVO_DEFECTO, tarifa: IVA_TARIFA_DEFECTO };

/**
 * Normaliza lo que venga de `config` (o de un body) a un `ConfigIva` usable.
 * Una tarifa que no sea un entero entre 0 y 100 cae al valor por defecto: es
 * preferible imprimir el 19 % conocido que reventar el documento, y el
 * llamador ya validó al guardar (ver app/api/config/route.ts).
 */
export function normalizarConfigIva(activo: unknown, tarifa: unknown): ConfigIva {
  const act = activo === true || activo === 'true' || activo === 1 || activo === '1';
  // Cadena vacía / ausente = «no configurado», no «tarifa cero»: `Number('')` es 0
  // y eso convertiría una clave sin valor en un IVA del 0 %.
  const crudo = typeof tarifa === 'string' ? tarifa.trim() : tarifa;
  if (crudo === '' || crudo === null || crudo === undefined) return { activo: act, tarifa: IVA_TARIFA_DEFECTO };
  const n = Number(crudo);
  const t = Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 100 ? n : IVA_TARIFA_DEFECTO;
  return { activo: act, tarifa: t };
}

// ── Escala de comisión de la cláusula cuarta ────────────────────────────────

export type TramoComision = {
  /** 1..4, en el orden en que los enuncia la cláusula. */
  indice: number;
  /** Días mínimos del tramo. */
  desde: number;
  /** Días máximos del tramo; `null` = sin tope («treinta (30) días o más»). */
  hasta: number | null;
  /** Porcentaje en UNIDADES (35 = 35 %), como lo escribe el documento. */
  pct: number;
  /** Cómo se nombra el tramo en el otrosí: «resulta aplicable el último tramo…». */
  ordinal: string;
};

export const ESCALA_COMISION_AGENCIA: readonly TramoComision[] = [
  { indice: 1, desde: 1, hasta: 1, pct: 35, ordinal: 'primer' },
  { indice: 2, desde: 2, hasta: 6, pct: 33, ordinal: 'segundo' },
  { indice: 3, desde: 7, hasta: 29, pct: 31, ordinal: 'tercer' },
  { indice: 4, desde: 30, hasta: null, pct: 30, ordinal: 'último' },
] as const;

/** Extremos del rango que la cláusula declara infranqueable («entre el 30 % y el 35 %»). */
export const COMISION_PCT_MIN = 30;
export const COMISION_PCT_MAX = 35;

/** El tramo de la escala que corresponde a un arrendamiento de `dias` días. */
export function tramoComisionAgencia(dias: number): TramoComision {
  const d = Math.max(1, Math.floor(Number(dias) || 0));
  const tramo = ESCALA_COMISION_AGENCIA.find(t => d >= t.desde && (t.hasta === null || d <= t.hasta));
  // El último tramo no tiene tope, así que `find` solo puede fallar si alguien
  // rompe la tabla. Se devuelve el tramo más caro para el propietario (30 %)
  // antes que inventar un porcentaje fuera del rango pactado.
  return tramo ?? ESCALA_COMISION_AGENCIA[ESCALA_COMISION_AGENCIA.length - 1];
}

/** Porcentaje de comisión en UNIDADES (30, 31, 33 o 35) según los días. */
export function comisionPctAgencia(dias: number): number {
  return tramoComisionAgencia(dias).pct;
}

// ── Derivados de una operación ──────────────────────────────────────────────

export function redondear(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

export type EntradaDerivados = {
  /** Días del arrendamiento (>= 1). */
  dias: number;
  /** Canon diario en pesos, ya redondeado a peso entero. */
  canonDiario: number;
  iva?: ConfigIva;
  /** Depósito de garantía; por defecto el del contrato ($2.000.000). */
  deposito?: number;
  /**
   * Porcentaje de comisión en UNIDADES. Por defecto sale de la ESCALA del
   * contrato de agencia. Se puede forzar (p. ej. para comparar con el global de
   * `comision_plataforma_pct`), pero fuera del rango 30–35 el documento estaría
   * contradiciendo su propia cláusula cuarta: por eso queda constancia en
   * `comisionFueraDeRango`.
   */
  comisionPct?: number;
};

export type Derivados = {
  dias: number;
  canonDiario: number;
  /** canon diario × días. */
  canonTotal: number;
  iva: ConfigIva;
  /** IVA sobre el canon total. 0 cuando está apagado. */
  ivaCanon: number;
  /** Lo que paga el arrendatario: canon total + IVA. */
  totalArrendatario: number;
  comisionPct: number;
  tramoComision: TramoComision;
  /** ¿El porcentaje usado se salió del rango 30–35 que fija la cláusula cuarta? */
  comisionFueraDeRango: boolean;
  comisionValor: number;
  /** IVA sobre la comisión del agente. 0 cuando está apagado. */
  ivaComision: number;
  /** Saldo que se gira al propietario en cuanto al canon: canon total − comisión. */
  netoPropietario: number;
  /** 200 % del canon diario, por cada día o fracción de mora en la restitución. */
  penaMoraDiaria: number;
  /** 30 % del canon total. */
  clausulaPenalArrendamiento: number;
  deposito: number;
};

/**
 * ÚNICA función que calcula las cifras de una operación. Todo documento que
 * imprima plata tiene que salir de acá.
 */
export function calcularDerivados(e: EntradaDerivados): Derivados {
  const dias = Math.max(1, Math.floor(Number(e.dias) || 0));
  const canonDiario = redondear(e.canonDiario);
  const canonTotal = canonDiario * dias;

  const iva = e.iva ?? IVA_POR_DEFECTO;
  const ivaCanon = iva.activo ? redondear(canonTotal * iva.tarifa / 100) : 0;

  const tramo = tramoComisionAgencia(dias);
  const comisionPct = e.comisionPct === undefined ? tramo.pct : Number(e.comisionPct);
  const comisionValor = redondear(canonTotal * comisionPct / 100);
  const ivaComision = iva.activo ? redondear(comisionValor * iva.tarifa / 100) : 0;

  return {
    dias,
    canonDiario,
    canonTotal,
    iva,
    ivaCanon,
    totalArrendatario: canonTotal + ivaCanon,
    comisionPct,
    tramoComision: tramo,
    comisionFueraDeRango: comisionPct < COMISION_PCT_MIN || comisionPct > COMISION_PCT_MAX,
    comisionValor,
    ivaComision,
    netoPropietario: canonTotal - comisionValor,
    penaMoraDiaria: redondear(canonDiario * PENA_MORA_PCT / 100),
    clausulaPenalArrendamiento: redondear(canonTotal * CLAUSULA_PENAL_ARRENDAMIENTO_PCT / 100),
    deposito: e.deposito === undefined ? DEPOSITO_GARANTIA : redondear(e.deposito),
  };
}

// ── Escala del contrato vs. porcentaje global de hoy ────────────────────────

export type ComparacionComision = {
  dias: number;
  canonTotal: number;
  /** Lo que dice el contrato firmado. */
  pctEscala: number;
  comisionEscala: number;
  /** Lo que aplica hoy `lib/contabilidad.ts` (config `comision_plataforma_pct`). */
  pctGlobal: number;
  comisionGlobal: number;
  /** comisiónGlobal − comisiónEscala. Positivo = al propietario se le descontó de más. */
  diferencia: number;
};

/**
 * Cuánto cambiaría la comisión de una operación si se aplicara la escala del
 * contrato en vez del porcentaje único de hoy. `pctGlobalFraccion` es la fracción
 * que guarda `comision_plataforma_pct` (0.35), no unidades de porcentaje.
 */
export function comparacionComision(dias: number, canonTotal: number, pctGlobalFraccion: number): ComparacionComision {
  const d = Math.max(1, Math.floor(Number(dias) || 0));
  const base = redondear(canonTotal);
  const pctEscala = comisionPctAgencia(d);
  const pctGlobal = redondear(Number(pctGlobalFraccion) * 10000) / 100;
  const comisionEscala = redondear(base * pctEscala / 100);
  const comisionGlobal = redondear(base * pctGlobal / 100);
  return {
    dias: d,
    canonTotal: base,
    pctEscala,
    comisionEscala,
    pctGlobal,
    comisionGlobal,
    diferencia: comisionGlobal - comisionEscala,
  };
}
