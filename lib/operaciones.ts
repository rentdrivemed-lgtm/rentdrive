import type Database from 'better-sqlite3';
import { lugarResumen, type Lugar } from './lugares';
import { generarActaCierre } from './acta-servicio';
import { compararFotosVehiculo, type InspeccionResultado } from './inspeccion-vehiculo';
import {
  casillasPendientes, faseDeTarea, fotoDeCasilla, normalizarFotos, parseFotosServicio, parseOmisiones,
  FASES, FASE_NOMBRE,
  type CasillaId, type FaseFoto, type FotoServicio, type OmisionFoto,
} from './fotos-servicio';

type DB = Database.Database;

export type PlantillaTarea = { tipo: string; titulo: string; detalle: string; orden: number };

export type DetalleServicio = {
  reserva_id: number;
  usuario_id: number;
  usuario_nombre: string;
  usuario_celular: string;
  propietario_id: number;
  propietario_nombre: string;
  vehiculo_id: number;
  marca: string;
  modelo: string;
  placa: string;
  fecha_inicio: string;
  fecha_fin: string;
  total: number;
  recogida: string;
  entrega: string;
};

export function plantillaTareas(reserva: { recogida?: unknown; entrega?: unknown; fecha_inicio: string; fecha_fin: string }): PlantillaTarea[] {
  const parseLugar = (v: unknown): Lugar | null => {
    if (!v) return null;
    try { return (typeof v === 'string' ? JSON.parse(v) : v) as Lugar; } catch { return null; }
  };
  const recogidaStr = lugarResumen(parseLugar(reserva.recogida));
  const entregaStr = lugarResumen(parseLugar(reserva.entrega));
  return [
    { tipo: 'preparacion', titulo: 'Lavar el vehículo', detalle: '', orden: 1 },
    { tipo: 'preparacion', titulo: 'Tanquear el vehículo', detalle: '', orden: 2 },
    // La fecha va PRIMERO: `lugarResumen` de un lugar con dirección conocida ya trae su
    // propia raya ("Punto de atención San Joaquín — Calle 42A #68A-10"), y con el orden
    // anterior la tarea salía con dos rayas seguidas ("… #68A-10 — Fecha: …"), ilegible.
    // Así la única raya del renglón es la que separa el lugar de su dirección.
    { tipo: 'entrega', titulo: 'Entregar vehículo al cliente', detalle: `Fecha: ${reserva.fecha_inicio} · Lugar: ${recogidaStr}`, orden: 3 },
    { tipo: 'recepcion', titulo: 'Recibir vehículo del cliente', detalle: `Fecha: ${reserva.fecha_fin} · Lugar: ${entregaStr}`, orden: 4 },
    { tipo: 'inspeccion', titulo: 'Inspección de daños (IA)', detalle: 'Subir fotos de salida y entrada para comparar con IA', orden: 5 },
  ];
}

/**
 * `opciones.guiadas` decide si a la operación se le exigirán las 8 casillas de fotos
 * por fase (columna `fotos_guiadas`, ver lib/db.ts). Por defecto SÍ: una reserva que
 * se confirma ahora nace con el recorrido guiado.
 *
 * Se pasa `false` desde el BACKFILL de GET /api/operaciones, que crea la operación
 * para reservas confirmadas hace tiempo que nunca tuvieron una. Ahí el servicio puede
 * estar hecho desde hace meses y nadie tomó nunca esas fotos: exigirlas dejaría la
 * operación imposible de cerrar por un requisito que no existía cuando tocaba.
 */
export function crearOperacionParaReserva(db: DB, reservaId: number, opciones?: { guiadas?: boolean }): { creada: boolean; operacionId: number } {
  const existe = db.prepare('SELECT id FROM operaciones WHERE reserva_id = ?').get(reservaId) as { id: number } | undefined;
  if (existe) return { creada: false, operacionId: existe.id };

  const reserva = db.prepare('SELECT fecha_inicio, fecha_fin, recogida, entrega FROM reservas WHERE id = ?').get(reservaId) as { fecha_inicio: string; fecha_fin: string; recogida: string; entrega: string } | undefined;
  if (!reserva) throw new Error(`Reserva ${reservaId} no encontrada`);

  // `fotos_guiadas` se pone EXPLÍCITAMENTE acá y no como DEFAULT de la columna: el
  // DEFAULT es 0 justamente para que las operaciones que ya existían cuando se
  // lanzaron las casillas queden exentas del bloqueo de las 8 fotos (ver lib/db.ts).
  const guiadas = opciones?.guiadas === false ? 0 : 1;
  const ins = db.prepare("INSERT INTO operaciones (reserva_id, estado, fotos_guiadas) VALUES (?, 'pendiente', ?)").run(reservaId, guiadas);
  const operacionId = Number(ins.lastInsertRowid);

  const tareas = plantillaTareas(reserva);
  const insTarea = db.prepare('INSERT INTO operacion_tareas (operacion_id, tipo, titulo, detalle, estado, orden) VALUES (?, ?, ?, ?, ?, ?)');
  for (const t of tareas) {
    insTarea.run(operacionId, t.tipo, t.titulo, t.detalle, 'pendiente', t.orden);
  }

  return { creada: true, operacionId };
}

// ── Casillas de fotos del servicio ──────────────────────────────────────────
//
// Las 8 zonas y sus instrucciones viven en lib/fotos-servicio.ts (módulo puro, lo
// comparten las dos pantallas). Acá está lo que necesita la BASE DE DATOS: leer y
// escribir las columnas, y decidir el bloqueo.
//
// El nombre de la columna se saca de este mapa constante y NUNCA de algo que venga
// del cliente: `fase` se valida antes con `esFase`, pero además el literal que
// termina interpolado en el SQL solo puede salir de acá.
const COL_FOTOS: Record<FaseFoto, 'fotos_salida' | 'fotos_entrada'> = {
  salida: 'fotos_salida',
  entrada: 'fotos_entrada',
};

/**
 * Tope de fotos que se aceptan en UNA fase. No se recorta nada en silencio: pasarse
 * es un 400. Existe solo para acotar el tamaño de la columna y del payload (la
 * pantalla nueva manda 8 como máximo); está altísimo a propósito para que ninguna
 * operación vieja, por muchas fotos sueltas que traiga, se vuelva imposible de editar.
 */
export const MAX_FOTOS_FASE = 200;

type FilaFotos = { fotos_salida: string | null; fotos_entrada: string | null; fotos_omitidas: string | null; fotos_guiadas: number | null };

function filaFotos(db: DB, opId: number): FilaFotos | undefined {
  return db.prepare(`
    SELECT COALESCE(fotos_salida,'[]')   AS fotos_salida,
           COALESCE(fotos_entrada,'[]')  AS fotos_entrada,
           COALESCE(fotos_omitidas,'[]') AS fotos_omitidas,
           COALESCE(fotos_guiadas,0)     AS fotos_guiadas
    FROM operaciones WHERE id = ?
  `).get(opId) as FilaFotos | undefined;
}

/** Las fotos de una fase, ya tolerando el formato legado (array plano de strings). */
export function leerFotosFase(db: DB, opId: number, fase: FaseFoto): FotoServicio[] {
  const fila = filaFotos(db, opId);
  return parseFotosServicio(fila?.[COL_FOTOS[fase]]);
}

export function leerOmisiones(db: DB, opId: number): OmisionFoto[] {
  return parseOmisiones(filaFotos(db, opId)?.fotos_omitidas);
}

/** ¿A esta operación se le exigen las 8 casillas por fase? (ver lib/db.ts) */
export function exigeCasillas(db: DB, opId: number): boolean {
  return Number(filaFotos(db, opId)?.fotos_guiadas ?? 0) === 1;
}

function guardarOmisiones(db: DB, opId: number, omisiones: OmisionFoto[]): void {
  db.prepare('UPDATE operaciones SET fotos_omitidas = ? WHERE id = ?').run(JSON.stringify(omisiones), opId);
}

/**
 * Reemplaza TODAS las fotos de una fase. Es la operación cruda que usa la acción
 * legada `fotos` (quitar una foto suelta de una operación vieja). Para la captura
 * guiada se usa `guardarFotoCasilla`, que no pisa el resto.
 */
export function guardarFotosFase(db: DB, opId: number, fase: FaseFoto, fotos: FotoServicio[]): void {
  const limpias = normalizarFotos(fotos);
  db.prepare(`UPDATE operaciones SET ${COL_FOTOS[fase]} = ? WHERE id = ?`).run(JSON.stringify(limpias), opId);
}

/**
 * Quita UNA foto suelta (sin casilla) de una fase, filtrando EN EL SERVIDOR dentro de
 * una transacción.
 *
 * Antes esto se hacía desde la pantalla: el navegador se quedaba con la lista que
 * había cargado, le sacaba la foto y mandaba el resto con la acción `fotos`, que
 * reemplaza la fase entera. O sea que devolvía al servidor un estado viejo: todo lo
 * que otra persona (o el mensajero en la calle) hubiera subido entre la carga de la
 * pantalla y el clic desaparecía sin que nadie se enterara — exactamente el atropello
 * que `guardarFotoCasilla` ya evitaba para las casillas guiadas.
 *
 * Solo toca fotos SIN casilla, que son las únicas que se quitan por este camino: las
 * guiadas se quitan con `guardarFotoCasilla(..., '')`, que además limpia su omisión.
 *
 * Es IDEMPOTENTE: si la foto ya no está (dos clics, dos pestañas), no es un error —
 * el estado final es el que se pedía. Devuelve `true` si de verdad quitó algo, por si
 * el llamador quiere distinguirlo.
 */
export function quitarFotoSuelta(db: DB, opId: number, fase: FaseFoto, url: string): boolean {
  return db.transaction((): boolean => {
    const fila = filaFotos(db, opId);
    if (!fila) return false;
    const actuales = parseFotosServicio(fila[COL_FOTOS[fase]]);
    const quedan = actuales.filter(f => !(f.casilla === null && f.url === url));
    if (quedan.length === actuales.length) return false;
    db.prepare(`UPDATE operaciones SET ${COL_FOTOS[fase]} = ? WHERE id = ?`)
      .run(JSON.stringify(normalizarFotos(quedan)), opId);
    return true;
  })();
}

/**
 * Guarda (o quita, con `url` vacía) la foto de UNA casilla sin tocar las demás.
 *
 * Se hace en el servidor, leyendo-modificando-escribiendo dentro de una
 * transacción, y no mandando la lista completa desde el navegador: el mensajero
 * toma las fotos una por una con señal mala, y dos guardados que se cruzan con la
 * lista completa se pisan entre sí (la segunda respuesta borraba la foto de la
 * primera). Acá cada foto solo puede afectar a su propia casilla.
 *
 * Si la casilla estaba omitida con motivo, la omisión desaparece: ya no hay nada
 * que justificar, la foto está.
 */
export function guardarFotoCasilla(db: DB, opId: number, fase: FaseFoto, casilla: CasillaId, url: string): void {
  db.transaction(() => {
    const fila = filaFotos(db, opId);
    if (!fila) return;
    const actuales = parseFotosServicio(fila[COL_FOTOS[fase]]);
    const resto = actuales.filter(f => f.casilla !== casilla);
    const nuevas = url ? [...resto, { url, casilla }] : resto;
    db.prepare(`UPDATE operaciones SET ${COL_FOTOS[fase]} = ? WHERE id = ?`)
      .run(JSON.stringify(normalizarFotos(nuevas)), opId);
    if (url) {
      const omisiones = parseOmisiones(fila.fotos_omitidas);
      const quedan = omisiones.filter(o => !(o.fase === fase && o.casilla === casilla));
      if (quedan.length !== omisiones.length) guardarOmisiones(db, opId, quedan);
    }
  })();
}

/**
 * Deja constancia de que una casilla NO se pudo fotografiar, con el motivo escrito
 * a mano, quién lo escribió y cuándo. Es la única salida para no dejar al mensajero
 * varado en la calle (sin batería, de noche, el carro encajonado en un parqueadero)
 * y, a la vez, la razón por la que el bloqueo no es una barrera imposible.
 *
 * El motivo sale impreso en el acta de respaldo: omitir no es gratis, queda escrito.
 *
 * Devuelve `false` si esa casilla YA tiene foto: registrar un motivo sobre una foto
 * que existe no significa nada y dejaría el acta diciendo dos cosas a la vez ("acá
 * está la foto" / "no se pudo tomar"). El llamador responde 400.
 */
export function omitirCasilla(
  db: DB, opId: number, fase: FaseFoto, casilla: CasillaId, motivo: string,
  autor: { nombre: string; tipo: 'mensajero' | 'admin' },
): boolean {
  return db.transaction(() => {
    const fila = filaFotos(db, opId);
    if (!fila) return false;
    if (fotoDeCasilla(parseFotosServicio(fila[COL_FOTOS[fase]]), casilla)) return false;
    const omisiones = parseOmisiones(fila.fotos_omitidas).filter(o => !(o.fase === fase && o.casilla === casilla));
    omisiones.push({
      fase,
      casilla,
      motivo,
      autor: autor.nombre,
      autor_tipo: autor.tipo,
      fecha: new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
    });
    guardarOmisiones(db, opId, omisiones);
    return true;
  })();
}

/**
 * Deshace una omisión (el mensajero se equivocó de casilla, o al final sí pudo
 * tomar la foto). La casilla vuelve a contar como pendiente, o sea que esto solo
 * puede VOLVER A BLOQUEAR la tarea: nunca la desbloquea.
 */
export function quitarOmision(db: DB, opId: number, fase: FaseFoto, casilla: CasillaId): void {
  db.transaction(() => {
    const fila = filaFotos(db, opId);
    if (!fila) return;
    guardarOmisiones(db, opId, parseOmisiones(fila.fotos_omitidas).filter(o => !(o.fase === fase && o.casilla === casilla)));
  })();
}

/**
 * EL BLOQUEO. Devuelve el mensaje de error si la tarea `tipoTarea` no se puede
 * marcar como hecha porque faltan fotos de su fase, o `null` si puede seguir.
 *
 * Se llama desde las DOS rutas que marcan tareas (`/api/operaciones/<id>` del panel
 * y `/api/m/<token>` del mensajero). Que la pantalla deshabilite el botón es
 * cosmético: cualquiera con el enlace del mensajero puede llamar la API directo, así
 * que la comprobación de verdad es esta.
 *
 * NO aplica a las operaciones con `fotos_guiadas = 0` — las que ya existían cuando
 * se lanzaron las casillas. Bloquearlas retroactivamente dejaría servicios en curso
 * imposibles de cerrar, y servicios ya cerrados que se reabren no se podrían volver
 * a cerrar, por unas fotos que nadie pidió cuando tocaba tomarlas.
 */
export function bloqueoFotosTarea(db: DB, opId: number, tipoTarea: string): string | null {
  const fase = faseDeTarea(tipoTarea);
  if (!fase) return null;
  const fila = filaFotos(db, opId);
  if (!fila) return null;
  if (Number(fila.fotos_guiadas ?? 0) !== 1) return null;

  const fotos = parseFotosServicio(fila[COL_FOTOS[fase]]);
  const omisiones = parseOmisiones(fila.fotos_omitidas);
  const pendientes = casillasPendientes(fotos, omisiones, fase);
  if (pendientes.length === 0) return null;

  const cuales = pendientes.map(c => c.nombre.toLowerCase()).join(', ');
  const una = pendientes.length === 1;
  const cuantas = una ? 'Falta 1 foto' : `Faltan ${pendientes.length} fotos`;
  const cierre = una
    ? 'Tómala, o escribe el motivo por el que no puedes tomarla.'
    : 'Tómalas, o marca cada una con el motivo por el que no puedes tomarla.';
  return `${cuantas} de ${fase === 'salida' ? 'la entrega' : 'la devolución'}: ${cuales}. ${cierre}`;
}

// ── El veredicto de la IA no puede sobrevivir a las fotos que lo produjeron ──
//
// Caso real de producción: un mensajero fotografió un vehículo EQUIVOCADO (otro carro,
// otra placa), corrió la inspección y cerró el servicio. Quedó guardado un "con daños"
// —un rayón en el capó de un carro que no era el de la reserva— y no había ninguna
// forma de quitarlo: ni por el panel ni por la API. Solo se sobrescribía corriendo otra
// inspección, que además no se puede correr si ya no hay fotos que comparar. El panel
// siguió mostrando "con daños" para un servicio cuyas fotos ya no existían.
//
// Un veredicto de IA huérfano no es un dato incompleto: es la clase de dato con la que
// se le cobra un daño a un cliente que no lo hizo. Por eso se limpia.

/**
 * Borra el veredicto VIVO de la inspección de la operación (`inspeccion_ia` y
 * `inspeccion_estado`). Devuelve `true` solo si de verdad había algo que borrar, para
 * que el llamador sepa si tiene que dejar constancia en la bitácora o avisar en
 * pantalla.
 *
 * ⚠️ NO toca ninguna acta de respaldo. El acta es la fotografía del momento en que se
 * congeló y tiene que seguir diciendo lo que decía entonces —incluido el veredicto que
 * había— aunque el servicio se rehaga después. Lo único que se limpia es el estado vivo.
 */
export function limpiarInspeccion(db: DB, opId: number): boolean {
  const fila = db.prepare(`
    SELECT COALESCE(inspeccion_ia,'') AS ia, COALESCE(inspeccion_estado,'') AS estado
    FROM operaciones WHERE id = ?
  `).get(opId) as { ia: string; estado: string } | undefined;
  if (!fila) return false;
  // Ya estaba limpia: no hay nada que borrar ni nada que auditar.
  if (!fila.ia && (fila.estado === '' || fila.estado === 'pendiente')) return false;
  db.prepare("UPDATE operaciones SET inspeccion_ia = '', inspeccion_estado = 'pendiente' WHERE id = ?").run(opId);
  return true;
}

/**
 * Invalida el veredicto si alguna de las dos fases se quedó SIN NINGUNA foto. Devuelve
 * la fase que quedó vacía si de verdad hubo que limpiar, o `null` si no había nada que
 * hacer. Se llama después de cualquier acción que pueda quitar fotos.
 *
 * ── Por qué "fase vacía" y no "cualquier cambio de foto" ──
 * Repetir UNA foto es el pan de cada día mientras se trabaja: sale movida, sale a
 * contraluz, el mensajero la vuelve a tomar. Si cada foto repetida borrara el
 * veredicto, la inspección sería inservible en la práctica y se gastaría una llamada a
 * la IA cada vez. En cambio, una fase SIN fotos y un veredicto guardado es un estado
 * que ninguna ejecución legítima puede producir: `ejecutarInspeccion` se niega a correr
 * sin fotos en los dos juegos ("No hay fotos de salida para comparar"). O sea que ese
 * veredicto es, con seguridad, de unas fotos que ya no están.
 *
 * ── Por qué automático y no "con aviso" ──
 * Un aviso que se puede cerrar deja el dato huérfano exactamente donde estaba, que es
 * el problema que se está arreglando. Y las fotos también se quitan desde el enlace del
 * mensajero, donde no hay a quién avisar ni quién decida. Se limpia solo, se deja
 * constancia en la bitácora y las actas ya congeladas siguen intactas: nada se pierde
 * de verdad, porque la inspección se puede volver a correr cuando haya fotos nuevas.
 */
export function invalidarInspeccionSiFaseVacia(db: DB, opId: number): FaseFoto | null {
  const fila = filaFotos(db, opId);
  if (!fila) return null;
  const vacia = FASES.find(f => parseFotosServicio(fila[COL_FOTOS[f]]).length === 0);
  if (!vacia) return null;
  return limpiarInspeccion(db, opId) ? vacia : null;
}

/** Texto para la bitácora: "se quedó sin fotos la entrega al cliente". */
export function motivoFaseVacia(fase: FaseFoto): string {
  return `la fase «${FASE_NOMBRE[fase]}» se quedó sin fotos`;
}

export function getConfig(db: DB, clave: string): string {
  const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave) as { valor: string } | undefined;
  return row?.valor ?? '';
}

export function setConfig(db: DB, clave: string, valor: string): void {
  db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor);
}

export function cargarDetalleServicio(db: DB, reservaId: number): DetalleServicio | null {
  const row = db.prepare(`
    SELECT r.id AS reserva_id, r.usuario_id, u.nombre AS usuario_nombre, COALESCE(u.celular,'') AS usuario_celular,
           v.propietario_id, p.nombre AS propietario_nombre,
           r.vehiculo_id, v.marca, v.modelo, COALESCE(v.placa,'') AS placa,
           r.fecha_inicio, r.fecha_fin, r.total,
           COALESCE(r.recogida,'{}') AS recogida, COALESCE(r.entrega,'{}') AS entrega
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios u ON r.usuario_id = u.id
    JOIN usuarios p ON v.propietario_id = p.id
    WHERE r.id = ?
  `).get(reservaId) as DetalleServicio | undefined;
  return row ?? null;
}

export function recomputarEstadoOperacion(db: DB, opId: number, mensajeroId: number | null): void {
  const tareas = db.prepare('SELECT estado FROM operacion_tareas WHERE operacion_id = ?').all(opId) as { estado: string }[];
  const total = tareas.length;
  const hechas = tareas.filter(t => t.estado === 'hecho').length;
  let nuevoEstado: string;
  if (total > 0 && hechas === total) {
    nuevoEstado = 'finalizada';
  } else if (hechas > 0) {
    nuevoEstado = 'en_proceso';
  } else {
    nuevoEstado = mensajeroId ? 'asignada' : 'pendiente';
  }
  const antes = db.prepare('SELECT estado FROM operaciones WHERE id = ?').get(opId) as { estado: string } | undefined;
  db.prepare("UPDATE operaciones SET estado = ? WHERE id = ? AND estado != 'finalizada'").run(nuevoEstado, opId);

  // Al CERRARSE el servicio (última tarea marcada) se congela solo el acta de
  // respaldo: es el momento en que las fotos y los datos ya están completos y
  // justo antes de que alguien pueda borrar una foto sin dejar rastro. Se puede
  // volver a generar después desde el panel (botón "Generar respaldo") si se
  // agregan más fotos, y esa regeneración queda como una versión NUEVA.
  if (nuevoEstado === 'finalizada' && antes?.estado !== 'finalizada') {
    congelarActa(db, opId);
  }
}

/**
 * Congela el acta de respaldo sin que un fallo pueda tumbar la acción que la
 * disparó (marcar una tarea, cerrar el servicio a mano). Si algo sale mal se
 * registra y la operación sigue: el respaldo se puede volver a generar a mano desde
 * el panel, pero perder el marcado de la tarea deja al mensajero atascado en la calle.
 *
 * `generarActaCierre` ya deduplica: si la última versión se congeló con las mismas
 * fotos y las mismas omisiones, no crea una versión nueva. Por eso se puede llamar
 * varias veces en el mismo flujo sin llenar el historial de copias iguales.
 */
export function congelarActa(db: DB, opId: number): void {
  try {
    generarActaCierre(db, opId);
  } catch (e) {
    console.error('[acta] no se pudo generar el acta de cierre:', e instanceof Error ? e.message : e);
  }
}

/**
 * Congela el acta al marcar como HECHA una tarea de fase (entrega o devolución).
 *
 * Entre marcar "vehículo entregado" y cerrar el servicio pueden pasar días, y en ese
 * rato cualquiera con el enlace del mensajero puede quitar las fotos que acaba de
 * subir sin que quede rastro de nada: el bloqueo solo mira el momento en que se marca
 * la tarea. Congelando también acá, ese momento —el único en que consta que las 8
 * fotos estaban— queda guardado. En las tareas que no son de fase (lavar, tanquear,
 * inspección) no hace nada.
 */
export function congelarActaDeFase(db: DB, opId: number, tipoTarea: string): void {
  if (faseDeTarea(tipoTarea) === null) return;
  congelarActa(db, opId);
}

export function mensajeAdmin(det: DetalleServicio): string {
  return [
    '🚗 *Nuevo servicio DrivePass*',
    '',
    `*Vehículo:* ${det.marca} ${det.modelo}${det.placa ? ` (${det.placa})` : ''}`,
    `*Cliente:* ${det.usuario_nombre}`,
    `*Fechas:* ${det.fecha_inicio} → ${det.fecha_fin}`,
    '',
    'Asigna un mensajero en el panel de Operaciones.',
  ].join('\n');
}

export function mensajeMensajero(det: DetalleServicio, tareas: { titulo: string; detalle: string }[], enlace?: string): string {
  const listaTareas = tareas.map(t => `• ${t.titulo}${t.detalle ? `: ${t.detalle}` : ''}`).join('\n');
  const lines = [
    '🚗 *Servicio asignado — DrivePass*',
    '',
    `*Vehículo:* ${det.marca} ${det.modelo}${det.placa ? ` (${det.placa})` : ''}`,
    `*Cliente:* ${det.usuario_nombre}`,
    `*Fechas:* ${det.fecha_inicio} → ${det.fecha_fin}`,
  ];
  if (listaTareas) { lines.push('', '*Tareas:*', listaTareas); }
  if (enlace) { lines.push('', `*Panel de servicio:* ${enlace}`); }
  return lines.join('\n');
}

// Base de los enlaces que salen de la app hacia afuera (panel del mensajero
// /m/<token> por WhatsApp, reseteo de contraseña por correo). Debe apuntar
// SIEMPRE al origen canónico: la cookie de sesión `token` es host-only y la
// allowlist de Origin de lib/csrf.ts solo conoce NEXT_PUBLIC_APP_URL (y su
// variante sin www), así que un enlace a un tercer origen dejaría al usuario
// sin sesión y con los POST bloqueados por CSRF.
// Por eso NEXT_PUBLIC_APP_URL va PRIMERO: hoy RAILWAY_PUBLIC_DOMAIN vale
// "www.drivepasscol.com" y coincide, pero es una variable que inyecta Railway
// y podría pasar a exponer el *.up.railway.app; RAILWAY_PUBLIC_DOMAIN queda
// solo como respaldo para despliegues sin dominio propio configurado.
export function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return '';
}

export async function ejecutarInspeccion(db: DB, opId: number): Promise<InspeccionResultado> {
  const op = db.prepare('SELECT fotos_salida, fotos_entrada, reserva_id FROM operaciones WHERE id = ?').get(opId) as { fotos_salida: string; fotos_entrada: string; reserva_id: number } | undefined;
  if (!op) throw new Error('Operación no encontrada');

  // `parseFotosServicio` (y no un JSON.parse a pelo) porque estas columnas traen
  // DOS formatos: el legado `["url", …]` y el actual `[{casilla, url}, …]`. La
  // casilla es justo lo que la IA necesita para saber qué zona está mirando.
  const fotosSalida = parseFotosServicio(op.fotos_salida);
  const fotosEntrada = parseFotosServicio(op.fotos_entrada);
  if (fotosSalida.length === 0) throw new Error('No hay fotos de salida para comparar');
  if (fotosEntrada.length === 0) throw new Error('No hay fotos de entrada para comparar');

  const vehiculo = db.prepare(`
    SELECT v.marca, v.modelo, COALESCE(v.placa,'') AS placa
    FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id WHERE r.id = ?
  `).get(op.reserva_id) as { marca: string; modelo: string; placa: string } | undefined;

  const resultado = await compararFotosVehiculo(
    { vehiculo: vehiculo ? `${vehiculo.marca} ${vehiculo.modelo}` : '', placa: vehiculo?.placa },
    fotosSalida,
    fotosEntrada,
  );

  db.prepare('UPDATE operaciones SET inspeccion_ia = ?, inspeccion_estado = ? WHERE id = ?')
    .run(JSON.stringify(resultado), resultado.hay_danos_nuevos ? 'con_danos' : 'sin_danos', opId);

  return resultado;
}
