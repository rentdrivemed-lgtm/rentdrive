// Precio de mercado por segmento — deriva el precio/día de un vehículo a partir de su
// categoría y valor comercial (Estudio de Mercado, 7 rentadoras, jul-2026).
// Se usa tanto en el registro/vitrina (precio automático) como en la calculadora del admin
// y en "¿Cuánto puedes ganar con tu carro?" para sugerir un precio realista.
import type { TipoVehiculo } from './rentabilidad';

// ─── Precio de mercado por segmento (Estudio de Mercado, 7 rentadoras, jul-2026) ───
// El precio/día NO es proporcional al valor: es regresivo (los económicos rentan a ~0,45%/día
// de su valor; los de gama alta a ~0,20%). En vez de un precio fijo por categoría, cada segmento
// tiene un RANGO real de tarifa y el precio se INTERPOLA según dónde cae el valor comercial del
// carro dentro del rango de valor del segmento. Así marca/modelo/año (que definen el valor)
// posicionan el precio sin que el carro más caro del grupo arrastre a todos hacia arriba.
export const RANGO_MERCADO_POR_TIPO: Record<TipoVehiculo, {
  valorMin: number; valorMax: number; precioMin: number; precioMax: number;
}> = {
  sedan:          { valorMin: 45_000_000,  valorMax: 130_000_000, precioMin: 220_000, precioMax: 490_000 },
  coupe:          { valorMin: 90_000_000,  valorMax: 220_000_000, precioMin: 300_000, precioMax: 600_000 },
  suv:            { valorMin: 95_000_000,  valorMax: 170_000_000, precioMin: 300_000, precioMax: 530_000 },
  camioneta7:     { valorMin: 150_000_000, valorMax: 330_000_000, precioMin: 450_000, precioMax: 1_050_000 },
  lujo_auto:      { valorMin: 180_000_000, valorMax: 500_000_000, precioMin: 490_000, precioMax: 1_000_000 },
  lujo_camioneta: { valorMin: 250_000_000, valorMax: 600_000_000, precioMin: 700_000, precioMax: 1_200_000 },
};

// Interpola el precio sugerido dentro del rango del segmento según el valor comercial.
// `ajustePct` (ej. +5 / −10) sube o baja modelos de alta/baja demanda. Redondea a $1.000.
export function precioMercadoSugerido(
  tipo: TipoVehiculo, valorComercial: number, ajustePct = 0,
): number {
  const r = RANGO_MERCADO_POR_TIPO[tipo];
  if (!r || !valorComercial || valorComercial <= 0) return 0;
  const t = r.valorMax > r.valorMin ? (valorComercial - r.valorMin) / (r.valorMax - r.valorMin) : 0;
  const tc = Math.min(1, Math.max(0, t)); // fuera de rango → se ancla al extremo del segmento
  const base = r.precioMin + tc * (r.precioMax - r.precioMin);
  return Math.round((base * (1 + ajustePct / 100)) / 1000) * 1000;
}

// Banda de cordura: rango razonable de precio/día como % del valor comercial (regresivo).
// Sirve para marcar en ámbar un precio manual fuera de mercado.
export function bandaPrecioValor(valorComercial: number): { min: number; max: number } {
  const PCT_ALTO = 0.0045, PCT_BAJO = 0.0020;      // 0,45% carros baratos → 0,20% gama alta
  const V_BAJO = 50_000_000, V_ALTO = 500_000_000;
  const t = Math.min(1, Math.max(0, (valorComercial - V_BAJO) / (V_ALTO - V_BAJO)));
  const pct = PCT_ALTO - t * (PCT_ALTO - PCT_BAJO);
  return {
    min: Math.round(valorComercial * pct * 0.75),
    max: Math.round(valorComercial * pct * 1.25),
  };
}

// Los `tipo` guardados en la BD deberían ser uno de los 6 segmentos, pero por datos viejos
// o intermedios puede llegar 'compacto'/'pickup'/vacío. Coacciona a un segmento válido para
// que el cálculo nunca falle.
const MAPA_TIPO_LEGADO: Record<string, TipoVehiculo> = {
  sedan: 'sedan', coupe: 'coupe', suv: 'suv', camioneta7: 'camioneta7',
  lujo_auto: 'lujo_auto', lujo_camioneta: 'lujo_camioneta',
  compacto: 'sedan', pickup: 'camioneta7', // legado
};
export function segmentoValido(tipo: string | null | undefined): TipoVehiculo {
  return MAPA_TIPO_LEGADO[(tipo || '').trim()] ?? 'sedan';
}
