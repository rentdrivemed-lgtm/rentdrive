// Prueba de las fases 3 y 4 de contratos digitales: el PDF, el paquete y el mostrador.
//
// A diferencia de `probar-contratos-firma.mjs` (que va por HTTP contra un servidor
// levantado), este script llama a las funciones por dentro y trabaja sobre una COPIA de
// la base: genera PDF de verdad, los deja en una carpeta para poder ABRIRLOS y MIRARLOS,
// arma los zip de un propietario y de un cliente, y comprueba el ciclo del mostrador.
//
// Qué comprueba:
//   · que se genere el PDF de los SEIS documentos, con firmas y con constancia;
//   · que las firmas queden ancladas a su bloque DENTRO del texto (no en un apéndice);
//   · que un documento anulado salga marcado como tal;
//   · que alterar el texto en la base haga que la constancia avise (el sello no cuadra);
//   · el ciclo del mostrador: copia en blanco → escaneado → estado «papel»;
//   · que un contrato NO pueda firmarse por las dos vías (en los dos sentidos);
//   · que el escaneado se valide por sus BYTES y no por lo que declare el cliente;
//   · que el zip del propietario y el del cliente traigan cada uno SU mitad.
//
// Cómo correrlo (desde la raíz del proyecto):
//   node scripts/correr-ts.mjs scripts/probar-contratos-pdf.ts --salida ./salida-contratos-pdf
//
// ⚠️ NO toca `rentdrive.db`: copia la base a un archivo de trabajo y escribe ahí. No
// escribe credenciales ni cookies en disco.

import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { TIPOS_DOCUMENTO, TITULOS_DOCUMENTO, type TipoDocumento } from '../lib/contratos-datos';
import {
  generarContrato, firmarBloqueContrato, leerContrato, leerFirmas, anularContrato,
  type ContratoRow,
} from '../lib/contratos-firma';
import { registrarFirmaEnPapel, leerEscaneo, validarEscaneo } from '../lib/contratos-papel';
import { anclarFirmas, construirContratoPDF, contratoPDFBuffer } from '../lib/contrato-pdf';
import { listarDocumentosPersona, construirPaquete, fechaHoraColombia } from '../lib/paquete-documentos';

const argv = process.argv.slice(2);
const opcion = (n: string, pd: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : pd;
};

const RUTA_ORIGEN = opcion('db', './rentdrive.db');
const RUTA_TRABAJO = opcion('db-trabajo', './rentdrive-prueba-pdf.db');
const SALIDA = opcion('salida', './salida-contratos-pdf');
const RESERVA = Number(opcion('reserva', '1'));
/**
 * `--limpiar` borra los contratos de esa reserva EN LA COPIA DE TRABAJO antes de
 * empezar. No toca la base real. Sirve para obtener siempre el mismo juego de seis
 * documentos limpios (útil para mirar los PDF); sin la bandera, la prueba reutiliza lo
 * que ya haya, que es lo realista.
 */
const LIMPIAR = argv.includes('--limpiar');

let pruebas = 0;
let fallos = 0;
function comprobar(titulo: string, condicion: unknown, detalle = ''): void {
  pruebas++;
  const ok = !!condicion;
  if (!ok) fallos++;
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
}

/** Un PNG de firma sintético (trazo oscuro sobre transparente), como el del <canvas>. */
async function firmaPng(semilla: number): Promise<string> {
  const w = 300, h = 90;
  const rgba = Buffer.alloc(w * h * 4);
  for (let x = 0; x < w; x++) {
    const y = Math.round(h / 2 + Math.sin((x + semilla) / 14) * (h / 3));
    for (let d = -2; d <= 2; d++) {
      const yy = Math.min(h - 1, Math.max(0, y + d));
      const i = (yy * w + x) * 4;
      rgba[i] = 17; rgba[i + 1] = 24; rgba[i + 2] = 39; rgba[i + 3] = 255;
    }
  }
  const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** Una «foto del contrato firmado» sintética, para el ciclo del mostrador. */
async function escaneoJpeg(): Promise<string> {
  const jpg = await sharp({
    create: { width: 1240, height: 1754, channels: 3, background: { r: 246, g: 244, b: 238 } },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="1240" height="1754"><text x="80" y="200" font-size="54" fill="#222">CONTRATO FIRMADO A MANO</text>`
        + `<text x="80" y="300" font-size="34" fill="#444">(escaneado de prueba del mostrador)</text>`
        + `<path d="M120 1400 C 260 1300, 340 1520, 500 1400 S 720 1300, 860 1420" stroke="#111" stroke-width="7" fill="none"/>`
        + `<line x1="100" y1="1500" x2="900" y2="1500" stroke="#333" stroke-width="3"/></svg>`,
      ),
      top: 0, left: 0,
    }])
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

async function main(): Promise<void> {
  if (!existsSync(RUTA_ORIGEN)) {
    console.error(`No existe la base ${RUTA_ORIGEN}.`);
    process.exit(1);
  }
  for (const sufijo of ['', '-wal', '-shm']) {
    if (existsSync(RUTA_TRABAJO + sufijo)) rmSync(RUTA_TRABAJO + sufijo);
  }
  // `VACUUM INTO` y no `copyFileSync`: la base corre en modo WAL, así que copiar solo el
  // archivo principal deja fuera todo lo que aún está en `rentdrive.db-wal` y la prueba
  // acabaría corriendo, sin avisar, sobre una foto vieja de los datos. `VACUUM INTO`
  // escribe una copia CONSISTENTE y completa, y además no toca el original.
  const origen = new Database(RUTA_ORIGEN, { readonly: true });
  origen.prepare('VACUUM INTO ?').run(RUTA_TRABAJO);
  origen.close();
  const db = new Database(RUTA_TRABAJO);
  await fs.mkdir(SALIDA, { recursive: true });

  const reserva = db.prepare('SELECT r.id, r.usuario_id, v.propietario_id FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = ?')
    .get(RESERVA) as { id: number; usuario_id: number; propietario_id: number } | undefined;
  if (!reserva) { console.error(`No existe la reserva #${RESERVA}.`); process.exit(1); }

  const admin = db.prepare("SELECT id, nombre, correo FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1")
    .get() as { id: number; nombre: string; correo: string };
  const actorAdmin = { id: admin.id, nombre: admin.nombre, correo: admin.correo, nivel: 'admin' };

  console.log(`\nBase de trabajo: ${RUTA_TRABAJO}`);
  console.log(`Reserva #${reserva.id} · propietario ${reserva.propietario_id} · cliente ${reserva.usuario_id}`);
  console.log(`Carpeta de salida: ${path.resolve(SALIDA)}\n`);

  if (LIMPIAR) {
    // Solo sobre la COPIA. El orden respeta las claves foráneas.
    db.prepare('DELETE FROM contrato_escaneos WHERE contrato_id IN (SELECT id FROM contratos WHERE reserva_id = ?)').run(RESERVA);
    db.prepare('DELETE FROM contrato_firmas WHERE contrato_id IN (SELECT id FROM contratos WHERE reserva_id = ?)').run(RESERVA);
    db.prepare('DELETE FROM contratos WHERE reserva_id = ?').run(RESERVA);
    console.log('(--limpiar) se borraron los contratos de la reserva en la copia de trabajo\n');
  }

  // ── 1 · Un documento vigente de cada tipo ──────────────────────────────────
  console.log('1 · Emitir los seis documentos');
  const porTipo = new Map<TipoDocumento, number>();
  for (const tipo of TIPOS_DOCUMENTO) {
    const vigente = db.prepare("SELECT id FROM contratos WHERE reserva_id = ? AND tipo = ? AND estado <> 'anulado' ORDER BY version DESC LIMIT 1")
      .get(RESERVA, tipo) as { id: number } | undefined;
    if (vigente) { porTipo.set(tipo, vigente.id); comprobar(`${tipo}: ya había uno vigente`, true, `id ${vigente.id}`); continue; }
    const r = generarContrato(db, tipo, RESERVA, actorAdmin);
    comprobar(`${tipo}: emitido`, r.ok, r.ok ? r.contrato.numero : (r as { error: string }).error);
    if (r.ok) porTipo.set(tipo, r.contrato.id);
  }

  // ── 2 · Firmar digitalmente lo que falte ──────────────────────────────────
  console.log('\n2 · Firmar electrónicamente los bloques pendientes');
  // El pagaré se reserva para el mostrador: se deja SIN firmar digitalmente.
  const tipoParaPapel: TipoDocumento = 'pagare';
  let semilla = 0;
  for (const [tipo, id] of porTipo) {
    if (tipo === tipoParaPapel) continue;
    const c = leerContrato(db, id)!;
    if (c.estado === 'anulado') continue;
    for (const f of leerFirmas(db, id)) {
      if (f.firmada_en) continue;
      const usuarioId = f.rol === 'agente' ? admin.id : f.rol === 'cliente' ? reserva.usuario_id : reserva.propietario_id;
      const fila = db.prepare('SELECT nombre, correo, rol FROM usuarios WHERE id = ?').get(usuarioId) as { nombre: string; correo: string; rol: 'admin' | 'propietario' | 'usuario' };
      const r = firmarBloqueContrato(db, id, {
        usuarioId, nombre: fila.nombre, correo: fila.correo, rolCuenta: fila.rol,
        puedeFirmarComoAgente: fila.rol === 'admin',
      }, {
        bloque: f.bloque, nombreConfirmado: fila.nombre, firmaImagen: await firmaPng(semilla += 37),
        metodo: 'trazo', acepta: true, version: c.version, ip: '127.0.0.1', userAgent: 'prueba-pdf',
      });
      comprobar(`${tipo} · firmar «${f.bloque}»`, r.ok, r.ok ? '' : (r as { error: string }).error);
    }
  }

  // ── 3 · El anclaje de las firmas dentro del texto ─────────────────────────
  console.log('\n3 · Las firmas se anclan a su bloque DENTRO del texto');
  for (const [tipo, id] of porTipo) {
    const c = leerContrato(db, id)!;
    const firmas = leerFirmas(db, id);
    const anclas = anclarFirmas(tipo, c.texto, firmas.map(f => f.bloque));
    comprobar(`${tipo}: ${firmas.length} bloque(s) anclados`, !!anclas && anclas.length === firmas.length,
      anclas ? anclas.map(a => `${a.clave}@${a.inicio}-${a.fin}`).join(' ') : 'NO se pudo anclar (iría al apéndice)');
  }

  // ── 4 · El ciclo del mostrador ────────────────────────────────────────────
  console.log('\n4 · Mostrador: copia en blanco, escaneado y estado');
  const idPapel = porTipo.get(tipoParaPapel)!;
  const cPapel = leerContrato(db, idPapel)!;

  const pdfBlanco = await contratoPDFBuffer(
    { contrato: cPapel, firmas: leerFirmas(db, idPapel) }, { modo: 'papel' },
  );
  await fs.writeFile(path.join(SALIDA, `${cPapel.numero}-para-firmar.pdf`), Buffer.from(pdfBlanco));
  comprobar('copia para firma física generada', pdfBlanco.byteLength > 2000, `${Math.round(pdfBlanco.byteLength / 1024)} KB`);

  // Un archivo de tamaño creíble (4 KB) que se DECLARA PDF pero no lo es: lo que decide
  // es la cabecera real, no el prefijo del data URI.
  const basura = validarEscaneo('data:application/pdf;base64,' + Buffer.alloc(4096, 0x41).toString('base64'));
  comprobar('un archivo que MIENTE sobre su tipo se rechaza', !basura.ok, basura.ok ? '' : basura.error);
  const zipDisfrazado = validarEscaneo('data:image/jpeg;base64,' + Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(4096, 0x20)]).toString('base64'));
  comprobar('un .zip disfrazado de imagen se rechaza', !zipDisfrazado.ok, zipDisfrazado.ok ? '' : zipDisfrazado.error);

  const escaneo = await escaneoJpeg();
  const malaVersion = registrarFirmaEnPapel(db, idPapel, actorAdmin, {
    archivo: escaneo, nombreArchivo: 'pagare-firmado.jpg', version: cPapel.version + 9,
    confirma: true, ip: '127.0.0.1', userAgent: 'prueba-pdf',
  });
  comprobar('se rechaza si la versión no coincide', !malaVersion.ok, malaVersion.ok ? '' : (malaVersion as { error: string }).error);

  const sinConfirmar = registrarFirmaEnPapel(db, idPapel, actorAdmin, {
    archivo: escaneo, nombreArchivo: 'pagare-firmado.jpg', version: cPapel.version,
    confirma: false, ip: '127.0.0.1', userAgent: 'prueba-pdf',
  });
  comprobar('se rechaza sin confirmación explícita', !sinConfirmar.ok, sinConfirmar.ok ? '' : (sinConfirmar as { error: string }).error);

  const papel = registrarFirmaEnPapel(db, idPapel, actorAdmin, {
    archivo: escaneo, nombreArchivo: 'pagare-firmado.jpg', version: cPapel.version,
    confirma: true, ip: '127.0.0.1', userAgent: 'prueba-pdf',
  });
  comprobar('escaneado registrado', papel.ok, papel.ok ? `SHA-256 ${papel.sha256.slice(0, 16)}… · ${papel.bytes} bytes` : (papel as { error: string }).error);

  const cTrasPapel = leerContrato(db, idPapel)!;
  comprobar('el estado distingue la vía', cTrasPapel.estado === 'firmado' && cTrasPapel.via_firma === 'papel',
    `estado=${cTrasPapel.estado} via=${cTrasPapel.via_firma}`);
  comprobar('el escaneado quedó en la base', !!leerEscaneo(db, idPapel));

  const repetido = registrarFirmaEnPapel(db, idPapel, actorAdmin, {
    archivo: escaneo, nombreArchivo: 'otra.jpg', version: cTrasPapel.version, confirma: true, ip: '', userAgent: '',
  });
  comprobar('no se puede registrar un segundo escaneado', !repetido.ok, repetido.ok ? '' : (repetido as { error: string }).error);

  // ── 5 · Las dos vías son excluyentes ──────────────────────────────────────
  console.log('\n5 · Un contrato no puede firmarse por las dos vías');
  const bloquePagare = leerFirmas(db, idPapel)[0];
  const cliente = db.prepare('SELECT nombre, correo, rol FROM usuarios WHERE id = ?').get(reserva.usuario_id) as { nombre: string; correo: string; rol: 'usuario' };
  const firmaTrasPapel = firmarBloqueContrato(db, idPapel, {
    usuarioId: reserva.usuario_id, nombre: cliente.nombre, correo: cliente.correo, rolCuenta: cliente.rol,
    puedeFirmarComoAgente: false,
  }, {
    bloque: bloquePagare.bloque, nombreConfirmado: cliente.nombre, firmaImagen: await firmaPng(11),
    metodo: 'trazo', acepta: true, version: cTrasPapel.version, ip: '', userAgent: '',
  });
  comprobar('papel → NO admite firma electrónica', !firmaTrasPapel.ok, firmaTrasPapel.ok ? '' : (firmaTrasPapel as { error: string }).error);

  const idDigital = porTipo.get('otrosi-arrendamiento') ?? porTipo.get('arrendamiento')!;
  const cDigital = leerContrato(db, idDigital)!;
  const papelTrasFirma = registrarFirmaEnPapel(db, idDigital, actorAdmin, {
    archivo: escaneo, nombreArchivo: 'x.jpg', version: cDigital.version, confirma: true, ip: '', userAgent: '',
  });
  comprobar('digital → NO admite escaneado', !papelTrasFirma.ok, papelTrasFirma.ok ? '' : (papelTrasFirma as { error: string }).error);

  // ── 6 · Un documento anulado ──────────────────────────────────────────────
  console.log('\n6 · Un documento anulado se ve como tal');
  const idAnular = porTipo.get('otrosi-agencia')!;
  const anulacion = anularContrato(db, idAnular, actorAdmin, 'Prueba de la fase 3: comprobar el sello de ANULADA en el PDF.');
  comprobar('anulado', anulacion.ok, anulacion.ok ? '' : (anulacion as { error: string }).error);

  // ── 7 · Los PDF de los seis documentos ────────────────────────────────────
  console.log('\n7 · Generar los PDF');
  for (const [tipo, id] of porTipo) {
    const c = leerContrato(db, id)!;
    const escaneoFila = c.via_firma === 'papel' ? leerEscaneo(db, id) : null;
    const doc = await construirContratoPDF(
      { contrato: c, firmas: leerFirmas(db, id), escaneo: escaneoFila },
      { empresa: { nombre: 'DrivePass', nit: '902.088.011-1' }, generadoPara: 'prueba de la fase 3' },
    );
    const buf = Buffer.from(doc.output('arraybuffer'));
    const nombre = `${c.numero}-${tipo}.pdf`;
    await fs.writeFile(path.join(SALIDA, nombre), buf);
    comprobar(`${TITULOS_DOCUMENTO[tipo]}`, buf.length > 2000 && doc.getNumberOfPages() >= 1,
      `${nombre} · ${doc.getNumberOfPages()} pág · ${Math.round(buf.length / 1024)} KB · estado ${c.estado}${c.via_firma ? `/${c.via_firma}` : ''}`);
  }

  // ── 8 · La constancia avisa cuando el texto se altera ─────────────────────
  console.log('\n8 · Alterar el texto rompe la verificación');
  const idAlterar = porTipo.get('arrendamiento')!;
  const original = leerContrato(db, idAlterar)!.texto;
  db.prepare('UPDATE contratos SET texto = ? WHERE id = ?').run(original.replace('EL ARRENDATARIO', 'EL ARRENDATARIÓ'), idAlterar);
  const alterado = leerContrato(db, idAlterar)! as ContratoRow;
  const docAlterado = await construirContratoPDF({ contrato: alterado, firmas: leerFirmas(db, idAlterar) });
  const bufAlterado = Buffer.from(docAlterado.output('arraybuffer'));
  await fs.writeFile(path.join(SALIDA, `${alterado.numero}-TEXTO-ALTERADO.pdf`), bufAlterado);
  comprobar('el PDF del texto alterado se generó (hay que abrirlo y ver la ADVERTENCIA)', bufAlterado.length > 2000,
    `${alterado.numero}-TEXTO-ALTERADO.pdf`);
  db.prepare('UPDATE contratos SET texto = ? WHERE id = ?').run(original, idAlterar);

  // ── 9 · Los paquetes ──────────────────────────────────────────────────────
  console.log('\n9 · El zip del propietario y el del cliente');
  const { fechaISO, fechaHora } = fechaHoraColombia();
  for (const [quien, personaId] of [['propietario', reserva.propietario_id], ['cliente', reserva.usuario_id]] as const) {
    const lista = listarDocumentosPersona(db, personaId);
    if (!lista) { comprobar(`${quien}: lista`, false, 'no existe la persona'); continue; }
    const paquete = await construirPaquete(lista, { generadoPor: 'prueba de la fase 3', fechaHora, fechaISO, db });
    const ruta = path.join(SALIDA, `paquete-${quien}-${personaId}.zip`);
    await fs.writeFile(ruta, paquete.zip);
    comprobar(`${quien}: zip con ${lista.contratos.length} contrato(s)`, paquete.incluidos > 0,
      `${path.basename(ruta)} · ${paquete.incluidos} archivos · ${Math.round(paquete.bytes / 1024)} KB · omitidos ${paquete.omitidos.length}`);
    const tipos = new Set(lista.contratos.map(c => c.papel));
    console.log(`        papeles en el zip: ${[...tipos].join(', ') || '(ninguno)'}`);
    for (const c of lista.contratos) console.log(`          · ${c.ruta}.pdf`);
  }

  db.close();
  console.log(`\n${pruebas - fallos} de ${pruebas} comprobaciones pasaron.`);
  console.log(`PDF y zip en: ${path.resolve(SALIDA)}`);
  if (fallos > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
