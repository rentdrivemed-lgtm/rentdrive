// Pruebas de los conversores y de las cifras de los contratos digitales.
//
// El proyecto no tiene runner de tests (no hay jest/vitest en package.json), así
// que esto es un script de aserciones que imprime el resultado y sale con código
// distinto de 0 si algo falla.
//
// Cómo correrlo (desde la raíz del proyecto):
//   node scripts/correr-ts.mjs scripts/probar-contratos-conversores.ts
//
// Por qué existe: los seis documentos escriben cada cifra DOS veces, en letras y
// en números. Un error de conversión no se ve en una pantalla: se ve impreso en
// un contrato firmado. Los casos límite del español (veintiuno/veintiún, cien vs.
// ciento, un millón vs. dos millones, el género de las horas, los miles) están
// todos acá con el valor exacto que esperan los documentos.

import {
  agruparMiles, anioEnLetras, cantidadEnLetras, documentoFormateado, fechaEnLetras,
  fechaEnLetrasSinAnio, fechaFirmaEnLetras, fechaFirmaNumerica, fechaNumerica, horaEnLetras,
  montoEnLetras, numeroEnLetras, partesFecha, pesos, porcentajeEnLetras,
} from '../lib/contratos-texto';
import {
  CLAUSULA_PENAL_AGENCIA_PCT, calcularDerivados, clausulaPenalAgencia, comisionPctAgencia,
  comparacionComision, normalizarConfigIva, tramoComisionAgencia,
} from '../lib/contratos-calculo';
import { escalaComisionTexto } from '../lib/contratos-plantillas';

let ok = 0;
const fallos: string[] = [];

function igual(obtenido: unknown, esperado: unknown, que: string): void {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) { ok++; return; }
  fallos.push(`${que}\n    esperado: ${JSON.stringify(esperado)}\n    obtenido: ${JSON.stringify(obtenido)}`);
}

function lanza(fn: () => unknown, que: string): void {
  try { fn(); fallos.push(`${que}: NO lanzó y debía lanzar`); } catch { ok++; }
}

// ── Números a letras ────────────────────────────────────────────────────────
igual(numeroEnLetras(0), 'cero', 'numeroEnLetras(0)');
igual(numeroEnLetras(1), 'uno', 'numeroEnLetras(1)');
igual(numeroEnLetras(1, { apocope: true }), 'un', 'numeroEnLetras(1) apocopado');
igual(numeroEnLetras(1, { genero: 'femenino' }), 'una', 'numeroEnLetras(1) femenino');
igual(numeroEnLetras(15), 'quince', 'numeroEnLetras(15)');
igual(numeroEnLetras(16), 'dieciséis', 'numeroEnLetras(16)');
igual(numeroEnLetras(20), 'veinte', 'numeroEnLetras(20)');
// El caso clásico: veintiuno / veintiún / veintiuna.
igual(numeroEnLetras(21), 'veintiuno', 'numeroEnLetras(21)');
igual(numeroEnLetras(21, { apocope: true }), 'veintiún', 'numeroEnLetras(21) apocopado');
igual(numeroEnLetras(21, { genero: 'femenino' }), 'veintiuna', 'numeroEnLetras(21) femenino');
igual(numeroEnLetras(22), 'veintidós', 'numeroEnLetras(22)');
igual(numeroEnLetras(26), 'veintiséis', 'numeroEnLetras(26)');
igual(numeroEnLetras(29), 'veintinueve', 'numeroEnLetras(29)');
igual(numeroEnLetras(31), 'treinta y uno', 'numeroEnLetras(31)');
igual(numeroEnLetras(31, { apocope: true }), 'treinta y un', 'numeroEnLetras(31) apocopado');
igual(numeroEnLetras(41, { genero: 'femenino' }), 'cuarenta y una', 'numeroEnLetras(41) femenino');
// cien vs. ciento.
igual(numeroEnLetras(100), 'cien', 'numeroEnLetras(100)');
igual(numeroEnLetras(101), 'ciento uno', 'numeroEnLetras(101)');
igual(numeroEnLetras(101, { apocope: true }), 'ciento un', 'numeroEnLetras(101) apocopado');
igual(numeroEnLetras(115), 'ciento quince', 'numeroEnLetras(115)');
igual(numeroEnLetras(200), 'doscientos', 'numeroEnLetras(200)');
igual(numeroEnLetras(200, { genero: 'femenino' }), 'doscientas', 'numeroEnLetras(200) femenino');
igual(numeroEnLetras(500), 'quinientos', 'numeroEnLetras(500)');
igual(numeroEnLetras(500, { genero: 'femenino' }), 'quinientas', 'numeroEnLetras(500) femenino');
igual(numeroEnLetras(700), 'setecientos', 'numeroEnLetras(700)');
igual(numeroEnLetras(900), 'novecientos', 'numeroEnLetras(900)');
igual(numeroEnLetras(999), 'novecientos noventa y nueve', 'numeroEnLetras(999)');
// Miles: «mil», nunca «un mil».
igual(numeroEnLetras(1000), 'mil', 'numeroEnLetras(1000)');
igual(numeroEnLetras(1001), 'mil uno', 'numeroEnLetras(1001)');
igual(numeroEnLetras(2000), 'dos mil', 'numeroEnLetras(2000)');
igual(numeroEnLetras(21000), 'veintiún mil', 'numeroEnLetras(21000)');
igual(numeroEnLetras(31000), 'treinta y un mil', 'numeroEnLetras(31000)');
igual(numeroEnLetras(100000), 'cien mil', 'numeroEnLetras(100000)');
igual(numeroEnLetras(101000), 'ciento un mil', 'numeroEnLetras(101000)');
igual(numeroEnLetras(200000, { genero: 'femenino' }), 'doscientas mil', 'numeroEnLetras(200000) femenino');
igual(numeroEnLetras(999999), 'novecientos noventa y nueve mil novecientos noventa y nueve', 'numeroEnLetras(999999)');
// Millones: un millón vs. dos millones.
igual(numeroEnLetras(1000000), 'un millón', 'numeroEnLetras(1000000)');
igual(numeroEnLetras(1000001), 'un millón uno', 'numeroEnLetras(1000001)');
igual(numeroEnLetras(2000000), 'dos millones', 'numeroEnLetras(2000000)');
igual(numeroEnLetras(21000000), 'veintiún millones', 'numeroEnLetras(21000000)');
igual(numeroEnLetras(2850000), 'dos millones ochocientos cincuenta mil', 'numeroEnLetras(2850000)');
igual(numeroEnLetras(15000000), 'quince millones', 'numeroEnLetras(15000000)');
igual(numeroEnLetras(108100000), 'ciento ocho millones cien mil', 'numeroEnLetras(108100000)');
igual(numeroEnLetras(1000000000), 'mil millones', 'numeroEnLetras(1000000000)');

lanza(() => numeroEnLetras(-1), 'numeroEnLetras(-1)');
lanza(() => numeroEnLetras(1.5), 'numeroEnLetras(1.5)');
lanza(() => numeroEnLetras(Number.NaN), 'numeroEnLetras(NaN)');

// ── Cifras ──────────────────────────────────────────────────────────────────
igual(agruparMiles(0), '0', 'agruparMiles(0)');
igual(agruparMiles(100), '100', 'agruparMiles(100)');
igual(agruparMiles(1000), '1.000', 'agruparMiles(1000)');
igual(agruparMiles(108100000), '108.100.000', 'agruparMiles(108100000)');
igual(pesos(500000), '$500.000', 'pesos(500000)');

// ── Montos como los escriben los documentos ─────────────────────────────────
igual(montoEnLetras(500000), 'QUINIENTOS MIL PESOS ($500.000)', 'canon diario del otrosí');
igual(montoEnLetras(2000000), 'DOS MILLONES DE PESOS ($2.000.000)', 'depósito de garantía');
igual(montoEnLetras(1000000), 'UN MILLÓN DE PESOS ($1.000.000)', 'pena diaria por mora');
igual(montoEnLetras(2850000), 'DOS MILLONES OCHOCIENTOS CINCUENTA MIL PESOS ($2.850.000)', 'IVA del otrosí');
igual(montoEnLetras(4500000), 'CUATRO MILLONES QUINIENTOS MIL PESOS ($4.500.000)', 'comisión / cláusula penal');
igual(montoEnLetras(10500000), 'DIEZ MILLONES QUINIENTOS MIL PESOS ($10.500.000)', 'saldo al propietario');
igual(montoEnLetras(15000000), 'QUINCE MILLONES DE PESOS ($15.000.000)', 'canon total');
igual(montoEnLetras(17850000), 'DIECISIETE MILLONES OCHOCIENTOS CINCUENTA MIL PESOS ($17.850.000)', 'total a cargo del arrendatario');
igual(montoEnLetras(108100000), 'CIENTO OCHO MILLONES CIEN MIL PESOS ($108.100.000)', 'valor asegurado');
igual(montoEnLetras(0), 'CERO PESOS ($0)', 'montoEnLetras(0)');
igual(montoEnLetras(21000000), 'VEINTIÚN MILLONES DE PESOS ($21.000.000)', 'montoEnLetras(21.000.000)');

// ── Cantidades pequeñas ─────────────────────────────────────────────────────
igual(cantidadEnLetras(1), 'un (1)', 'cantidadEnLetras(1)');
igual(cantidadEnLetras(2), 'dos (2)', 'cantidadEnLetras(2)');
igual(cantidadEnLetras(6), 'seis (6)', 'cantidadEnLetras(6)');
igual(cantidadEnLetras(7), 'siete (7)', 'cantidadEnLetras(7)');
igual(cantidadEnLetras(21), 'veintiún (21)', 'cantidadEnLetras(21)');
igual(cantidadEnLetras(24), 'veinticuatro (24)', 'cantidadEnLetras(24)');
igual(cantidadEnLetras(29), 'veintinueve (29)', 'cantidadEnLetras(29)');
igual(cantidadEnLetras(30), 'treinta (30)', 'cantidadEnLetras(30)');

// ── Porcentajes ─────────────────────────────────────────────────────────────
igual(porcentajeEnLetras(19), 'diecinueve por ciento (19%)', 'IVA');
igual(porcentajeEnLetras(20), 'veinte por ciento (20%)', 'cláusula penal de agencia');
igual(porcentajeEnLetras(21), 'veintiún por ciento (21%)', 'porcentaje con apócope');
igual(porcentajeEnLetras(30), 'treinta por ciento (30%)', 'comisión 30');
igual(porcentajeEnLetras(31), 'treinta y un por ciento (31%)', 'comisión 31 — apócope como en el contrato');
igual(porcentajeEnLetras(33), 'treinta y tres por ciento (33%)', 'comisión 33');
igual(porcentajeEnLetras(35), 'treinta y cinco por ciento (35%)', 'comisión 35');
igual(porcentajeEnLetras(50), 'cincuenta por ciento (50%)', 'desistimiento');
igual(porcentajeEnLetras(75), 'setenta y cinco por ciento (75%)', 'pérdida total');
igual(porcentajeEnLetras(200), 'doscientos por ciento (200%)', 'pena por mora');

// ── Fechas ──────────────────────────────────────────────────────────────────
igual(fechaEnLetras('2026-09-11'), 'once (11) de septiembre de dos mil veintiséis (2026)', 'fecha del otrosí');
igual(fechaEnLetras('2026-10-11'), 'once (11) de octubre de dos mil veintiséis (2026)', 'restitución');
igual(fechaEnLetras('2027-09-07'), 'siete (7) de septiembre de dos mil veintisiete (2027)', 'vigencia de la póliza');
igual(fechaEnLetras('2026-09-01'), 'primero (1) de septiembre de dos mil veintiséis (2026)', 'día primero');
igual(fechaEnLetras('2026-09-21'), 'veintiuno (21) de septiembre de dos mil veintiséis (2026)', 'día 21');
igual(fechaEnLetrasSinAnio('2026-09-11'), 'once (11) de septiembre', 'fecha sin año');
igual(fechaNumerica('2026-09-07'), '7 de septiembre de 2026', 'fecha numérica');
igual(fechaFirmaEnLetras('2026-09-11'), 'a los once (11) días del mes de septiembre del año dos mil veintiséis (2026)', 'fórmula de firma');
igual(fechaFirmaEnLetras('2026-09-01'), 'al primer (1) día del mes de septiembre del año dos mil veintiséis (2026)', 'fórmula de firma el día 1');
igual(fechaFirmaNumerica('2026-09-11'), 'a los 11 días del mes de septiembre del año 2026', 'fórmula de firma en cifras');
igual(fechaFirmaNumerica('2026-09-01'), 'al 1 día del mes de septiembre del año 2026', 'fórmula de firma en cifras el día 1');
igual(anioEnLetras(2026), 'dos mil veintiséis (2026)', 'modelo del vehículo');
igual(partesFecha('2026-09-11 08:30:00'), { dia: 11, mes: 9, anio: 2026 }, 'partesFecha con hora');
lanza(() => partesFecha('2026-02-31'), 'partesFecha(2026-02-31)');
lanza(() => partesFecha('11/09/2026'), 'partesFecha(11/09/2026)');

// ── Horas (el femenino de «la una») ─────────────────────────────────────────
igual(horaEnLetras('08:00'), 'las ocho de la mañana', 'hora de entrega del otrosí');
igual(horaEnLetras('13:00'), 'la una de la tarde', 'la una — artículo y género');
igual(horaEnLetras('01:00'), 'la una de la mañana', 'la una de la mañana');
igual(horaEnLetras('12:00'), 'las doce del mediodía', 'mediodía');
igual(horaEnLetras('00:00'), 'las doce de la medianoche', 'medianoche');
igual(horaEnLetras('19:30'), 'las siete y treinta de la noche', 'con minutos');
igual(horaEnLetras('21:00'), 'las nueve de la noche', 'noche');
lanza(() => horaEnLetras('25:00'), 'horaEnLetras(25:00)');
lanza(() => horaEnLetras('8'), 'horaEnLetras(8)');

// ── Documento de identidad ──────────────────────────────────────────────────
igual(documentoFormateado('71739615'), '71.739.615', 'cédula');
igual(documentoFormateado('1017241083'), '1.017.241.083', 'cédula larga');
igual(documentoFormateado('1.017.241.083'), '1.017.241.083', 'cédula ya formateada');
igual(documentoFormateado('AB1234567'), 'AB1234567', 'pasaporte (no se puntea)');
igual(documentoFormateado(''), '', 'documento vacío');

// ── Escala de comisión de la cláusula cuarta ────────────────────────────────
igual(comisionPctAgencia(1), 35, 'escala: 1 día');
igual(comisionPctAgencia(2), 33, 'escala: 2 días');
igual(comisionPctAgencia(6), 33, 'escala: 6 días');
igual(comisionPctAgencia(7), 31, 'escala: 7 días');
igual(comisionPctAgencia(29), 31, 'escala: 29 días');
igual(comisionPctAgencia(30), 30, 'escala: 30 días');
igual(comisionPctAgencia(365), 30, 'escala: un año');
igual(tramoComisionAgencia(30).ordinal, 'último', 'tramo de 30 días');
igual(tramoComisionAgencia(1).ordinal, 'primer', 'tramo de 1 día');

// La cláusula cuarta, escrita desde la escala, tiene que ser IDÉNTICA a la que
// redactó el abogado. Si alguien toca la tabla, este assert lo grita.
igual(
  escalaComisionTexto(),
  'Su porcentaje fluctúa entre el treinta por ciento (30%) y el treinta y cinco por ciento (35%) según el número de días del respectivo arrendamiento, conforme a la siguiente escala: treinta y cinco por ciento (35%) cuando el arrendamiento sea por un (1) día; treinta y tres por ciento (33%) cuando comprenda de dos (2) a seis (6) días; treinta y un por ciento (31%) cuando comprenda de siete (7) a veintinueve (29) días; y treinta por ciento (30%) cuando sea de treinta (30) días o más.',
  'cláusula cuarta del contrato de agencia, palabra por palabra',
);

// ── Derivados: el caso exacto de los documentos ─────────────────────────────
const conIva = calcularDerivados({ dias: 30, canonDiario: 500000, iva: { activo: true, tarifa: 19 } });
igual(conIva.canonTotal, 15000000, 'canon total');
igual(conIva.ivaCanon, 2850000, 'IVA del canon');
igual(conIva.totalArrendatario, 17850000, 'total a cargo del arrendatario');
igual(conIva.comisionPct, 30, 'comisión por escala');
igual(conIva.comisionValor, 4500000, 'comisión en pesos');
igual(conIva.ivaComision, 855000, 'IVA de la comisión');
igual(conIva.netoPropietario, 10500000, 'saldo al propietario');
igual(conIva.penaMoraDiaria, 1000000, 'pena diaria por mora (200 % del canon diario)');
igual(conIva.clausulaPenalArrendamiento, 4500000, 'cláusula penal del arrendamiento (30 % del canon total)');
igual(conIva.deposito, 2000000, 'depósito');
igual(conIva.comisionFueraDeRango, false, 'comisión dentro del rango 30–35');

const sinIva = calcularDerivados({ dias: 30, canonDiario: 500000, iva: { activo: false, tarifa: 19 } });
igual(sinIva.ivaCanon, 0, 'sin IVA: IVA del canon');
igual(sinIva.ivaComision, 0, 'sin IVA: IVA de la comisión');
igual(sinIva.totalArrendatario, 15000000, 'sin IVA: total = canon');

const unDia = calcularDerivados({ dias: 1, canonDiario: 290000, iva: { activo: false, tarifa: 19 } });
igual(unDia.comisionPct, 35, 'un día: 35 %');
igual(unDia.comisionValor, 101500, 'un día: comisión');
igual(unDia.netoPropietario, 188500, 'un día: saldo al propietario');
igual(unDia.penaMoraDiaria, 580000, 'un día: pena por mora');

// La suma no puede desaparecer por el redondeo: comisión + neto = canon total.
for (const dias of [1, 2, 6, 7, 29, 30, 45]) {
  for (const canon of [80000, 120000, 290000, 333333]) {
    const d = calcularDerivados({ dias, canonDiario: canon });
    igual(d.comisionValor + d.netoPropietario, d.canonTotal, `comisión + neto = canon (${dias} días, ${canon})`);
  }
}

// ── Cláusula penal de agencia y comparación con el porcentaje único ─────────
igual(CLAUSULA_PENAL_AGENCIA_PCT, 20, 'cláusula penal de agencia');
igual(clausulaPenalAgencia(4500000), 900000, 'pena del 20 % sobre las comisiones del período');

const comp = comparacionComision(30, 15000000, 0.35);
igual(comp.pctEscala, 30, 'comparación: escala');
igual(comp.pctGlobal, 35, 'comparación: global');
igual(comp.comisionEscala, 4500000, 'comparación: comisión por escala');
igual(comp.comisionGlobal, 5250000, 'comparación: comisión global');
igual(comp.diferencia, 750000, 'comparación: diferencia a favor del propietario');

// ── Configuración del IVA ───────────────────────────────────────────────────
igual(normalizarConfigIva('true', '19'), { activo: true, tarifa: 19 }, 'config IVA activa');
igual(normalizarConfigIva('false', '19'), { activo: false, tarifa: 19 }, 'config IVA apagada');
igual(normalizarConfigIva('', ''), { activo: false, tarifa: 19 }, 'config IVA vacía → apagada al 19');
igual(normalizarConfigIva('true', '19.5'), { activo: true, tarifa: 19 }, 'tarifa no entera → por defecto');
igual(normalizarConfigIva('true', '200'), { activo: true, tarifa: 19 }, 'tarifa fuera de rango → por defecto');
igual(normalizarConfigIva(true, 0), { activo: true, tarifa: 0 }, 'tarifa 0 es válida');

// ── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${ok} aserciones OK`);
if (fallos.length > 0) {
  console.error(`\n❌ ${fallos.length} FALLOS:\n`);
  for (const f of fallos) console.error(`  · ${f}`);
  process.exit(1);
}
console.log('✅ Todas las pruebas de conversores y cifras pasaron.\n');
