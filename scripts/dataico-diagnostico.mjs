#!/usr/bin/env node
// ⚠️ SCRIPT DE DIAGNÓSTICO — fase 1 de la integración Dataico.
//
// Estado real (confirmado 2026-08-27 contra el sandbox real de Dataico, con la
// DATAICO_API_KEY y el DATAICO_ACCOUNT_ID reales de Victor): la conexión funciona
// y el payload de prueba de abajo es válido en su totalidad EXCEPTO por un
// bloqueante externo — no técnico: la cuenta de Dataico de DrivePass Col S.A.S.
// todavía no tiene una numeración/resolución DIAN tramitada, así que
// `POST /invoices` responde "No se encuentra numeración '' en la cuenta de
// DATAICO". Deja este script tal cual: en cuanto Victor consiga la numeración,
// correrlo de nuevo (con DATAICO_CONFIRMAR_PRUEBA=1) debería servir para
// confirmar que ya se puede emitir de verdad (debería devolver CUFE / PDF en vez
// del error de numeración). Ver el detalle completo en `lib/dataico-v2.ts`.
//
// Qué hace:
//   1) GET /numberings/invoice — de solo lectura, confirma que la key funciona
//      y muestra qué numeraciones/resoluciones DIAN tiene ya la cuenta (útil para
//      confirmar en el momento en que Victor tramite la numeración: debería dejar
//      de salir vacío).
//   2) Si lo anterior responde 2xx Y pasas la variable DATAICO_CONFIRMAR_PRUEBA=1,
//      intenta un POST /invoices mínimo con datos ficticios, env:"PRUEBAS" fijo,
//      SIN actions (no dispara send_dian ni send_email), incluyendo
//      `dataico_account_id` desde DATAICO_ACCOUNT_ID en el body del invoice.
//
// Cómo correrlo:
//   Local, con la key y el account id pegados a mano (no los commitees en ningún
//   archivo):
//     DATAICO_API_KEY="..." DATAICO_ACCOUNT_ID="..." node scripts/dataico-diagnostico.mjs
//   Contra el entorno real de Railway sin desplegar nada:
//     railway run --service <nombre-del-servicio> node scripts/dataico-diagnostico.mjs
//   Para además intentar el POST de prueba (paso 2):
//     DATAICO_API_KEY="..." DATAICO_ACCOUNT_ID="..." DATAICO_CONFIRMAR_PRUEBA=1 node scripts/dataico-diagnostico.mjs
//
// La API key NUNCA se imprime en la consola. El account id tampoco: en los
// payloads/respuestas que se loguean (incluido el body del invoice de prueba
// del paso 2) se enmascara automáticamente (ver `redactarParaLog`), dejando
// como máximo los últimos 4 caracteres para poder confirmar a simple vista
// que se está usando el valor correcto.

const DATAICO_V2_BASE_URL = 'https://api.dataico.com/dataico_api/v2';

const key = process.env.DATAICO_API_KEY;
if (!key) {
  console.error('Falta DATAICO_API_KEY en el entorno. Ver instrucciones al inicio de este script.');
  process.exit(1);
}

const accountId = process.env.DATAICO_ACCOUNT_ID;
if (!accountId) {
  console.warn('Aviso: falta DATAICO_ACCOUNT_ID en el entorno. El paso 2 (POST /invoices) lo necesita');
  console.warn('en el body del invoice (`dataico_account_id`) — sin él, Dataico rechazará la prueba.');
}

function extraerMensajeError(body, status) {
  if (body && typeof body === 'object') {
    // Shape real CONFIRMADO contra el sandbox (POST /invoices): array de objetos
    // { error, path }, no un string plano. Ver el mismo manejo en lib/dataico-v2.ts.
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return body.errors
        .map((item) => {
          if (item && typeof item === 'object') {
            const msg = typeof item.error === 'string' && item.error ? item.error : JSON.stringify(item);
            const path = Array.isArray(item.path) && item.path.length > 0 ? item.path.join('.') : null;
            return path ? `${path}: ${msg}` : msg;
          }
          return typeof item === 'string' ? item : JSON.stringify(item);
        })
        .join(' | ');
    }
    if (typeof body.errors === 'string' && body.errors) return body.errors;
    if (typeof body.message === 'string' && body.message) return body.message;
    if (typeof body.error === 'string' && body.error) return body.error;
    // `errors: []` (array vacío) no aporta nada útil — cae al mensaje genérico en
    // vez de devolver el string inútil "[]".
    if (Array.isArray(body.errors)) return `Dataico respondió ${status} sin cuerpo de error legible`;
    if (body.errors) { try { return JSON.stringify(body.errors); } catch { /* noop */ } }
  }
  if (typeof body === 'string' && body) return body;
  return `Dataico respondió ${status} sin cuerpo de error legible`;
}

async function dataicoFetch(path, options = {}) {
  const url = `${DATAICO_V2_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Content-Type': 'application/json',
      'auth-token': key,
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  return { status: res.status, ok: res.ok, body };
}

// Formatea en hora de Bogotá (America/Bogota) SIEMPRE, sin importar en qué zona
// horaria corra el proceso Node (Railway corre en UTC por defecto — no hay
// `TZ=America/Bogota` configurado). Ver el mismo fix/nota en lib/dataico-v2.ts.
function formatearFechaDataico(d) {
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
  const obtener = (tipo) => partes.find((p) => p.type === tipo)?.value ?? '00';
  return `${obtener('day')}/${obtener('month')}/${obtener('year')} ${obtener('hour')}:${obtener('minute')}:${obtener('second')}`;
}

// Enmascara dataico_account_id (y por seguridad cualquier otro campo cuyo
// nombre contenga "account_id" o "api_key") en un objeto antes de imprimirlo
// en consola. Devuelve una copia; no muta el original.
function redactarParaLog(valor) {
  if (Array.isArray(valor)) return valor.map(redactarParaLog);
  if (valor && typeof valor === 'object') {
    const copia = {};
    for (const [k, v] of Object.entries(valor)) {
      if (/account_id|api_key/i.test(k) && typeof v === 'string' && v) {
        copia[k] = v.length > 4 ? `***${v.slice(-4)}` : '***';
      } else {
        copia[k] = redactarParaLog(v);
      }
    }
    return copia;
  }
  return valor;
}

async function main() {
  console.log('== Paso 1: GET /numberings/invoice ==');
  const numeraciones = await dataicoFetch('/numberings/invoice');
  console.log('status:', numeraciones.status, numeraciones.ok ? '(OK)' : '(ERROR)');
  console.log('body:', JSON.stringify(redactarParaLog(numeraciones.body), null, 2));
  if (!numeraciones.ok) {
    console.log(`\nMensaje de error: ${extraerMensajeError(numeraciones.body, numeraciones.status)}`);
    console.log('\nSi el status es 401: revisa que DATAICO_API_KEY sea la key correcta. CONFIRMADO:');
    console.log('esta llamada de solo lectura funciona con SOLO el header auth-token — no hace falta');
    console.log('ningún dato adicional, así que un 401 aquí es casi seguro una key incorrecta.');
    process.exit(1);
  }

  console.log('\n✅ La key funciona. Numeraciones/resoluciones DIAN disponibles arriba.');
  console.log('   (Si esta lista sigue vacía, ese es justo el bloqueante actual: falta tramitar');
  console.log('   una numeración/resolución DIAN en la cuenta de Dataico — ver lib/dataico-v2.ts.)');

  if (process.env.DATAICO_CONFIRMAR_PRUEBA !== '1') {
    console.log('\n(Para además probar POST /invoices con datos ficticios, corre de nuevo con');
    console.log(' DATAICO_CONFIRMAR_PRUEBA=1 — no crea nada real, env queda fijo en "PRUEBAS" y no');
    console.log(' se manda `actions.send_dian`, pero SÍ queda registrada en el sandbox de Dataico.)');
    return;
  }

  console.log('\n== Paso 2: POST /invoices (prueba mínima, env:"PRUEBAS", sin actions) ==');
  const numeroPrueba = `DIAG-${Date.now()}`;
  const invoiceBody = {
    number: numeroPrueba,
    env: 'PRUEBAS',
    invoice_type_code: 'FACTURA_VENTA',
    issue_date: formatearFechaDataico(new Date()),
    dataico_account_id: accountId, // CONFIRMADO: va en el body del invoice, no como header
    customer: {
      party_type: 'PERSONA_NATURAL',
      party_identification: '222222222222', // consumidor final / genérico, ficticio
      party_identification_type: 'CC',
      first_name: 'Prueba',
      family_name: 'Diagnostico',
      email: 'pruebas@drivepass.test',
      city: '05001',   // Medellín — código DIAN, CONFIRMADO aceptado por la API real
      department: '05', // Antioquia — CONFIRMADO aceptado por la API real
    },
    items: [
      { sku: 'DIAG-001', quantity: 1, description: 'Prueba de diagnóstico DrivePass — no es un servicio real', price: 1000 },
    ],
    payment_means_type: 'DEBITO',
    payment_means: 'CASH',
  };
  console.log('Payload enviado:', JSON.stringify(redactarParaLog({ invoice: invoiceBody }), null, 2));
  const creada = await dataicoFetch('/invoices', { method: 'POST', body: JSON.stringify({ invoice: invoiceBody }) });
  console.log('status:', creada.status, creada.ok ? '(OK)' : '(ERROR)');
  console.log('body:', JSON.stringify(redactarParaLog(creada.body), null, 2));
  if (!creada.ok) {
    const mensaje = extraerMensajeError(creada.body, creada.status);
    console.log(`\nMensaje de error: ${mensaje}`);
    if (/numeraci/i.test(mensaje)) {
      console.log('\n⛔ Este es el bloqueante EXTERNO conocido: falta tramitar una numeración/');
      console.log('   resolución DIAN en la cuenta de Dataico de DrivePass Col S.A.S. No es un');
      console.log('   problema de este script ni del payload — ver lib/dataico-v2.ts para detalle.');
    } else {
      console.log('Este error es un dato nuevo (no es el bloqueante de numeración ya conocido) —');
      console.log('revisa qué campo falta/está mal y actualiza lib/dataico-v2.ts si hace falta.');
    }
  } else {
    console.log('\n✅ Se creó una factura de PRUEBA en el sandbox de Dataico (env: PRUEBAS).');
    console.log('   Esto significa que la numeración DIAN ya está lista — ¡se puede pasar a la fase 2!');
    console.log('   Revisa el campo `numbering`/`cufe`/`pdf_url` del body para el mapeo real.');
  }
}

main().catch((e) => {
  console.error('Error inesperado corriendo el diagnóstico:', e instanceof Error ? e.message : e);
  process.exit(1);
});
