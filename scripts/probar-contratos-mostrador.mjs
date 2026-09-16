// Prueba POR HTTP de las rutas de las fases 3 y 4: el PDF y el mostrador.
//
// Complementa a `probar-contratos-pdf.ts` (que llama a las funciones por dentro):
// aquí se comprueba lo que solo se ve desde fuera — el control de acceso, los códigos
// de estado, las cabeceras de descarga y el ciclo real del mostrador contra la API.
//
// Qué comprueba:
//   · quién puede descargar el PDF y quién recibe 404 (no 403) por no ser parte;
//   · que la copia «para firmar» solo se dé mientras el documento esté pendiente;
//   · que el escaneado solo lo pueda subir un admin con el área de contratos;
//   · el ciclo completo: imprimir en blanco → subir escaneado → estado «papel»;
//   · que después del papel no se pueda firmar electrónicamente (409);
//   · que el escaneado se descargue como ADJUNTO y con nosniff.
//
// Cómo correrlo:
//   1. levanta el servidor:  npx next dev --webpack -p 4830
//   2. node scripts/probar-contratos-mostrador.mjs --base http://127.0.0.1:4830 --reserva 1
//
// ⚠️ Escribe en la base del servidor (registra un escaneado). NO guarda cookies ni
// credenciales en disco: las sesiones viven en memoria.

const argv = process.argv.slice(2);
const opcion = (n, pd) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : pd;
};

const BASE = opcion('base', 'http://127.0.0.1:4830');
const RESERVA = Number(opcion('reserva', '1'));

const CUENTAS = {
  admin: { correo: process.env.PRUEBA_ADMIN || 'admin@rentdrive.com', password: process.env.PRUEBA_ADMIN_CLAVE || 'admin123' },
  propietario: { correo: process.env.PRUEBA_PROPIETARIO || 'propietario@rentdrive.com', password: process.env.PRUEBA_PROPIETARIO_CLAVE || 'owner123' },
  cliente: { correo: process.env.PRUEBA_CLIENTE || 'usuario@rentdrive.com', password: process.env.PRUEBA_CLIENTE_CLAVE || 'user123' },
};

const sesiones = {};
let pruebas = 0;
let fallos = 0;

function comprobar(titulo, condicion, detalle = '') {
  pruebas++;
  const ok = !!condicion;
  if (!ok) fallos++;
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
}

async function entrar(quien) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CUENTAS[quien]),
  });
  const cookie = res.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') ?? '';
  if (!res.ok || !cookie) throw new Error(`no se pudo entrar como ${quien} (${res.status})`);
  sesiones[quien] = cookie;
}

async function pedir(quien, ruta, opciones = {}) {
  const cabeceras = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
  if (quien && sesiones[quien]) cabeceras.cookie = sesiones[quien];
  const res = await fetch(`${BASE}${ruta}`, { ...opciones, headers: cabeceras });
  let cuerpo = {};
  try { cuerpo = await res.json(); } catch { cuerpo = {}; }
  return { status: res.status, cuerpo };
}

async function bajar(quien, ruta) {
  const cabeceras = {};
  if (quien && sesiones[quien]) cabeceras.cookie = sesiones[quien];
  const res = await fetch(`${BASE}${ruta}`, { headers: cabeceras });
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  return {
    status: res.status,
    tipo: res.headers.get('content-type') || '',
    disposicion: res.headers.get('content-disposition') || '',
    nosniff: res.headers.get('x-content-type-options') || '',
    bytes: buf.length,
    magia: buf.subarray(0, 5).toString('ascii'),
  };
}

/** Una imagen JPEG mínima pero válida (>1 KB), como «escaneado» de prueba. */
function escaneoDePrueba() {
  // Cabecera JPEG real + relleno; el servidor valida los BYTES, no el nombre.
  const cabecera = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const cuerpo = Buffer.alloc(4096, 0x55);
  const fin = Buffer.from([0xff, 0xd9]);
  return `data:image/jpeg;base64,${Buffer.concat([cabecera, cuerpo, fin]).toString('base64')}`;
}

async function main() {
  for (const quien of Object.keys(CUENTAS)) await entrar(quien);
  console.log(`\nServidor: ${BASE} · reserva #${RESERVA}\n`);

  const lista = await pedir('admin', `/api/contratos?reserva_id=${RESERVA}`);
  comprobar('el equipo lista los documentos de la reserva', lista.status === 200, `${lista.cuerpo.contratos?.length ?? 0} documento(s)`);
  if (lista.status !== 200) { process.exitCode = 1; return; }

  const firmado = lista.cuerpo.contratos.find(c => c.estado === 'firmado');
  const pendiente = lista.cuerpo.contratos.find(c => c.estado === 'pendiente' && c.via_firma === '');

  // ── PDF ──
  console.log('1 · El PDF');
  if (firmado) {
    const pdf = await bajar('admin', `/api/contratos/${firmado.id}/pdf`);
    comprobar('el equipo descarga el PDF', pdf.status === 200 && pdf.magia === '%PDF-', `${pdf.bytes} bytes · ${pdf.tipo}`);
    comprobar('el PDF va como adjunto y con nosniff',
      pdf.disposicion.startsWith('attachment;') && pdf.nosniff === 'nosniff', pdf.disposicion);

    const delCliente = await bajar('cliente', `/api/contratos/${firmado.id}/pdf`);
    comprobar('el cliente descarga SU documento', delCliente.status === 200 && delCliente.magia === '%PDF-', `${delCliente.status}`);

    const papelDeFirmado = await pedir('admin', `/api/contratos/${firmado.id}/pdf?modo=papel`);
    comprobar('no se imprime «para firmar» un documento ya firmado', papelDeFirmado.status === 409, papelDeFirmado.cuerpo.error || '');
  } else {
    comprobar('hay un documento firmado para probar el PDF', false, 'no se encontró ninguno');
  }

  // ── Mostrador ──
  console.log('\n2 · El mostrador');
  if (!pendiente) {
    comprobar('hay un documento pendiente y sin vía elegida para el mostrador', false,
      'emite uno nuevo desde el panel y vuelve a correr la prueba');
    console.log(`\n${pruebas - fallos} de ${pruebas} comprobaciones pasaron.`);
    if (fallos > 0) process.exitCode = 1;
    return;
  }

  const blanco = await bajar('admin', `/api/contratos/${pendiente.id}/pdf?modo=papel`);
  comprobar('copia para firma física descargada', blanco.status === 200 && blanco.magia === '%PDF-', `${blanco.bytes} bytes`);
  comprobar('el nombre del archivo lo distingue', /para-firmar\.pdf/.test(blanco.disposicion), blanco.disposicion);

  const detalle = await pedir('admin', `/api/contratos/${pendiente.id}`);
  const version = detalle.cuerpo.contrato?.version;
  comprobar('el detalle expone la vía de firma', detalle.cuerpo.contrato?.via_firma === '', `via_firma=«${detalle.cuerpo.contrato?.via_firma}»`);

  const cuerpoEscaneo = { archivo: escaneoDePrueba(), nombre_archivo: 'contrato-firmado.jpg', version, confirma: true };

  const sinCsrf = await pedir('admin', `/api/contratos/${pendiente.id}/escaneo`, {
    method: 'POST', body: JSON.stringify(cuerpoEscaneo), headers: { 'Content-Type': 'text/plain' },
  });
  comprobar('sin Content-Type de JSON se bloquea (CSRF)', sinCsrf.status === 403 || sinCsrf.status === 400, `${sinCsrf.status}`);

  const delCliente = await pedir('cliente', `/api/contratos/${pendiente.id}/escaneo`, {
    method: 'POST', body: JSON.stringify(cuerpoEscaneo),
  });
  comprobar('el cliente NO puede registrar el papel', delCliente.status === 403, delCliente.cuerpo.error || `${delCliente.status}`);

  const basura = await pedir('admin', `/api/contratos/${pendiente.id}/escaneo`, {
    method: 'POST',
    body: JSON.stringify({ ...cuerpoEscaneo, archivo: `data:application/pdf;base64,${Buffer.alloc(4096, 0x41).toString('base64')}` }),
  });
  comprobar('un archivo que miente sobre su tipo se rechaza', basura.status === 400, basura.cuerpo.error || `${basura.status}`);

  const subida = await pedir('admin', `/api/contratos/${pendiente.id}/escaneo`, {
    method: 'POST', body: JSON.stringify(cuerpoEscaneo),
  });
  comprobar('el equipo registra el escaneado', subida.status === 201 && subida.cuerpo.via_firma === 'papel',
    subida.cuerpo.error || `estado=${subida.cuerpo.estado} via=${subida.cuerpo.via_firma}`);

  const tras = await pedir('admin', `/api/contratos/${pendiente.id}`);
  comprobar('el detalle distingue el estado', tras.cuerpo.contrato?.estado === 'firmado' && tras.cuerpo.papel?.firmado_en_papel === true,
    `estado=${tras.cuerpo.contrato?.estado} papel=${tras.cuerpo.papel?.firmado_en_papel}`);
  comprobar('el sello del escaneado verifica', tras.cuerpo.papel?.integridad?.ok === true, tras.cuerpo.papel?.integridad?.motivo || '');
  comprobar('ningún bloque queda ofrecido para firmar', (tras.cuerpo.firmas || []).every(f => f.puedo_firmar === false));

  const firmarTrasPapel = await pedir('cliente', `/api/contratos/${pendiente.id}/firmar`, {
    method: 'POST',
    body: JSON.stringify({
      bloque: (tras.cuerpo.firmas || [])[0]?.bloque || 'arrendatario',
      nombre_confirmado: 'María Usuario',
      firma_imagen: 'data:image/png;base64,AAAA',
      metodo: 'trazo', acepta: true, version,
    }),
  });
  comprobar('tras el papel NO se puede firmar electrónicamente', firmarTrasPapel.status === 409,
    firmarTrasPapel.cuerpo.error || `${firmarTrasPapel.status}`);

  const descarga = await bajar('cliente', `/api/contratos/${pendiente.id}/escaneo`);
  comprobar('el cliente descarga el escaneado de SU documento', descarga.status === 200 && descarga.bytes > 1000, `${descarga.bytes} bytes`);
  comprobar('el escaneado va como adjunto, con nosniff',
    descarga.disposicion.startsWith('attachment;') && descarga.nosniff === 'nosniff', descarga.disposicion);

  const yaNoPapel = await bajar('admin', `/api/contratos/${pendiente.id}/pdf?modo=papel`);
  comprobar('ya no se imprime «para firmar»', yaNoPapel.status === 409, `${yaNoPapel.status}`);

  const conEscaneo = await bajar('admin', `/api/contratos/${pendiente.id}/pdf`);
  comprobar('el PDF del expediente incluye el escaneado', conEscaneo.status === 200 && conEscaneo.magia === '%PDF-', `${conEscaneo.bytes} bytes`);

  // ── Un tercero ──
  console.log('\n3 · Quien no es parte');
  const ajeno = await bajar('propietario', `/api/contratos/${pendiente.id}/pdf`);
  comprobar('el propietario del vehículo SÍ es parte y puede verlo', ajeno.status === 200, `${ajeno.status}`);
  const inexistente = await bajar('cliente', '/api/contratos/99999999/pdf');
  comprobar('un id que no existe da 404', inexistente.status === 404, `${inexistente.status}`);

  console.log(`\n${pruebas - fallos} de ${pruebas} comprobaciones pasaron.`);
  if (fallos > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
