// ── Los DATOS de un contrato que sí se pueden editar ────────────────────────
//
// La distinción que gobierna este módulo, y que no se puede perder de vista:
//
//   · EDITABLE  → los DATOS que rellenan el documento (el número de chasis, la
//                 póliza, el canon, los conductores autorizados).
//   · INTOCABLE → el TEXTO LEGAL. Las cláusulas las redactó un abogado, viven en
//                 lib/contratos-plantillas.ts y se reproducen palabra por palabra.
//                 El sello HMAC de la firma cubre ese texto íntegro precisamente
//                 para que nadie lo altere después. Por eso, al cambiar un dato,
//                 el texto NO se edita: se VUELVE A GENERAR desde la plantilla.
//
// Este archivo es el CATÁLOGO de lo editable: qué campos hay, en qué grupo se
// muestran, **dónde se guarda cada uno**, cómo se valida y —lo que pidió el
// dueño— cómo va a salir impreso, en letras y en números, antes de guardarlo.
//
// ── Dónde vive cada dato (la decisión de diseño) ────────────────────────────
// El criterio es el del dueño: lo que es del VEHÍCULO o de la PERSONA se guarda en
// su ficha, para que sirva a los contratos siguientes y no haya que reescribirlo
// cada vez; lo que es de ESTA operación concreta se guarda en el contrato.
//
//   · `vehiculo`            → columnas de `vehiculos` (color, motor, chasis, valor
//                             asegurado y los datos de la carátula de la póliza).
//   · `usuario_cliente` /
//     `usuario_propietario` → columnas de `usuarios` (documento, vecindad,
//                             dirección, celular, licencia).
//   · `contrato`            → `contratos.overrides_json`, el parche de ESTA
//                             operación: canon, depósito, kilometraje, horas y
//                             lugares, conductores autorizados, fecha de suscripción.
//
// El nombre y el correo NO están aquí a propósito: son la identidad de la cuenta
// (login, verificación, unicidad) y se cambian en el área de usuarios. Cambiarlos
// desde un contrato sería tocar la autenticación por una ventana lateral.
//
// ⚠️ Módulo PURO: sin BD, sin `fs`. Lo importan por igual la ruta de API
// (app/api/contratos/[id]/datos) y la pantalla 'use client' que pinta el formulario
// —de ahí que la vista previa de «cómo va a salir impreso» viva aquí y no en el
// servidor: el que edita tiene que verla mientras escribe.

import {
  anioEnLetras, documentoFormateado, fechaEnLetras, fechaNumerica, horaEnLetras,
  montoEnLetras, partesFecha,
} from './contratos-texto';

// ── Grupos de la pantalla ───────────────────────────────────────────────────

export type GrupoCampo = 'arrendador' | 'arrendatario' | 'vehiculo' | 'poliza' | 'operacion';

export type DefGrupo = { clave: GrupoCampo; titulo: string; nota: string };

export const GRUPOS: readonly DefGrupo[] = [
  {
    clave: 'arrendador', titulo: 'EL ARRENDADOR / EL EMPRESARIO (propietario del vehículo)',
    nota: 'Se guarda en la ficha del propietario, así que sirve para todos sus contratos.',
  },
  {
    clave: 'arrendatario', titulo: 'EL ARRENDATARIO (cliente)',
    nota: 'Se guarda en la ficha del cliente, así que sirve para todos sus contratos.',
  },
  {
    clave: 'vehiculo', titulo: 'EL VEHÍCULO',
    nota: 'Se guarda en la ficha del vehículo: el próximo contrato de este mismo carro ya sale lleno.',
  },
  {
    clave: 'poliza', titulo: 'La póliza todo riesgo',
    nota: 'Datos de la carátula. Se guardan en la ficha del vehículo. Si al grupo le falta una pieza, el documento imprime el grupo entero en blanco (no una frase a medias).',
  },
  {
    clave: 'operacion', titulo: 'Esta operación',
    nota: 'Solo aplica a ESTE documento: se guarda en el contrato, no en la ficha del vehículo ni en la del cliente.',
  },
] as const;

// ── Catálogo ────────────────────────────────────────────────────────────────

export type DestinoCampo = 'usuario_cliente' | 'usuario_propietario' | 'vehiculo' | 'contrato';

export type TipoCampo =
  | 'texto' | 'texto-largo' | 'opcion' | 'documento' | 'placa' | 'serie'
  | 'entero' | 'monto' | 'fecha' | 'hora';

export type DefCampoEditable = {
  /** Clave estable del campo. Es lo que viaja en el cuerpo de la petición. */
  clave: string;
  etiqueta: string;
  grupo: GrupoCampo;
  destino: DestinoCampo;
  /**
   * Columna de la tabla de destino. Vacía para los campos de `contrato`, que se
   * guardan en `overrides_json` bajo la clave que dice `override`.
   */
  columna: string;
  /** Clave dentro de `OverridesContrato` (solo destino 'contrato'). */
  override?: keyof OverridesContrato;
  tipo: TipoCampo;
  /** Ruta dentro de `DatosContrato`: casa el campo con `faltantesDe()`. */
  ruta: string;
  ayuda?: string;
  opciones?: readonly { valor: string; etiqueta: string }[];
  /** Se guarda y se imprime en MAYÚSCULAS (categorías de licencia, siglas). */
  mayusculas?: boolean;
  /** Solo lectura en esta pantalla: se muestra, pero se cambia en otro sitio. */
  soloLectura?: boolean;
  /** Dónde se cambia, cuando es de solo lectura. */
  seCambiaEn?: string;
};

const TIPOS_DOCUMENTO_PERSONA = [
  { valor: 'cedula', etiqueta: 'Cédula de ciudadanía' },
  { valor: 'extranjeria', etiqueta: 'Cédula de extranjería' },
  { valor: 'pasaporte', etiqueta: 'Pasaporte' },
] as const;

export const CAMPOS_EDITABLES: readonly DefCampoEditable[] = [
  // ── EL ARRENDADOR (propietario) ──────────────────────────────────────────
  { clave: 'propietario.nombre', etiqueta: 'Nombre completo', grupo: 'arrendador', destino: 'usuario_propietario', columna: 'nombre', tipo: 'texto', ruta: 'propietario.nombre', soloLectura: true, seCambiaEn: 'la ficha del usuario (área Usuarios)' },
  { clave: 'propietario.tipo_documento', etiqueta: 'Tipo de documento', grupo: 'arrendador', destino: 'usuario_propietario', columna: 'tipo_documento', tipo: 'opcion', ruta: 'propietario.tipoDocumento', opciones: TIPOS_DOCUMENTO_PERSONA },
  { clave: 'propietario.documento_identidad', etiqueta: 'Número de documento', grupo: 'arrendador', destino: 'usuario_propietario', columna: 'documento_identidad', tipo: 'documento', ruta: 'propietario.documento' },
  { clave: 'propietario.ciudad', etiqueta: 'Vecindad (ciudad)', grupo: 'arrendador', destino: 'usuario_propietario', columna: 'ciudad', tipo: 'texto', ruta: 'propietario.ciudad', ayuda: 'Va impresa como «mayor de edad, vecino de …».' },
  { clave: 'propietario.direccion', etiqueta: 'Dirección de notificaciones', grupo: 'arrendador', destino: 'usuario_propietario', columna: 'direccion', tipo: 'texto-largo', ruta: 'propietario.direccion' },
  { clave: 'propietario.celular', etiqueta: 'Celular', grupo: 'arrendador', destino: 'usuario_propietario', columna: 'celular', tipo: 'texto', ruta: 'propietario.celular' },

  // ── EL ARRENDATARIO (cliente) ────────────────────────────────────────────
  { clave: 'cliente.nombre', etiqueta: 'Nombre completo', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'nombre', tipo: 'texto', ruta: 'cliente.nombre', soloLectura: true, seCambiaEn: 'la ficha del usuario (área Usuarios)' },
  { clave: 'cliente.tipo_documento', etiqueta: 'Tipo de documento', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'tipo_documento', tipo: 'opcion', ruta: 'cliente.tipoDocumento', opciones: TIPOS_DOCUMENTO_PERSONA },
  { clave: 'cliente.documento_identidad', etiqueta: 'Número de documento', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'documento_identidad', tipo: 'documento', ruta: 'cliente.documento' },
  { clave: 'cliente.ciudad', etiqueta: 'Vecindad (ciudad)', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'ciudad', tipo: 'texto', ruta: 'cliente.ciudad' },
  { clave: 'cliente.direccion', etiqueta: 'Dirección de notificaciones', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'direccion', tipo: 'texto-largo', ruta: 'cliente.direccion' },
  { clave: 'cliente.celular', etiqueta: 'Celular', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'celular', tipo: 'texto', ruta: 'cliente.celular' },
  { clave: 'cliente.numero_licencia', etiqueta: 'Licencia de conducción (número)', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'numero_licencia', tipo: 'texto', ruta: 'cliente.licencia.numero' },
  { clave: 'cliente.licencia_categoria', etiqueta: 'Categoría de la licencia', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'licencia_categoria', tipo: 'texto', ruta: 'cliente.licencia.categoria', mayusculas: true, ayuda: 'Tal como aparece en el carné: B1, C1, A2…' },
  { clave: 'cliente.licencia_vence', etiqueta: 'Vigencia de la licencia', grupo: 'arrendatario', destino: 'usuario_cliente', columna: 'licencia_vence', tipo: 'fecha', ruta: 'cliente.licencia.vigenciaHasta' },

  // ── EL VEHÍCULO ──────────────────────────────────────────────────────────
  { clave: 'vehiculo.placa', etiqueta: 'Placa', grupo: 'vehiculo', destino: 'vehiculo', columna: 'placa', tipo: 'placa', ruta: 'vehiculo.placa' },
  { clave: 'vehiculo.marca', etiqueta: 'Marca', grupo: 'vehiculo', destino: 'vehiculo', columna: 'marca', tipo: 'texto', ruta: 'vehiculo.marca' },
  { clave: 'vehiculo.modelo', etiqueta: 'Línea', grupo: 'vehiculo', destino: 'vehiculo', columna: 'modelo', tipo: 'texto', ruta: 'vehiculo.linea', ayuda: 'En la base la columna «modelo» guarda la LÍNEA (Corolla, CX-5). El «modelo» del documento es el año.' },
  { clave: 'vehiculo.anio', etiqueta: 'Modelo (año)', grupo: 'vehiculo', destino: 'vehiculo', columna: 'anio', tipo: 'entero', ruta: 'vehiculo.anio' },
  { clave: 'vehiculo.color', etiqueta: 'Color', grupo: 'vehiculo', destino: 'vehiculo', columna: 'color', tipo: 'texto', ruta: 'vehiculo.color', ayuda: 'El de la tarjeta de propiedad.' },
  { clave: 'vehiculo.numero_motor', etiqueta: 'Número de motor', grupo: 'vehiculo', destino: 'vehiculo', columna: 'numero_motor', tipo: 'serie', ruta: 'vehiculo.motor', ayuda: 'Cópialo de la tarjeta de propiedad, carácter por carácter.' },
  { clave: 'vehiculo.numero_chasis', etiqueta: 'Número de chasis', grupo: 'vehiculo', destino: 'vehiculo', columna: 'numero_chasis', tipo: 'serie', ruta: 'vehiculo.chasis', ayuda: 'Cópialo de la tarjeta de propiedad, carácter por carácter.' },
  { clave: 'vehiculo.valor_asegurado', etiqueta: 'Valor asegurado', grupo: 'vehiculo', destino: 'vehiculo', columna: 'valor_asegurado', tipo: 'monto', ruta: 'vehiculo.valorAsegurado', ayuda: 'El de la CARÁTULA DE LA PÓLIZA, que no es el valor comercial del carro.' },

  // ── La póliza ────────────────────────────────────────────────────────────
  { clave: 'poliza.numero', etiqueta: 'Número de la póliza', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_numero', tipo: 'texto', ruta: 'poliza.numero' },
  { clave: 'poliza.aseguradora', etiqueta: 'Aseguradora', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_aseguradora', tipo: 'texto', ruta: 'poliza.aseguradora' },
  { clave: 'poliza.aseguradora_nit', etiqueta: 'NIT de la aseguradora', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_aseguradora_nit', tipo: 'texto', ruta: 'poliza.aseguradoraNit' },
  { clave: 'poliza.expedida_el', etiqueta: 'Fecha de expedición', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_expedida_el', tipo: 'fecha', ruta: 'poliza.expedidaEl' },
  { clave: 'poliza.vigencia_desde', etiqueta: 'Vigencia desde', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_vigencia_desde', tipo: 'fecha', ruta: 'poliza.vigenciaDesde' },
  { clave: 'poliza.vigencia_hasta', etiqueta: 'Vigencia hasta', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_vigencia_hasta', tipo: 'fecha', ruta: 'poliza.vigenciaHasta', ayuda: 'Si se deja vacía se usa la fecha de vencimiento que se cargó con la carátula de la póliza.' },
  { clave: 'poliza.codigo_clausulado', etiqueta: 'Código del clausulado', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_codigo_clausulado', tipo: 'texto', ruta: 'poliza.codigoClausulado' },
  { clave: 'poliza.nota_tecnica', etiqueta: 'Nota técnica', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_nota_tecnica', tipo: 'texto', ruta: 'poliza.notaTecnica' },
  { clave: 'poliza.deducible', etiqueta: 'Deducible', grupo: 'poliza', destino: 'vehiculo', columna: 'poliza_deducible', tipo: 'texto-largo', ruta: 'poliza.deducible', ayuda: 'Se imprime tal cual: «10% del valor de la pérdida, mínimo 1 SMMLV».' },

  // ── Esta operación ───────────────────────────────────────────────────────
  { clave: 'operacion.fecha', etiqueta: 'Fecha de suscripción', grupo: 'operacion', destino: 'contrato', columna: '', override: 'fecha', tipo: 'fecha', ruta: 'fecha', ayuda: 'La fecha con la que se firman los documentos de esta operación.' },
  { clave: 'operacion.entrega_fecha', etiqueta: 'Fecha de entrega', grupo: 'operacion', destino: 'contrato', columna: '', tipo: 'fecha', ruta: 'operacion.entrega.fecha', soloLectura: true, seCambiaEn: 'la reserva (de ella salen los días y el canon)' },
  { clave: 'operacion.entrega_hora', etiqueta: 'Hora de entrega', grupo: 'operacion', destino: 'contrato', columna: '', override: 'entregaHora', tipo: 'hora', ruta: 'operacion.entrega.hora' },
  { clave: 'operacion.entrega_lugar', etiqueta: 'Lugar de entrega', grupo: 'operacion', destino: 'contrato', columna: '', override: 'entregaLugar', tipo: 'texto-largo', ruta: 'operacion.entrega.lugar', ayuda: 'Va impreso tal cual: «Calle 42 A No. 68 A 10 de Medellín, Antioquia».' },
  { clave: 'operacion.restitucion_fecha', etiqueta: 'Fecha de restitución', grupo: 'operacion', destino: 'contrato', columna: '', tipo: 'fecha', ruta: 'operacion.restitucion.fecha', soloLectura: true, seCambiaEn: 'la reserva (de ella salen los días y el canon)' },
  { clave: 'operacion.restitucion_hora', etiqueta: 'Hora de restitución', grupo: 'operacion', destino: 'contrato', columna: '', override: 'restitucionHora', tipo: 'hora', ruta: 'operacion.restitucion.hora' },
  { clave: 'operacion.restitucion_lugar', etiqueta: 'Lugar de restitución', grupo: 'operacion', destino: 'contrato', columna: '', override: 'restitucionLugar', tipo: 'texto-largo', ruta: 'operacion.restitucion.lugar' },
  { clave: 'operacion.canon_diario', etiqueta: 'Canon diario', grupo: 'operacion', destino: 'contrato', columna: '', override: 'canonDiario', tipo: 'monto', ruta: 'derivados.canonDiario', ayuda: 'De aquí salen el canon total, el IVA, la pena de mora y la comisión. Por defecto es lo recaudado dividido en los días.' },
  { clave: 'operacion.deposito', etiqueta: 'Depósito de garantía', grupo: 'operacion', destino: 'contrato', columna: '', override: 'deposito', tipo: 'monto', ruta: 'derivados.deposito' },
  { clave: 'operacion.kilometraje', etiqueta: 'Kilometraje pactado', grupo: 'operacion', destino: 'contrato', columna: '', override: 'kilometraje', tipo: 'texto', ruta: 'operacion.kilometraje', ayuda: 'Hoy la política es «ilimitado».' },
  { clave: 'operacion.costo_km_exceso', etiqueta: 'Costo por kilómetro en exceso', grupo: 'operacion', destino: 'contrato', columna: '', override: 'costoKmExceso', tipo: 'texto', ruta: 'operacion.costoKmExceso' },
] as const;

const POR_CLAVE = new Map<string, DefCampoEditable>(CAMPOS_EDITABLES.map(c => [c.clave, c]));

export function campoEditable(clave: string): DefCampoEditable | null {
  return POR_CLAVE.get(String(clave || '')) ?? null;
}

/** Los campos que de verdad se pueden escribir (los de solo lectura no). */
export function esEscribible(c: DefCampoEditable): boolean {
  return c.soloLectura !== true;
}

// ── El parche de ESTA operación ─────────────────────────────────────────────
//
// Lo que no tiene ficha propia porque es de este alquiler y de ningún otro. Se
// guarda en `contratos.overrides_json` y se aplica SOBRE el snapshot recién leído
// de la base (lib/contratos.ts → armarDatosContrato), nunca sobre el texto.

export type ConductorOverride = {
  nombre: string;
  documento: string;
  licenciaNumero: string;
  licenciaCategoria: string;
  licenciaVence: string;
};

export type OverridesContrato = {
  /** Fecha de suscripción (ISO). */
  fecha?: string;
  canonDiario?: number;
  deposito?: number;
  kilometraje?: string;
  costoKmExceso?: string;
  entregaHora?: string;
  entregaLugar?: string;
  restitucionHora?: string;
  restitucionLugar?: string;
  conductores?: ConductorOverride[];
};

/** Nunca lanza: un JSON corrupto se lee como «sin parche». */
export function parsearOverrides(json: string | null | undefined): OverridesContrato {
  let v: unknown;
  try {
    v = JSON.parse(String(json || '{}'));
  } catch {
    return {};
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: OverridesContrato = {};
  const texto = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x.trim() : undefined);
  const numero = (x: unknown) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  };
  if (texto(o.fecha)) out.fecha = texto(o.fecha);
  if (numero(o.canonDiario) !== undefined) out.canonDiario = numero(o.canonDiario);
  if (numero(o.deposito) !== undefined) out.deposito = numero(o.deposito);
  if (texto(o.kilometraje)) out.kilometraje = texto(o.kilometraje);
  if (texto(o.costoKmExceso)) out.costoKmExceso = texto(o.costoKmExceso);
  if (texto(o.entregaHora)) out.entregaHora = texto(o.entregaHora);
  if (texto(o.entregaLugar)) out.entregaLugar = texto(o.entregaLugar);
  if (texto(o.restitucionHora)) out.restitucionHora = texto(o.restitucionHora);
  if (texto(o.restitucionLugar)) out.restitucionLugar = texto(o.restitucionLugar);
  if (Array.isArray(o.conductores)) {
    const lista = o.conductores.flatMap(c => {
      if (!c || typeof c !== 'object') return [];
      const r = c as Record<string, unknown>;
      const nombre = String(r.nombre ?? '').trim();
      if (!nombre) return [];
      return [{
        nombre,
        documento: String(r.documento ?? '').trim(),
        licenciaNumero: String(r.licenciaNumero ?? '').trim(),
        licenciaCategoria: String(r.licenciaCategoria ?? '').trim(),
        licenciaVence: String(r.licenciaVence ?? '').trim(),
      }];
    });
    if (lista.length) out.conductores = lista.slice(0, MAX_CONDUCTORES);
  }
  return out;
}

export const MAX_CONDUCTORES = 5;

// ── Validación ──────────────────────────────────────────────────────────────
//
// Un chasis o un motor mal escritos no se notan y quedan impresos en un documento
// firmado. Por eso se valida forma, longitud y coherencia, y no solo «no vacío».

export type ValorCampo = string | number;
export type Validacion = { ok: true; valor: ValorCampo } | { ok: false; error: string };

const LARGO_MAXIMO: Record<TipoCampo, number> = {
  'texto': 120, 'texto-largo': 300, 'opcion': 40, 'documento': 30, 'placa': 10,
  'serie': 30, 'entero': 10, 'monto': 15, 'fecha': 10, 'hora': 5,
};

/** Rango de años admisible para un vehículo, con un año de margen hacia adelante. */
const ANIO_MIN = 1950;
const ANIO_MAX = new Date().getFullYear() + 2;

/** Topes de los montos. Altos a propósito: lo que se busca es atajar el dedazo. */
const TOPES_MONTO: Record<string, number> = {
  'vehiculo.valor_asegurado': 5_000_000_000,
  'operacion.canon_diario': 50_000_000,
  'operacion.deposito': 100_000_000,
};

/** Año mínimo/máximo aceptable en cualquier fecha de los documentos. */
const ANIO_FECHA_MIN = 2000;
const ANIO_FECHA_MAX = 2100;

function fechaValida(v: string): boolean {
  try {
    const { anio } = partesFecha(v);
    return anio >= ANIO_FECHA_MIN && anio <= ANIO_FECHA_MAX;
  } catch {
    return false;
  }
}

/**
 * Valida y NORMALIZA un valor. La cadena vacía siempre es válida: significa
 * «todavía no se sabe», y el documento lo imprime como un espacio en blanco con su
 * marca. Inventar un dato es peor que dejar el hueco.
 */
export function validarCampo(def: DefCampoEditable, crudo: unknown): Validacion {
  if (!esEscribible(def)) return { ok: false, error: `«${def.etiqueta}» no se edita desde aquí.` };

  const texto = crudo === null || crudo === undefined ? '' : String(crudo).trim();
  if (texto.length > LARGO_MAXIMO[def.tipo]) {
    return { ok: false, error: `«${def.etiqueta}»: máximo ${LARGO_MAXIMO[def.tipo]} caracteres.` };
  }

  switch (def.tipo) {
    case 'opcion': {
      if (!texto) return { ok: true, valor: '' };
      const ok = (def.opciones || []).some(o => o.valor === texto);
      return ok ? { ok: true, valor: texto } : { ok: false, error: `«${def.etiqueta}»: opción no válida.` };
    }
    case 'documento': {
      if (!texto) return { ok: true, valor: '' };
      const limpio = texto.replace(/[.\s-]/g, '');
      if (!/^[0-9A-Za-z]{5,20}$/.test(limpio)) {
        return { ok: false, error: `«${def.etiqueta}»: debe tener entre 5 y 20 caracteres, sin símbolos.` };
      }
      // Se guarda sin puntos: quien los pone al imprimir es `documentoFormateado`.
      return { ok: true, valor: limpio.toUpperCase() };
    }
    case 'placa': {
      if (!texto) return { ok: true, valor: '' };
      const limpio = texto.replace(/[\s-]/g, '').toUpperCase();
      if (!/^[A-Z]{3}[0-9]{2}[0-9A-Z]$/.test(limpio)) {
        return { ok: false, error: `«${def.etiqueta}»: debe tener la forma ABC123 (o ABC12D en motos).` };
      }
      return { ok: true, valor: limpio };
    }
    case 'serie': {
      if (!texto) return { ok: true, valor: '' };
      const limpio = texto.replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9-]{5,25}$/.test(limpio)) {
        return { ok: false, error: `«${def.etiqueta}»: solo letras y números, entre 5 y 25 caracteres. Cópialo de la tarjeta de propiedad.` };
      }
      return { ok: true, valor: limpio };
    }
    case 'entero': {
      if (!texto) return { ok: true, valor: 0 };
      const n = Number(texto);
      if (!Number.isInteger(n) || n < ANIO_MIN || n > ANIO_MAX) {
        return { ok: false, error: `«${def.etiqueta}»: debe ser un año entre ${ANIO_MIN} y ${ANIO_MAX}.` };
      }
      return { ok: true, valor: n };
    }
    case 'monto': {
      if (!texto) return { ok: true, valor: 0 };
      const n = Number(texto.replace(/[$.\s]/g, '').replace(',', '.'));
      const tope = TOPES_MONTO[def.clave] ?? 1_000_000_000;
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        return { ok: false, error: `«${def.etiqueta}»: escribe un valor en pesos, sin centavos.` };
      }
      if (n > tope) {
        return { ok: false, error: `«${def.etiqueta}»: ${montoEnLetras(tope)} es el tope. Revisa la cifra.` };
      }
      return { ok: true, valor: n };
    }
    case 'fecha': {
      if (!texto) return { ok: true, valor: '' };
      if (!fechaValida(texto)) {
        return { ok: false, error: `«${def.etiqueta}»: escribe una fecha real en formato año-mes-día.` };
      }
      return { ok: true, valor: texto };
    }
    case 'hora': {
      if (!texto) return { ok: true, valor: '' };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(texto)) {
        return { ok: false, error: `«${def.etiqueta}»: escribe la hora en formato 24 h (HH:MM).` };
      }
      return { ok: true, valor: texto };
    }
    case 'texto':
    case 'texto-largo':
    default: {
      // Los saltos de línea reventarían el renglón del documento.
      const limpio = texto.replace(/\s+/g, ' ');
      return { ok: true, valor: def.mayusculas ? limpio.toUpperCase() : limpio };
    }
  }
}

/** Un conductor autorizado completo, validado como lo que es: una parte más. */
export function validarConductor(c: unknown, indice: number): { ok: true; valor: ConductorOverride } | { ok: false; error: string } {
  const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
  const s = (x: unknown) => String(x ?? '').trim().replace(/\s+/g, ' ');
  const nombre = s(r.nombre);
  const documento = s(r.documento).replace(/[.\s-]/g, '');
  const licenciaNumero = s(r.licenciaNumero);
  const licenciaCategoria = s(r.licenciaCategoria);
  const licenciaVence = s(r.licenciaVence);
  const quien = `Conductor autorizado ${indice + 1}`;

  if (nombre.length < 5 || nombre.length > 120) {
    return { ok: false, error: `${quien}: escribe el nombre completo (entre 5 y 120 caracteres).` };
  }
  if (!/^[0-9A-Za-z]{5,20}$/.test(documento)) {
    return { ok: false, error: `${quien}: el documento debe tener entre 5 y 20 caracteres.` };
  }
  if (licenciaNumero && !/^[0-9A-Za-z-]{4,25}$/.test(licenciaNumero)) {
    return { ok: false, error: `${quien}: el número de licencia no tiene una forma válida.` };
  }
  if (licenciaCategoria.length > 20) return { ok: false, error: `${quien}: la categoría de la licencia es demasiado larga.` };
  if (licenciaVence && !fechaValida(licenciaVence)) {
    return { ok: false, error: `${quien}: la vigencia de la licencia debe ser una fecha real (año-mes-día).` };
  }
  return {
    ok: true,
    valor: {
      nombre: nombre.toUpperCase(),
      documento: documento.toUpperCase(),
      licenciaNumero,
      licenciaCategoria: licenciaCategoria.toUpperCase(),
      licenciaVence,
    },
  };
}

// ── Coherencia entre campos ─────────────────────────────────────────────────

export type Coherencia = {
  /** Impiden guardar: son contradicciones objetivas. */
  errores: string[];
  /** No impiden guardar, pero hay que verlos antes de firmar. */
  avisos: string[];
};

export type ValoresCampos = Record<string, ValorCampo>;

function comoFecha(v: ValorCampo | undefined): string {
  return typeof v === 'string' && fechaValida(v) ? v : '';
}

/**
 * Comprobaciones que no se pueden hacer campo a campo: una vigencia que termina
 * antes de empezar, una póliza que vence en mitad del alquiler, una licencia
 * vencida el día de la entrega.
 *
 * `entrega`/`restitucion` son las fechas de la operación, que no se editan aquí.
 */
export function validarCoherencia(v: ValoresCampos, op: { entrega: string; restitucion: string }): Coherencia {
  const errores: string[] = [];
  const avisos: string[] = [];

  const expedida = comoFecha(v['poliza.expedida_el']);
  const desde = comoFecha(v['poliza.vigencia_desde']);
  const hasta = comoFecha(v['poliza.vigencia_hasta']);
  const licencia = comoFecha(v['cliente.licencia_vence']);
  const suscripcion = comoFecha(v['operacion.fecha']);

  if (desde && hasta && desde > hasta) {
    errores.push('La póliza no puede terminar su vigencia antes de empezarla: revisa «Vigencia desde» y «Vigencia hasta».');
  }
  if (expedida && desde && expedida > desde) {
    avisos.push('La póliza figura expedida después del inicio de su vigencia. Verifícalo en la carátula.');
  }
  if (hasta && op.restitucion && hasta < op.restitucion) {
    avisos.push(`La póliza vence el ${fechaNumerica(hasta)} y el vehículo se restituye el ${fechaNumerica(op.restitucion)}: quedaría sin amparo durante el alquiler.`);
  }
  if (licencia && op.restitucion && licencia < op.restitucion) {
    avisos.push(`La licencia del arrendatario vence el ${fechaNumerica(licencia)}, antes de la restitución (${fechaNumerica(op.restitucion)}).`);
  }
  if (suscripcion && op.entrega && suscripcion > op.entrega) {
    avisos.push('La fecha de suscripción es posterior a la entrega del vehículo.');
  }

  const anio = Number(v['vehiculo.anio']);
  if (Number.isFinite(anio) && anio > 0 && anio < ANIO_MIN) {
    errores.push(`El modelo (año) del vehículo debe ser ${ANIO_MIN} o posterior.`);
  }

  return { errores, avisos };
}

// ── Cómo va a salir IMPRESO ─────────────────────────────────────────────────
//
// Lo pidió el dueño con estas palabras: «muestra el dato tal como va a salir
// impreso —en letras y en números— para que quien edita vea exactamente lo que va
// a firmar». Usa los MISMOS conversores que las plantillas (lib/contratos-texto.ts),
// así que lo que se ve aquí es literalmente lo que va a decir el documento.

/** '' cuando el campo está vacío o el valor no se puede convertir. */
export function comoSeImprime(def: DefCampoEditable, valor: ValorCampo): string {
  const texto = typeof valor === 'number' ? String(valor) : String(valor ?? '').trim();
  if (!texto) return '';
  try {
    switch (def.tipo) {
      case 'monto': {
        const n = Math.round(Number(texto.replace(/[$.\s]/g, '')));
        return Number.isFinite(n) && n > 0 ? montoEnLetras(n) : '';
      }
      case 'entero': {
        const n = Number(texto);
        return Number.isInteger(n) && n > 1900 ? anioEnLetras(n) : '';
      }
      case 'fecha':
        return `${fechaEnLetras(texto)}  ·  ${fechaNumerica(texto)}`;
      case 'hora':
        return horaEnLetras(texto);
      case 'documento':
        return documentoFormateado(texto);
      case 'placa':
      case 'serie':
        return texto.toUpperCase();
      case 'opcion': {
        const o = (def.opciones || []).find(x => x.valor === texto);
        return o ? o.etiqueta : texto;
      }
      default:
        // Los nombres y las marcas van en MAYÚSCULAS en los documentos; las
        // direcciones y el deducible, tal cual se escriben.
        return def.mayusculas || def.clave.endsWith('.marca') || def.clave.endsWith('.modelo') || def.clave.endsWith('.nombre')
          ? texto.toUpperCase()
          : texto;
    }
  } catch {
    return '';
  }
}
