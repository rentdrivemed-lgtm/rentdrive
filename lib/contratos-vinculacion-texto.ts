// ── Los dos contratos de VINCULACIÓN (los que se firman al crear la cuenta) ──
//
// ⚠️⚠️ BORRADOR PENDIENTE DE REVISIÓN LEGAL ⚠️⚠️
//
// A diferencia de lib/contratos-plantillas.ts —que es texto del abogado copiado
// palabra por palabra y que NO se reescribe—, este archivo lo redactó el equipo de
// desarrollo como ESTRUCTURA para que el abogado la revise y la corrija. Mientras
// `VINCULACION_REVISADA_POR_ABOGADO` siga en `false`:
//
//   · la pantalla de firma muestra un aviso visible de que es un borrador, y
//   · `puedeEmitirVinculacion()` (lib/contratos-vinculacion.ts) se niega a emitir
//     en producción, para que nadie firme un texto sin revisar.
//
// Al recibir el texto definitivo: se reemplazan las plantillas de abajo por el del
// abogado, se pone la constante en `true` y se sube. No hace falta tocar nada más.
//
// Las decisiones que el abogado tiene que confirmar van marcadas en el código con
// el comentario `// ⚖️ REVISAR:`.
//
// ⚠️ Módulo PURO (sin BD, sin `fs`): lo importan tanto las rutas de API como las
// pantallas 'use client'.

import { cantidadEnLetras, fechaFirmaEnLetras } from './contratos-texto';
import type { Empresa, Persona } from './contratos-datos';

/**
 * Interruptor de seguridad. En `false` el texto es un borrador del equipo de
 * desarrollo y NO se puede emitir en producción. Lo pone en `true` quien integre el
 * texto que entregue el abogado.
 */
export const VINCULACION_REVISADA_POR_ABOGADO = false;

/** Ejemplares que se firman, igual que el resto de documentos del módulo. */
export const EJEMPLARES_VINCULACION = 2;

export type TipoVinculacion = 'vinculacion-cliente' | 'vinculacion-propietario';

export const TIPOS_VINCULACION: readonly TipoVinculacion[] = [
  'vinculacion-cliente', 'vinculacion-propietario',
] as const;

export const TITULOS_VINCULACION: Record<TipoVinculacion, string> = {
  'vinculacion-cliente': 'Contrato de vinculación de usuario',
  'vinculacion-propietario': 'Contrato marco de vinculación de propietario',
};

/** Prefijo del consecutivo, con la misma forma que CAR-000012 / CAG-000007. */
export const PREFIJO_VINCULACION: Record<TipoVinculacion, string> = {
  'vinculacion-cliente': 'VUS',
  'vinculacion-propietario': 'VPR',
};

/**
 * Código que devuelven las rutas cuando la operación se frena porque falta la firma.
 * Vive en este módulo PURO —y no en contratos-vinculacion.ts, que es server-only—
 * para que la pantalla pueda reconocerlo y mandar a la persona a firmar, igual que
 * `CODIGO_PERFIL_INCOMPLETO` y `CODIGO_CORREO_NO_VERIFICADO`.
 */
export const CODIGO_VINCULACION_PENDIENTE = 'vinculacion_pendiente';

export function esTipoVinculacion(v: unknown): v is TipoVinculacion {
  return typeof v === 'string' && (TIPOS_VINCULACION as readonly string[]).includes(v);
}

/**
 * Qué rol de la tabla `contratos` ocupa el titular de cada documento. Es lo que
 * decide si el titular va en `cliente_id` o en `propietario_id` — ver la nota de
 * lib/db.ts → migrarContratosVinculacion.
 */
export const ROL_TITULAR: Record<TipoVinculacion, 'cliente' | 'propietario'> = {
  'vinculacion-cliente': 'cliente',
  'vinculacion-propietario': 'propietario',
};

/**
 * Datos de un contrato de vinculación. Deliberadamente MUCHO más pequeño que
 * `DatosContrato`: acá no hay vehículo, ni póliza, ni operación, ni liquidación,
 * porque el documento se firma antes de que exista nada de eso.
 */
export type DatosVinculacion = {
  /** Fecha de suscripción (ISO). */
  fecha: string;
  ciudad: string;
  /** La persona que se vincula. */
  titular: Persona;
  agente: Empresa;
  /** Referencias de trazabilidad; no salen impresas. */
  origen: { usuarioId: number };
};

// ── Piezas comunes ──────────────────────────────────────────────────────────

function encabezadoPartes(d: DatosVinculacion, denominacion: string): string {
  return `Entre los suscritos, a saber: ${d.titular.nombre}, mayor de edad, vecino de ${d.titular.ciudad}, `
    + `identificado con ${d.titular.articulo} ${d.titular.tipoDocumento} número ${d.titular.documento}, `
    + `con domicilio en ${d.titular.direccion} y correo electrónico ${d.titular.correo}, quien obra en nombre propio `
    + `y a quien en lo sucesivo se denominará ${denominacion}; y ${d.agente.razonSocial}, sociedad por acciones `
    + `simplificada identificada con el NIT ${d.agente.nit}, con domicilio principal en ${d.agente.domicilio}, `
    + `dirección en la ${d.agente.direccion} y correo electrónico ${d.agente.correo}, representada legalmente por `
    + `${d.agente.representante}, mayor de edad, identificado con la cédula de ciudadanía número `
    + `${d.agente.representanteCedula}, en su calidad de representante legal principal inscrito en el registro `
    + `mercantil, a quien en lo sucesivo se denominará LA PLATAFORMA, hemos convenido celebrar el presente contrato, `
    + `que se regirá por las siguientes`;
}

// Cláusula de firma electrónica. La Ley 527 de 1999 es la que ya citan los contratos
// de operación, así que se mantiene la misma referencia para no tener dos criterios.
function clausulaFirmaElectronica(): string {
  return `FIRMA ELECTRÓNICA. Las partes aceptan que el presente contrato se suscriba por medios electrónicos y `
    + `reconocen la validez y fuerza obligatoria de la firma electrónica aquí empleada, en los términos de la Ley 527 `
    + `de 1999 y sus normas reglamentarias. El titular declara que el trazo de firma y la confirmación de su nombre `
    + `fueron puestos por él mismo, y que conoce que LA PLATAFORMA conserva un sello de integridad que permite `
    + `verificar que el texto no fue alterado con posterioridad a la suscripción.`;
}

// ⚖️ REVISAR: la finalidad y el plazo del tratamiento de datos los tiene que validar
// el abogado contra la política de privacidad vigente de la empresa.
function clausulaDatosPersonales(): string {
  return `TRATAMIENTO DE DATOS PERSONALES. El titular autoriza de manera previa, expresa e informada a LA PLATAFORMA `
    + `para recolectar, almacenar, usar, circular y suprimir sus datos personales, incluidos los documentos de `
    + `identidad y de conducción que aporte, con la finalidad de ejecutar el presente contrato, verificar su identidad, `
    + `gestionar las operaciones de arrendamiento y atender las obligaciones legales y contractuales derivadas. `
    + `El titular conoce que le asisten los derechos de conocer, actualizar, rectificar y suprimir sus datos y a `
    + `revocar esta autorización, en los términos de la Ley 1581 de 2012 y del Decreto 1074 de 2015, los cuales puede `
    + `ejercer escribiendo a ${'notificaciones@drivepasscol.com'}.`;
}

function cierreFirmas(d: DatosVinculacion, denominacion: string): string {
  return `Para constancia se suscribe en ${d.ciudad}, ${fechaFirmaEnLetras(d.fecha)}, en `
    + `${cantidadEnLetras(EJEMPLARES_VINCULACION)} ejemplares del mismo tenor y valor.

${d.titular.nombre}
${d.titular.sigla} ${d.titular.documento}
${denominacion}

${d.agente.representante}
C.C. ${d.agente.representanteCedula}
Representante Legal de ${d.agente.razonSocial}, NIT ${d.agente.nit}
LA PLATAFORMA
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · VINCULACIÓN DE USUARIO (el que alquila)
// ═══════════════════════════════════════════════════════════════════════════
export function contratoVinculacionCliente(d: DatosVinculacion): string {
  return `CONTRATO DE VINCULACIÓN DE USUARIO
${encabezadoPartes(d, 'EL USUARIO')}
CLÁUSULAS
PRIMERA. OBJETO. El presente contrato regula la vinculación de EL USUARIO a la plataforma de intermediación operada por LA PLATAFORMA, a través de la cual podrá consultar vehículos ofrecidos por terceros propietarios y celebrar con ellos contratos de arrendamiento sin conductor. Este contrato NO constituye, por sí solo, el arrendamiento de ningún vehículo: cada operación se documenta en su propio contrato de arrendamiento y en el acta de entrega y devolución correspondientes.
SEGUNDA. CALIDAD EN QUE OBRA LA PLATAFORMA. LA PLATAFORMA obra como agente de los propietarios para la promoción y celebración de los contratos de arrendamiento. En consecuencia, no es propietaria de los vehículos ofrecidos ni asume la posición de arrendadora, sin perjuicio de las obligaciones que expresamente asume frente a EL USUARIO en el presente documento y en cada operación.
TERCERA. DECLARACIONES DE EL USUARIO. EL USUARIO declara que: (i) es mayor de edad y tiene plena capacidad legal para contratar; (ii) la información y los documentos que aporta son veraces y corresponden a su titular; (iii) cuenta con licencia de conducción vigente y apta para la categoría del vehículo que pretenda tomar en arrendamiento; y (iv) no se encuentra impedido legalmente para conducir.
CUARTA. OBLIGACIONES DE EL USUARIO. Son obligaciones de EL USUARIO: (i) mantener actualizada su información de identificación y de contacto; (ii) aportar y mantener vigentes los documentos que le sean exigidos para operar; (iii) destinar los vehículos que tome en arrendamiento al uso pactado, absteniéndose de subarrendar o de permitir su conducción por personas no autorizadas en el contrato respectivo; y (iv) responder por las infracciones de tránsito, fotomultas y comparendos que se causen durante el término en que tenga el vehículo bajo su tenencia.
QUINTA. VERIFICACIÓN DE IDENTIDAD Y DOCUMENTOS. EL USUARIO autoriza a LA PLATAFORMA a verificar la autenticidad y vigencia de los documentos que aporte, así como a suspender o terminar su vinculación cuando la verificación arroje inconsistencias. La verificación no releva a EL USUARIO de la veracidad de lo que declara.
SEXTA. ${clausulaDatosPersonales()}
SÉPTIMA. ${clausulaFirmaElectronica()}
OCTAVA. VIGENCIA Y TERMINACIÓN. El presente contrato rige desde su suscripción y por tiempo indefinido. Cualquiera de las partes podrá terminarlo en cualquier momento mediante aviso escrito, sin que la terminación afecte las operaciones de arrendamiento que se encuentren en curso, las cuales continuarán rigiéndose por sus propios contratos hasta su terminación y liquidación.
NOVENA. LEY APLICABLE Y JURISDICCIÓN. El presente contrato se rige por la ley colombiana. Para todos los efectos, las partes fijan como domicilio contractual la ciudad de Medellín y se someten a la jurisdicción de sus jueces.
${cierreFirmas(d, 'EL USUARIO')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · VINCULACIÓN DE PROPIETARIO (el que pone el carro)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚖️ REVISAR: este documento es el MARCO de la relación con el propietario. El
// contrato de agencia comercial por vehículo (lib/contratos-plantillas.ts →
// contratoAgencia) se sigue firmando por cada vehículo, porque es el que identifica
// placa, tarifa y comisión. Hay que confirmar con el abogado que el marco no se
// solape ni contradiga a aquel, sobre todo en la cláusula de comisión.
export function contratoVinculacionPropietario(d: DatosVinculacion): string {
  return `CONTRATO MARCO DE VINCULACIÓN DE PROPIETARIO
${encabezadoPartes(d, 'EL PROPIETARIO')}
CLÁUSULAS
PRIMERA. OBJETO. El presente contrato regula la vinculación de EL PROPIETARIO a la plataforma operada por LA PLATAFORMA, con el fin de que esta promueva y gestione el arrendamiento de los vehículos que aquel inscriba. Las condiciones económicas de cada vehículo —tarifa, plazo y porcentaje de comisión— se pactan en el contrato de agencia comercial y en los otrosí con valor de orden de servicio que se suscriban respecto de cada automotor, los cuales prevalecen sobre este marco en lo que a esa operación concierne.
SEGUNDA. DECLARACIONES DE EL PROPIETARIO. EL PROPIETARIO declara que: (i) es mayor de edad y tiene plena capacidad legal para contratar; (ii) es propietario de los vehículos que inscriba o está debidamente facultado para disponer de ellos con fines de arrendamiento; (iii) los vehículos se encuentran libres de gravámenes, embargos o limitaciones que impidan su arrendamiento; y (iv) la información y los documentos que aporta son veraces.
TERCERA. INSCRIPCIÓN DE VEHÍCULOS. La inscripción de cada vehículo queda sujeta a la verificación documental y a la inspección física que LA PLATAFORMA determine. LA PLATAFORMA podrá abstenerse de publicar un vehículo, o retirarlo de la vitrina, cuando su documentación no esté vigente o completa, o cuando su estado no resulte apto para el arrendamiento.
CUARTA. OBLIGACIONES DE EL PROPIETARIO. Son obligaciones de EL PROPIETARIO: (i) mantener vigentes la revisión técnico-mecánica, el seguro obligatorio y los demás documentos exigidos por la ley para cada vehículo inscrito; (ii) mantener los vehículos en condiciones mecánicas y de seguridad aptas para su uso; (iii) informar de inmediato cualquier circunstancia que afecte la disponibilidad o la titularidad de un vehículo; y (iv) abstenerse de arrendar directamente, por fuera de la plataforma, los vehículos respecto de los cuales exista una operación en curso gestionada por LA PLATAFORMA.
QUINTA. REMUNERACIÓN. La remuneración de LA PLATAFORMA se causa sobre cada operación de arrendamiento efectivamente celebrada, en el porcentaje y las condiciones que se pacten en el contrato de agencia comercial y en el otrosí correspondiente a cada vehículo. El presente marco no fija por sí mismo porcentaje alguno.
SEXTA. LIQUIDACIÓN Y GIRO. La liquidación de cada operación y el giro de lo que corresponda a EL PROPIETARIO se efectúan en los términos y plazos del contrato de agencia comercial respectivo, a la cuenta bancaria que EL PROPIETARIO indique por escrito y mantenga actualizada.
SÉPTIMA. ${clausulaDatosPersonales()}
OCTAVA. ${clausulaFirmaElectronica()}
NOVENA. VIGENCIA Y TERMINACIÓN. El presente contrato rige desde su suscripción y por tiempo indefinido. Cualquiera de las partes podrá terminarlo en cualquier momento mediante aviso escrito, sin que la terminación afecte las operaciones de arrendamiento en curso ni los contratos de agencia comercial vigentes sobre vehículos inscritos, los cuales continuarán rigiéndose por sus propios términos hasta su terminación y liquidación.
DÉCIMA. LEY APLICABLE Y JURISDICCIÓN. El presente contrato se rige por la ley colombiana. Para todos los efectos, las partes fijan como domicilio contractual la ciudad de Medellín y se someten a la jurisdicción de sus jueces.
${cierreFirmas(d, 'EL PROPIETARIO')}`;
}

export const PLANTILLAS_VINCULACION: Record<TipoVinculacion, (d: DatosVinculacion) => string> = {
  'vinculacion-cliente': contratoVinculacionCliente,
  'vinculacion-propietario': contratoVinculacionPropietario,
};

export function generarTextoVinculacion(tipo: TipoVinculacion, d: DatosVinculacion): string {
  return PLANTILLAS_VINCULACION[tipo](d);
}
