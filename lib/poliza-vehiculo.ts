// ── Carátula de la póliza todo riesgo del vehículo ──────────────────────────
//
// ÚNICA FUENTE DE VERDAD de la clave `poliza` dentro de `vehiculos.documentos`.
//
// ── Qué es y por qué es distinta de los demás documentos ────────────────────
// Desde sep-2026 la póliza todo riesgo la expide **DrivePass**, no el propietario
// (por eso se retiró del formulario la vieja clave `todo_riesgo`, que sí subía él).
// La carátula de esa póliza la tiene la empresa, así que es el ÚNICO documento del
// vehículo que **carga el administrador**: el SOAT, la tecno-mecánica y la tarjeta
// de propiedad las sigue subiendo el propietario.
//
// De ahí salen tres reglas que se aplican en el servidor, no en la interfaz:
//
//  1. **Solo el admin escribe `poliza`.** `documentos` está en `ownFields` del
//     PUT /api/vehiculos/[id], o sea que el propietario manda el JSON completo:
//     si no se le arranca esta clave del body, podría subirse su propia "póliza".
//     El PUT la fuerza SIEMPRE al valor que hay en la BD cuando quien edita no es
//     admin (ver el bloque "la carga DrivePass, no el propietario").
//  2. **No entra al estado agregado de documentos** (`DOC_KEYS`/`clavesRelevantes`
//     en esa misma ruta) ni al flujo de revisión/aprobación. Bloquear la
//     publicación de un carro por un documento que el propietario NO puede subir
//     sería castigarlo por una tarea de la empresa.
//  3. **El propietario la VE y la descarga.** Es la póliza de su carro: la ve en su
//     panel con la fecha de vencimiento y una nota de que la gestiona DrivePass.
//
// ── Por qué una clave en `documentos` y no una columna nueva ────────────────
// Se evaluó `vehiculos.poliza_url` + `poliza_vence`. Se quedó dentro de
// `documentos` porque todo lo que ya existe alrededor de ese JSON aplica igual y
// gratis: la validación de que la URL salió de nuestro storage
// (`documentosConUrlsValidas`), la preservación de claves al guardar, el visor de
// documentos del panel y el paquete descargable. Con columnas nuevas habría que
// duplicar cada una de esas piezas y además tocar la paridad SQLite↔Postgres.
// La "barrera real" que se pide no la da el lugar de almacenamiento sino el
// control de escritura, y ese está en el PUT: el propietario no puede escribir
// esta clave ni mandándola explícitamente en el body.
//
// ⚠️ Módulo PURO: sin `fs`, sin `better-sqlite3`. Lo importan tanto las rutas de
// API como los paneles 'use client' (igual que lib/lugares.ts o lib/pico-placa.ts).

/** Nombre de la clave dentro del JSON de `vehiculos.documentos`. */
export const CLAVE_POLIZA = 'poliza';

/** Etiqueta visible, la misma en el panel del admin y en el del propietario. */
export const POLIZA_LABEL = 'Carátula de la póliza todo riesgo';

/**
 * A diferencia del SOAT y la tecno-mecánica —que hoy guardan solo el archivo—, la
 * póliza guarda su fecha de vencimiento: una póliza vencida a mitad de un alquiler
 * es un problema real y hay que poder verlo de un vistazo.
 */
export type PolizaVehiculo = { url: string; vence: string };

/** `YYYY-MM-DD` y además una fecha que existe de verdad (no 2026-02-31). */
export function esFechaISO(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const [y, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const d = new Date(Date.UTC(y, mes - 1, dia));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Lee la póliza de un JSON de `documentos` (crudo o ya parseado). Nunca lanza:
 * cualquier basura devuelve `null`, igual que `parseFotosServicio`. Una entrada sin
 * `vence` (o con un `vence` corrupto) se devuelve con `vence: ''` en vez de
 * descartarse: el archivo existe y hay que poder verlo y descargarlo aunque le
 * falte la fecha.
 */
export function leerPoliza(raw: unknown): PolizaVehiculo | null {
  let valor: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { valor = JSON.parse(raw); } catch { return null; }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const docs = valor as Record<string, unknown>;
  const entrada = docs[CLAVE_POLIZA];
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return null;
  const { url, vence } = entrada as Record<string, unknown>;
  if (typeof url !== 'string' || !url.trim()) return null;
  return { url: url.trim(), vence: esFechaISO(vence) ? String(vence).trim() : '' };
}

/**
 * Normaliza lo que manda el admin al cargar o reemplazar la póliza.
 * Devuelve el error tal como se le debe mostrar, en vez de un booleano: quien
 * carga el documento tiene que saber si el problema es el archivo o la fecha.
 */
export function normalizarPolizaEntrada(raw: unknown): { ok: true; poliza: PolizaVehiculo } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Faltan los datos de la póliza.' };
  }
  const { url, vence } = raw as Record<string, unknown>;
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'Sube la carátula de la póliza antes de guardar.' };
  }
  if (url.length > 2000) {
    return { ok: false, error: 'La dirección del archivo no es válida, vuelve a subirlo.' };
  }
  if (!esFechaISO(vence)) {
    return { ok: false, error: 'Escribe la fecha de vencimiento de la póliza (año-mes-día).' };
  }
  return { ok: true, poliza: { url: url.trim(), vence: String(vence).trim() } };
}

/**
 * Días que faltan para el vencimiento (negativo = ya venció). `null` si no hay
 * fecha. Se compara en UTC contra el 'YYYY-MM-DD' de Colombia que le pasa quien
 * llama, para no depender de la zona horaria del proceso.
 */
export function diasParaVencer(vence: string, hoyISO: string): number | null {
  if (!esFechaISO(vence) || !esFechaISO(hoyISO)) return null;
  const ms = Date.parse(`${vence}T00:00:00Z`) - Date.parse(`${hoyISO}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Estado de vigencia para pintar el aviso: vencida, por vencer (≤30 días) o vigente. */
export type EstadoPoliza = 'sin_fecha' | 'vencida' | 'por_vencer' | 'vigente';

export const DIAS_AVISO_POLIZA = 30;

export function estadoPoliza(vence: string, hoyISO: string): EstadoPoliza {
  const dias = diasParaVencer(vence, hoyISO);
  if (dias === null) return 'sin_fecha';
  if (dias < 0) return 'vencida';
  if (dias <= DIAS_AVISO_POLIZA) return 'por_vencer';
  return 'vigente';
}

/** 'YYYY-MM-DD' de hoy en la zona de operación (Colombia), igual que lib/reserva-core.ts. */
export function hoyColombia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

// ── Barrera de escritura de `poliza` (sep-2026) ─────────────────────────────
//
// UNA SOLA función para los DOS caminos por los que el propietario puede escribir
// `vehiculos.documentos`: el POST que crea el vehículo y el PUT que lo edita.
// Antes la barrera vivía solo dentro del PUT y el POST insertaba el `documentos`
// del body tal cual, así que bastaba con crear el carro con
// `{"poliza":{"url":"…","vence":"…"}}` para escribir un documento que solo le
// corresponde a la empresa — y encima quedaba blindado, porque la preservación del
// PUT lo re-inyectaba en cada edición posterior. Dos bloques copiados se
// desincronizan; este es el único sitio donde se decide qué pasa con esta clave.

/** Mensaje único cuando `documentos` no es un objeto JSON plano. */
export const ERROR_DOCUMENTOS_FORMA =
  'El formato de los documentos del vehículo no es válido. Vuelve a cargar la página e inténtalo de nuevo.';

/**
 * Parsea un JSON de `documentos` exigiendo un OBJETO PLANO, y FALLA CERRADO.
 *
 * El bug que cierra: `typeof [] === 'object'`, así que un `documentos: "[]"` pasaba
 * por objeto en unos sitios y no en otros. En el PUT eso dejaba `documentos = '[]'`
 * — o sea, SOAT, tecno, tarjeta, la clave legada `todo_riesgo` y la póliza de la
 * empresa borrados de un plumazo, sin auditoría y con 200. Un array, un número, un
 * `null` o un JSON roto NO son "no hay nada que hacer": son entrada inválida y se
 * rechazan con 400.
 *
 * `undefined` y la cadena vacía sí son "sin documentos" y devuelven `{}` (es lo que
 * manda el POST cuando el formulario no trae ninguno).
 */
export function parsearDocumentos(raw: unknown): { ok: true; docs: Record<string, unknown> } | { ok: false; error: string } {
  let valor: unknown = raw;
  if (raw === undefined) valor = {};
  else if (typeof raw === 'string') {
    const txt = raw.trim();
    if (!txt) valor = {};
    else {
      try { valor = JSON.parse(txt); } catch { return { ok: false, error: ERROR_DOCUMENTOS_FORMA }; }
    }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return { ok: false, error: ERROR_DOCUMENTOS_FORMA };
  }
  return { ok: true, docs: valor as Record<string, unknown> };
}

/**
 * Aplica la barrera de la póliza a un `documentos` que viene del CLIENTE y devuelve
 * el JSON listo para escribir. Quien llama ya decidió que el autor NO es admin.
 *
 *  · Sin `guardadoJson` (creación): la clave se ARRANCA incondicionalmente. Nadie
 *    crea vehículos siendo admin por esa ruta, así que no hay caso legítimo.
 *  · Con `guardadoJson` (edición): el valor que se escribe es SIEMPRE el que ya está
 *    en la BD; si en la BD no hay ninguno, la clave se elimina. Da igual qué mande
 *    el cliente: su `poliza` nunca llega al UPDATE.
 *
 * Devuelve el error de forma en vez de "dejar pasar": ver `parsearDocumentos`.
 */
export function quitarPolizaDeEntrada(
  entradaJson: unknown,
  guardadoJson?: unknown,
): { ok: true; json: string } | { ok: false; error: string } {
  const entrada = parsearDocumentos(entradaJson);
  if (!entrada.ok) return entrada;

  let guardada: unknown = undefined;
  if (guardadoJson !== undefined) {
    // El JSON de la BD puede estar corrupto (o ser de antes de esta clave): eso no es
    // culpa de quien edita, así que no se responde 400 — simplemente no hay póliza
    // que preservar y la clave se borra del body.
    const bd = parsearDocumentos(guardadoJson);
    if (bd.ok && Object.hasOwn(bd.docs, CLAVE_POLIZA)) guardada = bd.docs[CLAVE_POLIZA];
  }

  if (guardada === undefined) {
    delete entrada.docs[CLAVE_POLIZA];
  } else {
    // `defineProperty` y no `docs[CLAVE_POLIZA] = …`: una clave `__proto__` guardada en
    // el JSON dispararía el setter de Object.prototype en vez de agregar la propiedad.
    Object.defineProperty(entrada.docs, CLAVE_POLIZA, {
      value: guardada, writable: true, enumerable: true, configurable: true,
    });
  }
  return { ok: true, json: JSON.stringify(entrada.docs) };
}
