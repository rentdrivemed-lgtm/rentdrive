// ── PDF de un contrato digital ──────────────────────────────────────────────
//
// Fase 3 del módulo de contratos. Parte PESADA (jsPDF + sharp) separada del resto,
// igual que `lib/contabilidad-pdf.ts` y `lib/acta-servicio-pdf.ts`: la cadena
// `lib/db.ts` → `lib/contratos*.ts` la carga casi cualquier ruta de la app y no tiene
// por qué arrastrar un generador de PDF.
//
// ── Regla number uno de este archivo ────────────────────────────────────────
// EL PDF SE ARMA DESDE EL TEXTO CONGELADO (`contratos.texto`), NUNCA volviendo a
// correr la plantilla. El documento firmado es el que se firmó: si mañana cambia la
// dirección del cliente, el precio del carro o incluso la redacción de la plantilla,
// este PDF sigue diciendo exactamente lo que decía el día de la firma. Por eso la
// función recibe filas de la base y no un id de reserva.
//
// ── Qué dibuja encima del texto ─────────────────────────────────────────────
//   · las IMÁGENES de las firmas, cada una en SU bloque dentro del documento (ver
//     «Anclas» más abajo), con nombre, documento, fecha y hora;
//   · una CONSTANCIA DE VERIFICACIÓN al final: si el sello de cada firma cuadra con
//     el texto, la huella SHA-256 del documento y, cuando algo no verifica, una
//     advertencia bien visible en vez de un párrafo tranquilizador;
//   · el sello de ANULADA con su motivo y su fecha, como en las cuentas de cobro
//     reemitidas (lib/contabilidad-pdf.ts);
//   · en modo mostrador, los bloques de firma EN BLANCO y la leyenda de copia para
//     firma física.
//
// ── Textos que NO vienen del abogado ────────────────────────────────────────
// Todo lo que este archivo escribe (encabezado, pies de página, constancia de
// verificación, leyenda de la copia para firma física y avisos de estado) es
// redacción propia, NEUTRA y deliberadamente separada del cuerpo del contrato: va en
// bandas de encabezado y pie o en secciones posteriores a la firma, nunca intercalada
// entre las cláusulas. Están reunidos en la constante `LEYENDAS` para que se puedan
// revisar de un vistazo y sustituir por lo que diga el abogado.
//
// ⚠️ Módulo de SERVIDOR: no importar desde un componente 'use client'.

import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import {
  ahoraLocalContrato, huellaDocumento, verificarSelloFirma,
  type ContratoRow, type FirmaContratoRow,
} from './contratos-firma';
import { verificarSelloPapel } from './contratos-papel';
import { validarFirmaPng } from './firma-imagen';
import { TITULOS_DOCUMENTO, type TipoDocumento } from './contratos-datos';

// ── Leyendas propias (NO son texto del abogado) ─────────────────────────────

export const LEYENDAS = {
  copiaFirmaFisica: 'COPIA PARA FIRMA FÍSICA',
  copiaFirmaFisicaDetalle:
    'Esta copia se imprime para ser firmada a mano. Los espacios de firma van en blanco a propósito. '
    + 'Mientras el ejemplar firmado no se escanee y se registre en el sistema, este documento no tiene ninguna firma.',
  pendienteFirma: 'PENDIENTE DE FIRMA',
  pendienteFirmaDetalle: 'Este documento todavía no está firmado por todas las partes.',
  anulada: 'ANULADA',
  firmadoPapel: 'FIRMADO EN PAPEL (MOSTRADOR)',
  firmadoPapelDetalle:
    'Este documento se imprimió, se firmó a mano y su escaneado quedó registrado en el sistema. '
    + 'No tiene firma electrónica: lo que el sistema puede comprobar es que el escaneado guardado corresponde a '
    + 'este texto y que no se ha alterado desde que se registró, no la autoría de los trazos del papel.',
  firmadoDigital: 'FIRMADO ELECTRÓNICAMENTE',
  constanciaTitulo: 'CONSTANCIA DE VERIFICACIÓN',
  constanciaQueEs:
    'Esta constancia la genera el sistema al producir el PDF. El sello de integridad es un código calculado con una '
    + 'clave que solo conoce el servidor y que cubre el texto íntegro del documento: si alguien modificara una cláusula '
    + 'en la base de datos después de la firma, el sello dejaría de coincidir y aquí aparecería una advertencia.',
  constanciaNoEsFirmaDigital:
    'Alcance: es una firma electrónica simple (trazo, nombre confirmado, fecha, hora y dirección IP del acto). No es '
    + 'una firma digital con certificado de una entidad de certificación.',
  constanciaPapel:
    'Alcance en el mostrador: este documento NO tiene firma electrónica. El sistema comprueba que el archivo escaneado '
    + 'que se guardó corresponde a este texto y que no ha cambiado; no comprueba quién trazó las firmas del papel.',
  sinFirmaBloque: 'Pendiente de firma',
  espacioFirmaPapel: 'Firma',
} as const;

// ── Geometría ───────────────────────────────────────────────────────────────

const MARGEN = 16;
const ANCHO_UTIL = 178;      // 210 mm de A4 menos los dos márgenes
const ALTO_PAGINA = 297;
const Y_TOPE = 20;           // primera línea de las páginas 2 en adelante
const Y_LIMITE = 276;        // por debajo de esto ya es zona de pie de página
const INTERLINEA = 4.3;
const TAM_CUERPO = 9;
const TAM_TITULO = 12.5;
const TAM_SECCION = 9.8;
const TAM_PIE = 6.8;

/** Líneas mínimas que tienen que caber para empezar un párrafo en la página actual. */
const MIN_LINEAS_VIUDA = 3;

const NARANJA: [number, number, number] = [199, 74, 33];
const AZUL: [number, number, number] = [27, 51, 86];
const VERDE: [number, number, number] = [21, 128, 61];
const GRIS = 120;

// ── Anclas: dónde vive cada bloque de firma DENTRO del texto ────────────────
//
// El texto congelado ya trae, al pie, los bloques de firma que redactó el abogado
// («_______ / NOMBRE / C.C. 71.739.615 / EL EMPRESARIO»). La imagen de la firma tiene
// que ir AHÍ, no en un apéndice al final: quien lee el papel espera el trazo encima de
// la raya, debajo del nombre de quien firma.
//
// Cada tipo declara, EN ORDEN, qué línea marca cada bloque. El emparejamiento es
// posicional dentro del tipo (el acta tiene dos «EL ARRENDATARIO», uno por momento), y
// por eso las claves van explícitas y no se deducen: si mañana el abogado reordena los
// bloques, esta tabla deja de cuadrar y el generador lo NOTA (ver `anclarFirmas`) y
// pinta todas las firmas en un apéndice en vez de ponerlas en el sitio equivocado.
type Ancla = { clave: string; re: RegExp };

const ANCLAS_FIRMA: Record<TipoDocumento, readonly Ancla[]> = {
  'agencia': [
    { clave: 'empresario', re: /^EL EMPRESARIO$/ },
    { clave: 'agente', re: /^EL AGENTE$/ },
    // El anexo de la cláusula décima séptima, que el propietario firma por separado.
    { clave: 'empresario-anexo', re: /^EL EMPRESARIO$/ },
  ],
  'otrosi-agencia': [
    { clave: 'empresario', re: /^EL EMPRESARIO$/ },
    { clave: 'agente', re: /^EL AGENTE$/ },
  ],
  'arrendamiento': [
    { clave: 'agente', re: /^En calidad de EL AGENTE\b/ },
    { clave: 'arrendatario', re: /^EL ARRENDATARIO$/ },
  ],
  'otrosi-arrendamiento': [
    { clave: 'agente', re: /^En calidad de EL AGENTE\b/ },
    { clave: 'arrendatario', re: /^EL ARRENDATARIO$/ },
  ],
  'acta-entrega': [
    { clave: 'entrega-agente', re: /^Por .+, EL AGENTE$/ },
    { clave: 'entrega-arrendatario', re: /^EL ARRENDATARIO$/ },
    { clave: 'devolucion-agente', re: /^Por .+, EL AGENTE$/ },
    { clave: 'devolucion-arrendatario', re: /^EL ARRENDATARIO$/ },
  ],
  'pagare': [
    { clave: 'otorgante', re: /^EL OTORGANTE$/ },
    { clave: 'otorgante-carta', re: /^EL OTORGANTE$/ },
  ],
};

const ES_RAYA = /^_{5,}$/;

/** ¿Esta línea puede formar parte del grupito de identificación de una firma? */
function esLineaDeIdentificacion(linea: string): boolean {
  const t = linea.trim();
  if (!t) return false;
  if (t.length > 70) return false;
  // Una frase que termina en punto («Suscrito en Medellín, 16 de septiembre de 2026.»)
  // es texto del documento, no parte del bloque de firma. Las líneas de identificación
  // no llevan punto final («C.C. 71.739.615», «DRIVEPASS COL S.A.S., NIT 900…»).
  if (t.endsWith('.') && !ES_RAYA.test(t)) return false;
  return true;
}

export type AnclajeFirma = {
  clave: string;
  /** Índice de la línea donde empieza el bloque (encima de ella va la imagen). */
  inicio: number;
  /** Índice de la última línea del bloque (debajo de ella va la constancia). */
  fin: number;
};

/**
 * Localiza en el texto el sitio de cada bloque de firma.
 *
 * Devuelve `null` si la estructura no cuadra (faltan anclas, sobran, o el documento
 * tiene bloques que la tabla no conoce — por ejemplo codeudores del pagaré, que hoy
 * nunca se generan). En ese caso el PDF pinta las firmas en un apéndice al final: es
 * preferible una firma en un apéndice bien rotulado a una firma puesta debajo del
 * nombre de otra persona.
 */
export function anclarFirmas(tipo: TipoDocumento, texto: string, claves: readonly string[]): AnclajeFirma[] | null {
  const anclas = ANCLAS_FIRMA[tipo];
  if (!anclas || anclas.length !== claves.length) return null;
  // Las claves del documento tienen que ser exactamente las que la tabla espera.
  const esperadas = anclas.map(a => a.clave).slice().sort().join('|');
  if (claves.slice().sort().join('|') !== esperadas) return null;

  const lineas = texto.split('\n');
  const encontrados: AnclajeFirma[] = [];
  let k = 0;
  const indicesAncla = new Set<number>();

  for (let i = 0; i < lineas.length && k < anclas.length; i++) {
    if (!anclas[k].re.test(lineas[i].trim())) continue;
    indicesAncla.add(i);
    encontrados.push({ clave: anclas[k].clave, inicio: i, fin: i });
    k++;
  }
  if (k !== anclas.length) return null;

  // Ahora se extiende cada ancla a su grupito de identificación: hacia atrás hasta un
  // renglón en blanco, una frase larga o el ancla anterior; hacia adelante hasta lo
  // mismo, cortando además en una raya de firma (que abre el bloque SIGUIENTE).
  for (const a of encontrados) {
    let ini = a.inicio;
    while (ini - 1 >= 0 && !indicesAncla.has(ini - 1) && esLineaDeIdentificacion(lineas[ini - 1])) ini--;
    let fin = a.fin;
    while (
      fin + 1 < lineas.length && !indicesAncla.has(fin + 1)
      && esLineaDeIdentificacion(lineas[fin + 1]) && !ES_RAYA.test(lineas[fin + 1].trim())
    ) fin++;
    a.inicio = ini;
    a.fin = fin;
  }
  return encontrados;
}

// ── Anchos reales de la fuente ──────────────────────────────────────────────
//
// ⚠️ Esto no es una micro-optimización: es la causa del defecto «DOCUMENTAL.El canon».
//
// El texto se escribe con Helvetica como una de las catorce fuentes estándar y SIN
// tabla `/Widths` en el PDF, así que el visor la dibuja con las métricas reales de la
// fuente. jsPDF, en cambio, mide con una tabla propia redondeada a DOS decimales de em
// (`widths.fof = 100`: la «E» le vale 0,66 em y no 0,667) y encima aplica kerning, que
// el archivo resultante no lleva. Las dos medidas difieren unas milésimas por carácter
// y el error SE ACUMULA a lo largo del renglón: el encabezado «DÉCIMA NOVENA. OTROSÍ Y
// PRELACIÓN DOCUMENTAL.» mide 86,96 mm para jsPDF y el visor lo dibuja en 87,83 mm. Esa
// diferencia —0,87 mm— es casi exactamente un espacio a 9 pt, que es el que se perdía al
// arrancar el tramo normal donde jsPDF creía que terminaba el negrita.
//
// Por eso el motor de párrafos mide con los anchos DE VERDAD, que van aquí en milésimas
// de em y por código WinAnsi —la codificación con la que se escribe el texto—, para
// Helvetica y Helvetica-Bold. Los seis códigos que WinAnsi deja sin definir valen 0 y
// hacen que la medida caiga de vuelta en `getTextWidth`, igual que cualquier carácter
// que no sea representable en esa codificación.

/** Anchos por código WinAnsi, empezando en el 32 (espacio). */
function tablaAnchos(csv: string): number[] {
  return csv.split(',').map(Number);
}

const ANCHOS_NORMAL = tablaAnchos(
  '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,'
  + '584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,'
  + '667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,'
  + '278,556,500,722,500,500,500,334,260,334,584,0,744,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,'
  + '0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,'
  + '584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,'
  + '667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,'
  + '556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500',
);

const ANCHOS_NEGRITA = tablaAnchos(
  '278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,'
  + '584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,'
  + '667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,'
  + '333,611,556,778,556,556,500,389,280,389,584,0,744,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,'
  + '0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,'
  + '584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,'
  + '667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,'
  + '556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556',
);

/**
 * Los veintisiete caracteres que WinAnsi mete en la franja 128–159 y que en Unicode
 * viven muy lejos de ahí: la raya del inciso, las comillas tipográficas, los puntos
 * suspensivos… El texto del abogado usa varios, así que sin este mapa se medirían por
 * el camino lento.
 */
const WINANSI_ALTOS: Record<number, number> = {
  0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135,
  0x02C6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145,
  0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02DC: 152,
  0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156, 0x017E: 158, 0x0178: 159,
};

/**
 * Ancho del texto en EM, o `null` si trae algún carácter que no está en la tabla (y que
 * por tanto tampoco se escribiría bien en WinAnsi).
 *
 * Se exporta para `scripts/probar-contratos-tipografia.mjs`, que mide con esta misma
 * regla la separación entre los tramos que se dibujan por separado.
 */
export function anchoEnEm(texto: string, negrita: boolean): number | null {
  const tabla = negrita ? ANCHOS_NEGRITA : ANCHOS_NORMAL;
  let total = 0;
  for (const caracter of texto) {
    const punto = caracter.codePointAt(0) ?? 0;
    const codigo = (punto >= 32 && punto <= 126) || (punto >= 0xA0 && punto <= 0xFF)
      ? punto
      : WINANSI_ALTOS[punto] ?? 0;
    const ancho = codigo >= 32 ? tabla[codigo - 32] : 0;
    if (!ancho) return null;
    total += ancho;
  }
  return total / 1000;
}

// ── Motor de escritura ──────────────────────────────────────────────────────
//
// jsPDF no sabe poner media línea en negrita, así que el texto se escribe PALABRA POR
// PALABRA midiendo cada una: así el encabezado de una cláusula («PRIMERA. OBJETO.»)
// sale en negrita y el resto del párrafo continúa en la misma línea, que es como está
// en el original. Un `splitTextToSize` corriente obligaría a partir el encabezado a un
// renglón aparte y el documento dejaría de parecerse al que redactó el abogado.

type Trozo = { texto: string; negrita: boolean };

class Lienzo {
  readonly doc: jsPDF;
  y = 24;

  constructor(doc: jsPDF) { this.doc = doc; }

  nuevaPagina(): void {
    this.doc.addPage();
    this.y = Y_TOPE;
  }

  /** Salta de página si lo que viene (en mm) no cabe en lo que queda. */
  asegurar(alto: number): void {
    if (this.y + alto > Y_LIMITE) this.nuevaPagina();
  }

  /**
   * Cuánto ocupa DE VERDAD un trozo de texto, en unidades del documento.
   *
   * Se mide con la tabla de anchos de la fuente y no con `getTextWidth`, porque la de
   * jsPDF viene redondeada a dos decimales de em y aplica un kerning que el PDF no
   * lleva: medido con ella, el texto se dibuja más ancho de lo calculado y el sobrante
   * se come el espacio que separa el encabezado en negrita del cuerpo del párrafo (ver
   * «Anchos reales de la fuente», arriba). Si el texto trae algo que no está en la
   * tabla se cae a `getTextWidth`, que es una medida peor pero nunca ausente.
   */
  anchoDe(palabra: string, negrita: boolean, tam: number): number {
    const em = anchoEnEm(palabra, negrita);
    if (em !== null) return (em * tam) / this.doc.internal.scaleFactor;
    this.doc.setFont('helvetica', negrita ? 'bold' : 'normal');
    this.doc.setFontSize(tam);
    return this.doc.getTextWidth(palabra);
  }

  /**
   * Escribe un párrafo con trozos en negrita y normal, con corte de línea propio.
   * `viuda` = líneas que como mínimo han de caber antes de empezarlo en esta página.
   */
  parrafo(
    trozos: Trozo[],
    opciones: {
      tam?: number; color?: number | [number, number, number]; interlinea?: number;
      viuda?: number; sangria?: number;
      /** Milímetros que deben quedar libres SÍ O SÍ antes de empezar (encabezados). */
      reservar?: number;
    } = {},
  ): void {
    const tam = opciones.tam ?? TAM_CUERPO;
    const interlinea = opciones.interlinea ?? INTERLINEA;
    const viuda = opciones.viuda ?? 1;
    const x0 = MARGEN + (opciones.sangria ?? 0);
    const ancho = ANCHO_UTIL - (opciones.sangria ?? 0);

    // La regla de viudas no puede aplicarse a ciegas: exigirle tres renglones libres a
    // un párrafo de UNO lo empujaba a la página siguiente y partía el bloque de firma
    // («EL ARRENDATARIO» al pie de una hoja y su «Nombre: …» en la otra). Se estima
    // cuántos renglones va a ocupar y se pide como mucho eso.
    const anchoTotal = trozos.reduce((suma, t) => suma + this.anchoDe(t.texto.trim(), t.negrita, tam), 0);
    const lineasEstimadas = Math.max(1, Math.ceil(anchoTotal / ancho));
    this.asegurar(Math.max(interlinea * Math.min(viuda, lineasEstimadas), opciones.reservar ?? 0));
    if (Array.isArray(opciones.color)) this.doc.setTextColor(...opciones.color);
    else this.doc.setTextColor(opciones.color ?? 0);

    const espacio = this.anchoDe(' ', false, tam);
    let x = x0;
    let primeraDeLinea = true;

    // ── Por qué se dibuja por TRAMOS y no palabra por palabra ──
    // Las palabras se acumulan en un tramo del mismo estilo y se dibujan de una sola
    // vez. Midiendo y dibujando cada palabra por separado, los redondeos de
    // `getTextWidth` se acumulaban a lo largo del renglón y acababan pegando dos
    // palabras («DRIVEPASSCOL S.A.S.»). Dibujando el tramo entero, el espaciado interno
    // lo pone jsPDF y solo se calcula a mano el salto entre negrita y normal y el corte
    // de línea — donde un redondeo no se nota.
    let tramo = '';
    let tramoNegrita = false;
    let tramoX = x0;
    /**
     * Dibuja el tramo pendiente y deja `x` justo donde termina, MEDIDO de una vez con
     * la fuente del propio tramo. `conEspacio` añade el blanco que separa este tramo
     * del siguiente: se mide junto con el texto (y no aparte) porque medir palabra a
     * palabra acumulaba redondeos y acababa pegando la negrita con lo que seguía
     * («CUARTA.Que»).
     */
    const soltarTramo = (conEspacio: boolean) => {
      if (!tramo) return;
      this.doc.setFont('helvetica', tramoNegrita ? 'bold' : 'normal');
      this.doc.setFontSize(tam);
      this.doc.text(tramo, tramoX, this.y);
      x = tramoX + this.anchoDe(conEspacio ? `${tramo} ` : tramo, tramoNegrita, tam);
      tramo = '';
    };

    for (const trozo of trozos) {
      // El texto congelado puede traer espacios dobles (el acta los usa para separar
      // «Nombre: X  C.C. Y»); se normalizan al partir en palabras.
      for (const palabra of trozo.texto.split(/\s+/)) {
        if (!palabra) continue;
        const w = this.anchoDe(palabra, trozo.negrita, tam);
        if (!primeraDeLinea && x + espacio + w > x0 + ancho) {
          soltarTramo(false);
          this.y += interlinea;
          if (this.y > Y_LIMITE) this.nuevaPagina();
          x = x0;
          primeraDeLinea = true;
        }
        if (tramo && trozo.negrita !== tramoNegrita) {
          soltarTramo(true);   // deja `x` con el blanco de separación ya contado
        } else if (!primeraDeLinea) {
          if (tramo) tramo += ' ';
          x += espacio;
        }
        if (!tramo) { tramoX = x; tramoNegrita = trozo.negrita; }
        // Una palabra más ancha que la caja (una raya de firma larguísima, por ejemplo)
        // se imprime igual y se sale: partirla por la mitad sería peor.
        tramo += palabra;
        x += w;
        primeraDeLinea = false;
      }
    }
    soltarTramo(false);
    this.y += interlinea;
    this.doc.setTextColor(0);
  }

  /** Un renglón suelto, sin corte de línea (rótulos, notas cortas ya acotadas). */
  linea(texto: string, opciones: { tam?: number; negrita?: boolean; color?: number | [number, number, number]; centrado?: boolean } = {}): void {
    const tam = opciones.tam ?? TAM_CUERPO;
    this.asegurar(INTERLINEA);
    this.doc.setFont('helvetica', opciones.negrita ? 'bold' : 'normal');
    this.doc.setFontSize(tam);
    if (Array.isArray(opciones.color)) this.doc.setTextColor(...opciones.color);
    else this.doc.setTextColor(opciones.color ?? 0);
    if (opciones.centrado) this.doc.text(texto, MARGEN + ANCHO_UTIL / 2, this.y, { align: 'center' });
    else this.doc.text(texto, MARGEN, this.y);
    this.y += INTERLINEA;
    this.doc.setTextColor(0);
  }

  espacio(mm: number): void { this.y += mm; }
}

// ── Clasificación de las líneas del texto congelado ─────────────────────────

/** Encabezado de sección: renglón corto en versales («CONSIDERACIONES», «CLÁUSULAS»). */
function esEncabezado(linea: string): boolean {
  const t = linea.trim();
  if (!t || t.length > 110) return false;
  if (t.includes(':')) return false;          // «EL ARRENDADOR: Juan, C.C. …» es contenido
  if (t.endsWith('.')) return false;
  if (/[a-záéíóúñü]/.test(t)) return false;   // tiene minúsculas: no es un encabezado
  const letras = (t.match(/[A-ZÁÉÍÓÚÑÜ]/g) || []).length;
  return letras >= 4;                         // «C.C. 71.739.615» no es un encabezado
}

/**
 * Encabezado de cláusula al principio de un párrafo: «PRIMERA. OBJETO.»,
 * «PARÁGRAFO SEGUNDO. EXCLUSIONES QUE EL EMPRESARIO DECLARA CONOCER.».
 * Devuelve el trozo en negrita y el resto.
 */
function partirEncabezadoClausula(linea: string): Trozo[] {
  // La coma va DENTRO de la clase para que «DÉCIMA OCTAVA. MÉRITO EJECUTIVO, DOMICILIO
  // Y LEY APLICABLE.» salga entero en negrita. El punto NO está en la clase: es lo que
  // cierra cada mitad del encabezado y lo que impide que se coma el párrafo.
  const m = /^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9 (),]{2,60}\.(?:\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9 (),]{2,60}\.)?)(\s+)(.+)$/.exec(linea);
  if (!m) return [{ texto: linea, negrita: false }];
  return [{ texto: m[1], negrita: true }, { texto: ` ${m[3]}`, negrita: false }];
}

// ── Imágenes ────────────────────────────────────────────────────────────────

const FIRMA_ANCHO_MAX = 58;   // mm
const FIRMA_ALTO_MAX = 18;    // mm
/** Alto que se reserva en la copia para firma física (espacio para firmar a mano). */
const FIRMA_ALTO_PAPEL = 16;

/** Ancho máximo al que se reduce el escaneado antes de incrustarlo. Ver el comentario de memoria. */
const ESCANEO_ANCHO_PX = 1400;

type ImagenIncrustable = { dataUrl: string; ancho: number; alto: number };

/**
 * Convierte el escaneado (cuando es una imagen) en algo que jsPDF sepa incrustar.
 *
 * ⚠️ Memoria — es la lección de lib/paquete-documentos.ts y de lib/acta-servicio-pdf.ts:
 * cada imagen entra al PDF como base64 (un tercio más de peso que el binario) y se queda
 * en el documento hasta que se serializa. Por eso se reduce a `ESCANEO_ANCHO_PX` y se
 * convierte a JPEG antes de incrustarla, en vez de meter los bytes originales.
 *
 * Devuelve `null` si no se pudo decodificar (HEIC sin soporte de libheif, archivo
 * truncado…): el PDF sigue saliendo, con una nota en lugar de la imagen.
 */
async function prepararEscaneo(base64: string): Promise<ImagenIncrustable | null> {
  try {
    const original = Buffer.from(base64, 'base64');
    const buffer = await sharp(original)
      .rotate()
      .resize({ width: ESCANEO_ANCHO_PX, withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    return { dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`, ancho: meta.width, alto: meta.height };
  } catch (e) {
    console.error('[contrato-pdf] no se pudo preparar el escaneado:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Entrada ─────────────────────────────────────────────────────────────────

/** Qué se imprime. */
export type ModoContratoPdf =
  /** El expediente: texto + firmas recogidas + constancia de verificación. */
  | 'expediente'
  /** La copia del mostrador: texto con los bloques de firma EN BLANCO, para imprimir. */
  | 'papel';

export type EscaneoParaPdf = {
  mime: string;
  /** Contenido en base64. Solo se incrusta si es una imagen. */
  contenido_base64: string;
  bytes: number;
  sha256: string;
  nombre_archivo: string;
};

export type ContratoParaPdf = {
  contrato: ContratoRow;
  firmas: FirmaContratoRow[];
  /** El escaneado del mostrador, cuando lo hay y se quiere incrustar. */
  escaneo?: EscaneoParaPdf | null;
};

export type OpcionesContratoPdf = {
  modo?: ModoContratoPdf;
  /** Nombre comercial y NIT de la empresa para el membrete. */
  empresa?: { nombre?: string; nit?: string };
  /** Quién descarga (queda en el pie de la constancia). */
  generadoPara?: string;
};

// ── Construcción ────────────────────────────────────────────────────────────

function fechaHoraLegible(v: string): string {
  return String(v || '').slice(0, 16).replace('T', ' ') || '—';
}

/** Cierra una frase con punto sin duplicarlo (el motivo lo escribe una persona). */
function terminadoEnPunto(v: string): string {
  const t = String(v || '').trim();
  return t.endsWith('.') ? t : `${t}.`;
}

function pesosBytes(n: number): string {
  const kb = n / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

/**
 * Arma el PDF de un contrato a partir de sus filas congeladas.
 *
 * `async` porque puede tener que decodificar el escaneado del mostrador; cuando no lo
 * hay, no toca disco ni red: todo lo que necesita (texto, firmas, trazos en PNG) está
 * en la base.
 */
export async function construirContratoPDF(
  datos: ContratoParaPdf, opciones: OpcionesContratoPdf = {},
): Promise<jsPDF> {
  const { contrato: c, firmas } = datos;
  const modo: ModoContratoPdf = opciones.modo ?? 'expediente';
  const esPapelImpreso = modo === 'papel';
  const titulo = TITULOS_DOCUMENTO[c.tipo] || c.tipo;
  const anulado = c.estado === 'anulado';
  const firmadoEnPapel = c.via_firma === 'papel';

  const doc = new jsPDF();
  const lienzo = new Lienzo(doc);

  // ── Membrete ──
  doc.setFontSize(15); doc.setFont('helvetica', 'bold');
  doc.text(opciones.empresa?.nombre || 'DrivePass', MARGEN, 18);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(GRIS);
  if (opciones.empresa?.nit) doc.text(`NIT: ${opciones.empresa.nit}`, MARGEN, 22.5);

  doc.setFontSize(8.5); doc.setTextColor(GRIS);
  doc.text(`No. ${c.numero}${c.version > 1 ? ` · versión ${c.version}` : ''}`, MARGEN + ANCHO_UTIL, 18, { align: 'right' });
  doc.text(`Reserva #${c.reserva_id} · emitido ${fechaHoraLegible(c.created_at)}`, MARGEN + ANCHO_UTIL, 22.5, { align: 'right' });
  doc.setTextColor(0);
  doc.setDrawColor(200); doc.line(MARGEN, 25.5, MARGEN + ANCHO_UTIL, 25.5);
  lienzo.y = 32;

  // ── Banda de estado (redacción propia, fuera del cuerpo del contrato) ──
  const banda = (etiqueta: string, detalle: string, color: [number, number, number]) => {
    lienzo.linea(etiqueta, { tam: 11.5, negrita: true, color });
    if (detalle) lienzo.parrafo([{ texto: detalle, negrita: false }], { tam: 7.6, color: GRIS, interlinea: 3.4 });
    lienzo.espacio(2.5);
  };

  // Un documento anulado lleva SOLO su banda: añadirle encima «pendiente de firma» o
  // «firmado electrónicamente» confundiría el estado del que se anuló con el estado
  // actual, que es uno solo — anulado. Lo que alcanzó a firmarse consta en la
  // constancia de verificación del final.
  if (anulado) {
    banda(
      LEYENDAS.anulada,
      `Este documento se anuló el ${fechaHoraLegible(c.anulado_en)}`
      + `${c.anulado_por_nombre ? ` por ${c.anulado_por_nombre}` : ''}.`
      + `${c.motivo_anulacion ? ` Motivo: ${terminadoEnPunto(c.motivo_anulacion)}` : ''}`
      + ' Se conserva como constancia de lo que decía y de las firmas que alcanzó a recoger; no está vigente.',
      NARANJA,
    );
  } else if (esPapelImpreso) {
    banda(LEYENDAS.copiaFirmaFisica, LEYENDAS.copiaFirmaFisicaDetalle, NARANJA);
  } else if (firmadoEnPapel) {
    banda(LEYENDAS.firmadoPapel, LEYENDAS.firmadoPapelDetalle, AZUL);
  } else if (c.estado === 'firmado') {
    banda(LEYENDAS.firmadoDigital, '', VERDE);
  } else {
    banda(LEYENDAS.pendienteFirma, LEYENDAS.pendienteFirmaDetalle, NARANJA);
  }

  // ── Cuerpo: el texto CONGELADO, línea a línea ──
  const lineas = c.texto.split('\n');
  const porClave = new Map(firmas.map(f => [f.bloque, f]));
  const anclajes = anclarFirmas(c.tipo, c.texto, firmas.map(f => f.bloque));
  const inicios = new Map<number, AnclajeFirma>();
  const fines = new Map<number, AnclajeFirma>();
  for (const a of anclajes ?? []) { inicios.set(a.inicio, a); fines.set(a.fin, a); }

  for (let i = 0; i < lineas.length; i++) {
    const cruda = lineas[i];
    const linea = cruda.trim();

    // Antes de la primera línea del bloque: el trazo (o el hueco para firmar a mano).
    const abre = inicios.get(i);
    if (abre) dibujarFirmaEnBloque(lienzo, porClave.get(abre.clave), c, esPapelImpreso, abre.fin - abre.inicio + 1);

    if (i === 0) {
      // Primera línea = título del documento tal como lo escribió el abogado.
      lienzo.asegurar(14);
      lienzo.parrafo([{ texto: linea, negrita: true }], { tam: TAM_TITULO, interlinea: 5.4, viuda: 2 });
      lienzo.espacio(2);
    } else if (!linea) {
      lienzo.espacio(2.2);
    } else if (esEncabezado(linea)) {
      lienzo.espacio(1.5);
      // `reservar` y no `viuda`: un encabezado de sección ocupa UN renglón, así que la
      // estimación de líneas lo dejaría empezar al pie de la página con su contenido en
      // la siguiente («FIRMAS DE LA DEVOLUCIÓN» huérfano al final del acta).
      lienzo.parrafo([{ texto: linea, negrita: true }], { tam: TAM_SECCION, interlinea: 4.6, reservar: INTERLINEA * 4 });
    } else {
      lienzo.parrafo(partirEncabezadoClausula(linea), { viuda: MIN_LINEAS_VIUDA });
    }

    // Después de la última línea del bloque: quién firmó, cuándo y por qué vía.
    const cierra = fines.get(i);
    if (cierra) dibujarConstanciaDeBloque(lienzo, porClave.get(cierra.clave), esPapelImpreso);
  }

  // ── Apéndice de firmas cuando el texto no se pudo anclar ──
  //
  // Solo ocurre si la estructura del documento no coincide con la tabla de anclas (por
  // ejemplo, un pagaré con codeudores, que hoy no se generan). Antes que poner un trazo
  // debajo del nombre equivocado, se pintan todos aquí, rotulados.
  if (!anclajes && firmas.length > 0) {
    lienzo.espacio(4);
    lienzo.parrafo([{ texto: 'BLOQUES DE FIRMA', negrita: true }], { tam: TAM_SECCION, viuda: 2 });
    lienzo.parrafo([{
      texto: 'Las firmas de este documento se relacionan aquí, con su rótulo, porque su estructura no permitió '
        + 'situarlas dentro del texto. El rótulo de cada bloque es el que aparece en el propio documento.',
      negrita: false,
    }], { tam: 7.6, color: GRIS, interlinea: 3.4 });
    for (const f of firmas) {
      lienzo.espacio(2);
      lienzo.linea(f.etiqueta, { tam: 9, negrita: true });
      dibujarFirmaEnBloque(lienzo, f, c, esPapelImpreso);
      lienzo.linea(`${f.nombre_esperado || '—'}${f.documento_esperado ? ` · ${f.documento_esperado}` : ''}`, { tam: 8 });
      dibujarConstanciaDeBloque(lienzo, f, esPapelImpreso);
    }
  }

  // ── El escaneado del mostrador ──
  if (!esPapelImpreso && firmadoEnPapel) await seccionEscaneo(lienzo, doc, datos);

  // ── Constancia de verificación ──
  if (!esPapelImpreso) seccionConstancia(lienzo, datos, opciones);

  // ── Pie en todas las hojas ──
  const marcaPie = esPapelImpreso
    ? LEYENDAS.copiaFirmaFisica
    : anulado ? LEYENDAS.anulada
      : firmadoEnPapel ? 'Firmado en papel'
        : c.estado === 'firmado' ? 'Firmado electrónicamente' : LEYENDAS.pendienteFirma;

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(TAM_PIE); doc.setFont('helvetica', 'normal'); doc.setTextColor(140);
    doc.text(`${c.numero} · ${titulo} · ${marcaPie}`, MARGEN, ALTO_PAGINA - 8, { maxWidth: ANCHO_UTIL - 30 });
    doc.text(`Página ${i} de ${paginas}`, MARGEN + ANCHO_UTIL, ALTO_PAGINA - 8, { align: 'right' });
  }
  doc.setTextColor(0);

  return doc;
}

// ── Piezas del dibujo ───────────────────────────────────────────────────────

/**
 * El trazo de la firma —o el hueco para firmar a mano— encima de su bloque.
 *
 * `lineasBloque` son las líneas que el bloque ocupa en el texto (nombre, documento,
 * rótulo…). Se usan para RESERVAR sitio: un bloque de firma partido entre dos páginas
 * —el trazo al pie de una y el nombre de quien firma al principio de la siguiente— es
 * justo lo que no puede pasar en un contrato.
 */
function dibujarFirmaEnBloque(
  lienzo: Lienzo, firma: FirmaContratoRow | undefined, c: ContratoRow, esPapelImpreso: boolean,
  lineasBloque = 4,
): void {
  // Las líneas del bloque + la constancia de firma + un renglón de respiro.
  const reserva = INTERLINEA * (lineasBloque + 2);
  if (esPapelImpreso) {
    // Copia para firmar a mano: espacio en blanco, sin ninguna marca que pueda
    // confundirse con una firma ya puesta.
    lienzo.asegurar(FIRMA_ALTO_PAPEL + reserva);
    lienzo.espacio(FIRMA_ALTO_PAPEL);
    return;
  }

  if (!firma || !firma.firmada_en) {
    // Documento pendiente (o firmado en papel): el bloque se marca como tal. No se deja
    // un hueco mudo que pueda pasar por una firma que no se ve.
    lienzo.asegurar(reserva);
    lienzo.espacio(1.5);
    lienzo.linea(
      c.via_firma === 'papel'
        ? 'Firmado a mano — ver el escaneado registrado al final de este documento'
        : LEYENDAS.sinFirmaBloque,
      { tam: 7.6, color: c.via_firma === 'papel' ? AZUL : NARANJA },
    );
    return;
  }

  const png = validarFirmaPng(firma.firma_imagen);
  if (!png.ok) {
    lienzo.linea('(No se pudo mostrar la imagen de esta firma)', { tam: 7.6, color: GRIS });
    return;
  }
  let ancho = FIRMA_ANCHO_MAX;
  let alto = (png.alto / png.ancho) * ancho;
  if (alto > FIRMA_ALTO_MAX) {
    alto = FIRMA_ALTO_MAX;
    ancho = (png.ancho / png.alto) * alto;
  }
  // Un bloque de firma no se parte entre dos páginas: la imagen, el nombre de quien
  // firma, su documento, el rótulo y la constancia van juntos o saltan juntos.
  lienzo.asegurar(alto + reserva);
  try {
    lienzo.doc.addImage(firma.firma_imagen, 'PNG', MARGEN, lienzo.y, ancho, alto);
    // `addImage` dibuja HACIA ABAJO desde `y`, mientras que `text` toma `y` como línea
    // base. Sin este respiro de más, la firma se montaba encima del renglón siguiente
    // («Por DRIVEPASS COL S.A.S., EL AGENTE» del acta).
    lienzo.espacio(alto + 3.5);
  } catch {
    // Un data URI corrupto no puede tumbar la generación del documento entero.
    lienzo.linea('(No se pudo mostrar la imagen de esta firma)', { tam: 7.6, color: GRIS });
  }
}

/** Quién firmó ese bloque, cuándo y por qué vía. Va debajo del bloque. */
function dibujarConstanciaDeBloque(lienzo: Lienzo, firma: FirmaContratoRow | undefined, esPapelImpreso: boolean): void {
  if (esPapelImpreso) {
    lienzo.linea(`${LEYENDAS.espacioFirmaPapel}: ____________________________     Fecha: ______________`, { tam: 7.6, color: GRIS });
    return;
  }
  if (!firma || !firma.firmada_en) return;
  const via = firma.firma_metodo === 'carga' ? 'imagen de firma cargada' : 'trazo en pantalla';
  lienzo.parrafo([{
    texto: `Firmado electrónicamente el ${fechaHoraLegible(firma.firmada_en)} · confirmó llamarse `
      + `${firma.firma_nombre_confirmado || '—'} · ${firma.documento_esperado || 'sin documento registrado'} · vía ${via}.`,
    negrita: false,
  }], { tam: 7.4, color: GRIS, interlinea: 3.3 });
}

/** El escaneado del mostrador: la imagen si se puede, y siempre su ficha. */
async function seccionEscaneo(lienzo: Lienzo, doc: jsPDF, datos: ContratoParaPdf): Promise<void> {
  const c = datos.contrato;
  doc.addPage();
  lienzo.y = Y_TOPE;
  lienzo.parrafo([{ texto: 'EJEMPLAR FIRMADO A MANO (ESCANEADO)', negrita: true }], { tam: TAM_SECCION });
  lienzo.parrafo([{
    texto: `Archivo registrado el ${fechaHoraLegible(c.papel_subido_en)}`
      + `${c.papel_subido_por_nombre ? ` por ${c.papel_subido_por_nombre}` : ''}`
      + `${c.papel_nombre_archivo ? ` · «${c.papel_nombre_archivo}»` : ''}`
      + ` · ${c.papel_mime || 'archivo'} · ${pesosBytes(Number(c.papel_bytes) || 0)}`
      + ` · SHA-256 ${c.papel_sha256 || '—'}.`,
    negrita: false,
  }], { tam: 7.4, color: GRIS, interlinea: 3.3 });
  lienzo.espacio(2);

  const escaneo = datos.escaneo;
  if (!escaneo || !escaneo.contenido_base64) {
    lienzo.parrafo([{
      texto: 'El archivo escaneado se conserva en el sistema y se descarga aparte; no se incrustó en este PDF.',
      negrita: false,
    }], { tam: 8, color: GRIS });
    return;
  }
  if (escaneo.mime === 'application/pdf') {
    lienzo.parrafo([{
      texto: 'El escaneado se subió como PDF y se conserva íntegro en el sistema: se descarga como archivo aparte '
        + '(en el paquete de documentos va junto a este mismo contrato). No se incrusta aquí para no alterar sus páginas.',
      negrita: false,
    }], { tam: 8, color: GRIS });
    return;
  }

  const img = await prepararEscaneo(escaneo.contenido_base64);
  if (!img) {
    lienzo.parrafo([{
      texto: 'No se pudo mostrar la imagen del escaneado en este PDF. El archivo original se conserva en el sistema '
        + 'y se puede descargar aparte.',
      negrita: false,
    }], { tam: 8, color: NARANJA });
    return;
  }
  let ancho = ANCHO_UTIL;
  let alto = (img.alto / img.ancho) * ancho;
  const altoDisponible = Y_LIMITE - lienzo.y;
  if (alto > altoDisponible) {
    alto = altoDisponible;
    ancho = (img.ancho / img.alto) * alto;
  }
  try {
    doc.addImage(img.dataUrl, 'JPEG', MARGEN, lienzo.y, ancho, alto);
    lienzo.espacio(alto + 2);
  } catch {
    lienzo.parrafo([{ texto: 'No se pudo incrustar la imagen del escaneado en este PDF.', negrita: false }], { tam: 8, color: NARANJA });
  }
}

/** La constancia de verificación: qué comprueba el sistema y qué dio. */
function seccionConstancia(lienzo: Lienzo, datos: ContratoParaPdf, opciones: OpcionesContratoPdf): void {
  const c = datos.contrato;
  const firmadoEnPapel = c.via_firma === 'papel';

  lienzo.espacio(4);
  lienzo.asegurar(40);
  lienzo.doc.setDrawColor(200);
  lienzo.doc.line(MARGEN, lienzo.y - 2, MARGEN + ANCHO_UTIL, lienzo.y - 2);
  lienzo.espacio(2);
  lienzo.parrafo([{ texto: LEYENDAS.constanciaTitulo, negrita: true }], { tam: TAM_SECCION, viuda: 2 });

  lienzo.parrafo([{ texto: LEYENDAS.constanciaQueEs, negrita: false }], { tam: 7.4, color: GRIS, interlinea: 3.3 });
  lienzo.parrafo(
    [{ texto: firmadoEnPapel ? LEYENDAS.constanciaPapel : LEYENDAS.constanciaNoEsFirmaDigital, negrita: false }],
    { tam: 7.4, color: GRIS, interlinea: 3.3 },
  );
  lienzo.espacio(1.5);

  lienzo.linea(`Documento: ${c.numero} · versión ${c.version} · estado «${c.estado}».`, { tam: 8 });
  lienzo.parrafo([{ texto: `Huella SHA-256 del texto: ${huellaDocumento(c)}`, negrita: false }], { tam: 7.4, color: GRIS, interlinea: 3.3 });

  const problemas: string[] = [];

  if (firmadoEnPapel) {
    const v = verificarSelloPapel(c);
    if (v && v.ok) {
      lienzo.linea('Sello del escaneado: VERIFICADO. El archivo guardado corresponde a este texto y no ha cambiado.', { tam: 8, color: VERDE });
    } else if (v) {
      problemas.push(`Escaneado firmado a mano: ${v.motivo}.`);
    }
  }

  const puestas = datos.firmas.filter(f => !!f.firmada_en);
  if (puestas.length === 0 && !firmadoEnPapel) {
    lienzo.linea('Este documento no tiene ninguna firma recogida.', { tam: 8, color: NARANJA });
  }
  for (const f of puestas) {
    const v = verificarSelloFirma(c, f);
    if (v.ok) {
      lienzo.parrafo([{
        texto: `${f.etiqueta}: sello VERIFICADO · firmada el ${fechaHoraLegible(f.firmada_en)} por `
          + `${f.firma_nombre_confirmado || '—'}.`,
        negrita: false,
      }], { tam: 7.8, color: VERDE, interlinea: 3.4 });
    } else {
      problemas.push(`${f.etiqueta}: ${v.motivo}.`);
    }
  }

  if (problemas.length > 0) {
    lienzo.espacio(2);
    lienzo.linea('ADVERTENCIA: LA VERIFICACIÓN NO PASÓ', { tam: 10, negrita: true, color: NARANJA });
    lienzo.parrafo([{
      texto: 'El sistema no puede confirmar que este documento siga igual que cuando se firmó. No lo des por bueno '
        + 'sin revisarlo. Detalle:',
      negrita: false,
    }], { tam: 7.8, color: NARANJA, interlinea: 3.4 });
    for (const p of problemas) {
      lienzo.parrafo([{ texto: `- ${p}`, negrita: false }], { tam: 7.8, color: NARANJA, interlinea: 3.4, sangria: 3 });
    }
  }

  lienzo.espacio(2);
  lienzo.parrafo([{
    // Hora LOCAL, con el mismo formato que las fechas de firma del propio documento:
    // un PDF que dijera la hora en UTC al lado de firmas en hora de Colombia parecería
    // generado antes de firmarse.
    texto: `PDF generado el ${ahoraLocalContrato().slice(0, 16)}`
      + `${opciones.generadoPara ? ` para ${opciones.generadoPara}` : ''}`
      + ' a partir del texto congelado en el sistema. Regenerar este PDF no vuelve a redactar el documento: el texto '
      + 'es el mismo que se firmó.',
    negrita: false,
  }], { tam: 7, color: GRIS, interlinea: 3.2 });
}

// ── Salida ──────────────────────────────────────────────────────────────────

/**
 * El PDF listo para responder desde una ruta de API.
 *
 * Devuelve el `ArrayBuffer` crudo de jsPDF, sin envolverlo: ya es un `BodyInit`
 * válido, así que `new NextResponse(pdf)` lo responde tal cual y no se copia el
 * documento entero (mismo criterio que `actaPDFBuffer`).
 */
export async function contratoPDFBuffer(datos: ContratoParaPdf, opciones: OpcionesContratoPdf = {}): Promise<ArrayBuffer> {
  const doc = await construirContratoPDF(datos, opciones);
  return doc.output('arraybuffer');
}

/**
 * Nombre de archivo del PDF, saneado a `[A-Za-z0-9._-]`.
 *
 * Ese alfabeto no es cosmético: el valor viaja en `Content-Disposition`, donde una
 * comilla o un salto de línea permitirían cerrar el valor e inyectar cabeceras. Mismo
 * criterio que `nombreArchivoZip` (lib/paquete-documentos.ts).
 */
export function nombreArchivoContrato(c: Pick<ContratoRow, 'numero' | 'tipo'>, modo: ModoContratoPdf = 'expediente'): string {
  const base = String(c.numero || c.tipo || 'contrato').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${base}${modo === 'papel' ? '-para-firmar' : ''}.pdf`;
}
