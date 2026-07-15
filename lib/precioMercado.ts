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

// ─── Tabla de precios por MARCA+MODELO (Estudio de Mercado, 7 rentadoras Medellín, jul-2026) ───
// La marca/modelo es la variable PRINCIPAL del precio: un modelo muy pedido (Tucson, Fortuner)
// renta más que el carro más barato de su segmento aunque valgan parecido. Cuando el vehículo
// está en esta tabla se usa su precio/día base (afinado por el año); si no, se cae a la
// interpolación por segmento (precioMercadoSugerido). 'valor' = valor comercial típico de un
// ejemplar reciente; 'precio' = tarifa/día de referencia para un modelo de <=3 años.
export type ModeloMercado = {
  marca: string; modelo: string; tipo: TipoVehiculo; valor: number; precio: number;
};

export const MODELOS_MERCADO: ModeloMercado[] = [
  // Económico / sedán pequeño
  { marca: 'Kia',           modelo: 'Picanto',         tipo: 'sedan',          valor: 55_000_000,  precio: 220_000 },
  { marca: 'Renault',       modelo: 'Logan / Sandero', tipo: 'sedan',          valor: 55_000_000,  precio: 225_000 },
  { marca: 'Chevrolet',     modelo: 'Onix',            tipo: 'sedan',          valor: 62_000_000,  precio: 240_000 },
  { marca: 'Suzuki',        modelo: 'Swift / Dzire',   tipo: 'sedan',          valor: 65_000_000,  precio: 245_000 },
  { marca: 'Mazda',         modelo: '2',               tipo: 'sedan',          valor: 65_000_000,  precio: 255_000 },
  { marca: 'Nissan',        modelo: 'Versa',           tipo: 'sedan',          valor: 72_000_000,  precio: 275_000 },
  // Sedán / compacto medio
  { marca: 'Nissan',        modelo: 'Sentra',          tipo: 'sedan',          valor: 90_000_000,  precio: 320_000 },
  { marca: 'Mazda',         modelo: '3',               tipo: 'sedan',          valor: 100_000_000, precio: 370_000 },
  { marca: 'Toyota',        modelo: 'Corolla',         tipo: 'sedan',          valor: 110_000_000, precio: 385_000 },
  { marca: 'Renault',       modelo: 'Arkana',          tipo: 'suv',            valor: 120_000_000, precio: 430_000 },
  { marca: 'Mercedes-Benz', modelo: 'A200 / CLA',      tipo: 'lujo_auto',      valor: 180_000_000, precio: 490_000 },
  // SUV compacta 5 puestos
  { marca: 'Suzuki',        modelo: 'Vitara',          tipo: 'suv',            valor: 95_000_000,  precio: 340_000 },
  { marca: 'Nissan',        modelo: 'Kicks',           tipo: 'suv',            valor: 98_000_000,  precio: 345_000 },
  { marca: 'Chevrolet',     modelo: 'Equinox',         tipo: 'suv',            valor: 120_000_000, precio: 390_000 },
  { marca: 'Mazda',         modelo: 'CX-30',           tipo: 'suv',            valor: 120_000_000, precio: 395_000 },
  { marca: 'Kia',           modelo: 'Sportage',        tipo: 'suv',            valor: 120_000_000, precio: 410_000 },
  { marca: 'Hyundai',       modelo: 'Tucson',          tipo: 'suv',            valor: 120_000_000, precio: 420_000 },
  { marca: 'Mazda',         modelo: 'CX-5',            tipo: 'suv',            valor: 135_000_000, precio: 435_000 },
  { marca: 'Volkswagen',    modelo: 'Tiguan',          tipo: 'suv',            valor: 140_000_000, precio: 440_000 },
  { marca: 'Toyota',        modelo: 'RAV4',            tipo: 'suv',            valor: 160_000_000, precio: 480_000 },
  // SUV grande / 7 puestos
  { marca: 'Chevrolet',     modelo: 'Trailblazer',     tipo: 'camioneta7',     valor: 150_000_000, precio: 500_000 },
  { marca: 'Mazda',         modelo: 'CX-9',            tipo: 'camioneta7',     valor: 160_000_000, precio: 520_000 },
  { marca: 'Kia',           modelo: 'Sorento',         tipo: 'camioneta7',     valor: 170_000_000, precio: 530_000 },
  { marca: 'Toyota',        modelo: 'Fortuner',        tipo: 'camioneta7',     valor: 190_000_000, precio: 600_000 },
  { marca: 'Hyundai',       modelo: 'Palisade',        tipo: 'camioneta7',     valor: 210_000_000, precio: 650_000 },
  { marca: 'Toyota',        modelo: '4Runner',         tipo: 'camioneta7',     valor: 230_000_000, precio: 680_000 },
  { marca: 'Toyota',        modelo: 'Prado',           tipo: 'camioneta7',     valor: 290_000_000, precio: 850_000 },
  // Lujo — sedán/coupé premium
  { marca: 'BMW',           modelo: 'Serie 3 / 4',     tipo: 'lujo_auto',      valor: 260_000_000, precio: 720_000 },
  // Lujo — SUV premium y camioneta grande
  { marca: 'BMW',           modelo: 'X1 / X2',         tipo: 'lujo_camioneta', valor: 220_000_000, precio: 620_000 },
  { marca: 'Audi',          modelo: 'Q5',              tipo: 'lujo_camioneta', valor: 280_000_000, precio: 780_000 },
  { marca: 'BMW',           modelo: 'X4',              tipo: 'lujo_camioneta', valor: 320_000_000, precio: 850_000 },
  { marca: 'Mercedes-Benz', modelo: 'GLC',             tipo: 'lujo_camioneta', valor: 330_000_000, precio: 880_000 },
  { marca: 'Audi',          modelo: 'Q7 / Q8',         tipo: 'lujo_camioneta', valor: 450_000_000, precio: 1_000_000 },
  { marca: 'Porsche',       modelo: 'Cayenne',         tipo: 'lujo_camioneta', valor: 520_000_000, precio: 1_120_000 },
  { marca: 'Chevrolet',     modelo: 'Tahoe',           tipo: 'lujo_camioneta', valor: 310_000_000, precio: 975_000 },
  { marca: 'Toyota',        modelo: 'Prado blindado',  tipo: 'lujo_camioneta', valor: 380_000_000, precio: 900_000 },
  { marca: 'Chevrolet',     modelo: 'Tahoe blindado',  tipo: 'lujo_camioneta', valor: 430_000_000, precio: 1_150_000 },
];

// Factor de año aplicado al PRECIO (más suave que el del valor): un modelo más viejo renta algo menos.
export function factorAnioPrecio(anio: number): number {
  const edad = new Date().getFullYear() - (anio || new Date().getFullYear());
  if (edad <= 3) return 1.00;
  if (edad <= 6) return 0.92;
  if (edad <= 9) return 0.84;
  return 0.75;
}

// Precio sugerido cuando el propietario elige un modelo de la tabla.
export function precioModeloSugerido(modelo: ModeloMercado, anio: number, ajustePct = 0): number {
  const base = modelo.precio * factorAnioPrecio(anio) * (1 + ajustePct / 100);
  return Math.round(base / 1000) * 1000;
}
