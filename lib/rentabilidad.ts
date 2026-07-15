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

export type TipoVehiculo = 'sedan' | 'coupe' | 'suv' | 'camioneta7' | 'lujo_auto' | 'lujo_camioneta';

export const TIPO_VEHICULO_LABELS: Record<TipoVehiculo, string> = {
  sedan: 'Sedán',
  coupe: 'Coupé',
  suv: 'SUV',
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
  sedan: { valorComercial: 67_000_000, soat: 316_200, pctSeguro: 0.040, mantenimiento: 3_100_000, precioDia: 160_000 },
  coupe: { valorComercial: 110_000_000, soat: 316_200, pctSeguro: 0.045, mantenimiento: 3_800_000, precioDia: 300_000 },
  suv: { valorComercial: 122_400_000, soat: 946_600, pctSeguro: 0.035, mantenimiento: 4_800_000, precioDia: 360_000 },
  camioneta7: { valorComercial: 180_000_000, soat: 946_600, pctSeguro: 0.033, mantenimiento: 5_800_000, precioDia: 500_000 },
  lujo_auto: { valorComercial: 200_000_000, soat: 316_200, pctSeguro: 0.020, mantenimiento: 6_000_000, precioDia: 580_000 },
  lujo_camioneta: { valorComercial: 303_992_000, soat: 1_250_000, pctSeguro: 0.022, mantenimiento: 9_000_000, precioDia: 950_000 },
};

export const COMISION_PLATAFORMA_DEFAULT = 0.33;
export const OCUPACION_DEFAULT = 0.45;
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
  precioDia: number;
  comision: number;
  ocupacion: number;
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

  const diasRentados = 365 * input.ocupacion;
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
