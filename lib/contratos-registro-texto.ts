// ── Documento que se firma AL CREAR LA CUENTA ───────────────────────────────
//
// Uno solo, y el mismo para clientes y propietarios: la AUTORIZACIÓN DE TRATAMIENTO
// DE DATOS PERSONALES.
//
// POR QUÉ ESTE Y NO DOS CONTRATOS DE VINCULACIÓN
// Hasta sep-2026 el registro emitía dos contratos marco —uno de usuario y otro de
// propietario— redactados por el equipo de desarrollo, que nunca pasaron por el
// abogado y se quedaron desactivados por eso. Al revisarlos contra los seis documentos
// que SÍ entregó el abogado se vio que se solapaban: el contrato de agencia comercial
// ya es el marco con el propietario y el de arrendamiento ya es el marco con el
// cliente, y ambos se suscriben en la primera operación.
//
// Lo único que el registro necesita de verdad y que esos dos no cubren es la
// autorización de datos, que la Ley 1581 de 2012 exige recoger ANTES de tratar el
// dato, no después. De modo que el alta firma esto y nada más.
//
// EL TEXTO es el del documento del abogado `02_Legal/Contratos/
// Contrato_3_Autorizacion_Datos.docx`, reproducido literalmente salvo por:
//   · los espacios en blanco del modelo, que se llenan con los datos reales de la
//     sociedad (la constante AGENTE y lib/contacto.ts);
//   · la razón social, que en el modelo decía «DRIVEPASS S.A.S.» y es
//     «DRIVEPASS COL S.A.S.» — el nombre correcto según el certificado de existencia
//     y representación legal, y el que usan los otros seis documentos.
// Si hay que cambiar una cláusula se cambia primero en el .docx y después acá.
//
// ⚠️ Módulo PURO (sin BD, sin `fs`): lo importan tanto las rutas de API como las
// pantallas 'use client'.

import { fechaFirmaEnLetras } from './contratos-texto';
import { CONTACTO_TELEFONO_VISIBLE } from './contacto';
import type { Empresa, Persona } from './contratos-datos';

/**
 * Interruptor de seguridad, heredado de los contratos de vinculación que este
 * documento sustituye.
 *
 * En `true` desde que el documento pasó a ser el del abogado en vez de un borrador
 * del equipo. Lo que queda abierto está anotado con `// ⚖️ REVISAR:` y no impide
 * emitir: son decisiones sobre el modelo, no defectos del texto.
 */
export const REGISTRO_REVISADO_POR_ABOGADO = true;

/** Un único documento de alta, para cualquier rol de cuenta. */
export type TipoRegistro = 'autorizacion-datos';

export const TIPO_REGISTRO: TipoRegistro = 'autorizacion-datos';

export const TITULO_REGISTRO = 'Autorización de tratamiento de datos personales';

/** Prefijo del consecutivo, con la misma forma que CAR-000012 / CAG-000007. */
export const PREFIJO_REGISTRO = 'ADP';

/** Ejemplares que se firman, igual que el resto de documentos del módulo. */
export const EJEMPLARES_REGISTRO = 2;

/**
 * Código que devuelven las rutas cuando la operación se frena porque falta la firma.
 * Vive en este módulo PURO —y no en el server-only— para que la pantalla lo reconozca
 * y mande a firmar, igual que `CODIGO_PERFIL_INCOMPLETO`.
 */
export const CODIGO_REGISTRO_PENDIENTE = 'autorizacion_datos_pendiente';

export type DatosRegistro = {
  fecha: string;
  ciudad: string;
  titular: Persona;
  agente: Empresa;
  /** En qué calidad firma: es la casilla «Arrendatario / Propietario» del documento. */
  calidad: 'Arrendatario' | 'Propietario';
  origen: { usuarioId: number };
};

/**
 * Los dos consentimientos que el documento recoge POR SEPARADO.
 *
 * No es un detalle de interfaz: la cláusula CUARTA exige consentimiento «separado y
 * expreso» para los datos sensibles (las imágenes de cédula y licencia, que son
 * biométricos), y la TERCERA declara que su entrega es facultativa. Meterlos en una
 * sola casilla convertiría el consentimiento reforzado en un trámite y le quitaría al
 * documento justo lo que la ley le pide.
 */
export type ConsentimientosRegistro = {
  /** La autorización general. Sin esto no hay documento que firmar. */
  general: boolean;
  /** Cláusula CUARTA: imágenes de documentos de identidad y licencia. Facultativo. */
  datosSensibles: boolean;
  /** Finalidad (g) de la cláusula SEGUNDA: comunicaciones comerciales. Facultativo. */
  comunicacionesComerciales: boolean;
};

function casilla(marcada: boolean): string {
  return marcada ? '[X]' : '[ ]';
}

function identificacionResponsable(a: Empresa): string {
  return `IDENTIFICACIÓN DEL RESPONSABLE\n`
    + `Responsable: ${a.razonSocial} — NIT ${a.nit}. Domicilio: ${a.domicilio}. `
    + `Dirección: ${a.direccion}. Correo de habeas data: ${a.correo}. `
    + `Teléfono: ${CONTACTO_TELEFONO_VISIBLE}.`;
}

/**
 * Texto íntegro del documento, con los consentimientos ya reflejados.
 *
 * Los consentimientos entran EN EL TEXTO (y no solo en una columna aparte) a propósito:
 * el sello HMAC de la firma se calcula sobre el texto, así que una vez firmado no se
 * puede cambiar después lo que la persona autorizó sin que el sello deje de verificar.
 */
export function generarTextoRegistro(d: DatosRegistro, c: ConsentimientosRegistro): string {
  const a = d.agente;
  const t = d.titular;

  return [
    TITULO_REGISTRO.toUpperCase(),
    `Ley 1581 de 2012, Decreto 1377 de 2013 — ${a.razonSocial}`,
    '',
    identificacionResponsable(a),
    '',
    'AUTORIZACIÓN DEL TITULAR',
    `Yo, ${t.nombre}, identificado con ${t.articulo} ${t.tipoDocumento} número ${t.documento}, `
      + `con domicilio en ${t.direccion}, ${t.ciudad}, y correo electrónico ${t.correo}, `
      + `en calidad de ${d.calidad}, de manera previa, expresa, libre e informada, autorizo a `
      + `${a.razonSocial} para recolectar, almacenar, usar, circular, actualizar, suprimir y, en `
      + `general, tratar mis datos personales en los términos de este documento (artículo 9 de la `
      + `Ley 1581 de 2012 y artículo 7 del Decreto 1377 de 2013).`,
    '',
    `PRIMERA. DATOS QUE SE RECOLECTAN. Datos de identificación (nombre, documento o pasaporte, `
      + `fecha de nacimiento, dirección, ciudad, país); datos de contacto (celular, correo, contacto `
      + `de emergencia); imágenes de documentos de identidad y de licencia de conducción; datos de `
      + `pago; y datos de la operación (reservas, depósitos, vehículos, fotografías de entrega y `
      + `devolución).`,
    '',
    `SEGUNDA. FINALIDADES DEL TRATAMIENTO. a) Verificar la identidad y la idoneidad de arrendatarios `
      + `y propietarios; b) ejecutar y gestionar los contratos de arrendamiento y de mandato; `
      + `c) gestionar pagos, depósitos, daños, fotomultas, cobros y liquidaciones; d) prevenir el `
      + `fraude; e) atender peticiones, consultas y reclamos; f) cumplir obligaciones legales; y `
      + `g) si se autoriza por separado, enviar comunicaciones comerciales.`,
    `    ${casilla(c.comunicacionesComerciales)} Autorizo el envío de comunicaciones comerciales.`,
    '',
    `TERCERA. CARÁCTER FACULTATIVO. La entrega de datos es facultativa; en especial, el titular no `
      + `está obligado a autorizar el tratamiento de datos sensibles (artículo 6 del Decreto 1377 de `
      + `2013). Ninguna actividad se condiciona a la entrega de datos sensibles.`,
    '',
    `CUARTA. CONSENTIMIENTO REFORZADO PARA DATOS SENSIBLES. Las imágenes de documentos de identidad `
      + `y de la licencia pueden contener datos sensibles/biométricos (artículo 5 de la Ley 1581 de `
      + `2012). Informado de su carácter facultativo y de que su finalidad es exclusivamente la `
      + `verificación de identidad y de la licencia y la prevención de fraude, autorizo de forma `
      + `separada y expresa su tratamiento:`,
    `    ${casilla(c.datosSensibles)} Sí autorizo.`,
    `Estos datos se conservarán con medidas reforzadas de seguridad y acceso restringido.`,
    '',
    `QUINTA. TRANSFERENCIA Y TRANSMISIÓN INTERNACIONAL. Autorizo de forma expresa e inequívoca la `
      + `transferencia y transmisión de mis datos a encargados o proveedores ubicados en el exterior `
      + `(alojamiento en la nube, pasarela de pago, firma electrónica) cuando sea necesario para la `
      + `ejecución del contrato (artículo 26 de la Ley 1581 de 2012 y artículos 24 y 25 del Decreto `
      + `1377 de 2013), bajo contratos de transmisión que garanticen la seguridad y confidencialidad.`,
    '',
    `SEXTA. DERECHOS DEL TITULAR. Tengo derecho a conocer, actualizar, rectificar y suprimir mis `
      + `datos, a solicitar prueba de esta autorización, a ser informado sobre su uso, a presentar `
      + `quejas ante la Superintendencia de Industria y Comercio y a revocar la autorización `
      + `(artículo 8 de la Ley 1581 de 2012), escribiendo al correo de habeas data indicado arriba.`,
    '',
    `SÉPTIMA. PROCEDIMIENTO DE CONSULTAS Y RECLAMOS. Las consultas se atenderán en máximo diez (10) `
      + `días hábiles (artículo 14 de la Ley 1581 de 2012); los reclamos en máximo quince (15) días `
      + `hábiles, prorrogables por ocho (8) días hábiles (artículo 15 de la Ley 1581 de 2012). El `
      + `titular debe agotar este trámite antes de acudir a la Superintendencia de Industria y `
      + `Comercio (artículo 16 de la Ley 1581 de 2012).`,
    '',
    `OCTAVA. VIGENCIA. Esta autorización rige desde su otorgamiento y durante el tiempo necesario `
      + `para cumplir las finalidades; los datos se conservarán mientras subsista la relación y los `
      + `términos legales de conservación. La política completa de tratamiento de ${a.razonSocial} `
      + `está publicada en su sitio web.`,
    '',
    `NOVENA. FIRMA ELECTRÓNICA. Las partes aceptan que este documento se suscriba por medios `
      + `electrónicos y reconocen su plena validez y fuerza probatoria en los términos de la Ley 527 `
      + `de 1999. La integridad del texto queda amparada por el sello criptográfico asociado a cada `
      + `firma.`,
    '',
    `Otorgada en ${d.ciudad} ${fechaFirmaEnLetras(d.fecha)}.`,
    '',
    `El presente documento se suscribe en ${EJEMPLARES_REGISTRO} ejemplares del mismo tenor.`,
  ].join('\n');
}

// ⚖️ REVISAR: dos decisiones que el modelo del abogado deja abiertas y que no dependen
// del texto sino de la operación:
//
//  1. El correo de habeas data es hoy el general de notificaciones. La ley no exige uno
//     dedicado, pero la política publicada debe indicar el mismo que diga este
//     documento, y quien lo atienda tiene plazos legales (cláusula SÉPTIMA).
//  2. El AVISO LEGAL del .docx advierte que hay que adoptar un Manual Interno
//     (art. 17 lit. k del Decreto 1377) y comprobar si los activos de la sociedad
//     obligan a registrar las bases de datos ante la SIC. Ninguna de las dos cosas es
//     código, pero sin ellas la autorización queda coja.
