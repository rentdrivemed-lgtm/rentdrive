// Calendario de disponibilidad de un vehículo (`vehiculos.dias_disponibles`).
//
// Módulo PURO (sin `fs` ni better-sqlite3): lo importan tanto las rutas de API como los
// editores de calendario del panel del admin y del propietario, igual que lib/pico-placa.ts.
//
// ⚠️ SEMÁNTICA INVERTIDA — leer antes de tocar nada:
// `dias_disponibles` es un array JSON de fechas sueltas 'YYYY-MM-DD' (no rangos), y el array
// VACÍO **no** significa "cerrado": significa "abierto sin restricciones, todos los días
// disponibles" (ver lib/disponibilidad-reglas.ts, POST /api/reservas y GET /api/vehiculos,
// que solo aplican el filtro cuando `dias.length > 0`). Por eso todo lo de acá razona con
// `estaAbierto(dia) = set.size === 0 || set.has(dia)` y nunca con `set.has(dia)` a secas.

// Se reutiliza el formateador que ya usa el calendario (hora LOCAL, sin desfase UTC) en vez
// de escribir otro igual — misma razón por la que este módulo es puro.
import { fechaISOLocal } from './pico-placa';

/**
 * Tope de fechas que se aceptan en un calendario. Las reglas de disponibilidad evalúan una
 * ventana móvil de 12 meses (~366 días) y el editor solo deja marcar mes a mes, así que
 * ~3 años es holgado para cualquier uso legítimo y a la vez impide que alguien arme un body
 * de cientos de miles de fechas para inflar la fila.
 */
export const MAX_DIAS_DISPONIBLES = 1100;

/** Fecha 'YYYY-MM-DD' real (no solo con forma de fecha: rechaza 2026-02-31, 2026-13-01, etc.). */
export function fechaISOValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  // Rango de cordura: el calendario es de operación real, no un archivo histórico.
  if (anio < 2000 || anio > 2100) return false;
  if (mes < 1 || mes > 12) return false;
  // `new Date(anio, mes, 0)` = último día del mes `mes` (1-indexado), en hora local.
  const ultimoDia = new Date(anio, mes, 0).getDate();
  return dia >= 1 && dia <= ultimoDia;
}

/**
 * Zona horaria de operación del negocio. El "hoy" del calendario NO puede depender de la TZ
 * del proceso: en producción los contenedores corren en UTC (no hay `TZ` fijada en el
 * Dockerfile ni en nixpacks.toml), así que entre las 19:00 y la medianoche hora Medellín el
 * `new Date()` del servidor ya está en el día siguiente y el día EN CURSO dejaría de
 * protegerse (se podría cerrar un día que tiene una reserva andando).
 */
export const ZONA_OPERACION = 'America/Bogota';

/**
 * 'YYYY-MM-DD' del instante `ref` visto desde la zona de operación (Medellín).
 *
 * Se usa `Intl` (disponible en Node y en el navegador: este módulo es puro y lo importan los
 * dos) con el locale 'en-CA', que formatea justamente como AAAA-MM-DD. Si por lo que sea el
 * runtime no tuviera datos de zonas horarias, cae al formateo local — peor, pero nunca rompe.
 */
export function hoyISOOperacion(ref: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_OPERACION, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(ref);
  } catch {
    return fechaISOLocal(ref);
  }
}

/**
 * Expande un rango 'YYYY-MM-DD'..'YYYY-MM-DD' en días, en hora local (sin desfase UTC).
 *
 * Por defecto es INCLUSIVO en ambos extremos — mismo criterio que el chequeo de conflictos
 * entre reservas (`NOT (fecha_fin < ? OR fecha_inicio > ?)` en POST /api/reservas) y que las
 * `ocupadas` que ya devuelve GET /api/vehiculos/[id] al calendario público.
 *
 * Con `{ finExclusivo: true }` deja fuera el día de `fin`: es el criterio que necesita
 * `diasOcupadosPorReservas`, porque el gate que realmente consume `dias_disponibles` al crear
 * una reserva recorre `while (cur < fin)` (ver POST /api/reservas). Ahí el día de devolución
 * NO tiene que estar abierto.
 *
 * Tolera timestamps ('2026-10-05T00:00:00') quedándose con los primeros 10 caracteres.
 */
export function diasDeRango(inicio: string, fin: string, opciones: { finExclusivo?: boolean } = {}): string[] {
  const a = String(inicio || '').slice(0, 10);
  const b = String(fin || '').slice(0, 10);
  if (!fechaISOValida(a) || !fechaISOValida(b)) return [];
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const cur = new Date(ay, am - 1, ad);
  const end = new Date(by, bm - 1, bd);
  const out: string[] = [];
  while (opciones.finExclusivo ? cur < end : cur <= end) {
    out.push(fechaISOLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export type ReservaRango = { fecha_inicio: string; fecha_fin: string; estado?: string };

/**
 * Días que una reserva ACTIVA tiene comprometidos en este vehículo.
 *
 * Criterios (documentados a propósito, hay dos decisiones de borde):
 *
 * 1) **Qué es "activa"**: todo estado salvo `cancelada` — mismo criterio que usa el resto
 *    del sistema (GET /api/vehiculos/[id], chequeo de conflictos de POST /api/reservas,
 *    lib/eliminar.ts). `completada` SÍ entra en esa lista, pero…
 * 2) **…solo cuentan los días de HOY en adelante**: una reserva ya terminada (típicamente
 *    `completada`, pero también una `en_curso` que quedó colgada) no debe impedir que el
 *    propietario o el admin cierren días del pasado — cerrarlos no afecta a nadie, porque
 *    `dias_disponibles` solo gatea la CREACIÓN de reservas nuevas. Filtrar por fecha en vez
 *    de por estado cubre el caso sin depender de que el estado esté bien mantenido.
 * 3) **Rango con fin EXCLUSIVO** (`diasDeRango(..., { finExclusivo: true })`): el día de
 *    `fecha_fin` es el de DEVOLUCIÓN y NO entra. El criterio se alinea con el único gate que
 *    consume de verdad `dias_disponibles` al crear una reserva — `while (cur < fin)` en POST
 *    /api/reservas —, que no exige que el día de devolución esté abierto. (Quien impide que
 *    otra reserva arranque ese mismo día es el chequeo de conflictos entre reservas, que es
 *    inclusivo, pero ese chequeo no mira `dias_disponibles` para nada.)
 *
 *    Elegir el inclusivo "por conservador" tenía dos costos reales: el editor pintaba la celda
 *    de `fecha_fin` como normal y clicable pero la unión de `conDiasOcupados` la devolvía sin
 *    ningún aviso (botón muerto), y en un vehículo irrestricto aparecían días marcados en
 *    verde que nadie marcó. Con el criterio exclusivo, lo que se protege es exactamente lo que
 *    la reserva necesita, ni un día más.
 */
export function diasOcupadosPorReservas(reservas: ReservaRango[], hoy: Date = new Date()): Set<string> {
  const hoyISO = hoyISOOperacion(hoy);
  const out = new Set<string>();
  for (const r of reservas) {
    if (r.estado === 'cancelada') continue;
    for (const d of diasDeRango(r.fecha_inicio, r.fecha_fin, { finExclusivo: true })) {
      if (d >= hoyISO) out.add(d); // comparación lexicográfica: válida para 'YYYY-MM-DD'
    }
  }
  return out;
}

/** true si, con este conjunto guardado, el día está abierto (recordar: vacío = todo abierto). */
export function estaAbierto(dias: Set<string>, dia: string): boolean {
  return dias.size === 0 || dias.has(dia);
}

/**
 * Días de `candidatos` que estaban abiertos con `previos` y quedarían CERRADOS con `nuevos`.
 *
 * Contempla la semántica invertida en los dos sentidos:
 *  · pasar de `[]` (irrestricto) a una lista cierra TODO lo que no esté en la lista;
 *  · pasar de una lista a `[]` abre todo, así que nunca cierra nada.
 */
export function diasQueSeCierran(previos: string[], nuevos: string[], candidatos: Iterable<string>): string[] {
  const antes = new Set(previos);
  const despues = new Set(nuevos);
  const cerrados: string[] = [];
  for (const d of candidatos) {
    if (estaAbierto(antes, d) && !estaAbierto(despues, d)) cerrados.push(d);
  }
  return cerrados.sort();
}

/**
 * Une al conjunto elegido los días ocupados por reservas activas que HOY están abiertos, para
 * que un editor no pueda cerrarlos sin querer.
 *
 * Hace falta porque el componente `CalendarioDisponibilidad` **no deja marcar** los días
 * reservados (son celdas deshabilitadas): sin esta unión, un vehículo irrestricto (`[]`) con
 * una reserva activa quedaba en un callejón sin salida — cualquier primer día que se marcara
 * cerraba de golpe los días reservados y el servidor lo rechazaba siempre.
 *
 * `guardados` es lo que hay HOY en BD, y es lo que decide qué se preserva: solo se re-agregan
 * los días ocupados que ya están abiertos (`estaAbierto`). Sin ese filtro, un día ocupado que
 * estaba CERRADO a propósito se abriría solo al guardar cualquier otro cambio — y como cerrarlo
 * no era ningún cierre nuevo, el servidor lo aceptaría sin chistar. Preservar solo lo abierto
 * es exactamente lo que evita el 400, ni un día más.
 *
 * ⚠️ Es una ayuda de CLIENTE, no del servidor: en el PUT no tiene sentido (si el cambio cerraba
 * un día ocupado, el 400 ya salió antes), y ahí el servidor guarda tal cual lo recibido.
 *
 * Si el conjunto elegido está vacío se devuelve vacío tal cual: eso es "abrir sin
 * restricciones", que no cierra ningún día.
 */
export function conDiasOcupados(elegidos: string[], ocupados: Iterable<string>, guardados: string[]): string[] {
  if (elegidos.length === 0) return [];
  const antes = new Set(guardados);
  const preservar = [...ocupados].filter(d => estaAbierto(antes, d));
  return [...new Set([...elegidos, ...preservar])].sort();
}

export type ValidacionDias =
  | { ok: true; dias: string[]; json: string }
  | { ok: false; error: string };

/**
 * Valida lo que llega por el body antes de escribirlo en `dias_disponibles`.
 *
 * Hasta ahora esta columna se escribía SIN ninguna validación: un string que no fuera JSON
 * (o un JSON que no fuera array de fechas) entraba tal cual a la BD y después reventaba en
 * silencio en cada `try { JSON.parse(...) } catch { dias = [] }` del sistema — dejando el
 * vehículo IRRESTRICTO (abierto de par en par) sin que nadie se enterara. Por eso se rechaza
 * con 400 en vez de normalizar en silencio.
 *
 * Acepta el string JSON (lo que mandan los editores) o un array ya parseado.
 */
export function validarDiasDisponibles(raw: unknown): ValidacionDias {
  let valor: unknown = raw;

  if (typeof valor === 'string') {
    const s = valor.trim();
    if (!s) return { ok: true, dias: [], json: '[]' };
    try { valor = JSON.parse(s); }
    catch { return { ok: false, error: 'El calendario de disponibilidad no tiene un formato válido.' }; }
  }

  if (!Array.isArray(valor)) {
    return { ok: false, error: 'El calendario de disponibilidad debe ser una lista de fechas.' };
  }
  if (valor.length > MAX_DIAS_DISPONIBLES) {
    return { ok: false, error: `El calendario no puede tener más de ${MAX_DIAS_DISPONIBLES} días marcados.` };
  }

  const vistos = new Set<string>();
  const dias: string[] = [];
  for (const item of valor) {
    if (!fechaISOValida(item)) {
      // Se trunca: el valor viene del cliente y un item de 100 KB volvería entero en el error.
      // `String(...)` porque JSON.stringify(undefined) devuelve undefined, no un string.
      const crudo = typeof item === 'string' ? item : String(JSON.stringify(item));
      const muestra = crudo.length > 40 ? `${crudo.slice(0, 40)}…` : crudo;
      return { ok: false, error: `Fecha inválida en el calendario: ${muestra}. Se espera el formato AAAA-MM-DD.` };
    }
    if (vistos.has(item)) {
      return { ok: false, error: `La fecha ${item} está repetida en el calendario.` };
    }
    vistos.add(item);
    dias.push(item);
  }

  return { ok: true, dias, json: JSON.stringify(dias) };
}

/** Parseo tolerante de la columna tal como está en BD (para comparar contra lo que llega). */
export function parseDiasGuardados(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter(fechaISOValida);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(fechaISOValida) : [];
  } catch { return []; }
}
