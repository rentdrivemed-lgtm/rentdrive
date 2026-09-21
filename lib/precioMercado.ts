// Precio de mercado por segmento — deriva el precio/día de un vehículo a partir de su
// categoría y valor comercial.
// Se usa tanto en el registro/vitrina (precio automático) como en la calculadora del admin
// y en "¿Cuánto puedes ganar con tu carro?" para sugerir un precio realista.
//
// ─── RECALIBRACIÓN sep-2026 ───────────────────────────────────────────────────
// Hasta ago-2026 la tabla venía de un estudio propio sobre 7 rentadoras (jul-2026) que
// mezclaba plataformas entre particulares (P2P) con rentadoras formales. Eso inflaba las
// tarifas: el precio P2P no incluye la estructura de una rentadora (flota de reemplazo,
// mostrador, póliza corporativa) y no es con quien competimos.
//
// Las tarifas de esta versión provienen de las tarifas PUBLICADAS por cuatro rentadoras
// formales de Medellín, consultadas en septiembre de 2026:
//
//     · Rentadora de Colombia      · Rent a Car Medellín
//     · Exotic Rent a Car          · Evolution Rent a Car
//
// Las líneas marcadas `mercado formal sep-2026` corresponden a modelos con tarifa
// publicada por al menos una de esas cuatro. Las marcadas `estimado` NO tienen tarifa
// publicada: su precio se interpoló desde los modelos comparables que sí la tienen, y la
// interfaz las muestra con la advertencia "Precio estimado — sin referencia publicada en
// el mercado formal" para no dar una cifra con una precisión que no tiene respaldo.
//
// Todas las cifras son CANON (base), antes de IVA. El IVA se causa sobre la comisión, no
// sobre el canon — ver `desgloseTarifa()` en lib/rentabilidad.ts.
import type { TipoVehiculo } from './rentabilidad';

// ─── Precio de mercado por segmento ───────────────────────────────────────────
// El precio/día NO es proporcional al valor: es regresivo (los económicos rentan a ~0,45%/día
// de su valor; los de gama alta a ~0,20%). En vez de un precio fijo por categoría, cada segmento
// tiene un RANGO real de tarifa y el precio se INTERPOLA según dónde cae el valor comercial del
// carro dentro del rango de valor del segmento. Así marca/modelo/año (que definen el valor)
// posicionan el precio sin que el carro más caro del grupo arrastre a todos hacia arriba.
//
// INVARIANTE (ago-2026, tras el caso de la Explorer sugerida en $300.000/día): `precioMin` de
// un segmento NUNCA debe quedar por debajo del modelo más barato de ese mismo segmento en
// `MODELOS_MERCADO`, ni `precioMax` por encima del más caro. Si no, un vehículo con el
// `valor_comercial` mal declarado cae en un piso más barato que CUALQUIER carro real de su
// categoría. Cada vez que se toque la tabla de modelos hay que revisar estos rangos — la
// prueba `__rangosCoherentesConModelos()` del final de este archivo lo comprueba.
export const RANGO_MERCADO_POR_TIPO: Record<TipoVehiculo, {
  valorMin: number; valorMax: number; precioMin: number; precioMax: number;
}> = {
  economico:      { valorMin: 38_000_000,  valorMax: 70_000_000,  precioMin: 150_000, precioMax: 200_000 },
  sedan:          { valorMin: 60_000_000,  valorMax: 130_000_000, precioMin: 215_000, precioMax: 390_000 },
  coupe:          { valorMin: 90_000_000,  valorMax: 220_000_000, precioMin: 300_000, precioMax: 600_000 },
  suv:            { valorMin: 85_000_000,  valorMax: 170_000_000, precioMin: 290_000, precioMax: 490_000 },
  pickup:         { valorMin: 90_000_000,  valorMax: 220_000_000, precioMin: 320_000, precioMax: 620_000 },
  camioneta7:     { valorMin: 110_000_000, valorMax: 330_000_000, precioMin: 400_000, precioMax: 760_000 },
  lujo_auto:      { valorMin: 180_000_000, valorMax: 500_000_000, precioMin: 490_000, precioMax: 1_000_000 },
  lujo_camioneta: { valorMin: 220_000_000, valorMax: 600_000_000, precioMin: 560_000, precioMax: 1_150_000 },
};

// Interpola el precio sugerido dentro del rango del segmento según el valor comercial.
// `ajustePct` (ej. +5 / −10) sube o baja modelos de alta/baja demanda. Redondea a $1.000.
//
// Blindaje (ago-2026, tras el caso de la Explorer sugerida en $300.000/día): el resultado
// SIEMPRE se recorta al rango [precioMin, precioMax] del segmento, DESPUÉS de aplicar
// `ajustePct`. Antes el ajuste no tenía tope, así que un `precio_ajuste_pct` grande (mal
// declarado, o un valor atípico) podía sacar el precio final del rango razonable del
// segmento aunque la interpolación por valor comercial sí estuviera acotada. Con el clamp
// final, el precio de un carro NUNCA puede salir del rango de su categoría sin importar qué
// valor comercial o qué ajuste se haya declarado — el rango de la categoría manda.
export function precioMercadoSugerido(
  tipo: TipoVehiculo, valorComercial: number, ajustePct = 0,
): number {
  // Blindaje: un NaN en cualquiera de los dos números (dato mal parseado, división
  // corrupta aguas arriba, etc.) se propagaría por toda la interpolación y produciría un
  // resultado NaN, contradiciendo la garantía de "nunca sale del rango" de arriba.
  if (!Number.isFinite(valorComercial)) valorComercial = 0;
  if (!Number.isFinite(ajustePct)) ajustePct = 0;
  const r = RANGO_MERCADO_POR_TIPO[tipo];
  if (!r || !valorComercial || valorComercial <= 0) return 0;
  const t = r.valorMax > r.valorMin ? (valorComercial - r.valorMin) / (r.valorMax - r.valorMin) : 0;
  const tc = Math.min(1, Math.max(0, t)); // fuera de rango → se ancla al extremo del segmento
  const base = r.precioMin + tc * (r.precioMax - r.precioMin);
  const conAjuste = base * (1 + ajustePct / 100);
  const acotado = Math.min(r.precioMax, Math.max(r.precioMin, conAjuste));
  return Math.round(acotado / 1000) * 1000;
}

// Banda de cordura: rango razonable de precio/día como % del valor comercial (regresivo).
// Sirve para marcar en ámbar un precio manual fuera de mercado.
//
// OJO (sep-2026): esta banda se calcula sobre el valor comercial DEL AÑO DEL VEHÍCULO, no
// sobre el del modelo 0 km. Mientras el valor no se depreciaba por año (el bug que se
// corrigió en esta misma tanda) la banda se calculaba sobre un valor de carro nuevo y el
// precio sobre uno de carro viejo, así que la propia calculadora avisaba "este precio está
// por debajo del mercado" contra un precio que ella misma acababa de sugerir. Quien llame a
// esta función debe pasarle el valor ya depreciado — ver `valorComercialSugerido()`.
// RECALIBRADA sep-2026 junto con la tabla de precios. Los parámetros viejos (0,45% → 0,20%
// con ventana de ±25%) venían de las tarifas infladas por el P2P: contrastados contra los
// precios del mercado formal, 22 de los 58 modelos de `MODELOS_MERCADO` quedaban FUERA de su
// propia banda. O sea que la calculadora marcaba como "fuera de mercado" el precio que ella
// misma acababa de sugerir, para más de un tercio del catálogo.
//
// La curva real es mucho más plana de lo que se suponía: va de ~0,34%/día del valor en los
// económicos a ~0,24% en la gama alta, no de 0,45% a 0,20%. Y la dispersión entre modelos de
// valor parecido es grande (un Mazda 2 renta al 0,41% y un Mazda 3 al 0,24%), así que la
// ventana pasa de ±25% a ±35%: con ±25% la banda vuelve a acusar modelos reales.
//
// Con estos parámetros ningún modelo de la tabla queda fuera de su banda, y la banda sigue
// haciendo su trabajo — que es marcar un precio escrito a mano que no tiene sentido, no
// discutirle al propietario un precio que salió de la tabla.
// LA ANTIGÜEDAD MUEVE LA BANDA. Un carro viejo renta a un porcentaje MÁS ALTO de su valor que
// uno nuevo, y no por casualidad: es exactamente la divergencia entre las dos curvas de
// antigüedad de arriba. A los 10 años el valor cayó al 52% pero la tarifa solo al 62%, así que
// la relación precio/valor sube en 0,62/0,52 = 1,19. Sin este ajuste la banda acusaba a los
// modelos baratos en cuanto envejecían (un Mazda 2 de 2014, un Versa de 2014) — el mismo tipo
// de falso positivo que motivó esta recalibración, solo que por el otro extremo.
//
// LA BANDA TIENE QUE MIRAR LOS MISMOS EJES QUE EL PRECIO. Cada vez que un factor mueve UN SOLO
// lado de la relación precio/valor, la banda se descuadra y vuelve a acusar el precio que la
// propia calculadora sugiere. Son tres, y los tres hay que compensarlos acá:
//
//   · ANTIGÜEDAD — el valor cae más rápido que la tarifa (×0,52 contra ×0,62 a los 10 años),
//     así que un carro viejo renta a un % MÁS ALTO de su valor. Sube la banda.
//   · EQUIPAMIENTO — el full equipo sube el valor ×1,15 y no toca la tarifa (el cliente de
//     alquiler no paga más por el techo corredizo). Sin descontarlo, la banda subía un 15% con
//     el precio quieto y marcaba "por debajo del mercado" a 24 combinaciones reales.
//   · EXENCIÓN DE PICO Y PLACA — al revés: sube la tarifa y no toca el valor. Sin incluirlo, la
//     banda marcaba "por encima" a 15 combinaciones.
//
// Todos los parámetros son opcionales: sin ellos la banda es la de un vehículo de hasta 3 años,
// estándar y no exento, que es el comportamiento de siempre.
export function bandaPrecioValor(
  valorComercial: number,
  opciones: number | { anio?: number; equipamiento?: Equipamiento; factorExencion?: number } = {},
): { min: number; max: number } {
  // Acepta todavía `bandaPrecioValor(valor, anio)` — así se llamaba hasta hace poco.
  const o = typeof opciones === 'number' ? { anio: opciones } : opciones;

  const PCT_ALTO = 0.0034, PCT_BAJO = 0.0022;      // 0,34% carros baratos → 0,22% gama alta
  const VENTANA = 0.35;
  const V_BAJO = 50_000_000, V_ALTO = 500_000_000;

  // El equipamiento se DESCUENTA del valor antes de mirar el %: la banda se calcula sobre el
  // valor "pelado", que es el que corresponde a la tarifa.
  const valorSinEquipo = valorComercial / FACTOR_EQUIPAMIENTO[o.equipamiento ?? 'estandar'];

  const t = Math.min(1, Math.max(0, (valorSinEquipo - V_BAJO) / (V_ALTO - V_BAJO)));
  const factorEdad = o.anio === undefined ? 1 : factorAnioPrecio(o.anio) / factorAnioValor(o.anio);
  const pct = (PCT_ALTO - t * (PCT_ALTO - PCT_BAJO)) * factorEdad;
  const centro = valorSinEquipo * pct * (o.factorExencion ?? 1);
  return {
    min: Math.round(centro * (1 - VENTANA)),
    max: Math.round(centro * (1 + VENTANA)),
  };
}

// Los `tipo` guardados en la BD deberían ser uno de los segmentos de arriba, pero por datos
// viejos o intermedios puede llegar 'compacto' o vacío. Coacciona a un segmento válido para
// que el cálculo nunca falle.
//
// 'pickup' YA NO es legado (sep-2026): pasó a ser un segmento propio con su propio rango de
// tarifa, así que los vehículos que estaban guardados con ese `tipo` dejan de mostrarse como
// "Camioneta 7 puestos" y pasan a mostrarse como "Pick up", que es lo que siempre fueron.
const MAPA_TIPO_LEGADO: Record<string, TipoVehiculo> = {
  economico: 'economico', sedan: 'sedan', coupe: 'coupe', suv: 'suv', pickup: 'pickup',
  camioneta7: 'camioneta7', lujo_auto: 'lujo_auto', lujo_camioneta: 'lujo_camioneta',
  compacto: 'sedan', // legado
};
export function segmentoValido(tipo: string | null | undefined): TipoVehiculo {
  return MAPA_TIPO_LEGADO[(tipo || '').trim()] ?? 'sedan';
}

// ─── Tabla de precios por MARCA+MODELO ────────────────────────────────────────
// La marca/modelo es la variable PRINCIPAL del precio: un modelo muy pedido (Tucson, Fortuner)
// renta más que el carro más barato de su segmento aunque valgan parecido. Cuando el vehículo
// está en esta tabla se usa su precio/día base (afinado por el año); si no, se cae a la
// interpolación por segmento (precioMercadoSugerido). 'valor' = valor comercial típico de un
// ejemplar de hasta 3 años; 'precio' = canon/día de referencia para ese mismo ejemplar.
export type ModeloMercado = {
  marca: string; modelo: string; tipo: TipoVehiculo; valor: number; precio: number;
  /**
   * `true` cuando NO hay tarifa publicada por una rentadora formal para este modelo y el
   * precio se interpoló desde comparables. La interfaz lo advierte explícitamente: es
   * preferible decir "estimado" que dar una cifra que aparenta venir de una fuente.
   */
  estimado?: boolean;
  /**
   * `true` cuando el modelo solo se consigue en caja automática (eléctricos, gama alta,
   * 7 puestos). Evita que el selector de transmisión ofrezca un "descuento por mecánica"
   * sobre una versión que no existe.
   */
  soloAutomatica?: boolean;
};

export const MODELOS_MERCADO: ModeloMercado[] = [
  // ─── Económico ───
  { marca: 'Chevrolet',     modelo: 'Spark GT',        tipo: 'economico',      valor: 42_000_000,  precio: 150_000, estimado: true },
  { marca: 'Chevrolet',     modelo: 'Joy',             tipo: 'economico',      valor: 45_000_000,  precio: 150_000, estimado: true },
  { marca: 'Fiat',          modelo: 'Mobi',            tipo: 'economico',      valor: 45_000_000,  precio: 150_000, estimado: true },
  { marca: 'Renault',       modelo: 'Kwid',            tipo: 'economico',      valor: 45_000_000,  precio: 152_000, estimado: true },
  { marca: 'Suzuki',        modelo: 'S-Presso',        tipo: 'economico',      valor: 48_000_000,  precio: 155_000, estimado: true },
  { marca: 'Nissan',        modelo: 'March',           tipo: 'economico',      valor: 50_000_000,  precio: 160_000, estimado: true },
  { marca: 'Kia',           modelo: 'Picanto',         tipo: 'economico',      valor: 55_000_000,  precio: 164_000 }, // mercado formal sep-2026
  { marca: 'Chevrolet',     modelo: 'Sail',            tipo: 'economico',      valor: 52_000_000,  precio: 165_000, estimado: true },
  { marca: 'Renault',       modelo: 'Logan / Sandero', tipo: 'economico',      valor: 55_000_000,  precio: 169_000 }, // mercado formal sep-2026
  { marca: 'Renault',       modelo: 'Stepway',         tipo: 'economico',      valor: 60_000_000,  precio: 178_000, estimado: true },
  { marca: 'Kia',           modelo: 'Picanto automática', tipo: 'economico',   valor: 62_000_000,  precio: 180_000, estimado: true, soloAutomatica: true },
  { marca: 'Chevrolet',     modelo: 'Onix',            tipo: 'economico',      valor: 62_000_000,  precio: 199_000 }, // mercado formal sep-2026
  // ─── Sedán / compacto ───
  { marca: 'Toyota',        modelo: 'Yaris',           tipo: 'sedan',          valor: 70_000_000,  precio: 215_000, estimado: true },
  { marca: 'Suzuki',        modelo: 'Swift / Dzire',   tipo: 'sedan',          valor: 65_000_000,  precio: 218_000 }, // mercado formal sep-2026
  { marca: 'Mazda',         modelo: '3',               tipo: 'sedan',          valor: 100_000_000, precio: 244_000 }, // mercado formal sep-2026
  { marca: 'Mazda',         modelo: '2',               tipo: 'sedan',          valor: 65_000_000,  precio: 267_000 }, // mercado formal sep-2026
  { marca: 'Nissan',        modelo: 'Versa',           tipo: 'sedan',          valor: 72_000_000,  precio: 286_000 }, // mercado formal sep-2026
  { marca: 'Nissan',        modelo: 'Sentra',          tipo: 'sedan',          valor: 90_000_000,  precio: 320_000, estimado: true },
  { marca: 'Toyota',        modelo: 'Corolla',         tipo: 'sedan',          valor: 110_000_000, precio: 385_000, estimado: true },
  // ─── SUV compacta ───
  // El Chevrolet Spin es en rigor un monovolumen de 7 puestos, pero la plataforma no tiene
  // segmento de monovolumen y su tarifa está muy por debajo del piso de 'camioneta7': dejarlo
  // ahí hundiría el piso de ese segmento (ver la INVARIANTE de arriba). Va en 'suv', que es el
  // segmento cuyo rango de tarifa sí corresponde a lo que cuesta alquilarlo.
  { marca: 'Chevrolet',     modelo: 'Spin',            tipo: 'suv',            valor: 85_000_000,  precio: 290_000, estimado: true },
  { marca: 'Volkswagen',    modelo: 'Tiguan',          tipo: 'suv',            valor: 140_000_000, precio: 312_000, soloAutomatica: true }, // mercado formal sep-2026
  { marca: 'Chevrolet',     modelo: 'Tracker',         tipo: 'suv',            valor: 95_000_000,  precio: 318_000, estimado: true },
  { marca: 'Renault',       modelo: 'Duster',          tipo: 'suv',            valor: 95_000_000,  precio: 320_000, estimado: true },
  // En flota DrivePass (vehículo 17). Ninguna de las cuatro rentadoras formales publica tarifa
  // del Nivus, así que va `estimado`: interpolado desde el Tracker (0,335%/día) y el Duster
  // (0,337%), sus comparables directos de tamaño y equipamiento. NO se marca `soloAutomatica`
  // porque la versión Trendline sí es mecánica — igual que Tracker, Duster, Kicks y Seltos.
  { marca: 'Volkswagen',    modelo: 'Nivus',           tipo: 'suv',            valor: 100_000_000, precio: 325_000, estimado: true },
  { marca: 'Chevrolet',     modelo: 'Equinox',         tipo: 'suv',            valor: 120_000_000, precio: 338_000, soloAutomatica: true }, // mercado formal sep-2026
  { marca: 'Nissan',        modelo: 'Kicks',           tipo: 'suv',            valor: 98_000_000,  precio: 345_000, estimado: true },
  { marca: 'Kia',           modelo: 'Seltos',          tipo: 'suv',            valor: 105_000_000, precio: 345_000, estimado: true },
  { marca: 'Suzuki',        modelo: 'Vitara',          tipo: 'suv',            valor: 95_000_000,  precio: 347_000 }, // mercado formal sep-2026
  { marca: 'Nissan',        modelo: 'Qashqai',         tipo: 'suv',            valor: 115_000_000, precio: 350_000, estimado: true, soloAutomatica: true },
  { marca: 'Mazda',         modelo: 'CX-30',           tipo: 'suv',            valor: 120_000_000, precio: 356_000, soloAutomatica: true }, // mercado formal sep-2026
  // En flota DrivePass (vehículo 16). SUV eléctrica de Changan, sin tarifa publicada por el
  // mercado formal: `estimado` desde el Song Plus (0,272%/día), su comparable eléctrico, y el
  // CX-30 (0,297%), su comparable de tamaño. Queda en 0,292%. `soloAutomatica` porque un
  // eléctrico no tiene caja manual: ofrecer "descuento por mecánica" sería ofrecer algo que no
  // existe. OJO: al ser eléctrico está exento de pico y placa, así que el precio que ve el
  // propietario sale de acá multiplicado por `factorTarifaExencion()` — no sumar el sobreprecio
  // de la exención a este número o se cuenta dos veces.
  { marca: 'Deepal',        modelo: 'S05',             tipo: 'suv',            valor: 125_000_000, precio: 365_000, estimado: true, soloAutomatica: true },
  { marca: 'Kia',           modelo: 'Sportage',        tipo: 'suv',            valor: 120_000_000, precio: 375_000, soloAutomatica: true }, // mercado formal sep-2026
  { marca: 'BYD',           modelo: 'Song Plus',       tipo: 'suv',            valor: 145_000_000, precio: 395_000, estimado: true, soloAutomatica: true },
  { marca: 'Hyundai',       modelo: 'Tucson',          tipo: 'suv',            valor: 120_000_000, precio: 420_000, estimado: true, soloAutomatica: true },
  { marca: 'Renault',       modelo: 'Arkana',          tipo: 'suv',            valor: 120_000_000, precio: 430_000, estimado: true, soloAutomatica: true },
  { marca: 'Mazda',         modelo: 'CX-5',            tipo: 'suv',            valor: 135_000_000, precio: 435_000, estimado: true, soloAutomatica: true },
  { marca: 'Toyota',        modelo: 'RAV4',            tipo: 'suv',            valor: 160_000_000, precio: 480_000, estimado: true, soloAutomatica: true },
  // ─── Pick up ───
  { marca: 'Renault',       modelo: 'Alaskan',         tipo: 'pickup',         valor: 150_000_000, precio: 420_000, estimado: true },
  // ─── Camioneta 7 puestos ───
  { marca: 'Mazda',         modelo: 'CX-9',            tipo: 'camioneta7',     valor: 160_000_000, precio: 405_000, soloAutomatica: true }, // mercado formal sep-2026
  { marca: 'Chevrolet',     modelo: 'Captiva',         tipo: 'camioneta7',     valor: 110_000_000, precio: 420_000, estimado: true, soloAutomatica: true },
  { marca: 'Chevrolet',     modelo: 'Trailblazer',     tipo: 'camioneta7',     valor: 150_000_000, precio: 500_000, estimado: true, soloAutomatica: true },
  { marca: 'Toyota',        modelo: 'Fortuner',        tipo: 'camioneta7',     valor: 190_000_000, precio: 506_000, soloAutomatica: true }, // mercado formal sep-2026
  { marca: 'Hyundai',       modelo: 'Santa Fe',        tipo: 'camioneta7',     valor: 175_000_000, precio: 520_000, estimado: true, soloAutomatica: true },
  { marca: 'Kia',           modelo: 'Sorento',         tipo: 'camioneta7',     valor: 170_000_000, precio: 530_000, estimado: true, soloAutomatica: true },
  { marca: 'Chevrolet',     modelo: 'Traverse',        tipo: 'camioneta7',     valor: 200_000_000, precio: 560_000, estimado: true, soloAutomatica: true },
  { marca: 'Ford',          modelo: 'Explorer',        tipo: 'camioneta7',     valor: 210_000_000, precio: 580_000, estimado: true, soloAutomatica: true },
  { marca: 'Hyundai',       modelo: 'Palisade',        tipo: 'camioneta7',     valor: 210_000_000, precio: 650_000, estimado: true, soloAutomatica: true },
  { marca: 'Toyota',        modelo: '4Runner',         tipo: 'camioneta7',     valor: 230_000_000, precio: 680_000, estimado: true, soloAutomatica: true },
  { marca: 'Toyota',        modelo: 'Prado',           tipo: 'camioneta7',     valor: 290_000_000, precio: 734_000, soloAutomatica: true }, // mercado formal sep-2026
  // ─── Lujo — sedán/coupé premium ───
  { marca: 'Mercedes-Benz', modelo: 'A200 / CLA',      tipo: 'lujo_auto',      valor: 180_000_000, precio: 490_000, estimado: true, soloAutomatica: true },
  { marca: 'BMW',           modelo: 'Serie 3 / 4',     tipo: 'lujo_auto',      valor: 260_000_000, precio: 720_000, estimado: true, soloAutomatica: true },
  // ─── Lujo — SUV premium y camioneta grande ───
  // El `valor` bajó de 320M a 260M en la misma tanda. NO es un dato nuevo de mercado: los 320M
  // estaban calibrados contra el precio viejo de $850.000 (0,266%/día, en línea con el GLC y el
  // Tahoe blindado). Con el precio verificado de $566.000 ese par quedaba en 0,177%/día — el
  // punto más bajo de toda la tabla, por debajo del Cayenne (0,215%) y del Q7/Q8 (0,222%) — y
  // hacía que la banda de cordura acusara al X4 en cuanto se le bajaba el año. A 260M queda en
  // 0,218%, entre el X1/X2 (220M) y el Q5 (280M), que es donde está el X4 en la gama. CONFIRMAR
  // con una cotización real: se movió el valor y no el precio porque el precio sí está verificado.
  { marca: 'BMW',           modelo: 'X4',              tipo: 'lujo_camioneta', valor: 260_000_000, precio: 566_000, soloAutomatica: true }, // mercado formal sep-2026
  { marca: 'BMW',           modelo: 'X1 / X2',         tipo: 'lujo_camioneta', valor: 220_000_000, precio: 620_000, estimado: true, soloAutomatica: true },
  { marca: 'Audi',          modelo: 'Q5',              tipo: 'lujo_camioneta', valor: 280_000_000, precio: 780_000, estimado: true, soloAutomatica: true },
  { marca: 'Mercedes-Benz', modelo: 'GLC',             tipo: 'lujo_camioneta', valor: 330_000_000, precio: 880_000, estimado: true, soloAutomatica: true },
  { marca: 'Toyota',        modelo: 'Prado blindado',  tipo: 'lujo_camioneta', valor: 380_000_000, precio: 900_000, estimado: true, soloAutomatica: true },
  { marca: 'Chevrolet',     modelo: 'Tahoe',           tipo: 'lujo_camioneta', valor: 310_000_000, precio: 938_000, soloAutomatica: true }, // mercado formal sep-2026
  { marca: 'Audi',          modelo: 'Q7 / Q8',         tipo: 'lujo_camioneta', valor: 450_000_000, precio: 1_000_000, estimado: true, soloAutomatica: true },
  { marca: 'Porsche',       modelo: 'Cayenne',         tipo: 'lujo_camioneta', valor: 520_000_000, precio: 1_120_000, estimado: true, soloAutomatica: true },
  { marca: 'Chevrolet',     modelo: 'Tahoe blindado',  tipo: 'lujo_camioneta', valor: 430_000_000, precio: 1_150_000, estimado: true, soloAutomatica: true },
];

// ─── Antigüedad ───────────────────────────────────────────────────────────────
//
// Son DOS curvas distintas y es importante no confundirlas:
//
//   · `factorAnioValor`  — cuánto VALE el carro. Es la curva fuerte: un carro de 10 años
//     vale la mitad que uno nuevo. Se usa para el valor comercial, que a su vez manda el
//     impuesto vehicular, la prima del seguro y el retorno sobre la inversión.
//   · `factorAnioPrecio` — cuánto se puede COBRAR por alquilarlo. Es más suave: un carro
//     de 10 años sigue prestando el mismo servicio de transporte, solo que el cliente
//     paga algo menos por él.
//
// Antes de sep-2026 solo existía la segunda, así que al cambiar el año la calculadora
// bajaba el precio pero dejaba el valor comercial del carro 0 km. Consecuencias reales:
// el impuesto salía en el tramo del 3,5% en vez del 2,5%, el seguro quedaba inflado, el
// retorno subestimado, y la banda de cordura — que se calcula sobre el valor — marcaba
// como "fuera de mercado" el precio que la propia calculadora acababa de sugerir.
export function factorAnioValor(anio: number): number {
  const edad = edadVehiculo(anio);
  if (edad <= 3) return 1.00;
  if (edad <= 6) return 0.82;
  if (edad <= 9) return 0.66;
  return 0.52;
}

// Endurecida en sep-2026 (antes 1,00 / 0,92 / 0,84 / 0,75): las rentadoras formales de
// Medellín castigan la antigüedad más de lo que suponía la curva vieja, que dejaba a un
// carro de 10 años cobrando el 75% de la tarifa de uno nuevo.
export function factorAnioPrecio(anio: number): number {
  const edad = edadVehiculo(anio);
  if (edad <= 3) return 1.00;
  if (edad <= 6) return 0.88;
  if (edad <= 9) return 0.74;
  return 0.62;
}

function edadVehiculo(anio: number): number {
  const actual = new Date().getFullYear();
  if (!Number.isFinite(anio) || anio <= 0) return 0;
  return Math.max(0, actual - anio);
}

// ─── Transmisión y equipamiento ───────────────────────────────────────────────
// La transmisión mueve las dos cosas (un automático vale más y se alquila más caro —
// buena parte de los clientes de alquiler no maneja mecánico); el equipamiento mueve solo
// el valor comercial, porque el cliente de alquiler no paga más por el techo corredizo.
export type Transmision = 'mecanica' | 'automatica';
export type Equipamiento = 'estandar' | 'full';

export const FACTOR_TRANSMISION: Record<Transmision, number> = { mecanica: 1.00, automatica: 1.10 };
export const FACTOR_EQUIPAMIENTO: Record<Equipamiento, number> = { estandar: 1.00, full: 1.15 };

export const TRANSMISION_LABELS: Record<Transmision, string> = {
  mecanica: 'Mecánica', automatica: 'Automática',
};
export const EQUIPAMIENTO_LABELS: Record<Equipamiento, string> = {
  estandar: 'Estándar', full: 'Full equipo',
};

// ─── Exención de pico y placa ─────────────────────────────────────────────────
//
// En el Valle de Aburrá un carro exento se puede alquilar los 7 días de la semana; uno
// sujeto a la restricción pierde un día hábil de cada semana. Esa diferencia se paga: Rent
// a Car Medellín publica el mismo Sandero a $119.990–$169.900/día CON restricción y a
// $179.990–$229.990/día sin ella (consultado sep-2026) — cerca de un 50% más.
//
// El beneficio por defecto es MÁS CONSERVADOR que ese 50% observado: 1,25. La diferencia
// publicada mezcla temporada y duración, y prometerle al propietario el tope del rango sería
// venderle una expectativa que no siempre se cumple. Es configurable para poder afinarlo.
//
// ─── OJO: EL BENEFICIO NO SE PUEDE COBRAR DOS VECES ───
// La ventaja de estar exento se puede contar por dos caminos distintos, y los dos describen el
// MISMO fenómeno:
//   (a) TARIFA — el mercado publica un precio/día más alto para el carro exento.
//   (b) DÍAS FACTURABLES — al carro con restricción no se le cobra el día de pico y placa, así
//       que de cada semana factura 6 días en vez de 7.
// Aplicar los dos a full duplica la ventaja: en un alquiler de una semana daba
// (7 × 1,25·C) / (6 × 1,00·C) = 1,46, o sea un 46% prometido donde el número declarado es 25%.
//
// Acá se conservan los DOS porque cada uno cumple una función distinta —el descuento de días es
// una regla de facturación concreta y justa con el cliente, la tarifa es la señal de mercado—
// pero el multiplicador de tarifa se DERIVA del beneficio total dividiendo la parte que ya
// aportan los días. Así `BENEFICIO_EXENCION_PICO_PLACA_DEFAULT` significa exactamente lo que
// dice: cuánto mejor le va, en total, al propietario de un carro exento.
//
// QUIÉN ESTÁ EXENTO: la decisión NO se toma aquí. El punto único de verdad es
// `exentoPicoPlaca()` en lib/vehiculo-campos.ts, que aplica la norma de Medellín tal cual:
// los ELÉCTRICOS quedan exentos de forma automática por su registro, pero los HÍBRIDOS y los
// de GAS (GNV) solo si el propietario INSCRIBIÓ la exención ante la Secretaría de Movilidad
// de Medellín. Marcar exento a un híbrido sin ese trámite es información falsa que termina
// en comparendo para el cliente.
export const BENEFICIO_EXENCION_PICO_PLACA_DEFAULT = 1.25;

/** Días de cada 7 que factura un carro CON pico y placa: pierde exactamente uno. */
export const DIAS_FACTURABLES_CON_RESTRICCION = 6;

/**
 * Parte del beneficio que va en la TARIFA, una vez descontada la que ya aportan los días
 * facturables. Con el beneficio total por defecto (1,25) da ≈1,071: un carro exento cobra un
 * 7,1% más por día Y factura los 7 días, lo que compone exactamente el 25% prometido.
 *
 * Quien NO descuente días de pico y placa debe usar el beneficio total directamente, no esto.
 */
export function factorTarifaExencion(beneficioTotal = BENEFICIO_EXENCION_PICO_PLACA_DEFAULT): number {
  const aporteDias = 7 / DIAS_FACTURABLES_CON_RESTRICCION;
  return beneficioTotal / aporteDias;
}

// ─── Precio sugerido por modelo ───────────────────────────────────────────────

export type OpcionesPrecioModelo = {
  /** Ajuste por demanda / negociación, en % (ej. −10 / +5). */
  ajustePct?: number;
  /** Transmisión elegida. Se ignora si el modelo es `soloAutomatica`. */
  transmision?: Transmision;
  /** `true` si el vehículo está exento de pico y placa (ver lib/vehiculo-campos.ts). */
  exentoPicoPlaca?: boolean;
  /** Multiplicador a aplicar cuando está exento. */
  factorExencion?: number;
  /** Días del alquiler; aplica la escalera de duración de lib/rentabilidad.ts. */
  factorDuracion?: number;
};

/**
 * Precio sugerido cuando el propietario elige un modelo de la tabla.
 *
 * La firma acepta todavía el tercer argumento numérico de siempre (`ajustePct`) para no
 * romper a los llamadores que ya existían — components/CalculadoraPanel.tsx entre ellos.
 */
export function precioModeloSugerido(
  modelo: ModeloMercado, anio: number, opciones: number | OpcionesPrecioModelo = 0,
): number {
  const o: OpcionesPrecioModelo = typeof opciones === 'number' ? { ajustePct: opciones } : opciones;
  const ajustePct = Number.isFinite(o.ajustePct) ? o.ajustePct! : 0;

  // El precio de la tabla corresponde a la versión mecánica cuando el modelo se vende en
  // ambas cajas; los `soloAutomatica` ya están tarifados como automáticos, así que ahí el
  // multiplicador no se vuelve a aplicar (si no, se cobraría el 10% dos veces).
  const trans = modelo.soloAutomatica ? 1.00 : FACTOR_TRANSMISION[o.transmision ?? 'mecanica'];
  // `factorExencion` es el multiplicador DE TARIFA, no el beneficio total — ver
  // `factorTarifaExencion()`. Quien llame con el beneficio total sin dividirlo lo estará
  // contando dos veces si además descuenta días de pico y placa.
  const exencion = o.exentoPicoPlaca ? (o.factorExencion ?? factorTarifaExencion()) : 1;
  const duracion = Number.isFinite(o.factorDuracion) ? o.factorDuracion! : 1;

  const base = modelo.precio * factorAnioPrecio(anio) * trans * exencion * duracion * (1 + ajustePct / 100);
  return Math.round(base / 1000) * 1000;
}

/**
 * Precio sugerido por SEGMENTO para un ejemplar de un año concreto — la rama de "mi carro no
 * está en la lista" de la calculadora.
 *
 * No es lo mismo que llamar a `precioMercadoSugerido()` con el valor ya depreciado, y la
 * diferencia importa. `precioMercadoSugerido` recorta el resultado a `[precioMin, precioMax]`,
 * y esos límites son los de un ejemplar de hasta 3 años. Con el valor ya depreciado, un
 * económico de 2016 caía por debajo de `valorMin`, se anclaba en `precioMin` ($150.000) y se
 * quedaba ahí — el precio de un carro NUEVO de ese segmento. La banda de cordura, que sí mira
 * el año, lo marcaba entonces como "por encima del mercado".
 *
 * Acá el orden es el mismo que en la rama por modelo, que es la que estaba bien:
 *   1. se revierte la depreciación para posicionar el carro dentro de su segmento como si
 *      fuera nuevo (ahí el clamp sí es el correcto y la INVARIANTE se sigue cumpliendo),
 *   2. se aplica la antigüedad al precio,
 *   3. y solo al final la exención, que a propósito SÍ puede salirse del rango del segmento:
 *      el rango describe el mercado normal, no el sobreprecio de un carro sin pico y placa.
 */
export function precioSegmentoPorAnio(
  tipo: TipoVehiculo, valorComercialActual: number, anio: number,
  opciones: { ajustePct?: number; exentoPicoPlaca?: boolean; factorExencion?: number } = {},
): number {
  const fv = factorAnioValor(anio);
  const valorComoNuevo = fv > 0 ? valorComercialActual / fv : valorComercialActual;
  const base = precioMercadoSugerido(tipo, valorComoNuevo, opciones.ajustePct ?? 0);
  if (!base) return 0;
  const exencion = opciones.exentoPicoPlaca ? (opciones.factorExencion ?? factorTarifaExencion()) : 1;
  return Math.round(base * factorAnioPrecio(anio) * exencion / 1000) * 1000;
}

/**
 * Valor comercial sugerido de un ejemplar concreto: parte del valor de referencia del modelo
 * (o de la categoría) y le aplica antigüedad, transmisión y equipamiento.
 *
 * Es una SUGERENCIA: el propietario siempre puede escribir el valor a mano, y solo se vuelve
 * a calcular cuando cambia el año, el modelo o la categoría — no mientras está escribiendo.
 */
export function valorComercialSugerido(
  valorBase: number, anio: number,
  opciones: { transmision?: Transmision; equipamiento?: Equipamiento; soloAutomatica?: boolean } = {},
): number {
  if (!Number.isFinite(valorBase) || valorBase <= 0) return 0;
  const trans = opciones.soloAutomatica ? 1.00 : FACTOR_TRANSMISION[opciones.transmision ?? 'mecanica'];
  const equipo = FACTOR_EQUIPAMIENTO[opciones.equipamiento ?? 'estandar'];
  const v = valorBase * factorAnioValor(anio) * trans * equipo;
  return Math.round(v / 100_000) * 100_000;
}

/**
 * Comprueba la INVARIANTE declarada arriba: ningún modelo puede quedar fuera del rango de
 * tarifa de su propio segmento. Devuelve la lista de incoherencias (vacía = todo bien).
 * No se ejecuta en producción; existe para las pruebas y para poder verificarla a mano
 * cada vez que se toque la tabla.
 */
export function __rangosCoherentesConModelos(): string[] {
  const fallas: string[] = [];
  for (const m of MODELOS_MERCADO) {
    const r = RANGO_MERCADO_POR_TIPO[m.tipo];
    if (!r) { fallas.push(`${m.marca} ${m.modelo}: segmento '${m.tipo}' inexistente`); continue; }
    if (m.precio < r.precioMin) fallas.push(`${m.marca} ${m.modelo}: ${m.precio} < precioMin ${r.precioMin} de '${m.tipo}'`);
    if (m.precio > r.precioMax) fallas.push(`${m.marca} ${m.modelo}: ${m.precio} > precioMax ${r.precioMax} de '${m.tipo}'`);
  }
  return fallas;
}
