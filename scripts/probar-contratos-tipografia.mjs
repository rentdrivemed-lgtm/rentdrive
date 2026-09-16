// Prueba de TIPOGRAFÍA del PDF de contratos: que no se peguen dos tramos.
//
// Por qué existe este script
// ──────────────────────────
// El cuerpo del contrato se dibuja por TRAMOS: el encabezado de la cláusula va en
// negrita y el resto del párrafo en redonda, y como jsPDF no sabe cambiar de fuente a
// media línea, cada tramo es una llamada a `text()` colocada a mano. Si la medida del
// tramo anterior se queda corta, el siguiente arranca demasiado pronto y el documento
// sale diciendo «…PRELACIÓN DOCUMENTAL.El canon…»: el punto está, el espacio no. Es un
// defecto que se lee, que ensucia un documento que se firma, y que no lo detecta
// ninguna de las otras pruebas porque el TEXTO es correcto — lo que falla es dónde se
// posa cada tramo.
//
// Qué comprueba
// ─────────────
//   1. que la tabla de anchos de `lib/contrato-pdf.ts` concuerde con la que trae jsPDF
//      (esta viene redondeada a dos decimales de em, así que se admite esa diferencia y
//      nada más: sirve para cazar una cifra mal tecleada en la tabla);
//   2. que entre dos tramos consecutivos del mismo renglón quede SIEMPRE, por lo menos,
//      la mayor parte de un espacio — con el detalle del patrón «minúscula-o-punto
//      pegado a mayúscula» cuando se produce;
//   3. que ningún tramo se salga del margen derecho;
//   4. lo anterior en los SEIS documentos y también en la copia para firma física.
//
// Cómo correrlo (desde la raíz del proyecto):
//   node scripts/probar-contratos-tipografia.mjs [--db ./rentdrive.db] [--reserva 1]
//
// ⚠️ Abre la base en modo SOLO LECTURA y no escribe nada en disco. No necesita
// servidor levantado ni credenciales.

import { createJiti } from 'jiti';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const opcion = (n, pd) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : pd;
};
const RUTA_DB = path.resolve(RAIZ, opcion('db', './rentdrive.db'));
const RESERVA = Number(opcion('reserva', '1'));

let pruebas = 0;
let fallos = 0;
function comprobar(titulo, condicion, detalle = '') {
  pruebas++;
  const ok = !!condicion;
  if (!ok) fallos++;
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
}

// ── El espía ────────────────────────────────────────────────────────────────
//
// jsPDF cuelga `text` de CADA instancia (no del prototipo), así que la única forma de
// ver dónde se posa cada tramo es envolver el constructor ANTES de que
// `lib/contrato-pdf.ts` lo importe. De ahí que el módulo se cargue por `jiti` más
// abajo y no con un `import` de arriba.
const jspdf = require('jspdf');
const Original = jspdf.jsPDF;
let trazos = [];
function jsPDFEspiado(...args) {
  const doc = new Original(...args);
  const textoOriginal = doc.text.bind(doc);
  doc.text = function (...args) {
    const contenido = args[0];
    // Los rótulos con `align` o `maxWidth` (membrete y pie) los coloca jsPDF por su
    // cuenta: no son tramos de párrafo y no entran en la comprobación.
    if (typeof contenido === 'string' && !args[3]) {
      const fuente = doc.internal.getFont();
      trazos.push({
        pagina: doc.internal.getCurrentPageInfo().pageNumber,
        x: Number(args[1]),
        y: Number(args[2]),
        texto: contenido,
        negrita: String(fuente.fontStyle || '').toLowerCase() === 'bold',
        tam: doc.internal.getFontSize(),
        escala: doc.internal.scaleFactor,
      });
    }
    return textoOriginal(...args);
  };
  return doc;
}
jspdf.jsPDF = jsPDFEspiado;
jspdf.default = jsPDFEspiado;

const jiti = createJiti(import.meta.url);
const { anchoEnEm, construirContratoPDF } = await jiti.import(path.join(RAIZ, 'lib/contrato-pdf.ts'));
const { TIPOS_DOCUMENTO, TITULOS_DOCUMENTO } = await jiti.import(path.join(RAIZ, 'lib/contratos-datos.ts'));
const { generarTexto } = await jiti.import(path.join(RAIZ, 'lib/contratos-plantillas.ts'));
const { armarDatosContrato } = await jiti.import(path.join(RAIZ, 'lib/contratos.ts'));

// ── Geometría, la misma de lib/contrato-pdf.ts ──────────────────────────────
const MARGEN = 16;
const ANCHO_UTIL = 178;
/** Cuánto de un espacio hay que respetar para no dar por pegados dos tramos. */
const MINIMO_ESPACIO = 0.6;
/** Los tramos se colocan en milímetros; medio decimal de holgura por el redondeo. */
const HOLGURA_MARGEN = 0.5;

const anchoDe = (t) => {
  const em = anchoEnEm(t.texto, t.negrita);
  return em === null ? null : (em * t.tam) / t.escala;
};

/** Los renglones de una tirada de trazos, ordenados de izquierda a derecha. */
function porRenglon(lista) {
  const mapa = new Map();
  for (const t of lista) {
    const clave = `${t.pagina}|${t.y.toFixed(2)}`;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(t);
  }
  for (const arr of mapa.values()) arr.sort((a, b) => a.x - b.x);
  return mapa;
}

const PEGADO = /[a-záéíóúñü.,;:)][A-ZÁÉÍÓÚÑÜ¿¡(]/;

function revisar(etiqueta, lista) {
  const pegados = [];
  const desbordes = [];
  const sinMedida = [];
  for (const [, renglon] of porRenglon(lista)) {
    for (let i = 0; i < renglon.length; i++) {
      const t = renglon[i];
      const ancho = anchoDe(t);
      if (ancho === null) { sinMedida.push(t.texto.slice(0, 40)); continue; }
      if (t.x + ancho > MARGEN + ANCHO_UTIL + HOLGURA_MARGEN) {
        desbordes.push(`p${t.pagina} «…${t.texto.slice(-42)}» se pasa ${(t.x + ancho - MARGEN - ANCHO_UTIL).toFixed(2)} mm`);
      }
      const siguiente = renglon[i + 1];
      if (!siguiente) continue;
      const espacio = ((anchoEnEm(' ', t.negrita) ?? 0.278) * t.tam) / t.escala;
      const hueco = siguiente.x - (t.x + ancho);
      if (hueco < espacio * MINIMO_ESPACIO) {
        const junta = `${t.texto.slice(-1)}${siguiente.texto.slice(0, 1)}`;
        pegados.push(
          `p${t.pagina} hueco ${hueco.toFixed(2)} mm (espacio ${espacio.toFixed(2)})`
          + `${PEGADO.test(junta) ? ` · patrón «${junta}»` : ''}`
          + ` · «…${t.texto.slice(-30)}» + «${siguiente.texto.slice(0, 30)}…»`,
        );
      }
    }
  }
  comprobar(`${etiqueta}: ningún tramo se pega al siguiente`, pegados.length === 0,
    pegados.length ? `\n        ${pegados.slice(0, 6).join('\n        ')}` : `${lista.length} tramos`);
  comprobar(`${etiqueta}: ningún tramo se sale del margen derecho`, desbordes.length === 0,
    desbordes.length ? `\n        ${desbordes.slice(0, 6).join('\n        ')}` : '');
  if (sinMedida.length) {
    comprobar(`${etiqueta}: todos los caracteres están en la tabla de anchos`, false, sinMedida.slice(0, 5).join(' · '));
  }
}

async function main() {
  // ── 1 · La tabla de anchos contra la de jsPDF ─────────────────────────────
  console.log('\n1 · La tabla de anchos concuerda con la de jsPDF (±0,01 em de redondeo)');
  const sonda = new Original();
  for (const [estilo, negrita] of [['normal', false], ['bold', true]]) {
    sonda.setFont('helvetica', estilo);
    // La tabla interna de jsPDF, sin pasar por `getTextWidth`: así no interviene el
    // kerning y se ve qué códigos tiene de verdad. Los que le faltan (el espacio duro,
    // los superíndices…) los resuelve con un ancho por defecto que no dice nada, así
    // que esos se saltan: ahí la tabla buena es la nuestra.
    const suyas = sonda.internal.getFont().metadata.Unicode.widths;
    const divisor = suyas.fof || 1;
    const desviados = [];
    let comparados = 0;
    for (let codigo = 32; codigo <= 255; codigo++) {
      const nuestro = anchoEnEm(String.fromCharCode(codigo), negrita);
      if (nuestro === null || suyas[codigo] === undefined) continue;
      comparados++;
      const suyo = suyas[codigo] / divisor;
      if (Math.abs(nuestro - suyo) > 0.0101) desviados.push(`${codigo} ${nuestro} vs ${suyo}`);
    }
    // jsPDF no trae todos los códigos de WinAnsi; con que coincidan los ~175 que sí
    // tiene, la tabla está bien copiada.
    comprobar(`helvetica ${estilo}`, desviados.length === 0 && comparados > 150,
      desviados.slice(0, 6).join(' · ') || `${comparados} códigos`);
  }

  // ── 2 · Los seis documentos ───────────────────────────────────────────────
  console.log(`\n2 · Los seis documentos (reserva #${RESERVA} de ${path.relative(RAIZ, RUTA_DB)})`);
  const db = new Database(RUTA_DB, { readonly: true });
  const datos = armarDatosContrato(db, RESERVA);
  db.close();
  if (!datos) {
    comprobar(`existe la reserva #${RESERVA}`, false, 'no se pudo armar el snapshot de datos');
    return;
  }

  for (const tipo of TIPOS_DOCUMENTO) {
    const contrato = {
      id: 0, reserva_id: RESERVA, tipo, numero: `PRUEBA-${tipo}`, version: 1,
      estado: 'pendiente', via_firma: null, texto: generarTexto(tipo, datos),
      datos_json: '{}', created_at: '2026-01-01 00:00', sello: '', sello_version: 1,
      anulado_en: null, anulado_por: null, anulado_por_nombre: null, motivo_anulacion: null,
    };
    for (const modo of ['expediente', 'papel']) {
      trazos = [];
      await construirContratoPDF({ contrato, firmas: [] }, { modo, empresa: { nombre: 'DrivePass', nit: '902.088.011-1' } });
      const capturados = trazos.slice();
      // Si el espía no llegó a tiempo, todo lo demás pasaría por vacío: eso es un fallo.
      comprobar(`${TITULOS_DOCUMENTO[tipo]} (${modo}): se capturaron los tramos`, capturados.length > 20, `${capturados.length}`);
      revisar(`${tipo}/${modo}`, capturados);
    }
  }
}

await main();
console.log(`\n${pruebas - fallos} de ${pruebas} comprobaciones pasaron.`);
if (fallos > 0) process.exitCode = 1;
