// Núcleo compartido de creación de reservas.
//
// Existen HOY dos vías para que nazca una reserva:
//   1) la pública, que usa el propio cliente desde la app  → POST /api/reservas
//   2) la del punto de atención ("mostrador"), donde un admin/secretaria crea la
//      reserva para un cliente que llega presencialmente → POST /api/admin/reservas
//
// Las dos comparten TODAS las reglas de negocio (mínimo de noches, documentos
// obligatorios —incluido el contraste del pasaporte contra el tipo de documento
// registrado del titular—, lugar de recogida/entrega, vehículo reservable, solapamiento con
// otras reservas, calendario `dias_disponibles` del propietario, cálculo de
// días/recargo/total y el INSERT en `reservas`). Este módulo es el único sitio
// donde viven, justamente para que no se dupliquen "a ojo" y una de las dos se
// quede sin validar algo dentro de tres meses.
//
// Cuando una regla NO es idéntica en las dos vías, la diferencia se parametriza acá
// (`ViaReserva`) en vez de resolverse omitiendo la llamada en una de las rutas. Hoy
// la única así es el mínimo de noches: 2 por la web, 1 en mostrador (ver
// `MIN_NOCHES_POR_VIA`).
//
// Lo que NO vive aquí, a propósito, es lo que SÍ difiere entre las dos vías:
// quién puede llamar (rol/permiso), los gates de cuenta del cliente
// (correo verificado / perfil completo), el estado inicial de la reserva y sus
// efectos posteriores (correos, contabilidad, operación logística).
//
// Módulo de SERVIDOR (toca better-sqlite3 vía el tipo y hace queries): no
// importar desde un componente 'use client'.
import type Database from 'better-sqlite3';
import { calcularDiasAlquiler, calcularTotalAlquiler, calcularRecargo, lugarValido, normalizarLugar, type Lugar } from './lugares';
import { MIN_NOCHES_RESERVA } from './disponibilidad-reglas';
import { esUrlDeStorageValida } from './storage';
import { validarDireccion, validarCiudad, validarNombreContacto, validarTelefonoContacto } from './validacion';

type DB = Database.Database;

/** Error de negocio ya listo para volverse `NextResponse.json({ error }, { status })`. */
export type ErrorReserva = { error: string; status: number };

const txt = (v: unknown) => String(v ?? '').trim();

// ── Fechas ───────────────────────────────────────────────────────────────────

/** Por cuál de las dos vías nace la reserva. Ver la cabecera de este módulo. */
export type ViaReserva = 'publica' | 'mostrador';

/**
 * Mínimo de noches EXIGIBLE, por vía.
 *
 * La regla del negocio sigue siendo `MIN_NOCHES_RESERVA` (hoy 2) y no se toca: es
 * la que aplica a quien reserva solo por la web, donde no hay nadie del equipo
 * evaluando si ese alquiler de un día conviene.
 *
 * ── Excepción deliberada del MOSTRADOR (1 noche) ────────────────────────────
 * Decisión del dueño: en el punto de atención SÍ se puede alquilar por un solo día.
 * Ahí el empleado (admin, socio o secretaría) tiene al cliente enfrente, ve el
 * documento, recibe el pago y puede decidir caso por caso; el mínimo existe para
 * evitar reservas de un día pedidas a ciegas por internet, no para impedir que el
 * equipo las haga.
 *
 * Se modela como tabla vía → mínimo, y no omitiendo la llamada en la ruta de
 * mostrador, por dos motivos: (a) la exención queda escrita en un sitio, con su
 * porqué, en vez de ser la AUSENCIA de una línea que alguien puede leer como un
 * olvido; (b) el mostrador sigue teniendo un piso real (1 noche), así que la
 * validación de allí no se vuelve decorativa.
 *
 * El 1 no es redundante con `validarFormatoFechas` (que exige fin > inicio): es la
 * misma garantía por otra vía, y si mañana el mínimo de mostrador sube a 2 basta
 * cambiar este número.
 */
export const MIN_NOCHES_POR_VIA: Record<ViaReserva, number> = {
  publica: MIN_NOCHES_RESERVA,
  mostrador: 1,
};

/**
 * Mínimo de noches. Se conserva EXACTAMENTE el cálculo que tenía POST /api/reservas
 * (Math.ceil sin el Math.max(1) de `calcularDiasAlquiler`, que es otra cosa: los
 * días que se COBRAN) y, para la vía pública, el mismo mensaje palabra por palabra.
 *
 * `via` es obligatorio a propósito: si mañana aparece una tercera forma de crear
 * reservas, el compilador obliga a decidir qué mínimo le toca en vez de heredar en
 * silencio la excepción del mostrador.
 */
export function validarNochesMinimas(fechaInicio: string, fechaFin: string, via: ViaReserva): ErrorReserva | null {
  const minimo = MIN_NOCHES_POR_VIA[via];
  const noches = Math.ceil((new Date(fechaFin).getTime() - new Date(fechaInicio).getTime()) / 86400000);
  if (noches < minimo) {
    return { error: `El alquiler mínimo es de ${minimo} ${minimo === 1 ? 'noche' : 'noches'}.`, status: 400 };
  }
  return null;
}

/**
 * Formato de fecha (YYYY-MM-DD) y orden inicio < fin.
 *
 * OJO: esto NO lo valida la ruta pública (histórico: ahí una fecha basura da
 * `noches = NaN`, que no dispara el mínimo y termina guardada tal cual). Se
 * expone aparte, en vez de meterlo dentro de `validarNochesMinimas`, para poder
 * exigirlo en la vía nueva de mostrador SIN cambiarle el comportamiento a la
 * ruta pública, que está fuera del alcance de este cambio.
 */
export function validarFormatoFechas(fechaInicio: string, fechaFin: string): ErrorReserva | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(fechaInicio) || !iso.test(fechaFin)) {
    return { error: 'Las fechas deben tener el formato AAAA-MM-DD.', status: 400 };
  }
  const ini = new Date(fechaInicio).getTime();
  const fin = new Date(fechaFin).getTime();
  if (Number.isNaN(ini) || Number.isNaN(fin)) {
    return { error: 'Las fechas no son válidas.', status: 400 };
  }
  if (fin <= ini) {
    return { error: 'La fecha de entrega debe ser posterior a la de recogida.', status: 400 };
  }
  return null;
}

/**
 * Días de gracia hacia atrás para la fecha de recogida de una reserva de MOSTRADOR.
 * 1 = se acepta desde ayer. Existe por dos motivos concretos del punto de atención:
 * la entrega de ayer que se alcanza a registrar a la mañana siguiente, y el borde de
 * medianoche (el proceso corre en UTC en Railway, Medellín va 5 horas atrás).
 */
export const DIAS_GRACIA_INICIO_MOSTRADOR = 1;

/** Hoy en horario de Medellín, YYYY-MM-DD. Mismo patrón que `hoyBogota()` en app/api/control/resumen. */
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/**
 * Piso de fecha: la recogida no puede quedar en el pasado.
 *
 * Solo lo usa la vía de MOSTRADOR, y por una razón que no es de usabilidad sino de
 * plata: esa vía crea la reserva ya `confirmada` + `pagado` y dispara contabilidad
 * (factura, liquidación al propietario, remisión). Sin piso, un empleado podía
 * fabricar alquileres con fecha del mes pasado y generar facturación retroactiva.
 * La ruta pública NO lo aplica (crea reservas `pendiente` que un humano aprueba, y
 * cambiarle el comportamiento está fuera del alcance de este módulo).
 *
 * Se compara como texto YYYY-MM-DD (orden lexicográfico == orden cronológico) para
 * no arrastrar husos horarios: `new Date('2026-09-14')` es medianoche UTC, que en
 * Medellín todavía es el 13.
 */
export function validarFechaInicioNoPasada(fechaInicio: string, diasGracia = DIAS_GRACIA_INICIO_MOSTRADOR): ErrorReserva | null {
  const piso = new Date(`${hoyBogota()}T00:00:00Z`);
  piso.setUTCDate(piso.getUTCDate() - diasGracia);
  const pisoStr = piso.toISOString().slice(0, 10);
  if (fechaInicio < pisoStr) {
    return { error: 'La fecha de recogida no puede estar en el pasado.', status: 400 };
  }
  return null;
}

// ── Documentos del cliente ───────────────────────────────────────────────────

export type DocumentosReserva = {
  documento_id_url?: unknown;
  documento_id_url_dorso?: unknown;
  documento_es_pasaporte?: unknown;
  licencia_url?: unknown;
  licencia_url_dorso?: unknown;
};

/**
 * Documentos de una reserva que YA pasaron por `resolverDocumentosIdentidad`.
 *
 * El marcador `__identidadContrastada` no se usa en tiempo de ejecución: existe para
 * que el compilador impida llegar a `insertarReserva` / `precargarDocumentosEnPerfil`
 * con el objeto crudo del body. Sin él, saltarse el contraste del pasaporte (la regla
 * de abajo) sería un olvido silencioso —exactamente lo que ya pasó una vez— en lugar
 * de un error de tipos. Solo este módulo puede construirlo.
 *
 * Además, aquí `documento_es_pasaporte` ya NO es lo que mandó el cliente sino lo que
 * dice el tipo de documento REGISTRADO del titular, que es lo que se persiste en
 * `reservas.documento_es_pasaporte` y lo que decide si se tocan cedula_url/_dorso.
 */
export type DocumentosValidados = DocumentosReserva & {
  documento_es_pasaporte: boolean;
  readonly __identidadContrastada: true;
};

/** Único tipo de documento sin dorso (valor de `usuarios.tipo_documento`). */
export const TIPO_DOCUMENTO_SIN_DORSO = 'pasaporte';

/**
 * Los documentos obligatorios que NO dependen del titular: documento de identidad
 * (frente) y los dos lados de la licencia. Mismos mensajes que ya devolvía la ruta
 * pública, palabra por palabra.
 *
 * El DORSO del documento de identidad NO se valida acá a propósito: su única
 * excepción legítima es el pasaporte, y esa exención no se le puede creer al body
 * (ver `resolverDocumentosIdentidad`), así que hace falta saber quién es el titular.
 */
export function validarDocumentosReserva(d: DocumentosReserva): ErrorReserva | null {
  if (!d.documento_id_url) return { error: 'Debes subir tu documento de identidad.', status: 400 };
  if (!d.licencia_url || !d.licencia_url_dorso) return { error: 'Debes subir frente y dorso de tu licencia de conducción.', status: 400 };
  return null;
}

/**
 * ── Dorso del documento de identidad (obligatorio) ───────────────────────────
 * La única excepción legítima es el pasaporte, que no tiene dorso (solo la página
 * con la foto). Pero `documento_es_pasaporte` lo manda el CLIENTE: si se le cree sin
 * más, cualquiera marca la casilla y se salta el dorso. Se contrasta contra el
 * `tipo_documento` que el TITULAR tiene registrado, que es el único dato que quien
 * hace la petición no controla desde este request. La opción no se elimina: quien de
 * verdad tiene pasaporte sigue pudiendo reservar sin dorso.
 *
 * `tipoDocumentoRegistrado` es:
 *   · vía pública (POST /api/reservas)      → `usuarios.tipo_documento` del usuario
 *                                             autenticado, que es el titular;
 *   · vía mostrador (POST /api/admin/reservas) → el del cliente resuelto: el de su
 *     cuenta (o el que esa misma petición esté completando, `cliente_datos`) si ya
 *     existía, o el del formulario si la cuenta se está creando en el momento. Nunca
 *     el del empleado que atiende.
 *
 * Devuelve los documentos con `documento_es_pasaporte` ya reemplazado por el valor
 * derivado, que es el que hay que guardar y el que decide si se tocan las columnas
 * de cédula del perfil.
 *
 * `descartarDorsoSiPasaporte` (lo usa el mostrador): si el titular es de pasaporte,
 * el dorso se guarda vacío en vez de arrastrar lo que viniera en el body. Esa ruta
 * exige que cada URL guardada sea una subida nuestra y al dorso de un pasaporte no
 * se le exige nada, así que si no se descarta quedaría persistida una URL que nada
 * validó. La vía pública NO lo usa: conserva el comportamiento que tiene hoy.
 */
export function resolverDocumentosIdentidad(
  d: DocumentosReserva,
  tipoDocumentoRegistrado: unknown,
  opts: { descartarDorsoSiPasaporte?: boolean } = {},
): { documentos: DocumentosValidados } | { error: ErrorReserva } {
  const esPasaporte = String(tipoDocumentoRegistrado ?? '').trim() === TIPO_DOCUMENTO_SIN_DORSO;

  if (d.documento_es_pasaporte && !esPasaporte) {
    return { error: {
      error: 'Tu documento registrado no es un pasaporte, así que necesitamos también el dorso. ' +
             'Si te registraste con pasaporte, escríbenos por el chat de soporte para corregir tu tipo de documento.',
      status: 400,
    } };
  }
  if (!esPasaporte && !d.documento_id_url_dorso) {
    return { error: { error: 'Falta el dorso de tu documento de identidad.', status: 400 } };
  }

  return { documentos: {
    ...d,
    documento_id_url_dorso: esPasaporte && opts.descartarDorsoSiPasaporte ? '' : d.documento_id_url_dorso,
    documento_es_pasaporte: esPasaporte,
    __identidadContrastada: true,
  } };
}

// ── Lugar de recogida / entrega ──────────────────────────────────────────────

/**
 * Valida recogida y entrega y DEVUELVE los lugares ya normalizados (ver
 * `normalizarLugar` en lib/lugares.ts). Las dos rutas deben usar lo que devuelve
 * esta función —y no el objeto crudo del body— para calcular el recargo y para
 * guardar: así lo que se cobra, lo que se valida y lo que queda en la fila de
 * `reservas` son literalmente el mismo dato. Normalizar en un solo punto de
 * entrada es lo que impide que `municipio: ' aeropuerto-jmc '` pase la validación
 * por el atajo de aeropuerto y salga con recargo $0.
 */
export function validarLugaresReserva(
  recogida?: unknown, entrega?: unknown,
): { lugares: { recogida: Lugar; entrega: Lugar } } | { error: ErrorReserva } {
  const r = normalizarLugar(recogida);
  if (!r || !lugarValido(r)) return { error: { error: 'Indica el lugar y la hora de recogida.', status: 400 } };
  const e = normalizarLugar(entrega);
  if (!e || !lugarValido(e)) return { error: { error: 'Indica el lugar y la hora de entrega.', status: 400 } };
  return { lugares: { recogida: r, entrega: e } };
}

// ── Vehículo y disponibilidad ────────────────────────────────────────────────

/**
 * `archivado = 0` explícito además de `disponible = 1`: un vehículo archivado ya
 * queda con `disponible = 0` al archivarse (ver lib/eliminar.ts), pero se valida
 * acá también en defensa en profundidad — nunca debe poder reservarse uno archivado.
 */
export function cargarVehiculoReservable(db: DB, vehiculoId: number): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM vehiculos WHERE id = ? AND disponible = 1 AND archivado = 0')
    .get(vehiculoId) as Record<string, unknown> | undefined;
}

/** Solapamiento con cualquier otra reserva no cancelada del mismo vehículo. */
export function hayConflictoDeFechas(db: DB, vehiculoId: number, fechaInicio: string, fechaFin: string): boolean {
  const conflicto = db.prepare(`
    SELECT id FROM reservas
    WHERE vehiculo_id = ? AND estado NOT IN ('cancelada')
    AND NOT (fecha_fin < ? OR fecha_inicio > ?)
  `).get(vehiculoId, fechaInicio, fechaFin);
  return !!conflicto;
}

/**
 * Calendario del propietario (`vehiculos.dias_disponibles`). Vacío = sin
 * restricción. Devuelve el primer día del rango que NO está abierto, o null.
 */
export function diaFueraDelCalendario(vehiculo: Record<string, unknown>, fechaInicio: string, fechaFin: string): string | null {
  const dispStr = (vehiculo.dias_disponibles as string) || '[]';
  let diasDisp: string[] = [];
  try { diasDisp = JSON.parse(dispStr); } catch { diasDisp = []; }
  if (diasDisp.length === 0) return null;

  const dispSet = new Set(diasDisp);
  const cur = new Date(fechaInicio);
  const fin = new Date(fechaFin);
  while (cur < fin) {
    const str = cur.toISOString().split('T')[0];
    if (!dispSet.has(str)) return str;
    cur.setDate(cur.getDate() + 1);
  }
  return null;
}

/** Solapamiento (409) + calendario del propietario (409), en ese orden. */
export function validarDisponibilidadFechas(
  db: DB, vehiculo: Record<string, unknown>, fechaInicio: string, fechaFin: string,
): ErrorReserva | null {
  if (hayConflictoDeFechas(db, Number(vehiculo.id), fechaInicio, fechaFin)) {
    return { error: 'Vehículo no disponible en esas fechas', status: 409 };
  }
  const diaMalo = diaFueraDelCalendario(vehiculo, fechaInicio, fechaFin);
  if (diaMalo) return { error: `El día ${diaMalo} no está disponible`, status: 409 };
  return null;
}

// ── Datos de la operación (dirección / ciudad / contacto de emergencia) ──────

// `tipo_documento` no lo usa `resolverDatosOperacion`: viaja acá porque es la misma
// fila y la vía pública lo necesita para el contraste del pasaporte
// (`resolverDocumentosIdentidad`). Se lee de una sola vez, como hacía la ruta antes
// de extraerse a este módulo.
export type PerfilOperacion = { tipo_documento?: string | null; direccion: string | null; ciudad: string | null; contacto_emergencia: string | null };
export type DatosOperacion = { direccion: string; ciudad: string; emergenciaNombre: string; emergenciaTel: string };

export function leerPerfilOperacion(db: DB, usuarioId: number): PerfilOperacion | undefined {
  return db.prepare('SELECT tipo_documento, direccion, ciudad, contacto_emergencia FROM usuarios WHERE id = ?')
    .get(usuarioId) as PerfilOperacion | undefined;
}

/**
 * Resuelve dirección, ciudad y contacto de emergencia mezclando lo que YA tiene
 * el perfil con lo que venga en el body.
 *
 * Usuarios legacy (registro viejo, casi sin validación) pueden tener guardado un
 * valor que las reglas ACTUALES rechazarían (p. ej. ciudad "a", teléfono "300").
 * Priorizar "¿ya lo tiene guardado?" solo por truthiness los dejaría atascados
 * para siempre. Por eso se revalida el valor guardado con las MISMAS reglas que
 * se le exigirían hoy a un dato nuevo; si no pasa, se trata como si no existiera.
 *
 * `perfil` puede ser null/undefined: es el caso del cliente que se está creando
 * en el mostrador y todavía no tiene fila en `usuarios`.
 */
export function resolverDatosOperacion(
  perfil: PerfilOperacion | null | undefined,
  body: { direccion?: unknown; ciudad?: unknown; emergencia_nombre?: unknown; emergencia_tel?: unknown },
): { datos: DatosOperacion } | { error: ErrorReserva } {
  let emergenciaGuardada: { nombre?: string; telefono?: string } = {};
  try { emergenciaGuardada = JSON.parse(perfil?.contacto_emergencia || '{}') || {}; } catch { emergenciaGuardada = {}; }

  const direccionGuardada = txt(perfil?.direccion);
  const direccion = validarDireccion(direccionGuardada) === null ? direccionGuardada : txt(body.direccion);

  const ciudadGuardada = txt(perfil?.ciudad);
  const ciudad = validarCiudad(ciudadGuardada) === null ? ciudadGuardada : txt(body.ciudad);

  const emNombreGuardado = txt(emergenciaGuardada.nombre);
  const emergenciaNombre = validarNombreContacto(emNombreGuardado) === null ? emNombreGuardado : txt(body.emergencia_nombre);

  const emTelGuardado = txt(emergenciaGuardada.telefono).replace(/\D/g, '');
  const emergenciaTel = validarTelefonoContacto(emTelGuardado) === null ? emTelGuardado : txt(body.emergencia_tel).replace(/\D/g, '');

  const errDireccion = validarDireccion(direccion);
  if (errDireccion) return { error: { error: errDireccion, status: 400 } };
  const errCiudad = validarCiudad(ciudad);
  if (errCiudad) return { error: { error: errCiudad, status: 400 } };
  const errEmNombre = validarNombreContacto(emergenciaNombre);
  if (errEmNombre) return { error: { error: errEmNombre, status: 400 } };
  const errEmTel = validarTelefonoContacto(emergenciaTel);
  if (errEmTel) return { error: { error: errEmTel, status: 400 } };

  return { datos: { direccion, ciudad, emergenciaNombre, emergenciaTel } };
}

/**
 * Los guarda en el perfil para no volver a pedirlos en la próxima reserva.
 *
 * Escribe las tres columnas SIEMPRE. Es correcto en la vía pública (el titular es el
 * propio usuario autenticado: está editando sus datos) y en una cuenta recién creada
 * en el mostrador. Para escribir sobre la cuenta PREEXISTENTE de un tercero existe
 * `rellenarDatosOperacionFaltantes`, que no pisa nada.
 */
export function guardarDatosOperacionEnPerfil(db: DB, usuarioId: number, d: DatosOperacion): void {
  db.prepare('UPDATE usuarios SET direccion = ?, ciudad = ?, contacto_emergencia = ? WHERE id = ?')
    .run(d.direccion, d.ciudad, JSON.stringify({ nombre: d.emergenciaNombre, telefono: d.emergenciaTel }), usuarioId);
}

/**
 * Igual que `guardarDatosOperacionEnPerfil`, pero SOLO rellena lo que ya estaba
 * vacío o inválido en ese perfil. Devuelve las columnas efectivamente escritas (para
 * dejarlas en la bitácora).
 *
 * Es la variante que usa el mostrador. Ahí el titular de la reserva NO es quien hace
 * la petición: un empleado manda un `usuario_id` cualquiera, así que un UPDATE
 * incondicional le daba la capacidad de reescribir la dirección, la ciudad y el
 * contacto de emergencia de CUALQUIER cliente del sistema, sin que el dueño de la
 * cuenta se entere. Completar lo que falta sí es parte legítima de atender al cliente
 * en la oficina; sobrescribir lo que ya tenía, no.
 *
 * Qué cuenta como "faltante" es exactamente el mismo criterio de
 * `resolverDatosOperacion` y de `faltanDatosDeOperacion` (lib/cliente-mostrador.ts):
 * un valor legacy que las reglas de HOY rechazarían cuenta como faltante. Como
 * `resolverDatosOperacion` ya conserva el valor guardado cuando es válido, para esos
 * campos el UPDATE sería un no-op; no escribirlos lo vuelve una garantía estructural
 * en vez de una consecuencia derivada.
 */
export function rellenarDatosOperacionFaltantes(
  db: DB, usuarioId: number, perfil: PerfilOperacion | null | undefined, d: DatosOperacion,
): string[] {
  let em: { nombre?: string; telefono?: string } = {};
  try { em = JSON.parse(perfil?.contacto_emergencia || '{}') || {}; } catch { em = {}; }

  const sets: string[] = [];
  const valores: unknown[] = [];
  const columnas: string[] = [];

  if (validarDireccion(txt(perfil?.direccion)) !== null) {
    sets.push('direccion = ?'); valores.push(d.direccion); columnas.push('direccion');
  }
  if (validarCiudad(txt(perfil?.ciudad)) !== null) {
    sets.push('ciudad = ?'); valores.push(d.ciudad); columnas.push('ciudad');
  }
  // El contacto de emergencia es UNA columna con dos subcampos: si cualquiera de los
  // dos falta, se reescribe el JSON completo — pero con los valores ya resueltos por
  // `resolverDatosOperacion`, que conserva el subcampo que sí era válido.
  const emNombreOk = validarNombreContacto(txt(em.nombre)) === null;
  const emTelOk = validarTelefonoContacto(txt(em.telefono).replace(/\D/g, '')) === null;
  if (!emNombreOk || !emTelOk) {
    sets.push('contacto_emergencia = ?');
    valores.push(JSON.stringify({ nombre: d.emergenciaNombre, telefono: d.emergenciaTel }));
    columnas.push('contacto_emergencia');
  }

  if (sets.length === 0) return [];
  valores.push(usuarioId);
  db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...valores);
  return columnas;
}

/**
 * Guarda los documentos frescos de ESTA reserva en el perfil (incluido el dorso,
 * que el atajo de foto del registro nunca captura) para que la PRÓXIMA reserva ya
 * venga precargada (ver app/pago/page.tsx). Best-effort a propósito — si falla,
 * no debe tumbar la creación de la reserva, que es lo importante.
 *
 * Antes de escribir a `usuarios` se exige que cada URL sea de verdad una subida
 * nuestra (`esUrlDeStorageValida`): sin esto, quien arme el body a mano podría
 * inyectar una URL arbitraria que quedara guardada como si fuera el documento del
 * cliente.
 *
 * El UPDATE es DINÁMICO/CONDICIONAL (mismo patrón que POST /api/auth/completar-perfil):
 * solo se toca cada columna cuando el valor de ESTA reserva es válido Y aplica, para
 * no pisar un documento bueno que el usuario ya tenía guardado:
 *   - si el documento de identidad del titular es un pasaporte (`documento_es_pasaporte`
 *     ya viene derivado del tipo REGISTRADO, no del flag del body — ver
 *     `resolverDocumentosIdentidad`), NO se tocan cedula_url/cedula_url_dorso (son de
 *     otro tipo de documento, y el pasaporte no tiene dorso);
 *   - licencia_url/licencia_url_dorso se actualizan siempre que la URL sea válida.
 *
 * ── `soloSiVacio` (obligatorio en la vía de mostrador) ──────────────────────────
 * `esUrlDeStorageValida` valida el DOMINIO, no la PROPIEDAD: confirma que la URL es
 * una subida nuestra, no que sea del titular de esta reserva. En la vía pública eso
 * basta (el titular es el propio usuario autenticado y solo puede escribir sobre su
 * fila). En el mostrador no: el empleado elige el `usuario_id` y GET /api/reservas le
 * muestra las URLs de los documentos de todas las reservas, así que un UPDATE
 * incondicional le permitía tomar la cédula del cliente A y dejarla guardada como
 * documento de identidad del cliente B — y como app/pago/page.tsx precarga la próxima
 * reserva desde el perfil, B seguiría reservando con los papeles de A.
 *
 * Con `soloSiVacio` cada columna se escribe únicamente si estaba vacía: rellenar el
 * dorso que nunca se capturó sigue funcionando, reemplazar un documento existente ya
 * no. Cambiar un documento que el cliente YA tiene es una operación de la ficha de
 * usuario (área "usuarios"), no un efecto colateral de crear una reserva.
 *
 * Devuelve las columnas efectivamente escritas, para poder dejarlas en la bitácora.
 */
export function precargarDocumentosEnPerfil(
  db: DB, usuarioId: number, d: DocumentosValidados, opts: { soloSiVacio?: boolean } = {},
): string[] {
  const sets: string[] = [];
  const valores: unknown[] = [];
  const columnas: string[] = [];

  type DocsPerfil = { cedula_url: string | null; cedula_url_dorso: string | null; licencia_url: string | null; licencia_url_dorso: string | null };
  let actuales: DocsPerfil | undefined;
  if (opts.soloSiVacio) {
    actuales = db.prepare('SELECT cedula_url, cedula_url_dorso, licencia_url, licencia_url_dorso FROM usuarios WHERE id = ?')
      .get(usuarioId) as DocsPerfil | undefined;
    // Si no se pudo leer la fila, se falla CERRADO: no escribir nada es preferible a
    // escribir sin saber qué había.
    if (!actuales) return [];
  }
  const ocupada = (col: keyof DocsPerfil) => !!opts.soloSiVacio && !!String(actuales?.[col] ?? '').trim();

  const poner = (col: keyof DocsPerfil, url: unknown) => {
    if (ocupada(col)) return;
    if (typeof url !== 'string' || !esUrlDeStorageValida(url)) return;
    sets.push(`${col} = ?`); valores.push(url); columnas.push(col);
  };

  if (!d.documento_es_pasaporte) {
    poner('cedula_url', d.documento_id_url);
    poner('cedula_url_dorso', d.documento_id_url_dorso);
  }
  poner('licencia_url', d.licencia_url);
  poner('licencia_url_dorso', d.licencia_url_dorso);

  if (sets.length === 0) return [];
  try {
    valores.push(usuarioId);
    db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...valores);
    return columnas;
  } catch (e) {
    console.error('[reservas] No se pudo precargar los documentos en el perfil (best-effort, no bloquea la reserva):', e instanceof Error ? e.message : e);
    return [];
  }
}

// ── Cobro ────────────────────────────────────────────────────────────────────

/** Días, recargo (autoritativo: server-side) y total bruto antes de créditos. */
export function calcularCobroReserva(
  vehiculo: Record<string, unknown>, fechaInicio: string, fechaFin: string,
  recogida?: Lugar | null, entrega?: Lugar | null,
): { dias: number; recargo: number; totalBruto: number } {
  const dias = calcularDiasAlquiler(fechaInicio, fechaFin);
  const recargo = calcularRecargo(recogida, entrega);
  const totalBruto = calcularTotalAlquiler(dias, Number(vehiculo.precio_dia), recargo);
  return { dias, recargo, totalBruto };
}

// ── INSERT ───────────────────────────────────────────────────────────────────

/** Método de pago registrado en mostrador. '' = no aplica (reserva creada desde la app). */
export const METODOS_PAGO = ['efectivo', 'transferencia', 'datafono', 'otro'] as const;
export type MetodoPago = typeof METODOS_PAGO[number];
export function esMetodoPago(v: unknown): v is MetodoPago {
  return typeof v === 'string' && (METODOS_PAGO as readonly string[]).includes(v);
}

/** Canal por el que nació la reserva. '' = la app (valor histórico de todas las filas previas). */
export const ORIGEN_MOSTRADOR = 'mostrador';

export type NuevaReserva = {
  usuarioId: number;
  vehiculoId: number;
  fechaInicio: string;
  fechaFin: string;
  total: number;
  estado: 'pendiente' | 'confirmada';
  pagoEstado: 'pendiente' | 'pagado';
  documentos: DocumentosValidados;
  firmaContrato: string;
  recogida?: Lugar | null;
  entrega?: Lugar | null;
  recargo: number;
  creditosUsados: number;
  /** Trazabilidad del punto de atención. Se omiten en la vía pública. */
  origen?: string;
  creadaPorAdminId?: number | null;
  metodoPago?: string;
  pagoReferencia?: string;
  pagoRegistradoPor?: number | null;
};

export function insertarReserva(db: DB, r: NuevaReserva): number {
  const d = r.documentos;
  const result = db.prepare(`
    INSERT INTO reservas (
      usuario_id, vehiculo_id, fecha_inicio, fecha_fin, total, pago_estado, estado,
      documento_id_url, documento_id_url_dorso, documento_es_pasaporte,
      licencia_url, licencia_url_dorso,
      firma_contrato, recogida, entrega, recargo, creditos_usados,
      origen, creada_por_admin_id, metodo_pago, pago_referencia, pago_registrado_por
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    r.usuarioId, r.vehiculoId, r.fechaInicio, r.fechaFin, r.total, r.pagoEstado, r.estado,
    (d.documento_id_url as string) || '', (d.documento_id_url_dorso as string) || '', d.documento_es_pasaporte ? 1 : 0,
    (d.licencia_url as string) || '', (d.licencia_url_dorso as string) || '',
    r.firmaContrato || '{}',
    JSON.stringify(r.recogida ?? null), JSON.stringify(r.entrega ?? null), r.recargo, r.creditosUsados,
    r.origen || '', r.creadaPorAdminId ?? null, r.metodoPago || '', r.pagoReferencia || '', r.pagoRegistradoPor ?? null,
  );
  return Number(result.lastInsertRowid);
}
