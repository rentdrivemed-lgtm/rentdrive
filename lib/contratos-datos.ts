// ── Los datos que llenan los contratos (snapshot congelable) ────────────────
//
// `DatosContrato` es el equivalente de `DatosActa` (lib/acta-servicio.ts) para los
// contratos: una estructura plana y serializable con TODO lo que los seis
// documentos necesitan. La fase 2 (firma) la congelará tal cual en la BD, de modo
// que un contrato firmado siga diciendo lo que decía aunque después cambie el
// precio del carro o el correo del cliente.
//
// ⚠️ Módulo PURO: sin BD, sin `fs`. Quien lee la base y arma esta estructura es
// lib/contratos.ts (server-only).
//
// ── Sobre los datos que faltan ──────────────────────────────────────────────
// Un dato que no se sabe NO se inventa: el mapeo lo deja en `PENDIENTE` y
// `CAMPOS_CONTRATO` declara cuál es, de dónde sale y en qué documentos aparece. De
// ahí sale `faltantesDe()`, que es lo que la fase 2 usa para NO dejar firmar un
// documento incompleto.
//
// Hasta sep-2026 varios de esos campos no tenían dónde vivir en la base (número de
// motor, chasis, color, valor asegurado, categoría y vigencia de la licencia, los
// datos de la carátula de la póliza): se imprimían en blanco y no había forma de
// llenarlos. Ya la tienen —columnas propias en `vehiculos` y `usuarios`, más el
// parche por operación de `contratos.overrides_json`— y se llenan desde la pantalla
// de datos del contrato (lib/contratos-campos.ts + lib/contratos-edicion.ts).

import type { ConfigIva, Derivados } from './contratos-calculo';

/** Marca visible de dato que falta. Nunca se imprime un dato inventado. */
export const PENDIENTE = '_________________';

export function esPendiente(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === '' || v === PENDIENTE;
}

/** Devuelve el valor o la marca de pendiente. Único punto donde se decide eso. */
export function oPendiente(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? PENDIENTE : s;
}

// ── Identidad de las partes ─────────────────────────────────────────────────

export type Persona = {
  /** Nombre completo. Los documentos lo imprimen en MAYÚSCULAS. */
  nombre: string;
  /** Cómo se nombra el documento en el texto: «cédula de ciudadanía». */
  tipoDocumento: string;
  /** Artículo que le corresponde: «identificado con LA cédula» / «con EL pasaporte». */
  articulo: string;
  /** Sigla de los bloques de firma: «C.C.», «C.E.», «Pasaporte». */
  sigla: string;
  /** Número ya formateado con puntos: «71.739.615». */
  documento: string;
  /** Vecindad: «mayor de edad, vecino de Medellín». */
  ciudad: string;
  direccion: string;
  correo: string;
  celular: string;
  licencia: LicenciaConduccion;
};

export type LicenciaConduccion = { numero: string; categoria: string; vigenciaHasta: string };

export const LICENCIA_VACIA: LicenciaConduccion = { numero: PENDIENTE, categoria: PENDIENTE, vigenciaHasta: PENDIENTE };

/** Un conductor autorizado distinto del arrendatario (acta y otrosí). */
export type ConductorAutorizado = { nombre: string; documento: string; licencia: LicenciaConduccion };

export type Empresa = {
  razonSocial: string;
  nit: string;
  domicilio: string;
  direccion: string;
  correo: string;
  representante: string;
  representanteCedula: string;
};

/**
 * DrivePass, EL AGENTE. Va en constantes y NO en `config` a propósito: lo que hay
 * en `config.empresa_nombre` es el nombre comercial («DrivePass»), no la razón
 * social que firma («DRIVEPASS COL S.A.S.»), y una identificación equivocada en un
 * contrato es un defecto del título. Si mañana cambia el representante legal, se
 * cambia acá y queda en el historial de git.
 */
export const AGENTE: Empresa = {
  razonSocial: 'DRIVEPASS COL S.A.S.',
  nit: '902.088.011-1',
  domicilio: 'Medellín, Antioquia',
  direccion: 'Calle 42 A No. 68 A 10',
  correo: 'notificaciones@drivepasscol.com',
  representante: 'WALTER LUJÁN ARISTIZÁBAL',
  representanteCedula: '98.595.638',
};

/** Ciudad y departamento donde se firma y que es domicilio contractual. */
export const CIUDAD_CONTRATO = 'Medellín, Antioquia';

// ── Vehículo y póliza ───────────────────────────────────────────────────────

export type VehiculoContrato = {
  placa: string;
  /** «marca TOYOTA» → `vehiculos.marca`. */
  marca: string;
  /** «línea TXL» → `vehiculos.modelo` (en la BD la columna «modelo» guarda la LÍNEA). */
  linea: string;
  /** «modelo dos mil veintiséis (2026)» → `vehiculos.anio`. */
  anio: number;
  color: string;
  motor: string;
  chasis: string;
  /** «de servicio particular». */
  servicio: string;
  /** Valor asegurado según la carátula de la póliza, en pesos. 0 = no se conoce. */
  valorAsegurado: number;
};

export type PolizaContrato = {
  numero: string;
  aseguradora: string;
  aseguradoraNit: string;
  /** ISO 'YYYY-MM-DD'. */
  expedidaEl: string;
  vigenciaDesde: string;
  vigenciaHasta: string;
  codigoClausulado: string;
  notaTecnica: string;
  deducible: string;
};

// ── Operación (lo que cambia en cada alquiler) ──────────────────────────────

export type ExtremoOperacion = {
  /** ISO 'YYYY-MM-DD'. */
  fecha: string;
  /** 'HH:MM' en 24 h. */
  hora: string;
  /** Dirección tal como va impresa: «la Calle 42 A No. 68 A 10 de Medellín, Antioquia». */
  lugar: string;
};

export type OperacionContrato = {
  entrega: ExtremoOperacion;
  restitucion: ExtremoOperacion;
  /** Texto del kilometraje pactado. Hoy siempre «ilimitado». */
  kilometraje: string;
  /** Costo por kilómetro en exceso (solo si el kilometraje no es ilimitado). */
  costoKmExceso: string;
  conductores: ConductorAutorizado[];
  /** Fotos tomadas a la entrega y a la devolución (acta). */
  fotosEntrega: number;
  fotosDevolucion: number;
  /**
   * Lo que el mensajero (o quien entregue) anotó con el vehículo delante, por fase.
   *
   * El acta los IMPRIME en vez de dejar rayas para llenar a mano, que es lo que hacía
   * hasta sep-2026 mientras esos mismos datos se tomaban en la app. Ver
   * lib/reporte-entrega.ts. Vacío mientras el reporte no exista todavía.
   */
  reporte?: {
    entrega: ReporteImpreso;
    devolucion: ReporteImpreso;
    /** Quién intervino, para la constancia al pie del acta. */
    intervenciones: { nombre: string; rol: string; accion: string; fase: string; cuando: string }[];
  };
};

/** Numeración de los documentos. Hoy se deriva de los ids; ver lib/contratos.ts. */
export type NumerosContrato = {
  contratoArrendamiento: string;
  otrosiArrendamiento: string;
  contratoAgencia: string;
  otrosiAgencia: string;
  acta: string;
};

// ── El snapshot completo ────────────────────────────────────────────────────

export type DatosContrato = {
  /** Fecha de suscripción de los documentos de ESTA operación (ISO). */
  fecha: string;
  /** Fecha en que se celebró el contrato marco de arrendamiento (ISO). */
  fechaContratoArrendamiento: string;
  /** Fecha en que se celebró el contrato marco de agencia (ISO). */
  fechaContratoAgencia: string;
  ciudad: string;
  /** EL EMPRESARIO (agencia) / EL ARRENDADOR (arrendamiento) / EL ACREEDOR (pagaré). */
  propietario: Persona;
  /** EL ARRENDATARIO / EL OTORGANTE del pagaré. */
  cliente: Persona;
  agente: Empresa;
  vehiculo: VehiculoContrato;
  poliza: PolizaContrato;
  operacion: OperacionContrato;
  numeros: NumerosContrato;
  iva: ConfigIva;
  derivados: Derivados;
  /** Referencias de trazabilidad y descuadres (no salen impresos). */
  origen: {
    reservaId: number; vehiculoId: number; propietarioId: number; clienteId: number;
    /** Lo efectivamente cobrado por el alquiler (total de la reserva − recargo de traslado). */
    canonRecaudado: number;
    /** canonRecaudado − (canon diario × días). Distinto de 0 = hay que resolverlo antes de firmar. */
    ajusteRedondeoCanon: number;
  };
};

// ── Catálogo de campos: de dónde sale cada dato y cuáles NO existen hoy ─────

export type TipoDocumento =
  | 'agencia' | 'otrosi-agencia' | 'arrendamiento' | 'otrosi-arrendamiento' | 'acta-entrega' | 'pagare';

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [
  'agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento', 'acta-entrega', 'pagare',
] as const;

export const TITULOS_DOCUMENTO: Record<TipoDocumento, string> = {
  'agencia': 'Contrato de agencia comercial',
  'otrosi-agencia': 'Otrosí al contrato de agencia comercial (orden de servicio)',
  'arrendamiento': 'Contrato de arrendamiento de vehículo automotor sin conductor',
  'otrosi-arrendamiento': 'Otrosí al contrato de arrendamiento',
  'acta-entrega': 'Acta de entrega y devolución',
  'pagare': 'Pagaré con carta de instrucciones',
};

export type DefCampo = {
  /** Ruta dentro de `DatosContrato`, con puntos. */
  ruta: string;
  etiqueta: string;
  /** Columna/JSON de donde sale, o la razón por la que no sale de ningún lado. */
  fuente: string;
  /**
   * ¿Su ausencia BLOQUEA la firma? (ver lib/contratos-firma.ts → faltantesQueBloquean).
   *
   * ⚠️ El nombre viene de cuando las dos cosas eran la misma: `true` significaba «el
   * dato tiene dónde vivir en la base y está vacío, así que firmar con ese hueco es
   * descuido» y `false`, «la plataforma no guarda ese dato todavía».
   *
   * Desde sep-2026 TODOS los campos de este inventario tienen ya dónde vivir: la
   * pantalla de datos del contrato los llena y los guarda (lib/contratos-campos.ts,
   * lib/db.ts → crearColumnasDatosContrato). Lo que sigue distinguiendo la bandera es
   * si el hueco IMPIDE FIRMAR o si sale en blanco en el documento y se le muestra al
   * firmante antes de que ponga el trazo. Los que quedan en `false` —los datos de la
   * carátula de la póliza, el valor asegurado, el color/motor/chasis— se dejaron sin
   * bloquear a propósito: el texto los imprime como renglones rotulados en blanco (así
   * está redactada el acta) y volverlos bloqueantes dejaría sin poder firmar cualquier
   * operación en la que no se tenga la carátula a mano en el mostrador. Convertirlos en
   * exigibles es una decisión del dueño y se hace cambiando esta bandera, nada más.
   */
  enBD: boolean;
  documentos: TipoDocumento[];
};

/**
 * Inventario explícito de los datos que llenan los documentos: de dónde sale cada
 * uno y si su ausencia impide firmar.
 */
export const CAMPOS_CONTRATO: readonly DefCampo[] = [
  // ── Propietario (EL EMPRESARIO / EL ARRENDADOR / EL ACREEDOR) ────────────
  { ruta: 'propietario.nombre', etiqueta: 'Nombre del propietario', fuente: 'usuarios.nombre', enBD: true, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'propietario.documento', etiqueta: 'Documento del propietario', fuente: 'usuarios.documento_identidad (hoy puede venir NULL)', enBD: true, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'propietario.ciudad', etiqueta: 'Vecindad del propietario', fuente: 'usuarios.ciudad', enBD: true, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento'] },
  { ruta: 'propietario.correo', etiqueta: 'Correo del propietario (notificaciones del Anexo Técnico)', fuente: 'usuarios.correo', enBD: true, documentos: ['agencia'] },

  // ── Cliente (EL ARRENDATARIO / EL OTORGANTE) ─────────────────────────────
  { ruta: 'cliente.nombre', etiqueta: 'Nombre del arrendatario', fuente: 'usuarios.nombre', enBD: true, documentos: ['arrendamiento', 'otrosi-arrendamiento', 'otrosi-agencia', 'acta-entrega', 'pagare'] },
  { ruta: 'cliente.documento', etiqueta: 'Documento del arrendatario', fuente: 'usuarios.documento_identidad', enBD: true, documentos: ['arrendamiento', 'otrosi-arrendamiento', 'otrosi-agencia', 'acta-entrega', 'pagare'] },
  { ruta: 'cliente.ciudad', etiqueta: 'Vecindad del arrendatario', fuente: 'usuarios.ciudad', enBD: true, documentos: ['arrendamiento', 'otrosi-arrendamiento', 'pagare'] },
  { ruta: 'cliente.correo', etiqueta: 'Correo del arrendatario', fuente: 'usuarios.correo', enBD: true, documentos: ['arrendamiento', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'cliente.celular', etiqueta: 'Teléfono del arrendatario', fuente: 'usuarios.celular', enBD: true, documentos: ['acta-entrega'] },
  { ruta: 'cliente.licencia.numero', etiqueta: 'Número de licencia de conducción', fuente: 'usuarios.numero_licencia', enBD: true, documentos: ['acta-entrega'] },
  { ruta: 'cliente.licencia.categoria', etiqueta: 'Categoría de la licencia', fuente: 'usuarios.licencia_categoria (se llena desde la pantalla de datos del contrato)', enBD: false, documentos: ['acta-entrega'] },
  { ruta: 'cliente.licencia.vigenciaHasta', etiqueta: 'Vigencia de la licencia', fuente: 'usuarios.licencia_vence (se llena desde la pantalla de datos del contrato; la IA de documentos ya la lee del carné)', enBD: false, documentos: ['acta-entrega'] },

  // ── Vehículo ─────────────────────────────────────────────────────────────
  { ruta: 'vehiculo.placa', etiqueta: 'Placa', fuente: 'vehiculos.placa', enBD: true, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'vehiculo.marca', etiqueta: 'Marca', fuente: 'vehiculos.marca', enBD: true, documentos: ['otrosi-agencia', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'vehiculo.linea', etiqueta: 'Línea', fuente: 'vehiculos.modelo (la columna «modelo» guarda en realidad la LÍNEA: Corolla, CX-5…)', enBD: true, documentos: ['otrosi-agencia', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'vehiculo.color', etiqueta: 'Color', fuente: 'vehiculos.color (se llena desde la pantalla de datos del contrato; la tarjeta de propiedad lo trae y el OCR lo propone)', enBD: false, documentos: ['acta-entrega'] },
  { ruta: 'vehiculo.motor', etiqueta: 'Número de motor', fuente: 'vehiculos.numero_motor (se llena desde la pantalla de datos del contrato)', enBD: false, documentos: ['acta-entrega'] },
  { ruta: 'vehiculo.chasis', etiqueta: 'Número de chasis', fuente: 'vehiculos.numero_chasis (se llena desde la pantalla de datos del contrato)', enBD: false, documentos: ['acta-entrega'] },
  { ruta: 'vehiculo.valorAsegurado', etiqueta: 'Valor asegurado', fuente: 'vehiculos.valor_asegurado (se llena desde la pantalla de datos del contrato). OJO: `valor_comercial` NO sirve, el contrato cita el valor ASEGURADO de la carátula, que es otro número', enBD: false, documentos: ['agencia'] },

  // ── Póliza ───────────────────────────────────────────────────────────────
  { ruta: 'poliza.numero', etiqueta: 'Número de la póliza', fuente: 'vehiculos.poliza_numero (se llena desde la pantalla de datos del contrato; `documentos.poliza` solo guarda {url, vence})', enBD: false, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'poliza.aseguradora', etiqueta: 'Aseguradora', fuente: 'vehiculos.poliza_aseguradora (ídem)', enBD: false, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'poliza.aseguradoraNit', etiqueta: 'NIT de la aseguradora', fuente: 'vehiculos.poliza_aseguradora_nit (ídem)', enBD: false, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento'] },
  { ruta: 'poliza.expedidaEl', etiqueta: 'Fecha de expedición de la póliza', fuente: 'vehiculos.poliza_expedida_el (ídem)', enBD: false, documentos: ['agencia'] },
  { ruta: 'poliza.vigenciaDesde', etiqueta: 'Vigencia desde', fuente: 'vehiculos.poliza_vigencia_desde (ídem)', enBD: false, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento'] },
  { ruta: 'poliza.vigenciaHasta', etiqueta: 'Vigencia hasta', fuente: 'vehiculos.poliza_vigencia_hasta y, si está vacía, vehiculos.documentos.poliza.vence (la fecha que se carga con la carátula)', enBD: true, documentos: ['agencia', 'otrosi-agencia', 'arrendamiento', 'otrosi-arrendamiento'] },
  { ruta: 'poliza.codigoClausulado', etiqueta: 'Código del clausulado', fuente: 'vehiculos.poliza_codigo_clausulado (ídem)', enBD: false, documentos: ['agencia'] },
  { ruta: 'poliza.notaTecnica', etiqueta: 'Nota técnica', fuente: 'vehiculos.poliza_nota_tecnica (ídem)', enBD: false, documentos: ['agencia'] },
  { ruta: 'poliza.deducible', etiqueta: 'Deducible', fuente: 'vehiculos.poliza_deducible (ídem)', enBD: false, documentos: ['acta-entrega'] },

  // ── Operación ────────────────────────────────────────────────────────────
  { ruta: 'operacion.entrega.fecha', etiqueta: 'Fecha de entrega', fuente: 'reservas.fecha_inicio', enBD: true, documentos: ['otrosi-agencia', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'operacion.entrega.hora', etiqueta: 'Hora de entrega', fuente: 'reservas.recogida.hora (lib/lugares.ts)', enBD: true, documentos: ['otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'operacion.entrega.lugar', etiqueta: 'Lugar de entrega', fuente: 'reservas.recogida', enBD: true, documentos: ['otrosi-arrendamiento'] },
  { ruta: 'operacion.restitucion.fecha', etiqueta: 'Fecha de restitución', fuente: 'reservas.fecha_fin', enBD: true, documentos: ['otrosi-agencia', 'otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'operacion.restitucion.hora', etiqueta: 'Hora de restitución', fuente: 'reservas.entrega.hora', enBD: true, documentos: ['otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'operacion.restitucion.lugar', etiqueta: 'Lugar de restitución', fuente: 'reservas.entrega', enBD: true, documentos: ['otrosi-arrendamiento', 'acta-entrega'] },
  { ruta: 'operacion.costoKmExceso', etiqueta: 'Costo por kilómetro en exceso', fuente: 'contratos.overrides_json (costoKmExceso). Por política el kilometraje es ilimitado, así que por defecto dice «no aplica»', enBD: false, documentos: ['acta-entrega'] },
] as const;

/** Los campos que HOY no tienen dónde vivir en la base. Inventario para el dueño. */
export const CAMPOS_SIN_ORIGEN: readonly DefCampo[] = CAMPOS_CONTRATO.filter(c => !c.enBD);

/**
 * Valor que hay en una ruta del snapshot ('vehiculo.motor', 'derivados.canonDiario').
 * Se exporta porque la pantalla de datos del contrato necesita mostrar, campo por
 * campo, lo que HOY dice el documento — y tiene que leerlo del mismo sitio del que
 * lo lee `faltantesDe()`, o las dos cosas se desincronizan.
 */
export function valorEnRuta(d: DatosContrato, ruta: string): unknown {
  return leerRuta(d, ruta);
}

function leerRuta(obj: unknown, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((acc, parte) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[parte];
    return undefined;
  }, obj);
}

export type CampoFaltante = DefCampo & { valor: string };

/**
 * Qué datos quedaron en blanco en ESTE snapshot. La fase 2 debe usarlo para no
 * dejar firmar un documento con huecos; la fase 1 solo lo reporta.
 * `tipo` filtra por documento: al pagaré no le faltan los datos de la póliza.
 */
export function faltantesDe(d: DatosContrato, tipo?: TipoDocumento): CampoFaltante[] {
  return CAMPOS_CONTRATO
    .filter(c => !tipo || c.documentos.includes(tipo))
    .flatMap(c => {
      const v = leerRuta(d, c.ruta);
      const vacio = typeof v === 'number' ? !Number.isFinite(v) || v <= 0 : esPendiente(v);
      return vacio ? [{ ...c, valor: typeof v === 'string' ? v : String(v ?? '') }] : [];
    });
}

// ── Checklist del acta de entrega y devolución ──────────────────────────────
//
// Los 18 ítems de estado y los 7 conceptos de documentos/mediciones, en el mismo
// orden en que los trae el acta que redactó el abogado. Van como constante —y no
// incrustados en la plantilla— para que la fase 3 pueda dibujar la tabla real en
// el PDF sin volver a teclearlos (y para que nadie los reordene sin darse cuenta).

export const ITEMS_ESTADO_VEHICULO: readonly string[] = [
  'Carrocería y pintura',
  'Vidrios, parabrisas y espejos',
  'Luces delanteras y traseras',
  'Direccionales y luces de freno',
  'Llantas, estado y presión',
  'Llanta de repuesto, gato y cruceta',
  'Rines y copas',
  'Tapicería, sillas y techo interior',
  'Tablero, instrumentos y testigos',
  'Aire acondicionado y calefacción',
  'Equipo de sonido y antena',
  'Cinturones de seguridad',
  'Limpiaparabrisas y plumillas',
  'Niveles de aceite y demás fluidos',
  'Batería y sistema eléctrico',
  'Kit de carretera, extintor y conos',
  'Tapetes y accesorios',
  'Aseo general interior y exterior',
] as const;

/** Lo que de un reporte acaba impreso en el acta. */
export type ReporteImpreso = {
  kilometraje: string;
  combustible: string;
  /** Ítem → 'B' | 'R' | 'M', y la nota si la hay. */
  inventario: Record<string, { estado: string; nota: string }>;
  /** '' si el cliente no confirmó. */
  confirmadoEn: string;
  /** Por qué no confirmó, si ese fue el caso. */
  constancia: string;
};

export const CONCEPTOS_DOCUMENTOS_ACTA: readonly string[] = [
  'Licencia de tránsito',
  'SOAT vigente',
  'Revisión técnico mecánica vigente',
  'Copia de la carátula de la póliza',
  'Llave principal y llave de repuesto',
  'Kilometraje registrado en el odómetro',
  'Nivel de combustible',
] as const;
