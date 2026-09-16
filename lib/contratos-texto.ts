// ── Conversores de texto para los contratos digitales ───────────────────────
//
// Los seis documentos que redactó el abogado escriben TODO en letras Y en cifras:
// «QUINIENTOS MIL PESOS ($500.000)», «a los once (11) días del mes de septiembre
// del año dos mil veintiséis (2026)», «treinta (30) días», «treinta por ciento
// (30%)». Este archivo es el único lugar donde se hace esa conversión, para que
// una misma cifra se escriba EXACTAMENTE igual en los seis documentos (el otrosí
// de arrendamiento y el de agencia citan las mismas sumas y no pueden discrepar
// ni en un peso ni en una letra).
//
// ⚠️ Módulo PURO: sin `fs`, sin `better-sqlite3`, sin BD. Lo pueden importar tanto
// las rutas de API como componentes 'use client' (igual que lib/lugares.ts,
// lib/pico-placa.ts o lib/poliza-vehiculo.ts).
//
// ── Por qué lanza en vez de devolver '' ─────────────────────────────────────
// Un conversor que ante una entrada rara devuelve texto vacío imprime un contrato
// con un hueco donde iba la plata. Acá se prefiere reventar: el llamador (fase 2)
// decide si eso es un 400 o un cartel de "faltan datos", pero nunca se firma un
// documento con una cifra en blanco por una coerción silenciosa.

export type Genero = 'masculino' | 'femenino';

export type OpcionesLetras = {
  /** Concordancia con el sustantivo que sigue: «una hora», «doscientas fotografías». */
  genero?: Genero;
  /**
   * Apócope del 1 y sus compuestos delante de sustantivo masculino o de «mil»,
   * «millones» y «por ciento»: «un (1) día», «veintiún (21) días»,
   * «treinta y un por ciento (31%)». Los documentos usan SIEMPRE esta forma en
   * esas posiciones (ver cláusula cuarta del contrato de agencia).
   */
  apocope?: boolean;
};

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];

const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Tope de seguridad: por encima de esto no hay contrato de alquiler que valga. */
const MAXIMO = 999_999_999_999;

function exigirEnteroNoNegativo(n: unknown, quien: string): number {
  const v = Number(n);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > MAXIMO) {
    throw new RangeError(`${quien}: se esperaba un entero entre 0 y ${MAXIMO}, llegó ${String(n)}`);
  }
  return v;
}

/** 0–29, la franja con más irregularidades del español. */
function menorDeTreinta(n: number, op: OpcionesLetras): string {
  if (n === 1) return op.apocope ? 'un' : op.genero === 'femenino' ? 'una' : 'uno';
  if (n === 21) return op.apocope ? 'veintiún' : op.genero === 'femenino' ? 'veintiuna' : 'veintiuno';
  return UNIDADES[n];
}

function menorDeCien(n: number, op: OpcionesLetras): string {
  if (n < 30) return menorDeTreinta(n, op);
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${menorDeTreinta(u, op)}`;
}

function menorDeMil(n: number, op: OpcionesLetras): string {
  if (n === 0) return '';
  // «cien» exacto, «ciento uno» con resto. La palabra «ciento» no tiene femenino;
  // las demás centenas sí: doscientas, quinientas, setecientas, novecientas.
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let centena = CENTENAS[c];
  if (c >= 2 && op.genero === 'femenino') centena = `${centena.slice(0, -2)}as`;
  const resto = r === 0 ? '' : menorDeCien(r, op);
  return [centena, resto].filter(Boolean).join(' ');
}

/**
 * Número a letras en minúsculas, sin la cifra entre paréntesis.
 *
 *   numeroEnLetras(21)                      → 'veintiuno'
 *   numeroEnLetras(21, { apocope: true })   → 'veintiún'
 *   numeroEnLetras(100)                     → 'cien'
 *   numeroEnLetras(101)                     → 'ciento uno'
 *   numeroEnLetras(2_850_000)               → 'dos millones ochocientos cincuenta mil'
 */
export function numeroEnLetras(n: number, op: OpcionesLetras = {}): string {
  const v = exigirEnteroNoNegativo(n, 'numeroEnLetras');
  if (v === 0) return 'cero';

  const partes: string[] = [];
  const millones = Math.floor(v / 1_000_000);
  const resto = v % 1_000_000;

  if (millones > 0) {
    // «un millón» / «dos millones» / «veintiún millones» / «mil millones».
    // El multiplicador de «millones» va siempre en masculino apocopado: es el
    // sustantivo «millón» el que se cuenta, no lo que se compra con él.
    partes.push(millones === 1 ? 'un millón' : `${numeroEnLetras(millones, { apocope: true })} millones`);
  }

  const miles = Math.floor(resto / 1000);
  const unidades = resto % 1000;

  // «mil» a secas, nunca «un mil». El multiplicador conserva el género del
  // sustantivo final («doscientas mil fotografías») pero apocopa el 1
  // («veintiún mil», «treinta y un mil»).
  if (miles > 0) partes.push(miles === 1 ? 'mil' : `${numeroEnLetras(miles, { genero: op.genero, apocope: true })} mil`);
  if (unidades > 0) partes.push(menorDeMil(unidades, op));

  return partes.join(' ');
}

/** Miles con punto, como en los documentos: 108100000 → '108.100.000'. */
export function agruparMiles(n: number): string {
  const v = exigirEnteroNoNegativo(n, 'agruparMiles');
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Cifra en pesos con el símbolo: 500000 → '$500.000'. */
export function pesos(n: number): string {
  return `$${agruparMiles(Math.round(Number(n)))}`;
}

/**
 * Monto completo tal como lo escriben los documentos, en MAYÚSCULAS:
 *
 *   montoEnLetras(500_000)     → 'QUINIENTOS MIL PESOS ($500.000)'
 *   montoEnLetras(2_000_000)   → 'DOS MILLONES DE PESOS ($2.000.000)'
 *   montoEnLetras(2_850_000)   → 'DOS MILLONES OCHOCIENTOS CINCUENTA MIL PESOS ($2.850.000)'
 *
 * La «DE» solo aparece cuando la suma es un múltiplo exacto de un millón
 * («dos millones DE pesos»), nunca con resto («dos millones ochocientos
 * cincuenta mil pesos») ni por debajo del millón («quinientos mil pesos»).
 */
export function montoEnLetras(n: number): string {
  const v = exigirEnteroNoNegativo(Math.round(Number(n)), 'montoEnLetras');
  const conDe = v >= 1_000_000 && v % 1_000_000 === 0;
  return `${numeroEnLetras(v, { apocope: true }).toUpperCase()} ${conDe ? 'DE PESOS' : 'PESOS'} (${pesos(v)})`;
}

/**
 * Cantidad pequeña con su cifra entre paréntesis, como «treinta (30) días»,
 * «un (1) día», «dos (2) ejemplares», «veinticuatro (24) horas».
 */
export function cantidadEnLetras(n: number, op: OpcionesLetras = {}): string {
  const v = exigirEnteroNoNegativo(n, 'cantidadEnLetras');
  return `${numeroEnLetras(v, { apocope: true, ...op })} (${v})`;
}

/**
 * Porcentaje en UNIDADES DE PORCENTAJE (30 = 30%), no en fracción:
 *
 *   porcentajeEnLetras(30)  → 'treinta por ciento (30%)'
 *   porcentajeEnLetras(31)  → 'treinta y un por ciento (31%)'   ← apócope, como en el contrato
 *   porcentajeEnLetras(200) → 'doscientos por ciento (200%)'
 */
export function porcentajeEnLetras(pct: number): string {
  const v = exigirEnteroNoNegativo(pct, 'porcentajeEnLetras');
  return `${numeroEnLetras(v, { apocope: true })} por ciento (${v}%)`;
}

// ── Fechas ──────────────────────────────────────────────────────────────────
//
// Los documentos usan DOS estilos y hay que respetar cuál va en cada sitio:
//   · en letras + cifra  → «once (11) de septiembre de dos mil veintiséis (2026)»
//     (contrato de agencia, contrato de arrendamiento, los dos otrosí);
//   · en cifras          → «7 de septiembre de 2026» (considerando séptima y cláusula
//     sexta del contrato de agencia, y TODO el anexo de constancia).
// No es un descuido del abogado: el anexo entero está escrito con cifras. Se
// conservan los dos estilos tal cual.

type PartesFecha = { dia: number; mes: number; anio: number };

/** Acepta 'YYYY-MM-DD' y 'YYYY-MM-DD HH:MM(:SS)'. No inventa zonas horarias. */
export function partesFecha(iso: string): PartesFecha {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  if (!m) throw new RangeError(`partesFecha: fecha inválida «${String(iso)}» (se esperaba YYYY-MM-DD)`);
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new RangeError(`partesFecha: fecha inexistente «${String(iso)}»`);
  }
  return { dia, mes, anio };
}

/** El día del mes en letras. El 1 se dice «primero», no «uno». */
function diaEnLetras(dia: number): string {
  return dia === 1 ? 'primero' : numeroEnLetras(dia);
}

/** 'once (11) de septiembre de dos mil veintiséis (2026)'. */
export function fechaEnLetras(iso: string): string {
  const { dia, mes, anio } = partesFecha(iso);
  return `${diaEnLetras(dia)} (${dia}) de ${MESES[mes - 1]} de ${numeroEnLetras(anio)} (${anio})`;
}

/** 'once (11) de septiembre' — sin año. El otrosí de agencia elide el año de la
 *  primera fecha cuando las dos caen en el mismo año. */
export function fechaEnLetrasSinAnio(iso: string): string {
  const { dia, mes } = partesFecha(iso);
  return `${diaEnLetras(dia)} (${dia}) de ${MESES[mes - 1]}`;
}

/** 'dos mil veintiséis (2026)' — el «modelo» del vehículo. */
export function anioEnLetras(anio: number): string {
  const v = exigirEnteroNoNegativo(anio, 'anioEnLetras');
  return `${numeroEnLetras(v)} (${v})`;
}

/** '7 de septiembre de 2026'. */
export function fechaNumerica(iso: string): string {
  const { dia, mes, anio } = partesFecha(iso);
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

/**
 * Fórmula de cierre: 'a los once (11) días del mes de septiembre del año dos mil
 * veintiséis (2026)'. El día 1 obliga a cambiar la concordancia entera —«a los un
 * (1) días» no existe—, así que sale «al primer (1) día del mes de…».
 */
export function fechaFirmaEnLetras(iso: string): string {
  const { dia, mes, anio } = partesFecha(iso);
  const anioTexto = `${numeroEnLetras(anio)} (${anio})`;
  if (dia === 1) return `al primer (1) día del mes de ${MESES[mes - 1]} del año ${anioTexto}`;
  return `a los ${numeroEnLetras(dia)} (${dia}) días del mes de ${MESES[mes - 1]} del año ${anioTexto}`;
}

/** La misma fórmula en cifras, como la escribe el anexo: 'a los 11 días del mes de septiembre del año 2026'. */
export function fechaFirmaNumerica(iso: string): string {
  const { dia, mes, anio } = partesFecha(iso);
  if (dia === 1) return `al 1 día del mes de ${MESES[mes - 1]} del año ${anio}`;
  return `a los ${dia} días del mes de ${MESES[mes - 1]} del año ${anio}`;
}

// ── Horas ───────────────────────────────────────────────────────────────────

/**
 * 'HH:MM' (24 h) → la forma en que la escribe el otrosí: «las ocho de la mañana».
 * Incluye el artículo porque el femenino obliga a cambiarlo: «la una de la tarde»,
 * no «las una». La hora de la reserva vive en `Lugar.hora` (lib/lugares.ts).
 */
export function horaEnLetras(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) throw new RangeError(`horaEnLetras: hora inválida «${String(hhmm)}» (se esperaba HH:MM)`);
  const h24 = Number(m[1]);
  const min = Number(m[2]);
  if (h24 > 23 || min > 59) throw new RangeError(`horaEnLetras: hora fuera de rango «${String(hhmm)}»`);

  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const articulo = h12 === 1 ? 'la' : 'las';
  const numero = numeroEnLetras(h12, { genero: 'femenino' });
  const minutos = min === 0 ? '' : ` y ${numeroEnLetras(min, { genero: 'femenino' })}`;

  let franja: string;
  if (h24 === 0 && min === 0) franja = 'de la medianoche';
  else if (h24 === 12 && min === 0) franja = 'del mediodía';
  else if (h24 < 12) franja = 'de la mañana';
  else if (h24 < 19) franja = 'de la tarde';
  else franja = 'de la noche';

  return `${articulo} ${numero}${minutos} ${franja}`;
}

// ── Identificación ──────────────────────────────────────────────────────────

/**
 * Documento de identidad con separador de miles, como en los documentos:
 * '71739615' → '71.739.615'. Si trae letras o ya viene formateado, se devuelve
 * limpio tal cual (un NIT o un pasaporte no se puntean).
 */
export function documentoFormateado(numero: string): string {
  const crudo = String(numero ?? '').trim();
  if (!crudo) return '';
  const soloDigitos = crudo.replace(/[.\s]/g, '');
  if (!/^\d+$/.test(soloDigitos)) return crudo;
  return soloDigitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Nombres de persona en MAYÚSCULAS, como firman los documentos. */
export function enMayusculas(texto: string): string {
  return String(texto ?? '').trim().toUpperCase();
}
