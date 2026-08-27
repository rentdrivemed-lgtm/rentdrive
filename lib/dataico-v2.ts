// Cliente del API v2 REAL de Dataico (facturación electrónica DIAN) — construido a
// partir del spec OpenAPI oficial que Victor compartió, y CONFIRMADO EMPÍRICAMENTE
// contra el sandbox real de Dataico (ver "Estado real" abajo). Es un módulo NUEVO y
// DISTINTO del stub legacy en `lib/dataico.ts` (que sigue usándose, sin cambios,
// desde `lib/contabilidad.ts` para el enganche automático de facturas — ver nota al
// final de este archivo). Este módulo NO está conectado todavía a ningún trigger de
// negocio: solo lo usa el script de diagnóstico (`scripts/dataico-diagnostico.mjs`),
// a propósito, para no afectar ningún flujo real de reservas/pagos en esta fase 1.
//
// ── Estado real (confirmado 2026-08-27 contra el sandbox real de Dataico, con la
//    DATAICO_API_KEY y el DATAICO_ACCOUNT_ID reales de Victor, ya en Railway) ─────
//
// ✅ CONFIRMADO FUNCIONANDO:
//   - `GET /numberings/invoice` responde 2xx con solo el header `auth-token:
//     <DATAICO_API_KEY>` — NO hace falta ningún segundo header ni dato adicional
//     para esa llamada de solo lectura.
//   - `POST /invoices` con un payload de prueba (customer `PERSONA_NATURAL` con CC,
//     items simples, y `dataico_account_id` incluido en el BODY del invoice — no
//     como header) avanza correctamente a través de TODA la validación de Dataico:
//     formato de fecha `dd/MM/yyyy HH:mm:ss`, shape de `customer`, shape de `items`,
//     y `city`/`department` como códigos DIAN numéricos (ej. `"05001"` / `"05"`)
//     son todos aceptados tal cual están implementados abajo.
//   - La base URL `https://api.dataico.com/dataico_api/v2` es correcta y está viva.
//   - El content-type real de la respuesta es `application/octet-stream` aunque el
//     cuerpo es texto JSON — por eso `dataicoFetch` no confía en el content-type,
//     siempre lee el body como texto y hace `JSON.parse` manual.
//   - El shape real de error de VALIDACIÓN de `POST /invoices` es
//     `{ errors: [{ error: string, path: string[] }] }` — un ARRAY de objetos, NO
//     un string plano ni `{ message: string }`. `extraerMensajeError` de abajo ya
//     lo contempla (y también cubre `{ errors: string }`, visto antes con una key
//     inválida en `GET /numberings/invoice` — puede ser un shape distinto para
//     errores de autenticación vs. errores de validación del payload).
//
// ⛔ ÚNICO BLOQUEANTE ACTUAL (externo, NO técnico):
//   `POST /invoices` responde con el error de validación:
//     "No se encuentra numeración '' en la cuenta de DATAICO"
//   Es decir: DrivePass Col S.A.S. **todavía no tiene una resolución de
//   numeración DIAN tramitada y cargada en su cuenta de Dataico**. Ese trámite es
//   legal/externo (ante la DIAN y luego configurado en el panel de Dataico), está
//   fuera del alcance de este código, y Victor ya está al tanto. Hasta que exista
//   una numeración real, NINGUNA factura puede emitirse de verdad (ni siquiera en
//   modo prueba) — el resto del payload ya está validado como correcto.
//
// ── Fase 2 (pendiente, bloqueada por lo anterior) ────────────────────────────
//   Una vez exista una numeración DIAN en la cuenta de Dataico:
//   1. Volver a correr `scripts/dataico-diagnostico.mjs` con
//      `DATAICO_CONFIRMAR_PRUEBA=1` para confirmar una emisión de prueba completa
//      end-to-end (debería devolver CUFE / PDF en vez del error de numeración).
//   2. Construir el mapeo reserva → factura (qué campos de la reserva/usuario
//      alimentan `customer`/`items`, cómo se calculan `city`/`department` DIAN
//      desde el lugar de recogida de `lib/lugares.ts`, etc.).
//   3. Decidir un trigger real de emisión (¿al confirmar el pago, como hace hoy
//      `lib/contabilidad.ts` con el stub legacy? ¿o un paso manual/admin?).
//   4. Decidir si este módulo (`lib/dataico-v2.ts`) REEMPLAZA al stub legacy
//      `lib/dataico.ts` (y se recablea `lib/contabilidad.ts` para usarlo), o si
//      conviven temporalmente. Recomendación: reemplazar, porque el legacy nunca
//      fue validado contra el sandbox real y usa una URL/headers distintos
//      (`DATAICO_ACCOUNT_ID` + `DATAICO_AUTH_TOKEN` como headers) que no están
//      configurados en Railway hoy — ver nota al final de este archivo.
//
// ── Autenticación (recordatorio) ─────────────────────────────────────────────
// Header `auth-token: <DATAICO_API_KEY>` en cada request. El `dataico_account_id`
// NO va como header: va como campo dentro del body de `POST /invoices` (ver
// `crearFacturaPrueba` abajo, que lo rellena automáticamente desde
// `process.env.DATAICO_ACCOUNT_ID` si no se pasa explícito).
const DATAICO_V2_BASE_URL = 'https://api.dataico.com/dataico_api/v2';

export function tieneClaveDataicoV2(): boolean {
  return !!process.env.DATAICO_API_KEY;
}

/** El `dataico_account_id` que va en el body de `POST /invoices` (no es un header). */
export function tieneAccountIdDataicoV2(): boolean {
  return !!process.env.DATAICO_ACCOUNT_ID;
}

export type DataicoResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; raw?: unknown };

function extraerMensajeError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    // Shape real CONFIRMADO EMPÍRICAMENTE contra el sandbox real (POST /invoices,
    // 2026-08-27): `{ errors: [{ error: string, path: string[] }] }` — un ARRAY de
    // objetos de error de validación, no un string plano. Es el shape que hay que
    // priorizar (se ve en errores de validación de payload, el caso más común).
    if (Array.isArray(b.errors) && b.errors.length > 0) {
      const mensajes = b.errors.map((item) => {
        if (item && typeof item === 'object') {
          const it = item as Record<string, unknown>;
          const msg = typeof it.error === 'string' && it.error ? it.error : JSON.stringify(it);
          const path = Array.isArray(it.path) && it.path.length > 0 ? it.path.join('.') : null;
          return path ? `${path}: ${msg}` : msg;
        }
        return typeof item === 'string' ? item : JSON.stringify(item);
      });
      return mensajes.join(' | ');
    }
    // Shape visto antes con una key inválida en GET /numberings/invoice (error de
    // autenticación, no de validación): `{ errors: "texto plano" }`.
    if (typeof b.errors === 'string' && b.errors) return b.errors;
    if (typeof b.message === 'string' && b.message) return b.message;
    if (typeof b.error === 'string' && b.error) return b.error;
    // `errors: []` (array vacío) no aporta nada útil — cae al mensaje genérico en
    // vez de devolver el string inútil "[]".
    if (Array.isArray(b.errors)) return `Dataico respondió ${status} sin cuerpo de error legible`;
    if (b.errors) {
      try { return JSON.stringify(b.errors); } catch { /* noop */ }
    }
  }
  if (typeof body === 'string' && body) return body;
  return `Dataico respondió ${status} sin cuerpo de error legible`;
}

/**
 * Cliente mínimo del API v2 de Dataico. Nunca lanza (throw): siempre devuelve
 * `DataicoResult`, para que el llamador decida cómo manejar un fallo sin que una
 * integración externa tumbe un flujo de negocio (mismo patrón que `lib/whatsapp.ts`).
 */
export async function dataicoFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<DataicoResult<T>> {
  const key = process.env.DATAICO_API_KEY;
  if (!key) {
    return { ok: false, status: 0, error: 'Falta DATAICO_API_KEY en el entorno' };
  }
  const url = `${DATAICO_V2_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers as Record<string, string> | undefined),
        'Content-Type': 'application/json',
        'auth-token': key,
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: extraerMensajeError(body, res.status), raw: body };
    }
    return { ok: true, status: res.status, data: body as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : 'Error de red desconocido al llamar a Dataico' };
  }
}

// ── Descubrimiento: numeraciones/resoluciones DIAN ──────────────────────────
export type DataicoNumberingModule = 'invoice' | 'credit-note' | 'debit-note' | 'support-doc';

/** GET /numberings/{modulo} — de solo lectura, primer paso de descubrimiento. */
export async function getNumeraciones(modulo: DataicoNumberingModule = 'invoice') {
  return dataicoFetch(`/numberings/${modulo}`);
}

// ── Prueba mínima de creación de factura (SOLO diagnóstico, fase 1) ─────────
// OJO: nada en la app llama esto todavía desde ningún trigger de negocio — solo
// `scripts/dataico-diagnostico.mjs`, a propósito, para no crear facturas reales
// (ni siquiera de prueba) sin que alguien lo pida explícitamente.
export type DataicoInvoiceItemPrueba = {
  sku: string;
  quantity: number;
  description: string;
  price: number;
};

export type DataicoCustomerPrueba = {
  party_type: 'PERSONA_NATURAL' | 'PERSONA_JURIDICA';
  party_identification: string;
  party_identification_type: string; // CC | NIT | CE | PASAPORTE | ...
  tax_level_code?: string;
  city?: string;    // código DIAN numérico (ej. "05001") — CONFIRMADO aceptado por la API real
  department?: string; // código DIAN numérico (ej. "05") — CONFIRMADO aceptado por la API real
  email?: string;
  first_name?: string;
  family_name?: string;
  company_name?: string;
};

export type DataicoInvoicePruebaInput = {
  number: string;
  customer: DataicoCustomerPrueba;
  items: DataicoInvoiceItemPrueba[];
  // Requerido por la API — si se omite, `crearFacturaPrueba` lo rellena
  // automáticamente desde `process.env.DATAICO_ACCOUNT_ID`. Solo hace falta
  // pasarlo a mano para forzar un valor distinto (ej. pruebas con otra cuenta).
  dataico_account_id?: string;
  numbering?: { resolution_number: string; prefix: string; flexible?: boolean };
  payment_means?: string;
  payment_means_type?: string;
};

// Formatea en hora de Bogotá (America/Bogota) SIEMPRE, sin importar en qué zona
// horaria corra el proceso Node (Railway corre en UTC por defecto — no hay
// `TZ=America/Bogota` configurado). Usar la hora local del servidor (`getDate`/
// `getHours`/etc.) desfasaría `issue_date` hasta 5 horas y podría registrar la
// factura en el día calendario equivocado cerca de medianoche. Mismo patrón que
// `hoyBogota()` en `app/api/control/resumen/route.ts`.
function formatearFechaDataico(d: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const obtener = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
  return `${obtener('day')}/${obtener('month')}/${obtener('year')} ${obtener('hour')}:${obtener('minute')}:${obtener('second')}`;
}

/**
 * POST /invoices de prueba MÍNIMA. `env` queda forzado a "PRUEBAS" siempre —
 * ignora cualquier intento de sobreescritura — para cumplir la instrucción
 * explícita de nunca emitir en producción desde este PR. No incluye `actions`
 * (no dispara `send_dian` ni `send_email`).
 *
 * `dataico_account_id` se rellena automáticamente desde
 * `process.env.DATAICO_ACCOUNT_ID` si `input` no trae uno explícito — así no hace
 * falta pasarlo a mano en cada llamada. Si tampoco hay variable de entorno, se
 * manda `undefined` (Dataico responderá el error de validación correspondiente).
 */
export async function crearFacturaPrueba(input: DataicoInvoicePruebaInput) {
  const invoiceBody: Record<string, unknown> = {
    ...input,
    dataico_account_id: input.dataico_account_id || process.env.DATAICO_ACCOUNT_ID,
    invoice_type_code: 'FACTURA_VENTA',
    issue_date: formatearFechaDataico(new Date()),
    env: 'PRUEBAS', // SIEMPRE pruebas en esta fase — no cambiar sin confirmación explícita de Victor.
  };
  return dataicoFetch('/invoices', { method: 'POST', body: JSON.stringify({ invoice: invoiceBody }) });
}

// ── Nota sobre el módulo legacy `lib/dataico.ts` ─────────────────────────────
// Ese archivo (de una sesión anterior, sin acceso al spec real) ya está enganchado
// a `lib/contabilidad.ts` (`emitirFactura`, disparado cuando se confirma el pago
// de una reserva) y usa una URL distinta (`/direct/dataico_api/v2/invoices`, con
// headers `Auth-token` y `Dataico_account_id`) y exige DOS variables de entorno
// (`DATAICO_ACCOUNT_ID` + `DATAICO_AUTH_TOKEN`) para activarse
// (`dataicoHabilitado()`). Hoy en Railway SÍ existen `DATAICO_API_KEY` y
// `DATAICO_ACCOUNT_ID` (las usa este módulo nuevo), pero NO existe
// `DATAICO_AUTH_TOKEN` — así que `dataicoHabilitado()` del legacy sigue devolviendo
// `false` y ese trigger sigue cayendo siempre a "borrador local". Este módulo
// nuevo (`dataico-v2.ts`) no cambia ese comportamiento: no está importado desde
// `lib/contabilidad.ts` ni desde ningún otro punto de la app todavía. Decidir si
// se reemplaza el stub legacy por este cliente real (y recablear el trigger de
// `lib/contabilidad.ts`) es trabajo de la fase 2, una vez exista una numeración
// DIAN real en la cuenta de Dataico (ver "ÚNICO BLOQUEANTE ACTUAL" arriba).
