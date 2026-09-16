// Genera los seis documentos y los compara, línea por línea, con los originales
// que redactó el abogado.
//
// Cómo correrlo (desde la raíz del proyecto):
//   node scripts/correr-ts.mjs scripts/probar-contratos.ts
//   node scripts/correr-ts.mjs scripts/probar-contratos.ts --salida /ruta/salida
//   node scripts/correr-ts.mjs scripts/probar-contratos.ts --db ./rentdrive.db --reserva 4
//
// Dos modos, y los dos importan:
//
//  1. CASO DE REFERENCIA (siempre). Reconstruye el ejemplo exacto de los .txt
//     (Néstor Fabián Cano Ochoa, Toyota TXL de placas NHV867, treinta días a
//     $500.000 con IVA del 19 %) y exige que el texto generado sea IDÉNTICO al
//     original en los cuatro documentos que vienen diligenciados. El pagaré y el
//     acta vienen en blanco en el original, así que ahí la comparación es
//     estructural: se verifica que los CINCO espacios que la carta de
//     instrucciones declara en blanco sigan en blanco y que el resto quede lleno.
//
//  2. RESERVA REAL (opcional, con --db y --reserva). Genera los seis documentos
//     con datos de la base y reporta qué campos quedaron pendientes.
//
// Las salidas se escriben en la carpeta de --salida para poder mirarlas con
// `diff` a mano.

import fs from 'fs';
import path from 'path';
import { calcularDerivados } from '../lib/contratos-calculo';
import { AGENTE, CIUDAD_CONTRATO, PENDIENTE, TIPOS_DOCUMENTO, faltantesDe, type DatosContrato, type TipoDocumento } from '../lib/contratos-datos';
import { generarTexto } from '../lib/contratos-plantillas';

// ── Argumentos ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function opcion(nombre: string): string | undefined {
  const i = argv.indexOf(`--${nombre}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const DIR_SALIDA = path.resolve(opcion('salida') || './salida-contratos');
const DIR_ORIGINALES = path.resolve(opcion('originales') || '/tmp/contratos');
const RUTA_DB = opcion('db');
const RESERVA_ID = Number(opcion('reserva') || 0);

const ARCHIVO_ORIGINAL: Record<TipoDocumento, string> = {
  'agencia': '1-agencia-comercial.txt',
  'pagare': '2-pagare.txt',
  'arrendamiento': '3-arrendamiento.txt',
  'acta-entrega': '4-acta-entrega.txt',
  'otrosi-arrendamiento': '5-otrosi-arrendamiento.txt',
  'otrosi-agencia': '6-otrosi-agencia.txt',
};

/** Los que en el original vienen DILIGENCIADOS: deben salir idénticos. */
const DEBEN_SER_IDENTICOS: TipoDocumento[] = ['agencia', 'arrendamiento', 'otrosi-arrendamiento', 'otrosi-agencia'];

/**
 * Diferencias CONOCIDAS y aceptadas frente al original, con su justificación.
 * Cualquier otra diferencia en un documento diligenciado es un error.
 */
const DIFERENCIAS_ACEPTADAS: Array<{ tipo: TipoDocumento; ori: string; gen: string; razon: string }> = [
  {
    tipo: 'otrosi-arrendamiento',
    ori: 'Aboco.sjc@gmail.com',
    gen: 'aboco.sjc@gmail.com',
    razon: 'el original escribió el correo del arrendatario con mayúscula inicial en el bloque de firmas; el motor imprime el correo tal como está registrado',
  },
];

let problemas = 0;

// ── Caso de referencia: el ejemplo exacto de los documentos ─────────────────

function datosDeReferencia(): DatosContrato {
  const derivados = calcularDerivados({ dias: 30, canonDiario: 500000, iva: { activo: true, tarifa: 19 } });
  const lugar = 'Calle 42 A No. 68 A 10 de Medellín, Antioquia';
  return {
    fecha: '2026-09-11',
    fechaContratoArrendamiento: '2026-09-11',
    fechaContratoAgencia: '2026-09-11',
    ciudad: CIUDAD_CONTRATO,
    propietario: {
      nombre: 'NÉSTOR FABIÁN CANO OCHOA',
      tipoDocumento: 'cédula de ciudadanía', articulo: 'la', sigla: 'C.C.',
      documento: '71.739.615', ciudad: 'Medellín',
      direccion: 'Calle 10 No. 40-20', correo: 'nestor.cano@ejemplo.com', celular: '+57 3001112233',
      licencia: { numero: PENDIENTE, categoria: PENDIENTE, vigenciaHasta: PENDIENTE },
    },
    cliente: {
      nombre: 'JUAN PABLO CASTAÑO FRANCO',
      tipoDocumento: 'cédula de ciudadanía', articulo: 'la', sigla: 'C.C.',
      documento: '1.017.241.083', ciudad: 'Medellín',
      direccion: 'Carrera 70 No. 45-15', correo: 'aboco.sjc@gmail.com', celular: '+57 3004445566',
      licencia: { numero: '1017241083', categoria: 'B1', vigenciaHasta: '2030-05-14' },
    },
    agente: AGENTE,
    vehiculo: {
      placa: 'NHV867', marca: 'TOYOTA', linea: 'TXL', anio: 2026,
      color: 'BLANCO', motor: '1GD0123456', chasis: 'MR0HA3CD9N0123456',
      servicio: 'particular', valorAsegurado: 108100000,
    },
    poliza: {
      numero: '900001684589',
      aseguradora: 'SEGUROS GENERALES SURAMERICANA S.A.',
      aseguradoraNit: '890.903.407-9',
      expedidaEl: '2026-09-07', vigenciaDesde: '2026-09-07', vigenciaHasta: '2027-09-07',
      codigoClausulado: 'F-13-18-0040-283 D00I', notaTecnica: 'N-13-18-0040-014',
      deducible: '10 % mínimo 1 SMMLV',
    },
    operacion: {
      entrega: { fecha: '2026-09-11', hora: '08:00', lugar },
      restitucion: { fecha: '2026-10-11', hora: '08:00', lugar },
      kilometraje: 'ilimitado', costoKmExceso: 'no aplica',
      conductores: [],
      fotosEntrega: 8, fotosDevolucion: 8,
    },
    numeros: {
      contratoArrendamiento: 'AR-000001', otrosiArrendamiento: '1',
      contratoAgencia: 'AG-000001', otrosiAgencia: '1', acta: 'AC-000001',
    },
    iva: derivados.iva,
    derivados,
    origen: {
      reservaId: 0, vehiculoId: 0, propietarioId: 0, clienteId: 0,
      canonRecaudado: derivados.canonTotal, ajusteRedondeoCanon: 0,
    },
  };
}

function normalizar(texto: string): string {
  return texto.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '\n');
}

function compararLineas(generado: string, original: string): Array<{ n: number; gen: string; ori: string }> {
  const g = generado.split('\n');
  const o = original.split('\n');
  const dif: Array<{ n: number; gen: string; ori: string }> = [];
  for (let i = 0; i < Math.max(g.length, o.length); i++) {
    if (g[i] !== o[i]) dif.push({ n: i + 1, gen: g[i] ?? '«falta línea»', ori: o[i] ?? '«sobra línea»' });
  }
  return dif;
}

function recortar(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── 1 · Caso de referencia ──────────────────────────────────────────────────

fs.mkdirSync(DIR_SALIDA, { recursive: true });
const datos = datosDeReferencia();

console.log('══ CASO DE REFERENCIA (el ejemplo exacto de los .txt del abogado) ══\n');

for (const tipo of TIPOS_DOCUMENTO) {
  const texto = normalizar(generarTexto(tipo, datos));
  fs.writeFileSync(path.join(DIR_SALIDA, `referencia-${tipo}.txt`), texto);

  const rutaOriginal = path.join(DIR_ORIGINALES, ARCHIVO_ORIGINAL[tipo]);
  if (!fs.existsSync(rutaOriginal)) {
    console.log(`  ${tipo.padEnd(22)} generado (no hay original en ${DIR_ORIGINALES} para comparar)`);
    continue;
  }
  const original = normalizar(fs.readFileSync(rutaOriginal, 'utf8'));
  fs.writeFileSync(path.join(DIR_SALIDA, `original-${tipo}.txt`), original);

  const todas = compararLineas(texto, original);
  const aceptadas = todas.filter(d => DIFERENCIAS_ACEPTADAS.some(a => a.tipo === tipo && a.ori === d.ori && a.gen === d.gen));
  const dif = todas.filter(d => !aceptadas.includes(d));
  for (const a of aceptadas) {
    const razon = DIFERENCIAS_ACEPTADAS.find(x => x.tipo === tipo && x.ori === a.ori)?.razon ?? '';
    console.log(`  ⚠️  ${tipo.padEnd(22)} diferencia aceptada en la línea ${a.n}: «${a.ori}» → «${a.gen}» (${razon})`);
  }
  const exigeIdentico = DEBEN_SER_IDENTICOS.includes(tipo);
  if (dif.length === 0) {
    console.log(`  ✅ ${tipo.padEnd(22)} IDÉNTICO al original${aceptadas.length ? ' (salvo la diferencia aceptada de arriba)' : ''} (${texto.split('\n').length} líneas)`);
  } else {
    const marca = exigeIdentico ? '❌' : '·';
    if (exigeIdentico) problemas++;
    console.log(`  ${marca} ${tipo.padEnd(22)} ${dif.length} línea(s) distintas${exigeIdentico ? ' — NO DEBERÍA' : ' (el original es un formulario en blanco)'}`);
    for (const d of dif.slice(0, exigeIdentico ? 10 : 3)) {
      console.log(`      línea ${d.n}\n        original: ${recortar(d.ori)}\n        generado: ${recortar(d.gen)}`);
    }
    if (dif.length > (exigeIdentico ? 10 : 3)) console.log(`      …y ${dif.length - (exigeIdentico ? 10 : 3)} más`);
  }
}

// ── 2 · El pagaré y su regla legal ──────────────────────────────────────────
//
// La carta de instrucciones declara que los ÚNICOS espacios en blanco son cinco.
// Si el motor los llenara, el título se contradiría a sí mismo; si llenara de
// menos, quedaría un campo abierto que nadie autorizó a diligenciar.

console.log('\n══ PAGARÉ: los cinco espacios que deben quedar EN BLANCO ══\n');

const textoPagare = generarTexto('pagare', datos);
const chequeosPagare: Array<[string, boolean]> = [
  ['número del pagaré (encabezado)', textoPagare.includes('PAGARÉ No. ____________')],
  ['número del pagaré (referencia de la carta)', textoPagare.includes('pagaré con espacios en blanco No. ____________,')],
  ['nombre e identificación de EL ACREEDOR', textoPagare.includes('a la orden de ____________________________________, identificado con ____________________,')],
  ['destinatario de la carta (EL ACREEDOR)', textoPagare.includes('Señores\n____________________________________\nCiudad')],
  ['cuantía en letras y en cifras', textoPagare.includes('la suma de ____________________________________ PESOS ($____________________)')],
  ['fecha de vencimiento', textoPagare.includes('la pagaré el día ______ del mes de ____________________ del año ____________.')],
  ['EL ACREEDOR es el PROPIETARIO: su nombre NO aparece impreso', !textoPagare.includes(datos.propietario.nombre)],
  ['EL ACREEDOR es el PROPIETARIO: su documento NO aparece impreso', !textoPagare.includes(datos.propietario.documento)],
  ['la fecha de suscripción SÍ queda diligenciada', textoPagare.includes('a los 11 días del mes de septiembre del año 2026')],
  ['la identificación del otorgante SÍ queda diligenciada', textoPagare.includes(datos.cliente.documento)],
  ['el número del contrato de arrendamiento SÍ queda diligenciado', textoPagare.includes('sin conductor No. AR-000001,')],
  ['sin codeudores no queda un bloque de codeudor en blanco', !textoPagare.includes('CODEUDOR SOLIDARIO')],
];
for (const [que, cumple] of chequeosPagare) {
  console.log(`  ${cumple ? '✅' : '❌'} ${que}`);
  if (!cumple) problemas++;
}

// ── 3 · Variante sin IVA ────────────────────────────────────────────────────

console.log('\n══ VARIANTE SIN IVA (la opción que pidió el dueño) ══\n');

const sinIva: DatosContrato = (() => {
  const d = datosDeReferencia();
  const der = calcularDerivados({ dias: 30, canonDiario: 500000, iva: { activo: false, tarifa: 19 } });
  return { ...d, iva: der.iva, derivados: der };
})();

for (const tipo of ['otrosi-arrendamiento', 'otrosi-agencia'] as TipoDocumento[]) {
  const texto = normalizar(generarTexto(tipo, sinIva));
  fs.writeFileSync(path.join(DIR_SALIDA, `sin-iva-${tipo}.txt`), texto);
}

const otrosiSinIva = generarTexto('otrosi-arrendamiento', sinIva);
const agenciaSinIva = generarTexto('otrosi-agencia', sinIva);
const chequeosIva: Array<[string, boolean]> = [
  ['no queda ninguna frase con un IVA de $0', !otrosiSinIva.includes('($0)') && !agenciaSinIva.includes('($0)')],
  ['el otrosí de arrendamiento dice por qué no se adiciona el IVA', otrosiSinIva.includes('no se adiciona con el impuesto sobre las ventas por no resultar aplicable a esta operación')],
  ['el canon diario ya no dice «antes de impuesto sobre las ventas»', !otrosiSinIva.includes('moneda corriente, antes de impuesto sobre las ventas')],
  ['el otrosí de agencia no promete girar un IVA que no se recaudó', !agenciaSinIva.includes('junto con el impuesto sobre las ventas recaudado')],
  ['el total a cargo del arrendatario es el canon', otrosiSinIva.includes('QUINCE MILLONES DE PESOS ($15.000.000) moneda corriente, suma que no se adiciona')],
  ['la comisión sigue citando el mismo saldo en los dos otrosí',
    agenciaSinIva.includes('DIEZ MILLONES QUINIENTOS MIL PESOS ($10.500.000)') && agenciaSinIva.includes('CUATRO MILLONES QUINIENTOS MIL PESOS ($4.500.000)')],
];
for (const [que, cumple] of chequeosIva) {
  console.log(`  ${cumple ? '✅' : '❌'} ${que}`);
  if (!cumple) problemas++;
}

// ── 4 · Coherencia entre los dos otrosí ─────────────────────────────────────
//
// El otrosí de arrendamiento y el de agencia citan las MISMAS cifras. Si alguna
// vez dejan de salir de `calcularDerivados`, esto lo detecta.

console.log('\n══ COHERENCIA ENTRE DOCUMENTOS ══\n');

const textoOtrosiArr = generarTexto('otrosi-arrendamiento', datos);
const textoOtrosiAg = generarTexto('otrosi-agencia', datos);
const cifrasComunes = [
  'QUINIENTOS MIL PESOS ($500.000)',
  'QUINCE MILLONES DE PESOS ($15.000.000)',
  'DOS MILLONES OCHOCIENTOS CINCUENTA MIL PESOS ($2.850.000)',
  'DOS MILLONES DE PESOS ($2.000.000)',
  'treinta (30) días',
];
for (const cifra of cifrasComunes) {
  const cumple = textoOtrosiArr.includes(cifra) && textoOtrosiAg.includes(cifra);
  console.log(`  ${cumple ? '✅' : '❌'} «${cifra}» aparece igual en los dos otrosí`);
  if (!cumple) problemas++;
}

// ── 5 · Reserva real (opcional) ─────────────────────────────────────────────

if (RUTA_DB && RESERVA_ID > 0) {
  console.log(`\n══ RESERVA REAL #${RESERVA_ID} (${RUTA_DB}) ══\n`);
  // Import diferido: solo este modo necesita better-sqlite3.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const db = new Database(path.resolve(RUTA_DB), { readonly: true });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { armarDatosContrato } = require('../lib/contratos') as typeof import('../lib/contratos');

  const reales = armarDatosContrato(db, RESERVA_ID);
  if (!reales) {
    console.log(`  ❌ la reserva ${RESERVA_ID} no existe en esa base`);
    problemas++;
  } else {
    fs.writeFileSync(path.join(DIR_SALIDA, `reserva-${RESERVA_ID}-datos.json`), JSON.stringify(reales, null, 2));
    for (const tipo of TIPOS_DOCUMENTO) {
      const texto = normalizar(generarTexto(tipo, reales));
      fs.writeFileSync(path.join(DIR_SALIDA, `reserva-${RESERVA_ID}-${tipo}.txt`), texto);
      const faltan = faltantesDe(reales, tipo);
      console.log(`  · ${tipo.padEnd(22)} ${texto.length} caracteres — ${faltan.length} campo(s) pendientes`);
    }
    console.log('\n  Campos pendientes (inventario de lo que la base NO tiene hoy):');
    for (const f of faltantesDe(reales)) {
      console.log(`    · ${f.etiqueta} — ${f.fuente}`);
    }
    console.log(`\n  Canon recaudado: $${reales.origen.canonRecaudado.toLocaleString('es-CO')} · días: ${reales.derivados.dias} · canon diario: $${reales.derivados.canonDiario.toLocaleString('es-CO')} · ajuste por redondeo: $${reales.origen.ajusteRedondeoCanon}`);
    console.log(`  Comisión por ESCALA del contrato: ${reales.derivados.comisionPct} % = $${reales.derivados.comisionValor.toLocaleString('es-CO')}`);
  }

  // ── Escala del contrato vs. porcentaje único que se liquida hoy ───────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { compararComisionLiquidaciones, configIva } = require('../lib/contratos') as typeof import('../lib/contratos');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { comisionPlataforma } = require('../lib/contabilidad') as typeof import('../lib/contabilidad');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { comparacionComision } = require('../lib/contratos-calculo') as typeof import('../lib/contratos-calculo');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { calcularDiasAlquiler } = require('../lib/lugares') as typeof import('../lib/lugares');

  const pctGlobal = comisionPlataforma(db);
  const iva = configIva(db);
  console.log(`\n  Config: comisión global = ${(pctGlobal * 100).toFixed(2)} % · IVA ${iva.activo ? `activo al ${iva.tarifa} %` : 'apagado'}`);

  const liq = compararComisionLiquidaciones(db, pctGlobal);
  console.log(`\n  ── ESCALA DEL CONTRATO vs. COMISIÓN QUE SE LIQUIDA HOY ──`);
  if (liq.length === 0) {
    console.log('  (no hay liquidaciones en esta base; se muestran las reservas confirmadas como referencia)');
    const reservas = db.prepare(`
      SELECT id, fecha_inicio, fecha_fin, total, COALESCE(recargo,0) AS recargo
      FROM reservas WHERE estado IN ('confirmada','en_curso','completada') ORDER BY id
    `).all() as Array<{ id: number; fecha_inicio: string; fecha_fin: string; total: number; recargo: number }>;
    let totalDif = 0;
    for (const r of reservas) {
      const dias = calcularDiasAlquiler(r.fecha_inicio, r.fecha_fin);
      const c = comparacionComision(dias, r.total - r.recargo, pctGlobal);
      totalDif += c.diferencia;
      console.log(`    reserva ${String(r.id).padStart(3)} · ${String(dias).padStart(2)} día(s) · canon $${c.canonTotal.toLocaleString('es-CO').padStart(11)} · escala ${c.pctEscala} % = $${c.comisionEscala.toLocaleString('es-CO').padStart(10)} · hoy ${c.pctGlobal} % = $${c.comisionGlobal.toLocaleString('es-CO').padStart(10)} · diferencia $${c.diferencia.toLocaleString('es-CO')}`);
    }
    console.log(`    TOTAL cobrado de más frente a la escala del contrato: $${totalDif.toLocaleString('es-CO')}`);
  } else {
    let totalDif = 0;
    for (const l of liq) {
      totalDif += l.comisionLiquidada - l.comisionEscala;
      console.log(`    liq ${String(l.liquidacionId).padStart(3)} (reserva ${l.reservaId}) · ${l.dias} día(s) · bruto $${l.canonTotal.toLocaleString('es-CO')} · escala ${l.pctEscala} % = $${l.comisionEscala.toLocaleString('es-CO')} · liquidado $${l.comisionLiquidada.toLocaleString('es-CO')} · diferencia $${(l.comisionLiquidada - l.comisionEscala).toLocaleString('es-CO')}`);
    }
    console.log(`    TOTAL descontado de más frente a la escala del contrato: $${totalDif.toLocaleString('es-CO')}`);
  }

  db.close();
}

// ── Resultado ───────────────────────────────────────────────────────────────

console.log(`\nSalidas escritas en: ${DIR_SALIDA}`);
if (problemas > 0) {
  console.error(`\n❌ ${problemas} problema(s). Revisa arriba.\n`);
  process.exit(1);
}
console.log('\n✅ Todo cuadra.\n');
