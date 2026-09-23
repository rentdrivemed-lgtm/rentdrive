// Calculadora de rentabilidad para propietarios — mismas variables y fórmulas
// que 01-Captacion-Propietarios/Analisis-Rentabilidad-Vehiculos.xlsx (RentDrive-Estrategia-Marketing-2026).
// Tramos de impuesto vehicular Antioquia 2026 (sobre valor comercial estimado).
const IMPUESTO_UMBRAL_1 = 57_349_000;
const IMPUESTO_UMBRAL_2 = 129_032_000;
const IMPUESTO_TARIFA_1 = 0.015;
const IMPUESTO_TARIFA_2 = 0.025;
const IMPUESTO_TARIFA_3 = 0.035;

export function pctImpuestoVehicular(valorComercial: number): number {
  if (valorComercial <= IMPUESTO_UMBRAL_1) return IMPUESTO_TARIFA_1;
  if (valorComercial <= IMPUESTO_UMBRAL_2) return IMPUESTO_TARIFA_2;
  return IMPUESTO_TARIFA_3;
}

export type TipoVehiculo =
  | 'economico' | 'sedan' | 'coupe' | 'suv' | 'pickup' | 'camioneta7' | 'lujo_auto' | 'lujo_camioneta';

// El ORDEN de este objeto es el orden en que se pintan las categorías en todas partes:
// los filtros de la portada (app/page.tsx), los botones y el selector de la calculadora
// pública, y los optgroup del selector de marca/modelo. Por eso 'economico' va primero —
// es el segmento de entrada y el que más consultas recibe.
export const TIPO_VEHICULO_LABELS: Record<TipoVehiculo, string> = {
  economico: 'Económico',
  sedan: 'Sedán',
  coupe: 'Coupé',
  suv: 'SUV',
  pickup: 'Pick up',
  camioneta7: 'Camioneta 7 puestos',
  lujo_auto: 'Automóvil de lujo',
  lujo_camioneta: 'Camioneta de lujo',
};

// Valores de referencia por categoría — no por marca/modelo específico. El propietario
// parte de aquí y ajusta cualquier campo con los datos reales de su vehículo.
// SOAT/impuesto/seguro con base en tarifas 2026 (ver 02-Analisis-Rentabilidad-Vehiculos.md);
// las categorías nuevas (coupé, camioneta 7 puestos, automóvil de lujo) son estimaciones de
// referencia por interpolación — afinarlas cuando se tengan cotizaciones reales de cada una.
export const DEFAULTS_POR_TIPO: Record<TipoVehiculo, {
  valorComercial: number; soat: number; pctSeguro: number; mantenimiento: number;
  precioDia: number;
}> = {
// `precioDia` recalibrado en sep-2026 junto con RANGO_MERCADO_POR_TIPO: cada uno es ahora el
// resultado exacto de `precioMercadoSugerido(tipo, valorComercial)` para el valor de esta misma
// fila. Antes no lo era y quedaban dos incoherencias que un lector razonable habría tomado por
// buenas: 'sedan' estaba en $160.000, POR DEBAJO del piso de $215.000 de su propio segmento
// (justo lo que prohíbe la INVARIANTE de lib/precioMercado.ts), y el segmento 'economico' salía
// más caro que el sedán.
  economico: { valorComercial: 50_000_000, soat: 316_200, pctSeguro: 0.045, mantenimiento: 2_400_000, precioDia: 169_000 },
  sedan: { valorComercial: 67_000_000, soat: 316_200, pctSeguro: 0.040, mantenimiento: 3_100_000, precioDia: 233_000 },
  coupe: { valorComercial: 110_000_000, soat: 316_200, pctSeguro: 0.045, mantenimiento: 3_800_000, precioDia: 346_000 },
  suv: { valorComercial: 122_400_000, soat: 946_600, pctSeguro: 0.035, mantenimiento: 4_800_000, precioDia: 378_000 },
  pickup: { valorComercial: 150_000_000, soat: 946_600, pctSeguro: 0.034, mantenimiento: 5_200_000, precioDia: 458_000 },
  camioneta7: { valorComercial: 180_000_000, soat: 946_600, pctSeguro: 0.033, mantenimiento: 5_800_000, precioDia: 515_000 },
  lujo_auto: { valorComercial: 200_000_000, soat: 316_200, pctSeguro: 0.020, mantenimiento: 6_000_000, precioDia: 522_000 },
  lujo_camioneta: { valorComercial: 303_992_000, soat: 1_250_000, pctSeguro: 0.022, mantenimiento: 9_000_000, precioDia: 690_000 },
};

export const COMISION_PLATAFORMA_DEFAULT = 0.35;
export const OCUPACION_DEFAULT = 0.45;

// ─── IVA: se causa SOBRE LA COMISIÓN, no sobre el canon ───────────────────────
//
// DrivePass actúa como AGENTE COMERCIAL del propietario (ver los contratos de agencia en
// lib/contratos-*.ts): el arrendador es el propietario, no la plataforma. Lo que factura
// DrivePass es su comisión, y el IVA se causa sobre ESE servicio. Aplicar el 19% al canon
// completo cobraría de más al cliente y le atribuiría al propietario una obligación
// tributaria que no le corresponde a través nuestro.
//
//   canon           → la tarifa/día que se pacta y es la base de todo
//   comisión        → canon × COMISION_PLATAFORMA_DEFAULT (35%)
//   IVA             → comisión × IVA_TARIFA_DEFAULT (19%)
//   precio cliente  → canon + IVA          = canon × (1 + 0,35 × 0,19) = canon × 1,0665
//   propietario     → canon − comisión     = canon × 0,65
//
// Ese 1,0665 NO se escribe a mano en ningún lado: sale de `factorPrecioCliente()`. Si
// mañana cambia la comisión o la tarifa del IVA, el factor cambia solo y no queda una
// constante vieja contradiciendo a las otras dos en alguna pantalla.
export const IVA_TARIFA_DEFAULT = 0.19;

/** Cuánto paga el cliente por cada peso de canon. Con los valores por defecto: 1,0665. */
export function factorPrecioCliente(
  comision = COMISION_PLATAFORMA_DEFAULT,
  iva = IVA_TARIFA_DEFAULT,
): number {
  return 1 + comision * iva;
}

export type DesgloseTarifa = {
  /** Base pactada: lo que "vale" el día de alquiler antes de impuestos. */
  canon: number;
  /** Lo que retiene DrivePass por el servicio de agencia. */
  comision: number;
  /** IVA sobre la comisión (0 si `cobrarIva` está apagado). */
  iva: number;
  /** Lo que efectivamente paga el cliente: canon + IVA. */
  precioCliente: number;
  /** Lo que recibe el propietario: canon − comisión. */
  propietario: number;
};

/**
 * Las tres cifras que hay que poder mostrar por separado en cualquier cotización.
 * `cobrarIva` es el interruptor de contabilidad: apagado deja el IVA en 0 y el precio al
 * cliente igual al canon, sin tocar la comisión ni lo que recibe el propietario.
 */
export function desgloseTarifa(
  canon: number,
  opciones: { comision?: number; iva?: number; cobrarIva?: boolean } = {},
): DesgloseTarifa {
  const base = Number.isFinite(canon) && canon > 0 ? canon : 0;
  const pctComision = Number.isFinite(opciones.comision) ? opciones.comision! : COMISION_PLATAFORMA_DEFAULT;
  const pctIva = Number.isFinite(opciones.iva) ? opciones.iva! : IVA_TARIFA_DEFAULT;
  const cobrarIva = opciones.cobrarIva ?? true;

  const comision = base * pctComision;
  const iva = cobrarIva ? comision * pctIva : 0;
  return {
    canon: base,
    comision,
    iva,
    precioCliente: base + iva,
    propietario: base - comision,
  };
}

// ─── Escalera de duración ─────────────────────────────────────────────────────
//
// El mercado formal de Medellín no cobra el mismo día suelto que el día dentro de un
// alquiler de un mes: a más días, menor tarifa diaria. Sin esta escalera la calculadora
// prometía al propietario el precio de 2 días multiplicado por 30, que es una cifra que
// nunca va a ver.
//
// El alquiler de UN día no se ofrece: el costo de entrega, revisión y devolución no se
// amortiza y las rentadoras formales tampoco lo hacen.
export const DIAS_MINIMOS_ALQUILER = 2;

/**
 * Días a partir de los cuales el alquiler lleva descuento por duración, y cuánto.
 *
 * REGLA DEL DUEÑO (sep-2026): «cuando sean más de 28 días, un descuento del 15 %».
 * «Más de 28» es literal — con 28 días NO hay descuento, con 29 sí.
 *
 * Sustituye a la escalera de cuatro tramos (10 % de 5 a 14 días, 18 % de 15 a 29 y
 * 28 % desde 30) que había hasta ahora. No era una calibración distinta de la misma
 * idea: era OTRA regla, y además solo vivía en la calculadora. El motor de reservas
 * cobraba días sueltos × precio, sin descuento ninguno, así que la cotización que el
 * propietario copiaba a WhatsApp prometía hasta un 28 % que la plataforma después no
 * aplicaba. Con una sola regla en los dos lados, lo cotizado y lo facturado coinciden.
 */
export const DIAS_PARA_DESCUENTO_DURACION = 29;
export const DESCUENTO_DURACION_PCT = 15;

export const ESCALERA_DURACION: { desde: number; hasta: number | null; factor: number; etiqueta: string }[] = [
  { desde: DIAS_MINIMOS_ALQUILER, hasta: DIAS_PARA_DESCUENTO_DURACION - 1, factor: 1.00, etiqueta: `${DIAS_MINIMOS_ALQUILER} a ${DIAS_PARA_DESCUENTO_DURACION - 1} días` },
  { desde: DIAS_PARA_DESCUENTO_DURACION, hasta: null, factor: 1 - DESCUENTO_DURACION_PCT / 100, etiqueta: `${DIAS_PARA_DESCUENTO_DURACION} días o más` },
];

/**
 * Factor de tarifa según cuántos días dure el alquiler. Menos de `DIAS_MINIMOS_ALQUILER`
 * devuelve el factor del primer tramo (no hay tarifa de 1 día que devolver); quien llama
 * debe comprobar el mínimo aparte y decir que no está disponible.
 */
export function factorDuracion(dias: number): number {
  const d = Number.isFinite(dias) ? Math.max(DIAS_MINIMOS_ALQUILER, Math.round(dias)) : DIAS_MINIMOS_ALQUILER;
  const tramo = ESCALERA_DURACION.find(t => d >= t.desde && (t.hasta === null || d <= t.hasta));
  return tramo ? tramo.factor : 1.00;
}
export const GPS_DISPOSITIVO_DEFAULT = 800_000;
export const GPS_ANIOS_AMORTIZACION_DEFAULT = 3;
export const GPS_PLAN_ANUAL_DEFAULT = 150_000;
export const ANIO_MINIMO_SIN_INSPECCION = 2018;

export type RentabilidadInput = {
  valorComercial: number;
  soat: number;
  pctSeguro: number;
  mantenimiento: number;
  gpsDispositivo: number;
  gpsAniosAmortizacion: number;
  gpsPlanAnual: number;
  /**
   * Canon/día con el que se proyecta el AÑO. Ojo: si se pasa el canon del tramo corto (2 a 4
   * días) la proyección anual es "el precio de 2 días multiplicado por 365", que es justo lo
   * que la escalera de duración existe para evitar. Quien llame debe pasar el canon ya
   * escalonado a la duración típica de sus alquileres — ver `factorDuracion()`.
   */
  precioDia: number;
  comision: number;
  ocupacion: number;
  /**
   * Días del año en que el vehículo PUEDE alquilarse. Por defecto 365; un carro sujeto a pico
   * y placa pierde un día hábil por semana (365 − 52 = 313) por mucha demanda que haya, y
   * proyectar sobre 365 le promete al propietario ingresos que no puede facturar.
   */
  diasDisponibles?: number;
};

export type RentabilidadResultado = {
  pctImpuesto: number;
  impuesto: number;
  seguro: number;
  gpsAnualAmortizado: number;
  costoCajaAnual: number;
  diasRentados: number;
  puntoEquilibrioDia: number;
  ingresoBrutoAnual: number;
  comisionCop: number;
  ingresoNetoAnual: number;
  utilidadNetaAnual: number;
  utilidadNetaMensual: number;
  roiAnual: number;
  esRentable: boolean;
};

export function calcularRentabilidad(input: RentabilidadInput): RentabilidadResultado {
  const pctImpuesto = pctImpuestoVehicular(input.valorComercial);
  const impuesto = input.valorComercial * pctImpuesto;
  const seguro = input.valorComercial * input.pctSeguro;
  const gpsAnualAmortizado = input.gpsDispositivo / Math.max(input.gpsAniosAmortizacion, 1) + input.gpsPlanAnual;
  const costoCajaAnual = input.soat + impuesto + seguro + input.mantenimiento + gpsAnualAmortizado;

  const diasDisponibles = Number.isFinite(input.diasDisponibles) ? input.diasDisponibles! : 365;
  const diasRentados = diasDisponibles * input.ocupacion;
  const puntoEquilibrioDia = diasRentados > 0 ? costoCajaAnual / diasRentados : 0;
  const ingresoBrutoAnual = input.precioDia * diasRentados;
  const comisionCop = ingresoBrutoAnual * input.comision;
  const ingresoNetoAnual = ingresoBrutoAnual - comisionCop;
  const utilidadNetaAnual = ingresoNetoAnual - costoCajaAnual;
  const utilidadNetaMensual = utilidadNetaAnual / 12;
  const roiAnual = input.valorComercial > 0 ? utilidadNetaAnual / input.valorComercial : 0;

  return {
    pctImpuesto, impuesto, seguro, gpsAnualAmortizado, costoCajaAnual,
    diasRentados, puntoEquilibrioDia,
    ingresoBrutoAnual, comisionCop, ingresoNetoAnual, utilidadNetaAnual,
    utilidadNetaMensual, roiAnual, esRentable: utilidadNetaAnual > 0,
  };
}

export function sensibilidadPorOcupacion(input: RentabilidadInput, ocupaciones: number[] = [0.30, 0.45, 0.60]) {
  return ocupaciones.map(ocupacion => ({
    ocupacion,
    ...calcularRentabilidad({ ...input, ocupacion }),
  }));
}
