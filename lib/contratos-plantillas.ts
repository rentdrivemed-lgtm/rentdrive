// ── Las seis plantillas de los contratos digitales ──────────────────────────
//
// ⚠️ ARCHIVO GENERADO A PARTIR DE LOS ORIGINALES DEL ABOGADO, palabra por palabra.
// El texto legal NO se reescribe, no se resume y no se "mejora": lo único que
// cambia son las interpolaciones `${…}`, que corresponden a los datos de cada
// operación. Si hay que corregir una cláusula, se corrige acá con el texto exacto
// que entregue el abogado.
//
// DÓNDE ESTÁN LOS ORIGINALES (.docx) y a qué función corresponde cada uno:
//
//     Desktop/DrivePass - Documentación Maestra/02_Legal/Contratos/
//       · Contrato_Agencia_Comercial.docx        → contratoAgencia()
//       · Otrosi_Agencia_Comercial.docx          → otrosiAgencia()
//       · Contrato_Arrendamiento_Vehiculo.docx   → contratoArrendamiento()
//       · Otrosi_Arrendamiento.docx              → otrosiArrendamiento()
//       · Pagare_y_Carta_de_Instrucciones.docx   → pagare()
//       · Acta_Entrega_y_Devolucion.docx         → actaEntregaDevolucion()
//
// El `00_Indice_Contratos.md` de esa carpeta guarda la correspondencia y el resultado
// de la última verificación.
//
// VERIFICADO el 21 de septiembre de 2026 contra esos seis originales, en las dos
// direcciones (que lo que dice el código esté en el documento, y que no haya texto en
// el documento que el código no cubra): 113 fragmentos literales comparados, CERO
// divergencias. No se modificó ninguna plantilla porque ya coincidían palabra por
// palabra — incluidas la escala de comisión, las 18 filas del inventario de estado y
// los 7 conceptos documentales del acta.
//
// ⚠️ Los contratos de VINCULACIÓN (los que se firman al crear la cuenta) NO están en
// este archivo ni entre esos seis originales: viven en ./contratos-vinculacion-texto.ts
// y su texto sigue siendo un borrador del equipo, pendiente de revisión legal.
//
// Cada `${…}` que se ve en el texto es, literalmente, la lista de lo que es
// VARIABLE. Todo lo demás es fijo a propósito (ver el reporte de la fase 1):
// entre otras cosas quedaron fijas la ciudad de las cláusulas de jurisdicción
// (Medellín), la política de desistimiento (50 %), el kilometraje ilimitado, los
// plazos de días hábiles y todas las citas de artículos de ley.
//
// ⚠️ Módulo PURO (sin BD, sin `fs`): lo puede importar tanto una ruta de API como
// una pantalla 'use client'. Quien lee la base y arma `DatosContrato` es
// lib/contratos.ts.

import {
  anioEnLetras, cantidadEnLetras, fechaEnLetras, fechaEnLetrasSinAnio, fechaFirmaEnLetras,
  fechaFirmaNumerica, fechaNumerica, horaEnLetras, montoEnLetras, pesos, porcentajeEnLetras,
  partesFecha,
} from './contratos-texto';
import {
  CLAUSULA_PENAL_AGENCIA_PCT, CLAUSULA_PENAL_ARRENDAMIENTO_PCT, COMISION_PCT_MAX, COMISION_PCT_MIN,
  ESCALA_COMISION_AGENCIA, PENA_MORA_PCT, type TramoComision,
} from './contratos-calculo';
import {
  CONCEPTOS_DOCUMENTOS_ACTA, ITEMS_ESTADO_VEHICULO, PENDIENTE, esPendiente,
  type DatosContrato, type PolizaContrato, type TipoDocumento,
} from './contratos-datos';

/** Ejemplares que se firman («en dos (2) ejemplares del mismo tenor y valor»). */
export const EJEMPLARES = 2;

// ── Piezas que dependen de los datos ────────────────────────────────────────

/** «treinta (30) días» / «un (1) día». */
function diasTexto(dias: number): string {
  return `${cantidadEnLetras(dias)} ${dias === 1 ? 'día' : 'días'}`;
}

/**
 * Artículo del lugar de entrega/restitución: «en **la** Calle 42 A No. 68 A 10»,
 * «en **el** Aeropuerto JMC». Se decide por la primera palabra de la dirección
 * porque es lo único que hay; cualquier cosa que no sea una vía femenina va con
 * «el». Se mantiene acotado a esta lista a propósito: es texto de una cláusula.
 */
const VIAS_FEMENINAS = ['calle', 'carrera', 'avenida', 'transversal', 'circular', 'diagonal', 'autopista', 'variante', 'vía'];
function conArticulo(lugar: string): string {
  const primera = String(lugar || '').trim().split(/\s+/)[0]?.toLowerCase().replace(/\.$/, '') ?? '';
  return `${VIAS_FEMENINAS.includes(primera) ? 'la' : 'el'} ${lugar}`;
}

/**
 * Fecha que PUEDE no existir todavía (las de la póliza, la vigencia de la
 * licencia). Si no es una fecha ISO válida se devuelve tal cual —normalmente la
 * marca `PENDIENTE`—, en vez de reventar la generación del documento: el hueco
 * queda visible y `faltantesDe()` lo reporta.
 */
function fechaNumericaOTexto(v: string): string {
  try { return fechaNumerica(v); } catch { return String(v ?? ''); }
}
function fechaEnLetrasOTexto(v: string): string {
  try { return fechaEnLetras(v); } catch { return String(v ?? ''); }
}
/** Igual que las fechas, pero para la hora de entrega/restitución de la reserva. */
function horaOTexto(v: string): string {
  try { return horaEnLetras(v); } catch { return String(v ?? ''); }
}

// ── Cifras que pueden no existir ────────────────────────────────────────────
//
// Cero NO es un monto ni una cantidad: cuando el dato no está en la base (el valor
// asegurado de la carátula, por ejemplo), `montoEnLetras(0)` imprime «CERO PESOS ($0)»
// y eso, en un contrato, no deja un hueco: AFIRMA que el vehículo está asegurado por
// nada. Lo mismo vale para «modelo cero (0)». Cuando la cifra falta sale la raya para
// diligenciar, exactamente igual que los datos de la póliza, y `faltantesDe()` la
// sigue reportando como campo pendiente.

/** Un monto que puede faltar: «CIENTO OCHO MILLONES… ($108.100.000)» o la raya. */
function montoOPendiente(v: number): string {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? montoEnLetras(n) : PENDIENTE;
}

/** El modelo del vehículo en letras y cifra: «dos mil veintiséis (2026)» o la raya. */
function anioOPendiente(v: number): string {
  const n = Number(v);
  return Number.isInteger(n) && n > 1900 ? anioEnLetras(n) : PENDIENTE;
}

/** Una cantidad suelta del acta (el modelo, el número de fotografías) o la raya. */
function cifraOPendiente(v: number): string {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? String(n) : PENDIENTE;
}

// ── Grupos de datos: o van completos, o no va ninguno ───────────────────────
//
// Los datos de la póliza se citan SIEMPRE juntos —número, aseguradora, NIT, vigencia—
// dentro de una misma declaración. Hoy la base solo conoce uno de ellos (la fecha de
// vencimiento, que sale de `vehiculos.documentos.poliza.vence`), y llenar únicamente
// ese producía frases a medio hacer: «amparado por la póliza número ________ expedida
// por ________, NIT ________, con vigencia entre ________ y el 31 de marzo de 2027».
// Una frase así se lee peor que una vacía del todo: parece un descuido al diligenciar
// y no un dato que falta, y presenta como verificada una póliza de la que no se sabe
// ni el número.
//
// Regla: si al grupo le falta una pieza, el grupo entero sale en blanco. La que sí se
// conoce no se pierde —sigue en el snapshot de datos y en `faltantesDe()`—, solo no se
// imprime sola. En cuanto la póliza esté completa, el grupo se imprime completo.
//
// Los renglones de datos del ACTA (placa/marca/línea/modelo/color/motor/chasis, o el
// número/categoría/vigencia de la licencia) NO siguen esta regla a propósito: el acta
// es un formato que se diligencia a mano en el mostrador —lleva su lista de chequeo y
// sus renglones en blanco—, allí un campo rotulado y vacío es lo que se espera, y
// borrar la placa del vehículo del que trata el acta sería destruirla.

const POLIZA_SIN_DATOS: PolizaContrato = {
  numero: PENDIENTE, aseguradora: PENDIENTE, aseguradoraNit: PENDIENTE,
  expedidaEl: PENDIENTE, vigenciaDesde: PENDIENTE, vigenciaHasta: PENDIENTE,
  codigoClausulado: PENDIENTE, notaTecnica: PENDIENTE, deducible: PENDIENTE,
};

function polizaImpresa(p: PolizaContrato): PolizaContrato {
  const completa = [
    p.numero, p.aseguradora, p.aseguradoraNit, p.expedidaEl,
    p.vigenciaDesde, p.vigenciaHasta, p.codigoClausulado, p.notaTecnica, p.deducible,
  ].every(v => !esPendiente(v));
  return completa ? p : POLIZA_SIN_DATOS;
}

/** Un tramo de la escala, con la redacción exacta de la cláusula cuarta. */
function tramoTexto(t: TramoComision): string {
  if (t.hasta === null) return `${porcentajeEnLetras(t.pct)} cuando sea de ${diasTexto(t.desde)} o más`;
  if (t.desde === t.hasta) return `${porcentajeEnLetras(t.pct)} cuando el arrendamiento sea por ${diasTexto(t.desde)}`;
  return `${porcentajeEnLetras(t.pct)} cuando comprenda de ${cantidadEnLetras(t.desde)} a ${diasTexto(t.hasta)}`;
}

/**
 * La ESCALA de comisión de la cláusula cuarta del contrato de agencia, escrita
 * desde `ESCALA_COMISION_AGENCIA` para que el contrato marco y el otrosí que
 * aplica un tramo no puedan decir cosas distintas. `scripts/probar-contratos.ts`
 * comprueba que el texto generado sea idéntico, palabra por palabra, al que
 * redactó el abogado.
 */
export function escalaComisionTexto(): string {
  const tramos = ESCALA_COMISION_AGENCIA.map(tramoTexto);
  const ultimo = tramos[tramos.length - 1];
  const previos = tramos.slice(0, -1);
  return `Su porcentaje fluctúa entre el ${porcentajeEnLetras(COMISION_PCT_MIN)} y el ${porcentajeEnLetras(COMISION_PCT_MAX)} según el número de días del respectivo arrendamiento, conforme a la siguiente escala: ${previos.join('; ')}; y ${ultimo}.`;
}

/** Cláusula segunda del otrosí de arrendamiento: plazo, entrega y restitución. */
export function plazoEntregaRestitucion(d: DatosContrato): string {
  const { entrega, restitucion } = d.operacion;
  const horaFinal = entrega.hora === restitucion.hora ? 'a la misma hora' : `a ${horaOTexto(restitucion.hora)}`;
  const lugares = entrega.lugar === restitucion.lugar
    ? `Tanto la entrega como la restitución se efectuarán en ${conArticulo(entrega.lugar)}.`
    : `La entrega se efectuará en ${conArticulo(entrega.lugar)} y la restitución en ${conArticulo(restitucion.lugar)}.`;
  return `El plazo de la presente operación es de ${diasTexto(d.derivados.dias)}, contado${d.derivados.dias === 1 ? '' : 's'} desde el ${fechaEnLetras(entrega.fecha)} a ${horaOTexto(entrega.hora)}, hora en que se verifica la entrega, hasta el ${fechaEnLetras(restitucion.fecha)} ${horaFinal}, oportunidad en la cual EL ARRENDATARIO restituirá EL VEHÍCULO. ${lugares}`;
}

/** «a los treinta (30) días pactados» / «a un (1) día pactado». */
function diasPactados(dias: number): string {
  return dias === 1 ? `a ${cantidadEnLetras(1)} día pactado` : `a los ${cantidadEnLetras(dias)} días pactados`;
}

/**
 * Cláusula tercera del otrosí de arrendamiento: canon y forma de pago.
 *
 * DOS REDACCIONES según el IVA esté activo o no. Sin IVA no se puede dejar la
 * frase colgada de «más el impuesto sobre las ventas de $0»: la variante lo dice
 * de frente, con las mismas palabras condicionales que ya usa la cláusula quinta
 * del contrato marco («cuando este resulte aplicable»).
 */
export function canonOtrosiArrendamiento(d: DatosContrato): string {
  const { canonDiario, canonTotal, ivaCanon, totalArrendatario, iva, dias } = d.derivados;
  if (!iva.activo) {
    return `El canon diario de arrendamiento es de ${montoEnLetras(canonDiario)} moneda corriente. Por consiguiente, el canon correspondiente ${diasPactados(dias)} asciende a ${montoEnLetras(canonTotal)} moneda corriente, suma que no se adiciona con el impuesto sobre las ventas por no resultar aplicable a esta operación y que constituye el valor total a cargo de EL ARRENDATARIO.`;
  }
  return `El canon diario de arrendamiento es de ${montoEnLetras(canonDiario)} moneda corriente, antes de impuesto sobre las ventas. Por consiguiente, el canon correspondiente ${diasPactados(dias)} asciende a ${montoEnLetras(canonTotal)} moneda corriente, suma a la que se adiciona el impuesto sobre las ventas a la tarifa del ${porcentajeEnLetras(iva.tarifa)}, esto es, ${montoEnLetras(ivaCanon)}, para un valor total a cargo de EL ARRENDATARIO de ${montoEnLetras(totalArrendatario)} moneda corriente.`;
}

/** Un conductor autorizado, identificado como lo hacen los demás documentos. */
function conductorIdentificado(c: { nombre: string; documento: string }): string {
  return `${c.nombre}, identificado con la cédula de ciudadanía número ${c.documento}`;
}

/**
 * Cláusula quinta del otrosí de arrendamiento.
 * ⚠️ La variante en plural NO viene del abogado: hoy la plataforma no guarda
 * conductores adicionales (ver `CAMPOS_CONTRATO`), así que en la práctica nunca
 * se usa. Queda redactada para la fase en que existan, y debe revisarla el
 * abogado antes de usarse de verdad.
 */
export function conductoresOtrosiArrendamiento(d: DatosContrato): string {
  const extra = d.operacion.conductores;
  if (extra.length === 0) return `Para esta operación el único conductor autorizado es EL ARRENDATARIO, ${d.cliente.nombre}.`;
  const lista = extra.map(conductorIdentificado);
  const unidos = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join('; ')} y ${lista[lista.length - 1]}`;
  return `Para esta operación los conductores autorizados son EL ARRENDATARIO, ${d.cliente.nombre}, y ${unidos}.`;
}

/** «desde el once (11) de septiembre hasta el once (11) de octubre de dos mil veintiséis (2026)». */
function rangoFechas(desde: string, hasta: string): string {
  const mismoAnio = partesFecha(desde).anio === partesFecha(hasta).anio;
  const inicio = mismoAnio ? fechaEnLetrasSinAnio(desde) : fechaEnLetras(desde);
  return `desde el ${inicio} hasta el ${fechaEnLetras(hasta)}`;
}

/**
 * Cláusula segunda del otrosí de agencia: la operación que se documenta.
 * Empieza en «contrato de arrendamiento…» porque el encabezado de la cláusula
 * («EL AGENTE celebró, en nombre y representación de EL EMPRESARIO,») es fijo y
 * vive en la plantilla.
 */
export function operacionOtrosiAgencia(d: DatosContrato): string {
  const { canonDiario, canonTotal, ivaCanon, iva, dias } = d.derivados;
  const antesDeIva = iva.activo ? ' antes de impuesto sobre las ventas' : '';
  const masIva = iva.activo ? `, más el impuesto sobre las ventas de ${montoEnLetras(ivaCanon)}` : '';
  return `contrato de arrendamiento de EL VEHÍCULO con ${d.cliente.nombre}, identificado con la ${d.cliente.tipoDocumento} número ${d.cliente.documento}, por un plazo de ${diasTexto(dias)} contados ${rangoFechas(d.operacion.entrega.fecha, d.operacion.restitucion.fecha)}, con un canon diario de ${montoEnLetras(canonDiario)}${antesDeIva}, para un canon total de ${montoEnLetras(canonTotal)} moneda corriente${masIva}, y kilometraje ${d.operacion.kilometraje}.`;
}

/** Cláusula tercera del otrosí de agencia: la comisión, según el tramo de la escala. */
export function comisionOtrosiAgencia(d: DatosContrato): string {
  const { dias, comisionPct, comisionValor, tramoComision, iva } = d.derivados;
  const antesDeIva = iva.activo ? ' antes de impuesto sobre las ventas' : '';
  const masIva = iva.activo ? ', más el impuesto sobre las ventas que sobre ella se cause a la tarifa vigente' : '';
  return `Como quiera que el arrendamiento comprende ${diasTexto(dias)}, resulta aplicable el ${tramoComision.ordinal} tramo de la escala prevista en la cláusula cuarta de EL CONTRATO, esto es, el ${porcentajeEnLetras(comisionPct)} del canon efectivamente recaudado${antesDeIva}. En consecuencia, la comisión de EL AGENTE por esta operación asciende a ${montoEnLetras(comisionValor)} moneda corriente${masIva}.`;
}

/** Cláusula cuarta del otrosí de agencia: liquidación y giro al propietario. */
export function liquidacionOtrosiAgencia(d: DatosContrato): string {
  const { netoPropietario, iva } = d.derivados;
  if (!iva.activo) {
    return `EL AGENTE recaudará de EL ARRENDATARIO el canon, deducirá su comisión y girará a EL EMPRESARIO el saldo resultante, que asciende a ${montoEnLetras(netoPropietario)} moneda corriente.`;
  }
  return `EL AGENTE recaudará de EL ARRENDATARIO el canon y el impuesto sobre las ventas, deducirá su comisión y el impuesto que sobre ella se cause, y girará a EL EMPRESARIO el saldo resultante, que en cuanto al canon asciende a ${montoEnLetras(netoPropietario)} moneda corriente, junto con el impuesto sobre las ventas recaudado.`;
}

/** Líneas de conductores autorizados del acta (una por conductor). */
export function conductoresActa(d: DatosContrato): string {
  const extra = d.operacion.conductores;
  if (extra.length === 0) return 'Conductor autorizado: no se autorizan conductores distintos de EL ARRENDATARIO.';
  return extra
    .map(c => `Conductor autorizado: ${c.nombre}, C.C. ${c.documento}, licencia No. ${c.licencia.numero}, categoría ${c.licencia.categoria}, vigente hasta ${fechaNumericaOTexto(c.licencia.vigenciaHasta)}.`)
    .join('\n');
}

/** Filas de una tabla del acta: el ítem y su renglón en blanco para entrega/devolución. */
export function filasChecklist(items: readonly string[]): string {
  return items.map(i => `${i}\n`).join('\n');
}

/**
 * Bloques de codeudores solidarios del pagaré.
 *
 * Si no hay codeudores NO se imprime el bloque vacío: la carta de instrucciones
 * declara que «todos los demás campos […] quedan diligenciados al momento de la
 * firma», así que dejar un «CODEUDOR SOLIDARIO / Nombre: ______» en blanco haría
 * que el título se contradijera a sí mismo.
 */
export function codeudoresPagare(d: DatosContrato): string {
  return d.operacion.conductores
    .map(c => `\n\nCODEUDOR SOLIDARIO\nNombre: ${c.nombre}\nC.C. ${c.documento}`)
    .join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CONTRATO DE AGENCIA COMERCIAL (marco DrivePass ↔ propietario)
// ═══════════════════════════════════════════════════════════════════════════
export function contratoAgencia(d: DatosContrato): string {
  return `CONTRATO DE AGENCIA COMERCIAL PARA LA PROMOCIÓN Y EXPLOTACIÓN DEL ARRENDAMIENTO DE VEHÍCULO AUTOMOTOR
Entre los suscritos, a saber: ${d.propietario.nombre}, mayor de edad, vecino de ${d.propietario.ciudad}, identificado con ${d.propietario.articulo} ${d.propietario.tipoDocumento} número ${d.propietario.documento}, quien obra en nombre propio y en su condición de propietario del vehículo objeto de este negocio, y a quien en lo sucesivo se denominará EL EMPRESARIO; y ${d.agente.razonSocial}, sociedad por acciones simplificada identificada con el NIT ${d.agente.nit}, con domicilio principal en ${d.agente.domicilio}, dirección en la ${d.agente.direccion} y correo electrónico ${d.agente.correo}, representada legalmente por ${d.agente.representante}, mayor de edad, identificado con la cédula de ciudadanía número ${d.agente.representanteCedula}, en su calidad de representante legal principal inscrito en el registro mercantil, a quien en lo sucesivo se denominará EL AGENTE, hemos convenido celebrar el CONTRATO DE AGENCIA COMERCIAL que se rige por las cláusulas que más adelante se consignan, previas las siguientes
CONSIDERACIONES
PRIMERA. Que EL EMPRESARIO es propietario del vehículo automotor de placas ${d.vehiculo.placa}, asegurado en su nombre por un valor de ${montoOPendiente(d.vehiculo.valorAsegurado)} moneda corriente, cuyas demás características de marca, línea, modelo, número de motor, número de chasis y color se consignan en el Anexo Técnico que hace parte integrante de este contrato, bien que en lo sucesivo se denominará EL VEHÍCULO.
SEGUNDA. Que EL AGENTE es una sociedad comercial cuyo objeto social principal comprende el alquiler y el arrendamiento de vehículos automotores, actividad que ejerce de manera profesional e independiente, con organización, personal, canales de promoción y base de clientes propios.
TERCERA. Que EL EMPRESARIO aspira a obtener el aprovechamiento económico de EL VEHÍCULO mediante su arrendamiento a terceros, pero carece de la estructura comercial que se requiere para promover ese negocio de manera estable y continuada.
CUARTA. Que, como quiera que EL AGENTE dispone precisamente de esa estructura, las partes encontraron en la agencia comercial regulada por los artículos 1317 y siguientes del Código de Comercio el tipo contractual que mejor se acomoda a sus intereses, de suerte que EL AGENTE promoverá y explotará el negocio por cuenta y en nombre de EL EMPRESARIO.
QUINTA. Que la explotación de EL VEHÍCULO supone que este permanezca amparado, sin interrupción, por una póliza de seguro de automóviles cuya destinación declarada del riesgo corresponda al alquiler o arrendamiento a terceros, amparo que EL AGENTE contrató y paga en su condición de tomador, razón por la cual el alcance de sus obligaciones se define en función de las eventualidades y de los montos que esa póliza reconoce, según los amparos que aparezcan contratados en la carátula y con sujeción al clausulado que la gobierna.
SEXTA. Que las condiciones económicas y operativas de cada arrendamiento difieren según el cliente, el plazo y la tarifa, de modo que las partes convinieron que este documento fije el marco general de la relación y que las particularidades de cada operación se consignen en órdenes de servicio y en otrosí.
SÉPTIMA. Que antes de suscribir este documento las partes examinaron la carátula de la póliza número ${d.poliza.numero}, expedida por ${d.poliza.aseguradora} el ${fechaNumericaOTexto(d.poliza.expedidaEl)}, junto con el clausulado que la rige, correspondiente al Seguro de Autos Plan Utilitarios y Pesados identificado con el código ${d.poliza.codigoClausulado} y la nota técnica ${d.poliza.notaTecnica}, y advirtieron que ese contrato de seguro no ampara la totalidad de los riesgos que la explotación de EL VEHÍCULO comporta, pues, como se lo permite el artículo 1056 del Código de Comercio, el asegurador delimitó a su arbitrio los riesgos que asume. Entre las eventualidades que dejó por fuera figura, con particular incidencia para este negocio, la pérdida causada directa o indirectamente por estafa, abuso de confianza o cualquier otro delito contra el patrimonio económico, salvo el hurto cuando ese amparo aparezca contratado.
OCTAVA. Que, como el riesgo así excluido permanece radicado en cabeza de EL EMPRESARIO por ser este el titular del interés asegurable, las partes dejan constancia de que aquel conserva la facultad de constituir, por su cuenta, los seguros y las garantías que estime necesarios para precaverlo, sin que su decisión de hacerlo o de abstenerse altere el reparto de responsabilidades que aquí se conviene.
En consecuencia, las partes acuerdan las siguientes
CLÁUSULAS
PRIMERA. OBJETO. EL AGENTE asume, de manera independiente y estable, el encargo de promover y explotar el negocio de arrendamiento de EL VEHÍCULO por cuenta y en nombre de EL EMPRESARIO. Dicho encargo comprende la consecución de clientes, la verificación del perfil del arrendatario y de los conductores autorizados, la celebración de los contratos de arrendamiento en representación de EL EMPRESARIO, la entrega y el recibo del bien, el recaudo del canon y la exigencia de las garantías previstas en este documento. Dado que EL AGENTE desarrolla esa labor con organización, personal y recursos propios y bajo su exclusivo riesgo, entre las partes no surge relación laboral, societaria ni de subordinación de ninguna clase.
SEGUNDA. RAMO, TERRITORIO, FACULTADES Y DURACIÓN. Con el fin de satisfacer lo que exige el artículo 1320 del Código de Comercio, las partes precisan los elementos del encargo en los siguientes términos. El ramo sobre el que versa la actividad de EL AGENTE es el arrendamiento de vehículos automotores sin conductor. El territorio comprende el municipio de Medellín y los demás municipios del Valle de Aburrá, y se extiende al resto del país dentro de los límites de cobertura que fije la póliza vigente. Las facultades conferidas le permiten promover el negocio, seleccionar y verificar al arrendatario, celebrar y suscribir en nombre y representación de EL EMPRESARIO los contratos de arrendamiento y sus otrosí, firmar las actas de entrega y de devolución, recaudar el canon y el depósito de garantía e imputar este último conforme a la cláusula octava, exigir la restitución del bien, constituir apoderados judiciales y extrajudiciales y formular las denuncias o querellas a que haya lugar. El término de duración es de un (1) año contado desde la fecha de suscripción y se prorroga automática y sucesivamente por períodos iguales, salvo que alguna de las partes avise por escrito su intención de no prorrogarlo con una antelación no inferior a treinta (30) días calendario. Por último, las partes conocen que la misma norma prevé la inscripción de este contrato en el registro mercantil y declaran que tal formalidad no condiciona su existencia ni su validez, sino su oponibilidad frente a terceros de buena fe exenta de culpa, según lo dispone el artículo 901 del Código de Comercio. En consecuencia, convienen que la inscripción sea facultativa y que EL AGENTE pueda adelantarla en cualquier tiempo, con cargo a EL EMPRESARIO, cuando lo estime conveniente para la defensa de sus derechos.
TERCERA. EXCLUSIVIDAD. Mientras este contrato se encuentre vigente, EL EMPRESARIO se abstendrá de arrendar EL VEHÍCULO por sí mismo o por interpuesta persona, y tampoco encomendará su promoción a terceros dentro del territorio señalado en la cláusula anterior. De suerte que, si llegare a celebrar directamente el negocio o lo celebrare por conducto distinto de EL AGENTE, este conservará íntegro su derecho a la comisión, tal como lo autoriza el artículo 1322 del Código de Comercio.
CUARTA. COMISIÓN. La gestión de EL AGENTE se remunera con una comisión que se liquida sobre el canon efectivamente recaudado en cada arrendamiento, antes de impuesto sobre las ventas, a la que se adiciona el impuesto sobre las ventas que resulte aplicable. ${escalaComisionTexto()} El porcentaje que corresponda a cada operación se consignará en la orden de servicio respectiva y en ningún caso podrá ubicarse por fuera de ese rango. La comisión se causa con el recaudo del canon, y EL AGENTE queda facultado desde ahora para descontarla del valor recaudado antes de girar el saldo.
QUINTA. RECAUDO, LIQUIDACIÓN Y RENDICIÓN DE CUENTAS. EL AGENTE recaudará en nombre de EL EMPRESARIO el canon de cada arrendamiento y, previa deducción de su comisión y de los gastos que este contrato pone a cargo de aquel, girará el saldo a la cuenta bancaria que EL EMPRESARIO le indique por escrito, dentro de los cinco (5) días hábiles siguientes a la restitución de EL VEHÍCULO. Dentro de los diez (10) primeros días de cada mes rendirá una relación detallada y justificada de las operaciones del período anterior, en la que discriminará los arrendamientos celebrados, los días arrendados, el canon recaudado, la comisión deducida, los gastos imputados y el saldo girado. En la misma oportunidad informará las condiciones del mercado que resulten útiles para valorar la conveniencia de los negocios, como lo ordena el artículo 1321 del Código de Comercio.
SEXTA. LA PÓLIZA DE SEGURO, SU ALCANCE Y LOS AMPAROS ADICIONALES. EL VEHÍCULO se encuentra amparado por la póliza número ${d.poliza.numero} expedida por ${d.poliza.aseguradora}, NIT ${d.poliza.aseguradoraNit}, cuya vigencia corre entre el ${fechaNumericaOTexto(d.poliza.vigenciaDesde)} y el ${fechaNumericaOTexto(d.poliza.vigenciaHasta)}, y en la cual EL AGENTE figura como tomador y responsable del pago de la prima, mientras que EL EMPRESARIO figura como asegurado respecto de EL VEHÍCULO. Se trata, por consiguiente, de un seguro contratado por cuenta ajena de los previstos en el artículo 1039 del Código de Comercio, de suerte que a EL AGENTE le incumben las obligaciones propias del tomador y a EL EMPRESARIO le corresponde el derecho a la prestación asegurada. El valor de la prima lo asume EL AGENTE en su condición de tomador y se entiende retribuido con la comisión pactada en la cláusula cuarta, salvo que la orden de servicio disponga otra cosa. Las obligaciones que este contrato radica en EL AGENTE se circunscriben a las eventualidades amparadas y a los montos asegurados que la póliza establece, de manera que ninguna eventualidad excluida o no prevista en ella, ni suma alguna que exceda el valor asegurado, compromete su responsabilidad, conforme lo desarrolla la cláusula séptima. Con el fin de que EL EMPRESARIO ejerza con pleno conocimiento la explotación del bien, los parágrafos siguientes precisan el alcance del amparo, sus principales exclusiones y las cargas que de él se derivan.
PARÁGRAFO PRIMERO. CONOCIMIENTO Y ACEPTACIÓN DE LAS CONDICIONES DE LA PÓLIZA. EL EMPRESARIO declara que recibe en este acto copia de la carátula y del clausulado que la gobierna, que los leyó y comprendió, y que conoce los amparos contratados, las exclusiones que los delimitan, los deducibles aplicables, los límites territoriales, las cargas que pesan sobre el asegurado en caso de siniestro y el valor asegurado de EL VEHÍCULO, condiciones que acepta como marco único de la protección con que cuenta la operación. Asume, por lo mismo, la carga de mantenerse informado de las modificaciones, los anexos y las renovaciones de la póliza, para lo cual EL AGENTE le remitirá copia de todo anexo o renovación dentro de los cinco (5) días hábiles siguientes a su expedición. La relación de exclusiones del parágrafo siguiente se hace con propósito ilustrativo y no reviste carácter taxativo, de modo que no sustituye el texto completo del clausulado, que prevalece para todos los efectos.
PARÁGRAFO SEGUNDO. EXCLUSIONES QUE EL EMPRESARIO DECLARA CONOCER. Además de la que se destaca en el parágrafo tercero, EL EMPRESARIO declara conocer que la póliza no cubre el hurto de carpas, llantas, rines y vigías cuando la pérdida sea parcial, ni los actos malintencionados de terceros distintos del hurto y de su tentativa. Tampoco ampara los daños eléctricos, electrónicos, mecánicos e hidráulicos que provengan del uso o del desgaste natural, de la fatiga del material, de deficiencias del servicio de reparación, lubricación o mantenimiento, o de la falta de lubricación o refrigeración que no se derive de un accidente, ni los que se sigan de mantener encendido EL VEHÍCULO, de continuar conduciéndolo o de encenderlo después de un accidente o de una inundación sin haber ejecutado antes las reparaciones técnicas necesarias. Quedan por fuera, en el mismo sentido, los accesorios y equipos especiales que no hayan sido inspeccionados, asegurados de manera expresa y registrados en la póliza; las pérdidas ocurridas mientras el bien esté retenido, embargado o decomisado por autoridad, salvo que ello provenga de un evento cubierto; las que sobrevengan cuando se halle sobrecargado, se destine a un fin distinto del declarado en la carátula, se emplee en la enseñanza de la conducción o participe en competencias, demostraciones o entrenamientos; las que envuelvan mala fe, documentos falsos o adulterados en la reclamación o dolo del asegurado o del conductor autorizado; las multas, los comparendos y los gastos de las medidas contravencionales; y los daños a la carga transportada, lo mismo que los que EL VEHÍCULO sufra por transportarla. Conoce, por último, que los amparos de daños, hurto, accesorios y equipos especiales, gastos de transporte, obligaciones financieras, accidentes al conductor y acompañamiento satelital son opcionales y solo operan si figuran contratados en la carátula, y que el clausulado niega los servicios de asistencia cuando el vehículo se dé en alquiler.
PARÁGRAFO TERCERO. NO RESTITUCIÓN DE EL VEHÍCULO Y ABUSO DE CONFIANZA. La entrega de EL VEHÍCULO al arrendatario se verifica por un título que no traslada el dominio, de modo que su apropiación o su no restitución al vencimiento del plazo no configura hurto sino abuso de confianza, conducta descrita en los artículos 249 y 250 del Código Penal. Como el clausulado excluye de todas las coberturas las pérdidas que provengan de ese delito y de los demás que atenten contra el patrimonio económico, con la sola salvedad del hurto, EL EMPRESARIO declara entender que la aseguradora no reconocerá indemnización si el arrendatario no devuelve el bien, lo apropia, lo enajena, lo grava, lo entrega a un tercero o dispone de él de cualquier modo, y acepta que, por virtud del límite convenido en la cláusula séptima, EL AGENTE tampoco responde por ese evento ni por sus consecuencias patrimoniales. Ocurrido el hecho, las obligaciones de EL AGENTE se agotan en formular la denuncia penal, reportar el bien ante las autoridades de tránsito y de policía, dar el aviso a la aseguradora y entregar a EL EMPRESARIO la identificación completa del arrendatario y de los conductores autorizados, el contrato de arrendamiento, las actas de entrega y de devolución y el pagaré con su carta de instrucciones, para que aquel adelante las acciones civiles, penales y ejecutivas que le asistan.
PARÁGRAFO CUARTO. DESTINACIÓN DECLARADA DEL RIESGO Y CONSERVACIÓN DE SU ESTADO. Las partes conocen que el clausulado excluye de todas las coberturas las pérdidas que ocurran cuando el vehículo asegurado sea arrendado o subarrendado, y que esa exclusión únicamente se enerva cuando el alquiler a terceros aparece declarado y aceptado como destinación del riesgo en la carátula o en el anexo que expida la aseguradora. EL AGENTE, en su condición de tomador, se obliga por tanto a declarar esa destinación ante ${d.poliza.aseguradora}, a obtener y conservar vigente el anexo o la constancia que así lo acredite y a remitir copia de ese documento a EL EMPRESARIO dentro de los cinco (5) días hábiles siguientes a su expedición. Una y otra parte se abstendrán de destinar EL VEHÍCULO a un uso distinto del declarado y darán aviso escrito a la aseguradora de todo hecho que agrave el riesgo o varíe su identidad, conforme se los imponen los artículos 1058 y 1060 del Código de Comercio, cuya inobservancia acarrea, según el caso, la nulidad relativa del contrato de seguro o su terminación.
PARÁGRAFO QUINTO. DEDUCIBLE, VALOR ASEGURADO E INFRASEGURO. EL EMPRESARIO declara conocer que el deducible corresponde a la suma o al porcentaje de la pérdida que debe asumir el asegurado, que se aplica con independencia de que él o el conductor autorizado hayan resultado responsables o inocentes en el siniestro y que su monto es el que indique la carátula para cada amparo. Sabe, además, que la pérdida se califica como total cuando el valor de los repuestos, la mano de obra y el impuesto sobre las ventas iguala o supera el setenta y cinco por ciento (75%) del valor comercial de EL VEHÍCULO al momento del siniestro; que en ese evento la indemnización se liquida sobre el valor comercial que registre la guía de valores vigente, sin superar el valor asegurado de la carátula y previo descuento del deducible; y que el asegurador no está obligado a responder sino hasta concurrencia de la suma asegurada, sin que la indemnización pueda exceder el valor real del interés asegurado, según lo prevén los artículos 1079 y 1089 del Código de Comercio. Por lo anterior, corresponde a EL EMPRESARIO solicitar oportunamente a EL AGENTE la gestión del anexo de actualización del valor asegurado cuando el valor comercial del bien lo justifique, y asumir el faltante que se derive del infraseguro cuando omita hacerlo.
PARÁGRAFO SEXTO. AMPAROS ADICIONALES POR CUENTA DE EL EMPRESARIO. Queda a discreción de EL EMPRESARIO amparar EL VEHÍCULO con pólizas distintas o adicionales, bien para cubrir eventualidades no comprendidas en la póliza aquí identificada, entre ellas el abuso de confianza y la no restitución del bien, bien para asegurar montos superiores a los que ella reconoce o para trasladar el deducible pactado. Dado que esa decisión atiende a su exclusivo interés, la contratación, el pago y la administración de tales pólizas corren por su cuenta y riesgo, sin que EL AGENTE asuma respecto de ellas obligación, gestión ni responsabilidad alguna, ni vea por ese hecho ampliado el límite de la cláusula séptima. Si hiciere uso de esta facultad, EL EMPRESARIO lo informará por escrito a EL AGENTE dentro de los cinco (5) días hábiles siguientes, con indicación de la aseguradora, los amparos contratados y las sumas aseguradas, y deberá declarar los seguros coexistentes al dar el aviso de siniestro, tal como se lo impone el artículo 1076 del Código de Comercio, cuya inobservancia maliciosa acarrea la pérdida del derecho a la prestación asegurada. Las partes dejan constancia de que, conforme al artículo 1092 del mismo estatuto, en caso de coexistencia de seguros los aseguradores soportan la indemnización en proporción a la cuantía de sus respectivos contratos, siempre que el asegurado haya obrado de buena fe.
PARÁGRAFO SÉPTIMO. SUSPENSIÓN DE LA OPERACIÓN. Como quiera que sin amparo vigente la operación no puede ejecutarse, EL AGENTE podrá suspender de inmediato la promoción y el arrendamiento de EL VEHÍCULO cuando este deje de figurar amparado, cualquiera que sea la causa, sin que tal suspensión le acarree responsabilidad ni genere indemnización a favor de EL EMPRESARIO.
SÉPTIMA. LÍMITE DE LA RESPONSABILIDAD DE EL AGENTE. Las partes convienen expresamente que la responsabilidad de EL AGENTE frente a EL EMPRESARIO, por cualquier menoscabo, pérdida, daño, destrucción, hurto, apropiación indebida, no restitución o deterioro de EL VEHÍCULO, lo mismo que por la responsabilidad civil que llegare a originarse frente a terceros con ocasión de su tenencia, uso, goce o circulación, se limita de manera exclusiva a las eventualidades amparadas y a los montos que la compañía aseguradora reconozca y pague en virtud de la póliza identificada en la cláusula anterior. Corren por cuenta de EL EMPRESARIO, en consecuencia, el deducible y la franquicia, el faltante de la indemnización frente al valor real del daño, el valor no cubierto por infraseguro, la pérdida de valor comercial del bien, el lucro cesante del tiempo de inmovilización o de reparación, las multas y los gastos de las medidas contravencionales, y toda eventualidad que la aseguradora excluya, objete o se abstenga de pagar por cualquier causa, comprendidas de manera señalada las pérdidas provenientes del abuso de confianza, de la estafa y de los demás delitos contra el patrimonio económico distintos del hurto. Nada de ello obsta para que EL EMPRESARIO persiga al arrendatario o al tercero responsable por las acciones que le asistan. Ninguna otra responsabilidad, de orden contractual o extracontractual, podrá predicarse de EL AGENTE con ocasión de la explotación de EL VEHÍCULO, y las pólizas adicionales que EL EMPRESARIO llegare a contratar por su cuenta no amplían este límite. Lo aquí pactado se entiende sin perjuicio de su responsabilidad por dolo o por culpa grave, cuya condonación anticipada carece de validez a la luz del artículo 1522 del Código Civil, y sin perjuicio del cumplimiento de las obligaciones que la cláusula novena pone a su cargo.
OCTAVA. DEPÓSITO DE GARANTÍA Y RÉGIMEN DE INFRACCIONES. En cada arrendamiento EL AGENTE exigirá al arrendatario, en nombre de EL EMPRESARIO, un depósito de garantía de ${montoEnLetras(d.derivados.deposito)} moneda corriente, que no constituye arras, no se imputa al canon y no genera intereses ni rendimientos a favor de quien lo entrega. Ese depósito permanecerá en poder de EL AGENTE durante los ocho (8) días hábiles siguientes a la restitución de EL VEHÍCULO, término dentro del cual lo aplicará al pago de comparendos, infracciones detectadas mediante ayudas tecnológicas, peajes, combustible faltante, deducibles, franquicias, daños no amparados por la póliza, lavado, inmovilización, grúa, gastos de recuperación y cualquier otro concepto que resulte a cargo del arrendatario. Vencido el término, EL AGENTE devolverá el saldo no imputado y, desde ese preciso momento, cesa toda su intervención y toda su responsabilidad respecto de hechos ocurridos durante el arrendamiento que se manifiesten, notifiquen o reclamen con posterioridad, ya sea en materia de tránsito o en cualquier otra. Tales hechos los gestionará directamente EL EMPRESARIO frente al arrendatario, para lo cual EL AGENTE le entregará, cuando se lo solicite, la identificación completa del arrendatario y de los conductores autorizados, copia del contrato de arrendamiento, de las actas de entrega y de devolución y del pagaré suscrito. Las partes dejan constancia de que, tras la declaratoria de inexequibilidad del parágrafo primero del artículo 8 de la Ley 1843 de 2017 dispuesta por la Corte Constitucional en la sentencia C-038 de 2020, el propietario del vehículo no responde solidariamente con el conductor infractor por las infracciones detectadas mediante ayudas tecnológicas, de manera que la identificación oportuna del arrendatario es el mecanismo idóneo para trasladarle la sanción.
PARÁGRAFO. GARANTÍA CAMBIARIA PARA LOS RIESGOS NO AMPARADOS. Como el depósito de garantía no guarda proporción con el valor de EL VEHÍCULO y los riesgos relacionados en el parágrafo tercero de la cláusula sexta carecen de amparo asegurador, EL AGENTE exigirá al arrendatario, en nombre de EL EMPRESARIO y antes de la entrega, la suscripción de un pagaré en blanco con su carta de instrucciones, cuyo espacio del valor podrá diligenciarse hasta concurrencia del valor asegurado de EL VEHÍCULO más los perjuicios y gastos que la no restitución irrogue. Ese título se otorgará a la orden de EL EMPRESARIO, servirá de recaudo ejecutivo para el cobro de la no restitución del bien y de los demás conceptos que resulten a cargo del arrendatario, y se le entregará cuando lo requiera para el ejercicio de sus acciones.
NOVENA. OBLIGACIONES DE EL AGENTE. A EL AGENTE le corresponde cumplir el encargo con arreglo a las instrucciones que reciba y a las prácticas propias de su actividad. En desarrollo de ese deber general, se obliga a verificar antes de cada entrega que el arrendatario y los conductores autorizados cuenten con licencia de conducción vigente y de la categoría correspondiente, para lo cual consultará su situación en el Registro Único Nacional de Tránsito y en el Sistema Integrado de Información sobre Multas y Sanciones por Infracciones de Tránsito; a celebrar el contrato de arrendamiento por escrito, en el formato acordado, y a exigir el pagaré con su carta de instrucciones en los términos del parágrafo de la cláusula octava; a recibir el depósito de garantía y administrarlo conforme a esa misma cláusula; a levantar acta de entrega y acta de devolución con inventario de accesorios y documentos, kilometraje, nivel de combustible, estado físico y registro fotográfico; a recaudar, liquidar y girar en los términos de la cláusula quinta; y a tratar los datos personales del arrendatario y de los conductores autorizados con sujeción a la Ley 1581 de 2012. En lo que atañe al seguro, se obliga a mantener vigente la póliza identificada en la cláusula sexta, a pagar oportunamente la prima para precaver la terminación automática que sanciona el artículo 1068 del Código de Comercio, a declarar la destinación del riesgo y obtener el anexo previsto en el parágrafo cuarto de esa cláusula, y a remitir a EL EMPRESARIO copia de los anexos y renovaciones en la oportunidad allí señalada. Ocurrido un siniestro, deberá informarlo a EL EMPRESARIO dentro de las veinticuatro (24) horas siguientes a su conocimiento y darlo a conocer a la aseguradora dentro de los tres (3) días siguientes a aquel en que lo conozca o deba conocerlo, según lo dispone el artículo 1075 del mismo estatuto, así como observar las cargas que el clausulado impone, entre ellas acudir a los canales de atención de la compañía, recaudar el material probatorio y fotográfico del evento, abstenerse de realizar pagos, arreglos, transacciones o conciliaciones con las víctimas o sus herederos, no afrontar proceso judicial sin autorización previa y escrita de aquella y retirar EL VEHÍCULO del taller una vez concluida la reparación o la valoración. Cuando el bien sea objeto de apoderamiento o no sea restituido, formulará la denuncia penal y adelantará los reportes que correspondan.
DÉCIMA. OBLIGACIONES DE EL EMPRESARIO. EL EMPRESARIO entregará EL VEHÍCULO en condiciones mecánicas y de seguridad idóneas para su arrendamiento y con la documentación al día. Le corresponde, asimismo, conocer la póliza en los términos de los parágrafos primero a quinto de la cláusula sexta, informar a EL AGENTE las pólizas adicionales que llegare a contratar y solicitar oportunamente el anexo de actualización del valor asegurado cuando el valor comercial del bien lo justifique, con el fin de precaver el infraseguro. Deberá igualmente conservar vigentes el seguro obligatorio de accidentes de tránsito y la revisión técnico mecánica y de emisiones contaminantes, pagar el impuesto de vehículos automotores y mantener el bien libre de comparendos pendientes, pues el clausulado condiciona a ello el pago de la indemnización, y asumir el mantenimiento preventivo y correctivo, lo mismo que las reparaciones que no correspondan al arrendatario. Se obliga además a mantener EL VEHÍCULO libre de gravámenes, embargos, medidas cautelares y limitaciones al dominio, y a informar de inmediato cualquier actuación que lo afecte. En caso de pérdida total adelantará los trámites que la aseguradora exija para el pago, entre ellos el traspaso del bien, la cancelación de la matrícula y, cuando fuere el caso, el proceso de desintegración vehicular, cuyos costos y cuya custodia asume, y entregará el salvamento con todas las partes y accesorios que aquel tenía al momento del siniestro. Finalmente, asumirá los conceptos señalados en la cláusula séptima, se abstendrá de arrendar el bien directamente y reembolsará a EL AGENTE los gastos que este realice por cuenta suya, siempre que se encuentren debidamente soportados.
DÉCIMA PRIMERA. RECLAMACIÓN Y CARGAS PROBATORIAS. EL AGENTE adelantará el trámite de la reclamación en nombre de EL EMPRESARIO, quien conserva la condición de asegurado y de beneficiario de la prestación. Como quiera que, según el artículo 1077 del Código de Comercio, corresponde al asegurado demostrar la ocurrencia del siniestro y su cuantía, las partes convienen que EL AGENTE aporte el acta de entrega, el acta de devolución, el registro fotográfico, la identificación del arrendatario y de los conductores autorizados, la denuncia penal cuando ella proceda y los demás soportes que obren en su poder. Una y otra se obligan a obrar de buena fe en la reclamación y a abstenerse de presentar documentos falsos o adulterados, dado que, conforme al artículo 1078 del mismo estatuto, la mala fe en la reclamación o en la comprobación del derecho acarrea su pérdida y el incumplimiento de las obligaciones del asegurado autoriza a deducir de la indemnización el valor de los perjuicios que ese incumplimiento cause. Si la aseguradora objeta la reclamación o la atiende parcialmente, EL AGENTE informará la decisión a EL EMPRESARIO dentro de los tres (3) días hábiles siguientes y le entregará copia íntegra del expediente, para que aquel resuelva si ejerce las acciones que le franquea el artículo 1053 del Código de Comercio, sin que la objeción, el pago parcial o la demora de la compañía comprometan la responsabilidad de EL AGENTE.
DÉCIMA SEGUNDA. INDEMNIDAD. EL EMPRESARIO mantendrá indemne a EL AGENTE, a sus administradores y a su personal frente a cualquier reclamación, demanda, requerimiento o actuación administrativa o judicial que tenga origen en la propiedad, tenencia, uso, circulación o estado de EL VEHÍCULO, y le reembolsará las sumas que deba pagar por esos conceptos, incluidas condenas, costas y honorarios de defensa, dentro de los diez (10) días hábiles siguientes al requerimiento acompañado de su soporte. Esta obligación no opera cuando la reclamación tenga origen en el dolo o en la culpa grave de EL AGENTE.
DÉCIMA TERCERA. TERMINACIÓN. El contrato termina por el vencimiento del plazo sin prórroga, por mutuo acuerdo y por las justas causas que enuncia el artículo 1325 del Código de Comercio. A ellas se agregan, en favor de EL AGENTE y sin necesidad de declaración judicial ni indemnización a su cargo, las siguientes: que EL VEHÍCULO deje de figurar amparado por la póliza, cualquiera que sea la causa; que el bien resulte afectado por embargo, secuestro, decomiso, medida cautelar o trámite de extinción del derecho de dominio; o que EL EMPRESARIO sea incluido en listas vinculantes o restrictivas, nacionales o internacionales, para el control del lavado de activos, la financiación del terrorismo o la corrupción. Terminado el contrato, las partes se sujetarán a lo dispuesto en el artículo 1324 del mismo código.
DÉCIMA CUARTA. CLÁUSULA PENAL. El incumplimiento de cualquiera de las obligaciones que este contrato impone a las partes dará lugar a que la parte incumplida pague a la cumplida, a título de pena, una suma equivalente al ${porcentajeEnLetras(CLAUSULA_PENAL_AGENCIA_PCT)} del valor total del contrato. La pena se causa por el solo hecho del incumplimiento, sin que sea menester requerimiento previo para constituir en mora, al cual las partes renuncian de manera expresa, y presta mérito ejecutivo en los términos de la cláusula décima octava.
PARÁGRAFO PRIMERO. DETERMINACIÓN DEL VALOR TOTAL DEL CONTRATO. Como quiera que la remuneración pactada en la cláusula cuarta es variable y depende del número y la duración de los arrendamientos que se celebren, las partes convienen que, para los efectos exclusivos de esta cláusula, el valor total del contrato equivale a la sumatoria de las comisiones causadas a favor de EL AGENTE durante el período anual en curso. Si el incumplimiento se verifica antes de que dicho período concluya, ese valor se determinará proyectando el promedio mensual de las comisiones efectivamente causadas hasta la fecha del incumplimiento por los doce (12) meses del período. Y si el incumplimiento ocurre antes de que se cause la primera comisión, la pena será equivalente a cinco (5) salarios mínimos legales mensuales vigentes a esa misma fecha.
PARÁGRAFO SEGUNDO. CONCURRENCIA CON LOS PERJUICIOS Y CON LA PRESTACIÓN MERCANTIL. Para los precisos efectos del artículo 1600 del Código Civil, las partes estipulan de manera expresa que el pago de la pena no extingue la obligación principal, no impide exigir su cumplimiento, no obsta para el cobro de los perjuicios que excedan su monto y no afecta ni sustituye la prestación consagrada en el artículo 1324 del Código de Comercio.
PARÁGRAFO TERCERO. ARMONÍA CON EL LÍMITE DE RESPONSABILIDAD. La pena que llegare a causarse a cargo de EL AGENTE se entiende sin perjuicio del límite pactado en la cláusula séptima, el cual conserva plena vigencia respecto de los perjuicios derivados del menoscabo, la pérdida, el hurto, el abuso de confianza, la no restitución o el deterioro de EL VEHÍCULO y de la responsabilidad civil frente a terceros.
DÉCIMA QUINTA. NOTIFICACIONES Y MENSAJES DE DATOS. Para todos los efectos de este contrato, comprendidas las comunicaciones, los requerimientos, la rendición de cuentas y las notificaciones judiciales y extrajudiciales, EL EMPRESARIO señala la dirección de correo electrónico que registra en el Anexo Técnico, y EL AGENTE la dirección ${d.agente.correo}. Las partes reconocen plena validez y fuerza vinculante a los mensajes de datos que se crucen por esos canales, conforme a la Ley 527 de 1999 y a la Ley 2213 de 2022, y aceptan que las comunicaciones se entiendan recibidas al día hábil siguiente al de su envío, salvo prueba en contrario. Todo cambio de dirección electrónica deberá informarse por escrito con una antelación no inferior a cinco (5) días hábiles.
DÉCIMA SEXTA. ÓRDENES DE SERVICIO, OTROSÍ Y PRELACIÓN DOCUMENTAL. La tarifa, el plazo, el porcentaje de comisión aplicable dentro del rango pactado y las instrucciones especiales de EL EMPRESARIO se consignarán en órdenes de servicio o en otrosí suscritos por las partes, que hacen parte integrante de este contrato. Integran igualmente el acuerdo, en su orden, el presente documento, sus otrosí, el Anexo Técnico de EL VEHÍCULO, el anexo de constancia previsto en la cláusula siguiente, las órdenes de servicio, las actas de entrega y de devolución, la póliza de seguro con su carátula, su clausulado y sus anexos, y las comunicaciones cruzadas entre las partes. Si se presentare contradicción entre documentos de un mismo orden, primará el de fecha más reciente.
DÉCIMA SÉPTIMA. INFORMACIÓN PREVIA Y CONSTANCIA SEPARADA. Con el fin de que ninguna de las estipulaciones que anteceden pueda reputarse oscura, sorpresiva o desconocida, y para los efectos de los artículos 1603 del Código Civil y 871 del Código de Comercio, las declaraciones de EL EMPRESARIO sobre la entrega y el conocimiento de la póliza, sobre los riesgos que ella no ampara y sobre la facultad de constituir amparos propios se recogen en el anexo que las partes suscriben por separado en esta misma fecha y que hace parte integrante de este contrato.
DÉCIMA OCTAVA. MÉRITO EJECUTIVO, DOMICILIO Y LEY APLICABLE. Este contrato, sus otrosí y las liquidaciones que de ellos se deriven, incluida la liquidación de la pena prevista en la cláusula décima cuarta, prestan mérito ejecutivo para la exigencia judicial de las obligaciones de dar, hacer o no hacer que de ellos resulten, sin que se requiera el requerimiento previo para constituir en mora, al cual las partes renuncian de manera expresa. El domicilio contractual es la ciudad de Medellín, Antioquia, y el negocio se rige por la ley colombiana. Las diferencias que surjan con ocasión de su celebración, ejecución, interpretación o terminación se someterán previamente a conciliación ante el Centro de Conciliación y Arbitraje de la Cámara de Comercio de Medellín para Antioquia y, agotada esa etapa sin acuerdo, a la justicia ordinaria.
Para constancia se firma en ${d.ciudad}, ${fechaFirmaEnLetras(d.fechaContratoAgencia)}, en ${cantidadEnLetras(EJEMPLARES)} ejemplares del mismo tenor y valor.
_______________________________
${d.propietario.nombre}
${d.propietario.sigla} ${d.propietario.documento}
EL EMPRESARIO
_______________________________
${d.agente.representante}
C.C. ${d.agente.representanteCedula}
Representante Legal
${d.agente.razonSocial}, NIT ${d.agente.nit}
EL AGENTE

ANEXO. CONSTANCIA DE ENTREGA Y CONOCIMIENTO DE LA PÓLIZA Y DE LOS RIESGOS NO AMPARADOS
El suscrito ${d.propietario.nombre}, identificado con ${d.propietario.articulo} ${d.propietario.tipoDocumento} número ${d.propietario.documento}, en su calidad de EL EMPRESARIO dentro del contrato de agencia comercial celebrado con ${d.agente.razonSocial}, NIT ${d.agente.nit}, para la promoción y explotación del arrendamiento del vehículo de placas ${d.vehiculo.placa}, deja las siguientes constancias, que hacen parte integrante de ese contrato:
PRIMERA. Recibí de EL AGENTE, en la fecha de suscripción de este anexo, copia íntegra de la carátula de la póliza de automóviles número ${d.poliza.numero}, expedida por ${d.poliza.aseguradora} con vigencia entre el ${fechaNumericaOTexto(d.poliza.vigenciaDesde)} y el ${fechaNumericaOTexto(d.poliza.vigenciaHasta)}, y del clausulado que la rige, identificado con el código ${d.poliza.codigoClausulado}. Leí y comprendí uno y otro documento antes de firmar.
SEGUNDA. Conozco que la póliza no ampara la totalidad de los riesgos de la operación y que, en particular, excluye de todas las coberturas las pérdidas causadas directa o indirectamente por estafa, abuso de confianza o cualquier otro delito contra el patrimonio económico, salvo el hurto si ese amparo aparece contratado.
TERCERA. Entiendo que, como el vehículo se entrega al arrendatario por un título que no traslada el dominio, su apropiación o su no restitución configura abuso de confianza en los términos de los artículos 249 y 250 del Código Penal y no hurto, de manera que la aseguradora no reconocerá indemnización por ese evento.
CUARTA. Acepto, por virtud del límite convenido en la cláusula séptima del contrato, que ${d.agente.razonSocial} tampoco responde por las pérdidas derivadas del abuso de confianza, de la no restitución del vehículo ni de cualquier otra eventualidad que la aseguradora excluya, objete o se abstenga de pagar, como tampoco por el deducible, por el faltante frente al valor real del daño, por el infraseguro, por las multas o por el lucro cesante.
QUINTA. Se me informó que puedo constituir por mi cuenta los seguros y las garantías que estime necesarios para precaver los riesgos no amparados, entre ellos el abuso de confianza y la no restitución del vehículo, y que la decisión de hacerlo o de abstenerme la adopto bajo mi exclusiva responsabilidad.
SEXTA. Ninguna manifestación verbal, publicidad o cotización previa distinta del contrato, de la carátula y del clausulado me fue ofrecida como alcance de la protección contratada.
Se firma en ${d.ciudad}, ${fechaFirmaNumerica(d.fechaContratoAgencia)}.
_______________________________
${d.propietario.nombre}
${d.propietario.sigla} ${d.propietario.documento}
EL EMPRESARIO
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · OTROSÍ AL CONTRATO DE AGENCIA, CON VALOR DE ORDEN DE SERVICIO
//     (es, en la práctica, la liquidación al propietario)
// ═══════════════════════════════════════════════════════════════════════════
export function otrosiAgencia(d: DatosContrato): string {
  return `OTROSÍ No. ${d.numeros.otrosiAgencia} AL CONTRATO DE AGENCIA COMERCIAL, CON VALOR DE ORDEN DE SERVICIO
Entre los suscritos, a saber: ${d.propietario.nombre}, mayor de edad, vecino de ${d.propietario.ciudad}, identificado con ${d.propietario.articulo} ${d.propietario.tipoDocumento} número ${d.propietario.documento}, quien obra en nombre propio y en su condición de propietario del vehículo objeto del negocio, y a quien en lo sucesivo se denominará EL EMPRESARIO; y ${d.agente.razonSocial}, sociedad por acciones simplificada identificada con el NIT ${d.agente.nit}, con domicilio principal en ${d.agente.domicilio}, dirección en la ${d.agente.direccion} y correo electrónico ${d.agente.correo}, representada legalmente por ${d.agente.representante}, mayor de edad, identificado con la cédula de ciudadanía número ${d.agente.representanteCedula}, en su calidad de representante legal principal inscrito en el registro mercantil, a quien en lo sucesivo se denominará EL AGENTE, hemos convenido suscribir el presente OTROSÍ, previas las siguientes
CONSIDERACIONES
PRIMERA. Que el ${fechaEnLetras(d.fechaContratoAgencia)} las partes celebraron en Medellín el CONTRATO DE AGENCIA COMERCIAL para la promoción y explotación del arrendamiento del vehículo de placas ${d.vehiculo.placa}, en adelante EL CONTRATO.
SEGUNDA. Que la cláusula décima quinta de EL CONTRATO dispone que la tarifa, el plazo, el porcentaje de comisión aplicable dentro del rango pactado y las instrucciones especiales de EL EMPRESARIO se consignen en órdenes de servicio o en otrosí suscritos por las partes, los cuales hacen parte integrante de aquel.
TERCERA. Que EL AGENTE, en desarrollo del encargo, consiguió cliente y celebró en nombre y representación de EL EMPRESARIO un contrato de arrendamiento de EL VEHÍCULO, de manera que corresponde documentar las condiciones económicas de esa operación y la remuneración que por ella se causa.
En consecuencia, las partes acuerdan las siguientes
CLÁUSULAS
PRIMERA. IDENTIFICACIÓN DE EL VEHÍCULO. Las partes precisan que el automotor de placas ${d.vehiculo.placa}, objeto de EL CONTRATO, corresponde a un vehículo de marca ${d.vehiculo.marca}, línea ${d.vehiculo.linea}, modelo ${anioOPendiente(d.vehiculo.anio)}, de servicio ${d.vehiculo.servicio}, cuyas demás características se consignan en el Anexo Técnico y en el acta de entrega respectiva.
SEGUNDA. OPERACIÓN QUE SE DOCUMENTA. EL AGENTE celebró, en nombre y representación de EL EMPRESARIO, ${operacionOtrosiAgencia(d)}
TERCERA. COMISIÓN DE EL AGENTE. ${comisionOtrosiAgencia(d)}
CUARTA. LIQUIDACIÓN Y GIRO. ${liquidacionOtrosiAgencia(d)} El giro se efectuará a la cuenta bancaria que EL EMPRESARIO indique por escrito, dentro de los cinco (5) días hábiles siguientes a la restitución de EL VEHÍCULO, acompañado de la relación discriminada de la liquidación, conforme a la cláusula quinta de EL CONTRATO. La declaración y el pago de los tributos que se causen corresponden a la parte que resulte responsable de ellos según el Estatuto Tributario.
QUINTA. DEPÓSITO DE GARANTÍA Y RÉGIMEN DE INFRACCIONES. EL AGENTE exigió y recibió de EL ARRENDATARIO, en nombre de EL EMPRESARIO, el depósito de garantía de ${montoEnLetras(d.derivados.deposito)} moneda corriente previsto en la cláusula octava de EL CONTRATO, el cual conservará durante los ocho (8) días hábiles siguientes a la restitución y aplicará en los términos allí pactados. Vencido ese término operan los efectos que la misma cláusula dispone, comprendida la entrega a EL EMPRESARIO de la identificación de EL ARRENDATARIO y de la documentación de la operación.
SEXTA. PÓLIZA. Se deja constancia de que EL VEHÍCULO permanece amparado por la póliza número ${d.poliza.numero} expedida por ${d.poliza.aseguradora}, NIT ${d.poliza.aseguradoraNit}, vigente entre el ${fechaEnLetrasOTexto(d.poliza.vigenciaDesde)} y el ${fechaEnLetrasOTexto(d.poliza.vigenciaHasta)}, en la que EL AGENTE figura como tomador y EL EMPRESARIO como asegurado, y de que EL ARRENDATARIO fue incorporado como asegurado del amparo de responsabilidad civil extracontractual, en los términos de la cláusula sexta de EL CONTRATO.
SÉPTIMA. VIGENCIA DE LO NO MODIFICADO. Las demás cláusulas de EL CONTRATO permanecen incólumes y continúan rigiendo la relación entre las partes. El presente otrosí, que tiene valor de orden de servicio, hace parte integrante de aquel y se interpreta en armonía con él, conforme al orden de prelación de su cláusula décima quinta.
Para constancia se firma en ${d.ciudad}, ${fechaFirmaEnLetras(d.fecha)}, en ${cantidadEnLetras(EJEMPLARES)} ejemplares del mismo tenor y valor.

${d.propietario.nombre}
${d.propietario.sigla} ${d.propietario.documento}
EL EMPRESARIO

${d.agente.representante}
C.C. ${d.agente.representanteCedula}
Representante Legal de ${d.agente.razonSocial}, NIT ${d.agente.nit}
EL AGENTE
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · CONTRATO DE ARRENDAMIENTO SIN CONDUCTOR (marco propietario ↔ cliente)
// ═══════════════════════════════════════════════════════════════════════════
export function contratoArrendamiento(d: DatosContrato): string {
  return `CONTRATO DE ARRENDAMIENTO DE VEHÍCULO AUTOMOTOR SIN CONDUCTOR
Entre los suscritos, a saber: ${d.propietario.nombre}, mayor de edad, vecino de ${d.propietario.ciudad}, identificado con ${d.propietario.articulo} ${d.propietario.tipoDocumento} número ${d.propietario.documento}, propietario del vehículo objeto de este contrato, a quien en lo sucesivo se denominará EL ARRENDADOR, representado en este acto por ${d.agente.razonSocial}, sociedad por acciones simplificada identificada con el NIT ${d.agente.nit}, con domicilio principal en ${d.agente.domicilio}, dirección en la ${d.agente.direccion} y correo electrónico ${d.agente.correo}, representada legalmente por ${d.agente.representante}, mayor de edad, identificado con la cédula de ciudadanía número ${d.agente.representanteCedula}, quien obra exclusivamente en su calidad de agente comercial de EL ARRENDADOR y a quien en lo sucesivo se denominará EL AGENTE; y ${d.cliente.nombre}, mayor de edad, vecino de ${d.cliente.ciudad}, identificado con ${d.cliente.articulo} ${d.cliente.tipoDocumento} número ${d.cliente.documento}, con dirección de correo electrónico ${d.cliente.correo}, quien obra en nombre propio y a quien en lo sucesivo se denominará EL ARRENDATARIO, hemos convenido celebrar el CONTRATO DE ARRENDAMIENTO DE VEHÍCULO AUTOMOTOR SIN CONDUCTOR que se rige por las cláusulas que más adelante se consignan, previas las siguientes
CONSIDERACIONES
PRIMERA. Que EL ARRENDADOR es propietario del vehículo automotor de placas ${d.vehiculo.placa}, que en lo sucesivo se denominará EL VEHÍCULO y cuyas características de marca, línea, modelo, número de motor, número de chasis y color se consignan en el acta de entrega que hace parte integrante de este contrato.
SEGUNDA. Que EL AGENTE promueve y explota el arrendamiento de EL VEHÍCULO por cuenta y en nombre de EL ARRENDADOR, en virtud del contrato de agencia comercial celebrado entre ambos, y comparece a este acto dentro de los precisos límites de las facultades que allí se le confirieron.
TERCERA. Que EL ARRENDATARIO manifiesta su interés en tomar EL VEHÍCULO en arrendamiento sin conductor, declara que lo destinará al uso particular convenido y afirma conocer y aceptar las condiciones que aquí se estipulan.
CUARTA. Que EL VEHÍCULO se encuentra amparado por la póliza número ${d.poliza.numero} expedida por ${d.poliza.aseguradora}, NIT ${d.poliza.aseguradoraNit}, con vigencia entre el ${fechaNumericaOTexto(d.poliza.vigenciaDesde)} y el ${fechaNumericaOTexto(d.poliza.vigenciaHasta)}, en la que EL AGENTE figura como tomador y EL ARRENDADOR como asegurado, y cuyos amparos, exclusiones, deducibles y límites territoriales declara conocer EL ARRENDATARIO, quien recibe copia de la carátula y de las condiciones particulares en este mismo acto.
QUINTA. Que, dado que las condiciones económicas de cada arrendamiento varían según el vehículo, el plazo y la temporada, las partes convinieron que este documento fije el marco general de la relación y que el canon, el plazo y las demás particularidades se consignen en el otrosí que se suscriba para cada operación.
En consecuencia, las partes acuerdan las siguientes
CLÁUSULAS
PRIMERA. OBJETO. EL ARRENDADOR entrega a EL ARRENDATARIO, a título de arrendamiento y sin conductor, el uso y goce de EL VEHÍCULO, y EL ARRENDATARIO se obliga a recibirlo por ese mismo título, a pagar el canon y a restituirlo en las condiciones y en la oportunidad que aquí se pactan. EL ARRENDATARIO adquiere y conserva la calidad de mero tenedor y reconoce de manera expresa dominio ajeno sobre el bien.
SEGUNDA. CALIDAD EN QUE OBRA EL AGENTE. EL AGENTE comparece únicamente como agente comercial de EL ARRENDADOR. No es propietario de EL VEHÍCULO ni ocupa la posición de arrendador, y su intervención se circunscribe a la promoción del negocio, a la celebración de este contrato en nombre de aquel, a la entrega y al recibo del bien, al recaudo del canon y a la administración del depósito de garantía. Por consiguiente, las obligaciones propias del arrendador recaen en EL ARRENDADOR, y EL AGENTE responde solamente por su propia gestión.
TERCERA. DECLARACIONES Y HABILITACIÓN DE EL ARRENDATARIO. EL ARRENDATARIO declara bajo la gravedad del juramento, que se entiende prestado con la firma de este documento, que es mayor de edad y plenamente capaz; que cuenta con licencia de conducción vigente, de la categoría que corresponde a EL VEHÍCULO, y que dicha licencia no se encuentra suspendida, cancelada ni retenida por autoridad alguna; que la información y los documentos que ha suministrado para su vinculación son veraces, completos y corresponden a su identidad; que los recursos con los que atiende las obligaciones de este contrato provienen de actividades lícitas y no se encuentran vinculados al lavado de activos ni a la financiación del terrorismo; y que no ha sido incluido en listas vinculantes o restrictivas nacionales o internacionales creadas para el control de tales conductas. EL ARRENDATARIO autoriza a EL ARRENDADOR y a EL AGENTE para verificar esta información ante las autoridades, centrales de riesgo y bases de datos que resulten pertinentes, en cualquier momento de la relación. La falsedad o la inexactitud de cualquiera de estas declaraciones constituye causal de terminación inmediata del contrato y deja a salvo las acciones penales y civiles a que haya lugar.
CUARTA. PLAZO, ENTREGA Y RESTITUCIÓN. El plazo del arrendamiento, con indicación de la fecha y hora de entrega y de la fecha, hora y lugar de restitución, se fija en el otrosí de la respectiva operación. Tanto la entrega como la restitución se harán constar en actas suscritas por las partes, en las que se consignarán el inventario de accesorios y documentos, el kilometraje, el nivel de combustible y el estado físico de EL VEHÍCULO, acompañadas de registro fotográfico. Esas actas hacen parte integrante del contrato y constituyen el patrón de comparación para establecer los daños y el desgaste imputables a EL ARRENDATARIO, de suerte que la obligación de restituir no se entenderá cumplida mientras el bien no sea entregado en el lugar convenido y no se haya suscrito el acta de devolución.
PARÁGRAFO PRIMERO. PRÓRROGA DEL PLAZO. El plazo podrá prorrogarse siempre que EL ARRENDATARIO lo solicite por el canal electrónico señalado en este contrato con una antelación no inferior a doce (12) horas al vencimiento, que EL AGENTE lo acepte por escrito y que se pague de manera anticipada el canon correspondiente al período adicional. La prórroga se hará constar en otrosí. A falta de cualquiera de estos requisitos, la permanencia de EL VEHÍCULO en poder de EL ARRENDATARIO después del vencimiento se rige por la cláusula décima segunda y no constituye prórroga tácita ni renovación del contrato.
PARÁGRAFO SEGUNDO. ALCANCE DEL ACTA DE DEVOLUCIÓN. La suscripción del acta de devolución acredita el estado aparente de EL VEHÍCULO al momento de su entrega material y no constituye paz y salvo ni finiquito. Por consiguiente, no libera a EL ARRENDATARIO de los daños ocultos que se adviertan con posterioridad, ni de las infracciones, sanciones, peajes o cobros que se causen durante la vigencia del contrato y se notifiquen o reclamen después de su terminación.
QUINTA. CANON Y FORMA DE PAGO. El canon de arrendamiento, su periodicidad y su forma de pago se fijan en el otrosí de la respectiva operación, atendiendo el número de días y las condiciones de la negociación, y se adiciona con el impuesto sobre las ventas cuando este resulte aplicable. Salvo que el otrosí disponga otra cosa, el canon se paga de manera anticipada como condición para la entrega. Ni el menor uso que EL ARRENDATARIO haga del bien ni su inmovilización por causas que le sean imputables modifican o reducen el canon pactado.
PARÁGRAFO. DESISTIMIENTO ANTES DE LA ENTREGA. Si EL ARRENDATARIO desiste de la operación antes de la entrega de EL VEHÍCULO, tendrá derecho a la devolución íntegra de lo pagado cuando comunique su decisión con una antelación no inferior a cuarenta y ocho (48) horas a la hora fijada para la entrega; a la devolución del cincuenta por ciento (50%) cuando la comunique dentro de las cuarenta y ocho (48) horas anteriores; y no habrá lugar a devolución cuando no comparezca ni comunique su desistimiento. Lo anterior se entiende sin perjuicio del derecho de retracto que la ley reconozca a EL ARRENDATARIO cuando la contratación se haya celebrado por métodos no tradicionales o a distancia y concurran los presupuestos legales para su ejercicio.
SEXTA. DEPÓSITO DE GARANTÍA. A la suscripción de este contrato EL ARRENDATARIO entrega a EL AGENTE, a título de depósito de garantía, la suma de ${montoEnLetras(d.derivados.deposito)} moneda corriente, que no constituye arras, no se imputa al canon y no genera intereses ni rendimientos a su favor. EL AGENTE conservará ese depósito durante los ocho (8) días hábiles siguientes a la restitución de EL VEHÍCULO, término dentro del cual queda facultado para imputarlo, total o parcialmente y sin que se requiera autorización adicional, al pago de comparendos e infracciones de tránsito, infracciones detectadas mediante ayudas tecnológicas, peajes, combustible faltante, deducibles, franquicias, daños no amparados por la póliza o no reconocidos por la aseguradora, lavado, inmovilización, grúa, gastos de recuperación del bien, cláusula penal y cualquier otra suma que resulte a su cargo. Vencido el término, EL AGENTE devolverá el saldo no imputado dentro del día hábil siguiente, junto con la relación discriminada de las imputaciones y sus soportes. Si los conceptos a cargo de EL ARRENDATARIO superan el valor del depósito, este pagará la diferencia dentro de los cinco (5) días hábiles siguientes al requerimiento, sin perjuicio de que se haga efectivo el pagaré previsto en la cláusula décima sexta.
PARÁGRAFO. EFECTOS DE LA DEVOLUCIÓN DEL DEPÓSITO. La devolución del saldo del depósito no constituye paz y salvo ni extingue las obligaciones de EL ARRENDATARIO. En consecuencia, los hechos ocurridos durante la vigencia del contrato que se manifiesten, notifiquen o reclamen después de vencido el término de ocho (8) días hábiles seguirán a su cargo y podrán exigírsele directamente por EL ARRENDADOR, a quien EL AGENTE entregará para el efecto la identificación de EL ARRENDATARIO y de los conductores autorizados, copia de este contrato, de las actas de entrega y devolución y del pagaré suscrito.
SÉPTIMA. CONDUCTORES AUTORIZADOS. EL VEHÍCULO solo podrá ser conducido por EL ARRENDATARIO y por las personas que se nominen expresamente como conductores autorizados en el otrosí y en el acta de entrega, quienes deberán acreditar licencia de conducción vigente y de la categoría correspondiente. EL ARRENDATARIO se obliga a no permitir, bajo ninguna circunstancia, que el bien sea conducido por persona distinta. El incumplimiento de esta obligación constituye causal de terminación inmediata y traslada a EL ARRENDATARIO la totalidad de las consecuencias patrimoniales del hecho, incluidas las que se deriven de la pérdida de cobertura de la póliza.
PARÁGRAFO. SOLIDARIDAD. Los conductores autorizados que suscriban el acta de entrega responderán solidariamente con EL ARRENDATARIO por las obligaciones dinerarias derivadas de este contrato y por los perjuicios que ocasionen con EL VEHÍCULO. Las partes pactan expresamente esta solidaridad para los efectos del artículo 1568 del Código Civil, según el cual, fuera de los casos en que la ley la establece, la solidaridad debe ser declarada de manera explícita.
OCTAVA. OBLIGACIONES DE EL ARRENDATARIO. Al lado de las que se desprenden de la naturaleza del contrato y de la ley, EL ARRENDATARIO asume las siguientes obligaciones. Destinará EL VEHÍCULO exclusivamente al uso particular convenido, de modo que le queda prohibido emplearlo en la prestación de servicio público de transporte, en el transporte remunerado de personas o de cosas, en plataformas de intermediación de transporte, en enseñanza automovilística, en competencias o pruebas de velocidad o de resistencia, en el remolque de otros vehículos y en el tránsito por vías no aptas o fuera de calzada. Conducirá personalmente o permitirá la conducción únicamente a los conductores autorizados, siempre con licencia vigente y de la categoría que corresponda. Observará con rigor las normas de tránsito contenidas en la Ley 769 de 2002 y en las disposiciones que la modifiquen, adicionen o reglamenten, respetará los límites de velocidad, la señalización y las restricciones de circulación, y se abstendrá de conducir bajo los efectos del alcohol, de sustancias psicoactivas o de medicamentos que alteren la capacidad de conducción. Guardará, custodiará, protegerá y resguardará el bien con la diligencia que emplearía en los propios, para lo cual lo estacionará en parqueaderos cerrados y vigilados, no lo dejará en la vía pública durante la noche, mantendrá activados los dispositivos de seguridad, no abandonará en su interior las llaves, los documentos ni objetos de valor, y adoptará las demás medidas razonables para precaver el hurto, el daño y cualquier otro riesgo previsible. Se abstendrá de ceder este contrato, de subarrendar y de trasladar a cualquier título la tenencia a terceros, así como de gravar EL VEHÍCULO, darlo en prenda, garantía o depósito, o permitir que resulte afectado por medidas cautelares; si se presentare diligencia judicial o administrativa sobre el bien, deberá oponerse exhibiendo este contrato, que lo acredita como mero tenedor, y dar aviso inmediato a EL AGENTE. Circulará únicamente dentro del territorio nacional y dentro de los límites de cobertura territorial de la póliza, sin que pueda sacar el bien del país salvo autorización previa y escrita. Tampoco podrá transportar mercancías peligrosas, inflamables, explosivas o de uso restringido, estupefacientes o sus precursores y mercancías de contrabando, ni emplear EL VEHÍCULO en la comisión de conducta punible o contravencional alguna. No excederá la capacidad de pasajeros ni la de carga que señale la licencia de tránsito, ni intervendrá el odómetro, ni realizará modificaciones, adaptaciones, reparaciones o instalación de accesorios, ni llevará el bien a talleres distintos de los que indique EL AGENTE. Antes de iniciar la marcha, y de manera periódica durante ella, verificará los niveles de aceite, refrigerante y demás fluidos, así como la presión y el estado de las llantas; atenderá de inmediato las alertas del tablero de instrumentos y detendrá la marcha cuando estas indiquen riesgo, absteniéndose de continuar la circulación en condiciones que agraven el daño. Asumirá el costo del combustible, los peajes, los parqueaderos, el lavado y, en general, los gastos ordinarios de uso, y restituirá el bien con el mismo nivel de combustible con que lo recibió. Informará a EL AGENTE, por el canal electrónico señalado en este contrato y dentro de las dos (2) horas siguientes a su ocurrencia, cualquier accidente, daño, falla mecánica, inmovilización, comparendo, retención, intento de hurto, hurto o cualquier otra situación que afecte o pueda afectar EL VEHÍCULO. Si se produjere un accidente, permanecerá en el lugar hasta el arribo de la autoridad de tránsito, procurará el levantamiento del croquis o del informe policial, obtendrá la identificación de los demás intervinientes y de los testigos, y se abstendrá de reconocer responsabilidad, de celebrar acuerdos o transacciones y de abandonar el bien. Si el vehículo fuere hurtado, formulará denuncia penal de manera inmediata y entregará copia de ella a EL AGENTE dentro de las veinticuatro (24) horas siguientes. Permitirá en todo tiempo la inspección del bien por parte de EL AGENTE o de quien este designe y aceptará la operación de los dispositivos de geolocalización instalados en él. Se notificará ante la autoridad competente, pagará oportunamente los comparendos e infracciones que se generen durante la vigencia del contrato y se identificará como conductor cuando la autoridad se lo requiera. Por último, restituirá EL VEHÍCULO en la fecha, hora y lugar convenidos y en el mismo estado en que lo recibió, salvo el desgaste natural derivado de su uso legítimo.
NOVENA. OBLIGACIONES DE EL ARRENDADOR. En concordancia con el artículo 1982 del Código Civil, EL ARRENDADOR se obliga a entregar EL VEHÍCULO a EL ARRENDATARIO, a mantenerlo en estado de servir para el fin a que ha sido arrendado y a librarlo de toda turbación o embarazo en su goce. En desarrollo de esos deberes, y por conducto de EL AGENTE, entregará el bien en condiciones mecánicas y de seguridad idóneas, aseado y con el nivel de combustible que se consigne en el acta de entrega; suministrará la licencia de tránsito, el seguro obligatorio de accidentes de tránsito y el certificado de revisión técnico mecánica y de emisiones contaminantes vigentes; acreditará que EL VEHÍCULO se encuentra amparado por la póliza identificada en la consideración cuarta y entregará copia de su carátula y condiciones; garantizará que el bien se halla libre de gravámenes, embargos y medidas cautelares que impidan su circulación; asumirá el mantenimiento preventivo y las reparaciones derivadas del desgaste natural o de vicios anteriores a la entrega; y atenderá las peticiones, quejas y reclamos de EL ARRENDATARIO por el canal electrónico señalado en este contrato, dentro de los quince (15) días hábiles siguientes a su recibo.
PARÁGRAFO. FALLA NO IMPUTABLE A EL ARRENDATARIO. Si durante la vigencia del contrato EL VEHÍCULO presenta una falla mecánica o un defecto que impida su uso y que no sea imputable a EL ARRENDATARIO, este quedará exonerado del pago del canon correspondiente al tiempo de la inmovilización, y EL ARRENDADOR, por conducto de EL AGENTE, podrá sustituir el bien por otro de características equivalentes o, si ello no fuere posible, reembolsar la parte proporcional del canon dentro de los cinco (5) días hábiles siguientes.
DÉCIMA. RÉGIMEN DEL SEGURO Y ASUNCIÓN DE RIESGOS. EL ARRENDATARIO figurará como asegurado del amparo de responsabilidad civil extracontractual de la póliza identificada en la consideración cuarta, cuyos amparos, exclusiones, deducibles y límites territoriales se detallan en el otrosí de la respectiva operación. Asume a su cargo, y se obliga a pagar, el deducible y la franquicia que correspondan, los faltantes de la indemnización frente al valor del daño, el valor no cubierto por infraseguro y, en general, los perjuicios derivados de eventos que la aseguradora excluya u objete cuando la objeción obedezca al incumplimiento de las obligaciones que este contrato pone a su cargo o a la inobservancia de las condiciones de la póliza. Le corresponde igualmente cumplir las cargas que la póliza imponga al asegurado y prestar toda la colaboración que se requiera para formalizar el siniestro.
DÉCIMA PRIMERA. GUARDA MATERIAL Y JURÍDICA. Durante toda la vigencia del contrato, y hasta la suscripción del acta de devolución, la guarda material y jurídica de EL VEHÍCULO se radica de manera exclusiva en EL ARRENDATARIO, por ser quien tiene su uso, mando, control y aprovechamiento efectivo. En consecuencia, él responde por los daños y perjuicios que se causen a terceros por o con el bien, y se obliga a reembolsar a EL ARRENDADOR y a EL AGENTE las sumas que estos deban pagar por tal concepto, incluidas condenas, costas y honorarios de defensa, dentro de los diez (10) días hábiles siguientes al requerimiento acompañado de su soporte. Uno y otro quedan facultados para llamarlo en garantía en los procesos que por esta causa se promuevan en su contra.
DÉCIMA SEGUNDA. MORA EN LA RESTITUCIÓN Y APROPIACIÓN INDEBIDA. Por cada día o fracción de retardo en la restitución, EL ARRENDATARIO pagará a título de pena una suma equivalente al ${porcentajeEnLetras(PENA_MORA_PCT)} del canon diario vigente, sin que por ello se entienda prorrogado el contrato ni extinguida la obligación de restituir. Si transcurren veinticuatro (24) horas desde la hora convenida sin que la restitución se produzca y sin justificación aceptada por escrito, EL AGENTE lo requerirá por el canal electrónico señalado en este contrato. Vencidas otras veinticuatro (24) horas desde el requerimiento sin que el bien sea devuelto, las partes entenderán que EL ARRENDATARIO retiene indebidamente una cosa mueble ajena que le fue entregada por título no traslativo de dominio, de suerte que EL ARRENDADOR, directamente o por conducto de EL AGENTE, quedará facultado para formular denuncia penal por el delito de abuso de confianza previsto en el artículo 249 del Código Penal, para activar los dispositivos de geolocalización y de bloqueo y para adelantar las gestiones de recuperación, cuyo costo correrá por cuenta de EL ARRENDATARIO.
DÉCIMA TERCERA. TERMINACIÓN ANTICIPADA. EL ARRENDADOR, por conducto de EL AGENTE, podrá dar por terminado este contrato de manera inmediata, sin necesidad de declaración judicial y sin perjuicio de las demás acciones, y exigir la restitución del bien, cuando EL ARRENDATARIO incumpla cualquiera de las obligaciones de la cláusula octava, permita la conducción por persona no autorizada, incurra en mora en el pago del canon, destine EL VEHÍCULO a un uso prohibido, resulte falsa o inexacta alguna de las declaraciones de la cláusula tercera, o cuando el estado o la ubicación del bien evidencien riesgo inminente para su conservación. A su turno, EL ARRENDATARIO podrá darlo por terminado cuando EL ARRENDADOR incumpla las obligaciones de la cláusula novena y ese incumplimiento le impida el uso y goce de EL VEHÍCULO.
DÉCIMA CUARTA. LÍMITE DE RESPONSABILIDAD Y DERECHOS DEL CONSUMIDOR. La responsabilidad de EL ARRENDADOR y de EL AGENTE frente a EL ARRENDATARIO y frente a terceros, con ocasión de este contrato, se limita al alcance de los amparos que la compañía aseguradora reconozca y pague en virtud de la póliza, sin que pueda predicarse de ellos obligación indemnizatoria adicional por hechos imputables a EL ARRENDATARIO, a los conductores autorizados o a terceros. Lo anterior se entiende sin perjuicio de la responsabilidad por dolo o culpa grave, cuya condonación anticipada carece de validez conforme al artículo 1522 del Código Civil, y sin perjuicio de los derechos que la Ley 1480 de 2011 reconozca a EL ARRENDATARIO cuando obre en calidad de consumidor, los cuales ninguna estipulación de este contrato limita, restringe ni menoscaba. Ninguna de las cláusulas aquí pactadas podrá interpretarse en el sentido de exonerar a EL ARRENDADOR de las obligaciones que la cláusula novena y el artículo 1982 del Código Civil ponen a su cargo.
DÉCIMA QUINTA. CLÁUSULA PENAL. El incumplimiento de cualquiera de las obligaciones a cargo de EL ARRENDATARIO dará lugar al pago de una pena equivalente al ${porcentajeEnLetras(CLAUSULA_PENAL_ARRENDAMIENTO_PCT)} del valor total del canon pactado en el otrosí de la respectiva operación. Para los precisos efectos del artículo 1600 del Código Civil, las partes estipulan de manera expresa que el pago de esa pena no extingue la obligación principal ni impide el cobro de los perjuicios que excedan su monto. La pena se causa por el solo hecho del incumplimiento y no concurre con la prevista en la cláusula décima segunda cuando el incumplimiento consista únicamente en el retardo en la restitución, caso en el cual se aplicará solo esta última.
DÉCIMA SEXTA. PAGARÉ Y MÉRITO EJECUTIVO. Con el fin de garantizar el cumplimiento de las obligaciones dinerarias a su cargo, EL ARRENDATARIO suscribe a favor de EL ARRENDADOR un pagaré con espacios en blanco, acompañado de su carta de instrucciones, que se diligenciará con arreglo al artículo 622 del Código de Comercio. Este contrato, sus otrosí, las actas de entrega y de devolución y las liquidaciones que de ellos se deriven prestan mérito ejecutivo, sin que se requiera requerimiento previo para constituir en mora, al cual EL ARRENDATARIO renuncia de manera expresa.
DÉCIMA SÉPTIMA. TRATAMIENTO DE DATOS PERSONALES Y GEOLOCALIZACIÓN. EL ARRENDATARIO autoriza de manera previa, expresa e informada a EL ARRENDADOR y a EL AGENTE para recolectar, almacenar, usar, circular y suprimir sus datos personales y los de los conductores autorizados, con la finalidad de verificar su idoneidad, ejecutar este contrato, gestionar siniestros, comparendos e infracciones, adelantar el cobro de las sumas adeudadas y atender obligaciones legales, todo ello con sujeción a la Ley 1581 de 2012 y a sus normas reglamentarias. Autoriza asimismo la instalación y operación de dispositivos de geolocalización en EL VEHÍCULO durante la vigencia del contrato, con la finalidad exclusiva de proteger el bien, verificar el cumplimiento de las condiciones de uso y facilitar su recuperación. EL ARRENDATARIO conserva en todo tiempo los derechos de conocer, actualizar, rectificar y suprimir sus datos, y de revocar la autorización, en los términos de la ley, y podrá ejercerlos por el canal electrónico señalado en este contrato.
DÉCIMA OCTAVA. NOTIFICACIONES Y MENSAJES DE DATOS. Las comunicaciones, los requerimientos y las notificaciones judiciales y extrajudiciales dirigidas a EL ARRENDADOR se surtirán por conducto de EL AGENTE, en la dirección ${d.agente.correo}, y las dirigidas a EL ARRENDATARIO en la dirección ${d.cliente.correo}. Las partes reconocen plena validez y fuerza vinculante a los mensajes de datos que se crucen por esos canales, conforme a la Ley 527 de 1999 y a la Ley 2213 de 2022, y aceptan que las comunicaciones se entiendan recibidas al día hábil siguiente al de su envío, salvo prueba en contrario. Todo cambio de dirección electrónica deberá informarse por escrito con una antelación no inferior a un (1) día hábil.
DÉCIMA NOVENA. OTROSÍ Y PRELACIÓN DOCUMENTAL. El canon, el plazo, los conductores autorizados, el kilometraje permitido y el detalle de los amparos de la póliza se consignarán en el otrosí suscrito por las partes, que hace parte integrante de este contrato. Lo integran igualmente, en su orden, el presente documento, sus otrosí, el acta de entrega, el acta de devolución, la carátula y las condiciones de la póliza, el pagaré con su carta de instrucciones y las comunicaciones cruzadas entre las partes. Si se presentare contradicción entre documentos de un mismo orden, primará el de fecha más reciente.
VIGÉSIMA. DOMICILIO Y LEY APLICABLE. El domicilio contractual es la ciudad de Medellín, Antioquia, y el negocio se rige por la ley colombiana. Las diferencias que surjan con ocasión de su celebración, ejecución, interpretación o terminación se someterán a los jueces competentes del circuito de Medellín, sin perjuicio de las atribuciones jurisdiccionales que la ley confiere a la Superintendencia de Industria y Comercio cuando EL ARRENDATARIO obre en calidad de consumidor.
Para constancia se firma en ${d.ciudad}, ${fechaFirmaEnLetras(d.fechaContratoArrendamiento)}, en ${cantidadEnLetras(EJEMPLARES)} ejemplares del mismo tenor y valor.

${d.agente.representante}
C.C. ${d.agente.representanteCedula}
Representante Legal de ${d.agente.razonSocial}, NIT ${d.agente.nit}
En calidad de EL AGENTE, en nombre y representación de EL ARRENDADOR

${d.cliente.nombre}
${d.cliente.sigla} ${d.cliente.documento}
EL ARRENDATARIO
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · OTROSÍ AL CONTRATO DE ARRENDAMIENTO (condiciones de la operación)
// ═══════════════════════════════════════════════════════════════════════════
export function otrosiArrendamiento(d: DatosContrato): string {
  return `OTROSÍ No. ${d.numeros.otrosiArrendamiento} AL CONTRATO DE ARRENDAMIENTO DE VEHÍCULO AUTOMOTOR SIN CONDUCTOR
Entre los suscritos, a saber: ${d.propietario.nombre}, mayor de edad, vecino de ${d.propietario.ciudad}, identificado con ${d.propietario.articulo} ${d.propietario.tipoDocumento} número ${d.propietario.documento}, propietario del vehículo objeto del contrato, a quien en lo sucesivo se denominará EL ARRENDADOR, representado en este acto por ${d.agente.razonSocial}, sociedad por acciones simplificada identificada con el NIT ${d.agente.nit}, con domicilio principal en ${d.agente.domicilio}, dirección en la ${d.agente.direccion} y correo electrónico ${d.agente.correo}, representada legalmente por ${d.agente.representante}, mayor de edad, identificado con la cédula de ciudadanía número ${d.agente.representanteCedula}, quien obra exclusivamente en su calidad de agente comercial de EL ARRENDADOR y a quien en lo sucesivo se denominará EL AGENTE; y ${d.cliente.nombre}, mayor de edad, vecino de ${d.cliente.ciudad}, identificado con ${d.cliente.articulo} ${d.cliente.tipoDocumento} número ${d.cliente.documento}, con dirección de correo electrónico ${d.cliente.correo}, quien obra en nombre propio y a quien en lo sucesivo se denominará EL ARRENDATARIO, hemos convenido suscribir el presente OTROSÍ, previas las siguientes
CONSIDERACIONES
PRIMERA. Que el ${fechaEnLetras(d.fechaContratoArrendamiento)} las partes celebraron en Medellín el CONTRATO DE ARRENDAMIENTO DE VEHÍCULO AUTOMOTOR SIN CONDUCTOR que recae sobre el vehículo de placas ${d.vehiculo.placa}, en adelante EL CONTRATO.
SEGUNDA. Que la cláusula décima novena de EL CONTRATO dispone que el canon, el plazo, los conductores autorizados, el kilometraje permitido y el detalle de los amparos de la póliza se consignen en el otrosí que las partes suscriban para cada operación, el cual hace parte integrante de aquel.
TERCERA. Que, como quiera que EL CONTRATO identificó EL VEHÍCULO por su placa y remitió las demás características al acta de entrega, las partes aprovechan este instrumento para precisarlas, sin que ello comporte modificación alguna del objeto contratado.
CUARTA. Que las partes convinieron las condiciones particulares de la primera operación de arrendamiento y proceden a consignarlas por escrito.
En consecuencia, las partes acuerdan las siguientes
CLÁUSULAS
PRIMERA. IDENTIFICACIÓN DE EL VEHÍCULO. Las partes precisan que el automotor de placas ${d.vehiculo.placa}, objeto de EL CONTRATO, corresponde a un vehículo de marca ${d.vehiculo.marca}, línea ${d.vehiculo.linea}, modelo ${anioOPendiente(d.vehiculo.anio)}, de servicio ${d.vehiculo.servicio}, cuyas demás características de número de motor, número de chasis y color se consignan en el acta de entrega que se suscribe de manera simultánea con este otrosí.
SEGUNDA. PLAZO, ENTREGA Y RESTITUCIÓN. ${plazoEntregaRestitucion(d)} La prórroga de este plazo se sujeta a lo previsto en el parágrafo primero de la cláusula cuarta de EL CONTRATO.
TERCERA. CANON Y FORMA DE PAGO. ${canonOtrosiArrendamiento(d)} Dicho valor se paga de manera anticipada y en su totalidad, como condición para la entrega de EL VEHÍCULO, conforme a la cláusula quinta de EL CONTRATO.
CUARTA. KILOMETRAJE. Para esta operación el kilometraje es ilimitado, de suerte que no se pacta tope alguno ni cobro por kilómetro en exceso. Lo anterior no exonera a EL ARRENDATARIO de las obligaciones de custodia, conservación y uso diligente que le impone la cláusula octava de EL CONTRATO, ni de responder por el desgaste que exceda el natural derivado del uso legítimo.
QUINTA. CONDUCTORES AUTORIZADOS. ${conductoresOtrosiArrendamiento(d)} La incorporación de cualquier otro conductor requiere otrosí previo y escrito, y su omisión acarrea las consecuencias previstas en la cláusula séptima de EL CONTRATO, comprendida la pérdida de cobertura de la póliza.
SEXTA. DEPÓSITO DE GARANTÍA. EL ARRENDATARIO entrega a EL AGENTE, a título de depósito de garantía, la suma de ${montoEnLetras(d.derivados.deposito)} moneda corriente, que se administra e imputa en los términos de la cláusula sexta de EL CONTRATO y se devuelve, en el saldo no imputado, dentro del día hábil siguiente al vencimiento de los ocho (8) días hábiles posteriores a la restitución.
SÉPTIMA. PÓLIZA APLICABLE. EL VEHÍCULO se encuentra amparado por la póliza número ${d.poliza.numero} expedida por ${d.poliza.aseguradora}, NIT ${d.poliza.aseguradoraNit}, con vigencia entre el ${fechaEnLetrasOTexto(d.poliza.vigenciaDesde)} y el ${fechaEnLetrasOTexto(d.poliza.vigenciaHasta)}, en la que EL AGENTE figura como tomador y EL ARRENDADOR como asegurado. EL ARRENDATARIO declara que en este acto recibe copia de la carátula y de las condiciones de la póliza, que conoce sus amparos, exclusiones, deducibles y límites territoriales, y que figura como asegurado del amparo de responsabilidad civil extracontractual. Los deducibles, franquicias, faltantes e infraseguro quedan a su cargo en los términos de la cláusula décima de EL CONTRATO.
OCTAVA. EFECTOS ECONÓMICOS DE LOS INCUMPLIMIENTOS. Para esta operación, y en aplicación de EL CONTRATO, las partes precisan que la pena por mora en la restitución prevista en su cláusula décima segunda asciende a ${montoEnLetras(d.derivados.penaMoraDiaria)} moneda corriente por cada día o fracción de retardo, equivalente al ${porcentajeEnLetras(PENA_MORA_PCT)} del canon diario; y que la cláusula penal prevista en su cláusula décima quinta asciende a ${montoEnLetras(d.derivados.clausulaPenalArrendamiento)} moneda corriente, equivalente al ${porcentajeEnLetras(CLAUSULA_PENAL_ARRENDAMIENTO_PCT)} del canon total pactado.
NOVENA. VIGENCIA DE LO NO MODIFICADO. Las demás cláusulas de EL CONTRATO permanecen incólumes y continúan rigiendo la relación entre las partes. El presente otrosí hace parte integrante de aquel y se interpreta en armonía con él, conforme al orden de prelación de su cláusula décima novena.
Para constancia se firma en ${d.ciudad}, ${fechaFirmaEnLetras(d.fecha)}, en ${cantidadEnLetras(EJEMPLARES)} ejemplares del mismo tenor y valor.

${d.agente.representante}
C.C. ${d.agente.representanteCedula}
Representante Legal de ${d.agente.razonSocial}, NIT ${d.agente.nit}
En calidad de EL AGENTE, en nombre y representación de EL ARRENDADOR

${d.cliente.nombre}
${d.cliente.sigla} ${d.cliente.documento}
EL ARRENDATARIO
${d.cliente.correo}
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · ACTA DE ENTREGA Y DEVOLUCIÓN
// ═══════════════════════════════════════════════════════════════════════════
export function actaEntregaDevolucion(d: DatosContrato): string {
  return `ACTA DE ENTREGA Y DEVOLUCIÓN DE VEHÍCULO AUTOMOTOR
No. ${d.numeros.acta}
La presente acta hace parte integrante del contrato de arrendamiento de vehículo automotor sin conductor No. ${d.numeros.contratoArrendamiento} y de su otrosí No. ${d.numeros.otrosiArrendamiento}, y constituye el patrón de comparación para establecer los daños y el desgaste imputables a EL ARRENDATARIO.
PARTES
EL ARRENDADOR: ${d.propietario.nombre}, ${d.propietario.sigla} ${d.propietario.documento}.
EL AGENTE: ${d.agente.razonSocial}, NIT ${d.agente.nit}, quien obra en nombre y representación de EL ARRENDADOR.
EL ARRENDATARIO: ${d.cliente.nombre}, ${d.cliente.sigla} ${d.cliente.documento}, teléfono ${d.cliente.celular}, correo ${d.cliente.correo}, licencia de conducción No. ${d.cliente.licencia.numero}, categoría ${d.cliente.licencia.categoria}, vigente hasta ${fechaNumericaOTexto(d.cliente.licencia.vigenciaHasta)}.
${conductoresActa(d)}
VEHÍCULO Y CONDICIONES DE LA OPERACIÓN
Placa ${d.vehiculo.placa}, marca ${d.vehiculo.marca}, línea ${d.vehiculo.linea}, modelo ${cifraOPendiente(d.vehiculo.anio)}, color ${d.vehiculo.color}, motor ${d.vehiculo.motor}, chasis ${d.vehiculo.chasis}.
Entrega: fecha ${fechaNumerica(d.operacion.entrega.fecha)}, hora ${d.operacion.entrega.hora}. Restitución: fecha ${fechaNumerica(d.operacion.restitucion.fecha)}, hora ${d.operacion.restitucion.hora}, lugar ${d.operacion.restitucion.lugar}.
Canon ${pesos(d.derivados.canonTotal)}. Depósito de garantía ${pesos(d.derivados.deposito)}. Kilometraje permitido ${d.operacion.kilometraje}. Costo por kilómetro en exceso ${d.operacion.costoKmExceso}.
Póliza No. ${d.poliza.numero}, aseguradora ${d.poliza.aseguradora}, deducible ${d.poliza.deducible}.

ESTADO DEL VEHÍCULO
Califíquese cada ítem con B si está en buen estado, R si es regular y M si es malo. Descríbase en observaciones todo rayón, abolladura, fisura o faltante.
ÍTEM
ENTREGA
DEVOLUCIÓN
${filasChecklist(ITEMS_ESTADO_VEHICULO)}
DOCUMENTOS, LLAVES Y MEDICIONES
CONCEPTO
ENTREGA
DEVOLUCIÓN
${filasChecklist(CONCEPTOS_DOCUMENTOS_ACTA)}
REGISTRO FOTOGRÁFICO Y OBSERVACIONES
Las partes dejan constancia de que al momento de la entrega se tomaron ${cifraOPendiente(d.operacion.fotosEntrega)} fotografías y al momento de la devolución ${cifraOPendiente(d.operacion.fotosDevolucion)} fotografías, que se anexan y hacen parte de esta acta.
Observaciones a la entrega:
__________________________________________________________________
__________________________________________________________________
__________________________________________________________________
Observaciones a la devolución:
__________________________________________________________________
__________________________________________________________________
__________________________________________________________________
DECLARACIONES
ENTREGA. EL ARRENDATARIO declara que recibe EL VEHÍCULO en el estado descrito en esta acta, que verificó personalmente cada uno de los ítems relacionados, que recibió copia de la carátula y de las condiciones de la póliza, y que conoce y acepta las obligaciones que le impone el contrato, en especial las relativas a la custodia del bien, a los conductores autorizados y al protocolo de siniestros.
DEVOLUCIÓN. La suscripción de la sección de devolución acredita el estado aparente de EL VEHÍCULO al momento de su entrega material y no constituye paz y salvo ni finiquito. Por consiguiente, no libera a EL ARRENDATARIO de los daños ocultos que se adviertan con posterioridad, ni de las infracciones, sanciones, peajes o cobros causados durante la vigencia del contrato que se notifiquen después de su terminación. Los cargos a su cargo se liquidarán e imputarán al depósito de garantía dentro de los ocho (8) días hábiles siguientes a esta fecha.

FIRMAS DE LA ENTREGA

Por ${d.agente.razonSocial}, EL AGENTE
Nombre: ${d.agente.representante}  C.C. ${d.agente.representanteCedula}

EL ARRENDATARIO
Nombre: ${d.cliente.nombre}  ${d.cliente.sigla} ${d.cliente.documento}

FIRMAS DE LA DEVOLUCIÓN
Fecha ${fechaNumerica(d.operacion.restitucion.fecha)}, hora ${d.operacion.restitucion.hora}.

Por ${d.agente.razonSocial}, EL AGENTE
Nombre: ${d.agente.representante}  C.C. ${d.agente.representanteCedula}

EL ARRENDATARIO
Nombre: ${d.cliente.nombre}  ${d.cliente.sigla} ${d.cliente.documento}
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · PAGARÉ CON CARTA DE INSTRUCCIONES
// ═══════════════════════════════════════════════════════════════════════════
export function pagare(d: DatosContrato): string {
  return `PAGARÉ No. ____________
Yo, ${d.cliente.nombre}, mayor de edad, vecino de ${d.cliente.ciudad}, identificado con ${d.cliente.articulo} ${d.cliente.tipoDocumento} número ${d.cliente.documento}, obrando en nombre propio y quien en adelante se denominará EL OTORGANTE, hago constar lo siguiente:
PRIMERO. PROMESA INCONDICIONAL DE PAGO. Pagaré de manera incondicional, a la orden de ____________________________________, identificado con ____________________, o a quien represente sus derechos, en adelante EL ACREEDOR, en la ciudad de Medellín, Antioquia, la suma de ____________________________________ PESOS ($____________________) moneda legal colombiana.
SEGUNDO. VENCIMIENTO. La suma antes indicada la pagaré el día ______ del mes de ____________________ del año ____________.
TERCERO. INTERESES. Sobre la suma adeudada reconoceré, desde la fecha de vencimiento y hasta el pago total, intereses moratorios a la tasa más alta que autoricen las disposiciones legales, sin que en ningún caso excedan el límite previsto en el artículo 884 del Código de Comercio.
CUARTO. GASTOS DE COBRANZA. Serán de mi cargo los gastos de cobranza judicial y extrajudicial, así como los honorarios profesionales en que EL ACREEDOR deba incurrir para obtener el pago.
QUINTO. DISPENSA DE FORMALIDADES. Declaro excusadas la presentación para el pago y los avisos de rechazo. Este título no requiere protesto, como quiera que no se ha insertado la cláusula que lo exige, conforme a los artículos 697 y 711 del Código de Comercio.
SEXTO. ESPACIOS EN BLANCO. Suscribo el presente pagaré con espacios en blanco y autorizo a EL ACREEDOR para llenarlos con arreglo al artículo 622 del Código de Comercio y conforme a la carta de instrucciones que otorgo en esta misma fecha, la cual forma parte integrante de este título.
SÉPTIMO. SOLIDARIDAD. Quienes suscriben este título en calidad de codeudores se obligan de manera solidaria con EL OTORGANTE al pago de la totalidad de la suma adeudada, sus intereses y sus accesorios, de modo que EL ACREEDOR podrá exigir el pago íntegro a cualquiera de ellos. Esta solidaridad se pacta de manera expresa para los efectos del artículo 1568 del Código Civil.
OCTAVO. DOMICILIO. Para todos los efectos derivados de este título se fija como domicilio la ciudad de Medellín, Antioquia.
Suscrito en ${d.ciudad}, ${fechaFirmaNumerica(d.fecha)}.
EL OTORGANTE
Nombre: ${d.cliente.nombre}
${d.cliente.sigla} ${d.cliente.documento}${codeudoresPagare(d)}

CARTA DE INSTRUCCIONES
${d.ciudad}, ${fechaNumerica(d.fecha)}.
Señores
____________________________________
Ciudad
Referencia: instrucciones para el diligenciamiento del pagaré con espacios en blanco No. ____________, suscrito en esta misma fecha.
Quienes suscribimos, en nuestra condición de otorgante y de codeudores solidarios del pagaré de la referencia, y con fundamento en el artículo 622 del Código de Comercio, impartimos las siguientes instrucciones irrevocables, que se entienden aceptadas con la tenencia del título y que nos obligan a todos por igual:
PRIMERA. ESPACIOS QUE SE DEJAN EN BLANCO. Declaramos que los únicos espacios que se dejan en blanco, para ser diligenciados por EL ACREEDOR, son los siguientes: el número del pagaré, el nombre y la identificación de EL ACREEDOR, la cuantía en letras y en cifras, y la fecha de vencimiento. Todos los demás campos, comprendidas nuestra identificación y la fecha de suscripción, quedan diligenciados al momento de la firma, de suerte que su modificación posterior constituirá alteración del texto del título.
SEGUNDA. PROCEDENCIA DEL DILIGENCIAMIENTO Y OBLIGACIONES GARANTIZADAS. Queda autorizado para llenar los espacios en blanco cuando incumplamos cualquiera de las obligaciones dinerarias a nuestro cargo, o cuando no restituyamos el vehículo en la oportunidad convenida. El título garantiza las obligaciones presentes y futuras, de plazo vencido o pendientes de vencimiento, que se deriven del contrato de arrendamiento de vehículo automotor sin conductor No. ${d.numeros.contratoArrendamiento}, de sus otrosí, de sus prórrogas y de las actas de entrega y de devolución que lo integran.
TERCERA. CUANTÍA. La suma que se consigne será la que resulte de sumar los siguientes conceptos causados a nuestro cargo y pendientes de pago a la fecha del diligenciamiento: los cánones de arrendamiento y sus impuestos; la pena diaria por mora en la restitución; la cláusula penal pactada; el deducible, la franquicia, los faltantes de la indemnización y el valor no cubierto por infraseguro; los daños no amparados por la póliza o no reconocidos por la aseguradora; los comparendos, las infracciones detectadas mediante ayudas tecnológicas y los peajes; el combustible faltante; los gastos de lavado, inmovilización, grúa y recuperación del vehículo; y los gastos de cobranza y honorarios profesionales. De esa sumatoria se descontará el valor del depósito de garantía efectivamente imputado.
CUARTA. FECHA DE VENCIMIENTO. Se consignará el mismo día en que el título sea diligenciado, de suerte que se haga exigible de manera inmediata.
QUINTA. BENEFICIARIO Y TENENCIA DEL TÍTULO. Se consignará el nombre de EL ACREEDOR. ${d.agente.razonSocial}, NIT ${d.agente.nit}, conserva la tenencia legítima del título en su calidad de agente comercial de aquel y queda facultada para diligenciarlo y para adelantar su cobro en su nombre.
SEXTA. PLAZO MÁXIMO PARA EL DILIGENCIAMIENTO. La presente autorización podrá ejercerse dentro de los tres (3) años siguientes a la terminación del contrato que da origen a las obligaciones garantizadas. Vencido ese término sin que el título haya sido diligenciado, la autorización se extingue y EL ACREEDOR deberá devolverlo dentro de los quince (15) días hábiles siguientes a la solicitud escrita que para el efecto se le formule.
SÉPTIMA. SOLIDARIDAD. Estas instrucciones obligan por igual al otorgante y a los codeudores que suscriben, quienes responden solidariamente por la totalidad de las obligaciones garantizadas, conforme al artículo 1568 del Código Civil y a la cláusula séptima del pagaré.
OCTAVA. REPORTE A CENTRALES DE INFORMACIÓN. Autorizamos a EL ACREEDOR y a ${d.agente.razonSocial} para consultar, reportar, procesar y divulgar ante los operadores de información financiera y crediticia el nacimiento, la modificación y la extinción de las obligaciones garantizadas, así como su comportamiento de pago. Las partes dejan constancia de que el reporte de información negativa solo procederá previa comunicación al titular, remitida a la última dirección registrada, con el fin de que pueda demostrar o efectuar el pago o controvertir el monto y la exigibilidad de la obligación, y únicamente una vez transcurridos veinte (20) días calendario desde su envío, conforme al artículo 12 de la Ley 1266 de 2008.
NOVENA. CONSTANCIA. Declaramos que recibimos copia del pagaré y de esta carta de instrucciones, que comprendemos su alcance y que las suscribimos de manera libre y voluntaria.

EL OTORGANTE
Nombre: ${d.cliente.nombre}
${d.cliente.sigla} ${d.cliente.documento}${codeudoresPagare(d)}
`;
}

/** Las seis plantillas, indexadas por tipo de documento. */
export const PLANTILLAS: Record<TipoDocumento, (d: DatosContrato) => string> = {
  'agencia': contratoAgencia,
  'otrosi-agencia': otrosiAgencia,
  'arrendamiento': contratoArrendamiento,
  'otrosi-arrendamiento': otrosiArrendamiento,
  'acta-entrega': actaEntregaDevolucion,
  'pagare': pagare,
};

/**
 * Genera el texto de un documento.
 *
 * Antes de entregar los datos a la plantilla se aplica la regla de los grupos
 * incompletos (ver «Grupos de datos» arriba): es el único sitio por el que pasan los
 * seis documentos, así que ninguno puede quedarse sin ella.
 */
export function generarTexto(tipo: TipoDocumento, d: DatosContrato): string {
  const poliza = polizaImpresa(d.poliza);
  return PLANTILLAS[tipo](poliza === d.poliza ? d : { ...d, poliza });
}
