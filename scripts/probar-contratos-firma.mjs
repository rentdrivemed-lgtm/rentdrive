// Prueba de extremo a extremo, POR HTTP, de la fase 2 de contratos digitales: la firma.
//
// Levanta nada: se conecta a un servidor de desarrollo que ya esté corriendo y usa la
// misma base que ese servidor. Comprueba, contra la API real (no llamando a las
// funciones por dentro):
//
//   · emitir un documento desde una reserva y verlo completo;
//   · que cada parte firme SOLO lo suyo (el cliente, el propietario y el agente);
//   · que no se pueda firmar dos veces el mismo bloque;
//   · que no se pueda firmar con la cuenta equivocada;
//   · que alterar el texto en la base haga fallar el sello de integridad;
//   · que restaurarlo lo vuelva a hacer verificar (o sea: el sello mira el TEXTO);
//   · las dos vías de firma (trazo en pantalla e imagen cargada y normalizada);
//   · el orden del acta (la devolución no se firma antes que la entrega);
//   · anular y reemitir conservando el documento anterior.
//
// Cómo correrlo:
//   1. levanta el servidor:  npx next dev --webpack -p 4777
//   2. asegúrate de tener una reserva confirmada con los datos completos
//      (documento, ciudad, celular y licencia de las dos partes, placa del vehículo,
//      vencimiento de la póliza y lugares con hora), y una cuenta de cliente EXTRA
//      (la de 'intruso') que no sea parte de esa reserva;
//   3. node scripts/probar-contratos-firma.mjs --base http://127.0.0.1:4777 --reserva 1 --db ./rentdrive.db
//
// ⚠️ NO escribe cookies ni credenciales en disco: las sesiones viven en memoria y el
// informe que imprime no incluye ni tokens ni contraseñas.

import Database from 'better-sqlite3';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const opcion = (n, pd) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : pd;
};

const BASE = opcion('base', 'http://127.0.0.1:4777');
const RESERVA = Number(opcion('reserva', '1'));
const RUTA_DB = opcion('db', './rentdrive.db');

// Cuentas de DESARROLLO. Las tres primeras son las que siembra lib/db.ts en una base
// local vacía (sus contraseñas están en ese mismo archivo, no son un secreto); la
// cuarta hay que crearla a mano y sirve para comprobar que un tercero no puede ni ver
// ni firmar el documento de otro. Todas se pueden sobrescribir por entorno para no
// depender de valores fijos. Esto NO corre contra producción: la comprobación del
// sello escribe en la base.
const CUENTAS = {
  admin: { correo: process.env.PRUEBA_ADMIN || 'admin@rentdrive.com', password: process.env.PRUEBA_ADMIN_CLAVE || 'admin123' },
  propietario: { correo: process.env.PRUEBA_PROPIETARIO || 'propietario@rentdrive.com', password: process.env.PRUEBA_PROPIETARIO_CLAVE || 'owner123' },
  cliente: { correo: process.env.PRUEBA_CLIENTE || 'usuario@rentdrive.com', password: process.env.PRUEBA_CLIENTE_CLAVE || 'user123' },
  intruso: { correo: process.env.PRUEBA_INTRUSO || 'intruso@rentdrive.com', password: process.env.PRUEBA_INTRUSO_CLAVE || 'intruso123' },
};

// Cookies de sesión, SOLO en memoria.
const sesiones = {};
let fallos = 0;
let pruebas = 0;

function comprobar(titulo, condicion, detalle = '') {
  pruebas++;
  const ok = !!condicion;
  if (!ok) fallos++;
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
}

async function pedir(quien, ruta, opciones = {}) {
  const cabeceras = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
  if (quien && sesiones[quien]) cabeceras.cookie = sesiones[quien];
  const res = await fetch(`${BASE}${ruta}`, { ...opciones, headers: cabeceras });
  let cuerpo = {};
  try { cuerpo = await res.json(); } catch { cuerpo = {}; }
  return { status: res.status, cuerpo };
}

async function entrar(quien) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CUENTAS[quien]),
  });
  const cookie = res.headers.getSetCookie?.().find(c => c.startsWith('token=')) || res.headers.get('set-cookie') || '';
  sesiones[quien] = cookie.split(';')[0];
  return res.status;
}

/** Un PNG con un trazo, equivalente a lo que produce el <canvas> de la interfaz. */
async function pngDeFirma(texto = 'firma') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="90">
    <rect width="280" height="90" fill="white"/>
    <path d="M12 68 C 60 8, 110 92, 160 34 S 250 66, 268 24" stroke="#111827" stroke-width="3" fill="none"/>
    <text x="14" y="84" font-size="11" fill="#111827">${texto}</text>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Una "foto de una hoja con la firma": márgenes grises de sobra, para que se note el recorte. */
async function fotoDeFirma() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700">
    <rect width="900" height="700" fill="#efe9dd"/>
    <rect x="120" y="120" width="660" height="460" fill="#fdfdfb"/>
    <path d="M280 400 C 340 300, 420 470, 500 350 S 640 420, 700 330" stroke="#1a1a2e" stroke-width="7" fill="none"/>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function emitir(tipo) {
  return pedir('admin', '/api/contratos', { method: 'POST', body: JSON.stringify({ reserva_id: RESERVA, tipo }) });
}

async function firmar(quien, id, bloque, extra = {}) {
  const detalle = await pedir(quien, `/api/contratos/${id}`);
  const version = extra.version ?? detalle.cuerpo?.contrato?.version ?? 1;
  return pedir(quien, `/api/contratos/${id}/firmar`, {
    method: 'POST',
    body: JSON.stringify({
      bloque,
      nombre_confirmado: extra.nombre ?? 'Nombre Confirmado',
      firma_imagen: extra.imagen ?? (await pngDeFirma(bloque)),
      metodo: extra.metodo ?? 'trazo',
      acepta: extra.acepta ?? true,
      version,
    }),
  });
}

const bloqueDe = (detalle, clave) => detalle.cuerpo.firmas.find(f => f.bloque === clave);

async function main() {
  console.log(`\n── Fase 2 de contratos: la firma ──  base ${BASE} · reserva ${RESERVA}\n`);

  for (const quien of Object.keys(CUENTAS)) {
    const status = await entrar(quien);
    comprobar(`login ${quien}`, status === 200 && !!sesiones[quien], `status ${status}`);
  }
  if (fallos > 0) { console.log('\nNo se pudo iniciar sesión: se aborta.\n'); process.exit(1); }

  // ── 1 · Emitir ────────────────────────────────────────────────────────────
  console.log('\n1 · Emitir el contrato de arrendamiento');
  const sinPermiso = await pedir('cliente', '/api/contratos', { method: 'POST', body: JSON.stringify({ reserva_id: RESERVA, tipo: 'arrendamiento' }) });
  comprobar('el cliente NO puede emitir', sinPermiso.status === 403, `status ${sinPermiso.status}`);

  const tipoMalo = await emitir('contrato-inventado');
  comprobar('tipo de documento inválido → 400', tipoMalo.status === 400, `status ${tipoMalo.status}`);

  const emitido = await emitir('arrendamiento');
  comprobar('admin emite → 201', emitido.status === 201, `status ${emitido.status} ${emitido.cuerpo.error || ''}`);
  const idArr = emitido.cuerpo?.contrato?.id;
  comprobar('el documento trae número propio', !!emitido.cuerpo?.contrato?.numero, emitido.cuerpo?.contrato?.numero);

  const duplicado = await emitir('arrendamiento');
  comprobar('no se puede emitir dos veces el mismo tipo → 409', duplicado.status === 409, `status ${duplicado.status}`);

  // ── 2 · Ver ───────────────────────────────────────────────────────────────
  console.log('\n2 · Verlo completo');
  const verCliente = await pedir('cliente', `/api/contratos/${idArr}`);
  comprobar('el cliente ve el documento', verCliente.status === 200, `status ${verCliente.status}`);
  comprobar('viene el TEXTO ÍNTEGRO', (verCliente.cuerpo?.contrato?.texto || '').length > 4000, `${(verCliente.cuerpo?.contrato?.texto || '').length} caracteres`);
  comprobar('no se publica el sello', JSON.stringify(verCliente.cuerpo).includes('firma_hash') === false);
  comprobar('el documento no tiene huecos subsanables', (verCliente.cuerpo?.faltantes?.bloqueantes || []).length === 0,
    JSON.stringify((verCliente.cuerpo?.faltantes?.bloqueantes || []).map(f => f.etiqueta)));

  const verIntruso = await pedir('intruso', `/api/contratos/${idArr}`);
  comprobar('un tercero recibe 404 (ni siquiera confirma que existe)', verIntruso.status === 404, `status ${verIntruso.status}`);

  const verAnonimo = await pedir(null, `/api/contratos/${idArr}`);
  comprobar('sin sesión → 401', verAnonimo.status === 401, `status ${verAnonimo.status}`);

  // ── 3 · Quién firma qué ───────────────────────────────────────────────────
  console.log('\n3 · Cada parte firma solo lo suyo');
  const intrusoFirma = await firmar('intruso', idArr, 'arrendatario');
  comprobar('un tercero no puede firmar → 404', intrusoFirma.status === 404, `status ${intrusoFirma.status}`);

  const propietarioFirmaAjeno = await firmar('propietario', idArr, 'arrendatario');
  comprobar('el propietario no puede firmar por el arrendatario → 403', propietarioFirmaAjeno.status === 403, `status ${propietarioFirmaAjeno.status}`);

  const clienteFirmaAgente = await firmar('cliente', idArr, 'agente');
  comprobar('el cliente no puede firmar como EL AGENTE → 403', clienteFirmaAgente.status === 403, `status ${clienteFirmaAgente.status}`);

  const sinAceptar = await firmar('cliente', idArr, 'arrendatario', { acepta: false });
  comprobar('sin casilla de aceptación → 400', sinAceptar.status === 400, `status ${sinAceptar.status}`);

  const sinNombre = await firmar('cliente', idArr, 'arrendatario', { nombre: '   ' });
  comprobar('sin nombre confirmado → 400', sinNombre.status === 400, `status ${sinNombre.status}`);

  const imagenFalsa = await firmar('cliente', idArr, 'arrendatario', { imagen: 'data:image/png;base64,' + Buffer.from('no soy un png').toString('base64') });
  comprobar('una "imagen" que no es PNG de verdad → 400', imagenFalsa.status === 400, `${imagenFalsa.status} ${imagenFalsa.cuerpo.error || ''}`);

  const versionMala = await firmar('cliente', idArr, 'arrendatario', { version: 99 });
  comprobar('versión que no es la del documento → 409', versionMala.status === 409, `status ${versionMala.status}`);

  const bloqueInexistente = await firmar('cliente', idArr, 'bloque-que-no-existe');
  comprobar('bloque inexistente → 404', bloqueInexistente.status === 404, `status ${bloqueInexistente.status}`);

  const agenteOk = await firmar('admin', idArr, 'agente');
  comprobar('el admin con el permiso firma como EL AGENTE', agenteOk.status === 200, `status ${agenteOk.status} ${agenteOk.cuerpo.error || ''}`);

  const agenteRepetido = await firmar('admin', idArr, 'agente');
  comprobar('no se puede firmar dos veces el mismo bloque → 409', agenteRepetido.status === 409, `status ${agenteRepetido.status}`);

  // La segunda firma llega como IMAGEN CARGADA: se normaliza primero.
  const foto = await fotoDeFirma();
  const normalizada = await pedir('cliente', '/api/contratos/firma-imagen', { method: 'POST', body: JSON.stringify({ imagen: foto }) });
  comprobar('la foto de una firma se normaliza', normalizada.status === 200 && (normalizada.cuerpo.imagen || '').startsWith('data:image/png;base64,'),
    `status ${normalizada.status} · ${normalizada.cuerpo.ancho}×${normalizada.cuerpo.alto}`);
  comprobar('la normalización recorta los márgenes', (normalizada.cuerpo.alto || 999) <= 180 && (normalizada.cuerpo.ancho || 999) <= 720,
    `${normalizada.cuerpo.ancho}×${normalizada.cuerpo.alto} (la foto medía 900×700)`);

  const noEsImagen = await pedir('cliente', '/api/contratos/firma-imagen', { method: 'POST', body: JSON.stringify({ imagen: 'data:image/png;base64,' + Buffer.from('basura').toString('base64') }) });
  comprobar('un archivo que no es imagen no se normaliza → 400', noEsImagen.status === 400, `status ${noEsImagen.status}`);

  const clienteOk = await firmar('cliente', idArr, 'arrendatario', { imagen: normalizada.cuerpo.imagen, metodo: 'carga', nombre: 'María Usuario' });
  comprobar('el cliente firma con su imagen cargada', clienteOk.status === 200, `status ${clienteOk.status} ${clienteOk.cuerpo.error || ''}`);
  comprobar('con la última firma el documento queda FIRMADO', clienteOk.cuerpo.completo === true && clienteOk.cuerpo.estado === 'firmado',
    `estado ${clienteOk.cuerpo.estado}`);

  // ── 4 · El sello ──────────────────────────────────────────────────────────
  console.log('\n4 · El sello delata cualquier alteración del texto');
  const firmado = await pedir('cliente', `/api/contratos/${idArr}`);
  comprobar('las dos firmas verifican su sello', firmado.cuerpo.firmas.every(f => f.integridad?.ok === true));
  comprobar('quedan registradas las dos vías de firma',
    bloqueDe(firmado, 'agente')?.firma_metodo === 'trazo' && bloqueDe(firmado, 'arrendatario')?.firma_metodo === 'carga');

  const db = new Database(RUTA_DB);
  const original = db.prepare('SELECT texto FROM contratos WHERE id = ?').get(idArr).texto;
  const alterado = original.replace('EL ARRENDATARIO', 'EL ARRENDATARIO (y su tío)');
  comprobar('la alteración cambia el texto de verdad', alterado !== original);
  db.prepare('UPDATE contratos SET texto = ? WHERE id = ?').run(alterado, idArr);

  const tocado = await pedir('cliente', `/api/contratos/${idArr}`);
  comprobar('con el texto alterado, NINGUNA firma verifica', tocado.cuerpo.firmas.every(f => f.integridad?.ok === false),
    tocado.cuerpo.firmas.map(f => `${f.bloque}:${f.integridad?.ok}`).join(' '));

  db.prepare('UPDATE contratos SET texto = ? WHERE id = ?').run(original, idArr);
  const restaurado = await pedir('cliente', `/api/contratos/${idArr}`);
  comprobar('al restaurar el texto vuelven a verificar (el sello mira el TEXTO)',
    restaurado.cuerpo.firmas.every(f => f.integridad?.ok === true));

  // Y con el texto alterado tampoco se le pueden apilar firmas nuevas encima.
  const actaPrevia = await emitir('acta-entrega');
  const idActa = actaPrevia.cuerpo?.contrato?.id;
  comprobar('se emite el acta de entrega y devolución', actaPrevia.status === 201, `status ${actaPrevia.status} ${actaPrevia.cuerpo.error || ''}`);

  // ── 5 · El acta: cuatro bloques y dos momentos ────────────────────────────
  console.log('\n5 · El acta tiene cuatro firmas y la devolución va después');
  const detalleActa = await pedir('admin', `/api/contratos/${idActa}`);
  comprobar('el acta abre cuatro bloques', detalleActa.cuerpo.firmas.length === 4, detalleActa.cuerpo.firmas.map(f => f.bloque).join(', '));
  comprobar('dos son de entrega y dos de devolución',
    detalleActa.cuerpo.firmas.filter(f => f.momento === 'entrega').length === 2 &&
    detalleActa.cuerpo.firmas.filter(f => f.momento === 'devolucion').length === 2);

  const devolucionAntes = await firmar('admin', idActa, 'devolucion-agente');
  comprobar('no se puede firmar la devolución antes de la entrega → 409', devolucionAntes.status === 409, `status ${devolucionAntes.status}`);

  const e1 = await firmar('admin', idActa, 'entrega-agente');
  const e2 = await firmar('cliente', idActa, 'entrega-arrendatario', { nombre: 'María Usuario' });
  comprobar('se firman los dos bloques de la entrega', e1.status === 200 && e2.status === 200, `${e1.status}/${e2.status}`);
  comprobar('el acta sigue PENDIENTE tras la entrega', e2.cuerpo.estado === 'pendiente', `estado ${e2.cuerpo.estado}`);

  const d1 = await firmar('admin', idActa, 'devolucion-agente');
  const d2 = await firmar('cliente', idActa, 'devolucion-arrendatario', { nombre: 'María Usuario' });
  comprobar('días después se firman los dos de la devolución', d1.status === 200 && d2.status === 200, `${d1.status}/${d2.status}`);
  comprobar('ahí sí el acta queda FIRMADA', d2.cuerpo.estado === 'firmado', `estado ${d2.cuerpo.estado}`);

  // ── 6 · La agencia: el propietario y el agente ────────────────────────────
  console.log('\n6 · El contrato de agencia lo firman el propietario y el agente');
  const agencia = await emitir('agencia');
  const idAg = agencia.cuerpo?.contrato?.id;
  comprobar('se emite el contrato de agencia', agencia.status === 201, `status ${agencia.status} ${agencia.cuerpo.error || ''}`);

  const clienteEnAgencia = await firmar('cliente', idAg, 'empresario');
  comprobar('el cliente no puede firmar como EL EMPRESARIO → 403', clienteEnAgencia.status === 403, `status ${clienteEnAgencia.status}`);

  const p1 = await firmar('propietario', idAg, 'empresario', { nombre: 'Carlos Propietario' });
  const a1 = await firmar('admin', idAg, 'agente');
  const p2 = await firmar('propietario', idAg, 'empresario-anexo', { nombre: 'Carlos Propietario' });
  comprobar('firman el empresario, el agente y el anexo', p1.status === 200 && a1.status === 200 && p2.status === 200,
    `${p1.status}/${a1.status}/${p2.status}`);
  comprobar('el contrato de agencia queda FIRMADO', p2.cuerpo.estado === 'firmado', `estado ${p2.cuerpo.estado}`);

  // ── 7 · Anular y reemitir ─────────────────────────────────────────────────
  console.log('\n7 · Anular y reemitir conservando el anterior');
  const anularSinMotivo = await pedir('admin', `/api/contratos/${idArr}/anular`, { method: 'POST', body: JSON.stringify({}) });
  comprobar('anular sin motivo → 400', anularSinMotivo.status === 400, `status ${anularSinMotivo.status}`);

  const anularSinPermiso = await pedir('cliente', `/api/contratos/${idArr}/anular`, { method: 'POST', body: JSON.stringify({ motivo: 'porque sí' }) });
  comprobar('el cliente no puede anular → 403', anularSinPermiso.status === 403, `status ${anularSinPermiso.status}`);

  const anulado = await pedir('admin', `/api/contratos/${idArr}/anular`, { method: 'POST', body: JSON.stringify({ motivo: 'Se corrigió la dirección del arrendatario' }) });
  comprobar('el admin anula el contrato firmado', anulado.status === 200 && anulado.cuerpo.contrato.estado === 'anulado', `status ${anulado.status}`);

  const anularDosVeces = await pedir('admin', `/api/contratos/${idArr}/anular`, { method: 'POST', body: JSON.stringify({ motivo: 'otra vez' }) });
  comprobar('no se anula dos veces → 409', anularDosVeces.status === 409, `status ${anularDosVeces.status}`);

  const firmarAnulado = await firmar('cliente', idArr, 'arrendatario');
  comprobar('un documento anulado no se puede firmar → 409', firmarAnulado.status === 409, `status ${firmarAnulado.status}`);

  const conservado = await pedir('cliente', `/api/contratos/${idArr}`);
  comprobar('el anulado conserva su texto y sus firmas',
    (conservado.cuerpo.contrato.texto || '').length > 4000 && conservado.cuerpo.firmas.every(f => !!f.firmada_en));
  comprobar('y sus firmas siguen verificando el sello', conservado.cuerpo.firmas.every(f => f.integridad?.ok === true));

  const reemitido = await emitir('arrendamiento');
  comprobar('se reemite como versión 2', reemitido.status === 201 && reemitido.cuerpo.contrato.version === 2,
    `${reemitido.cuerpo.contrato?.numero}`);

  const lista = await pedir('admin', `/api/contratos?reserva_id=${RESERVA}`);
  comprobar('el listado conserva el anulado y el nuevo',
    lista.cuerpo.contratos.some(c => c.id === idArr && c.estado === 'anulado') &&
    lista.cuerpo.contratos.some(c => c.id === reemitido.cuerpo.contrato.id && c.estado === 'pendiente'));

  // ── 8 · Bitácora ──────────────────────────────────────────────────────────
  console.log('\n8 · Queda rastro en la bitácora');
  const eventos = db.prepare("SELECT accion, COUNT(*) AS n FROM auditoria WHERE area='contratos' GROUP BY accion ORDER BY accion").all();
  const porAccion = Object.fromEntries(eventos.map(e => [e.accion, e.n]));
  comprobar('se registraron las emisiones', (porAccion.emitir_contrato || 0) >= 4, JSON.stringify(porAccion));
  comprobar('se registraron las firmas', (porAccion.firmar_contrato || 0) >= 9, JSON.stringify(porAccion));
  comprobar('se registró la anulación', (porAccion.anular_contrato || 0) >= 1, JSON.stringify(porAccion));
  db.close();

  console.log(`\n${fallos === 0 ? '✓ TODO BIEN' : '✗ HAY FALLAS'} — ${pruebas - fallos}/${pruebas} comprobaciones\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
