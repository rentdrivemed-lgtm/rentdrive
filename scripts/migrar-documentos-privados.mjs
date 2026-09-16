#!/usr/bin/env node
// ── ETAPA 2: pasar los documentos de identidad a entrega PRIVADA ────────────
//
// ⚠️ NO EJECUTAR TODAVÍA. Este script es la segunda etapa del trabajo y solo se
// puede correr cuando TODAS las pantallas hayan dejado de recibir la dirección del
// archivo (ver el listado «Qué falta» al final de este comentario). Si se corre
// antes, las pantallas que aún reciben la URL pública mostrarán documentos rotos:
// al pasar un recurso a `authenticated` su dirección cambia y la vieja deja de
// servir — que es exactamente el objetivo, pero hay que llegar preparado.
//
// QUÉ HACE
//   1. Lee de la base de datos TODAS las direcciones de documentos de identidad
//      (usuarios, reservas y el JSON `documentos` de vehículos).
//   2. Para cada una, renombra el recurso en Cloudinary de `type=upload` a
//      `type=authenticated` (`rename` con `to_type`), que es la operación que
//      REVOCA el enlace público: la dirección antigua deja de responder.
//   3. Reescribe en la base de datos la dirección nueva (canónica, SIN firma: la
//      firma la pone el servidor al vuelo, ver `urlEntregaDocumento`).
//
// POR QUÉ ESE ORDEN Y NO AL REVÉS. Cloudinary no permite tener el mismo archivo en
// los dos modos a la vez, así que no hay forma de solapar. Lo que sí se puede es
// hacerlo documento a documento y dejar la base consistente después de CADA uno:
// si el proceso se corta a la mitad, lo migrado funciona y lo no migrado también.
// Por eso se escribe la fila inmediatamente después de cada `rename`, en vez de
// acumular y guardar al final.
//
// MODO POR DEFECTO: ENSAYO. Sin `--aplicar` no toca nada: solo lista lo que haría.
//
//   node scripts/migrar-documentos-privados.mjs                 # ensayo
//   node scripts/migrar-documentos-privados.mjs --aplicar       # de verdad
//   node scripts/migrar-documentos-privados.mjs --aplicar --limite 5
//
// Variables necesarias: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
// CLOUDINARY_API_SECRET y (opcional) RENTDRIVE_DB con la ruta del .db.
//
// QUÉ FALTA ANTES DE PODER CORRERLO (etapa 2, pendiente):
//   · `GET/PUT /api/auth/me` sigue devolviéndole a la persona las direcciones de
//     SUS documentos, y `app/pago/page.tsx` se las devuelve al servidor al reservar.
//     Ese ida y vuelta hay que cambiarlo por «usa el que ya tengo en mi perfil»,
//     resuelto en el servidor.
//   · Los documentos del VEHÍCULO (tarjeta, SOAT, tecno, póliza) se editan desde el
//     panel del propietario con el mismo ida y vuelta.
//   · `app/(auth)/registro/page.tsx` y `app/completar-perfil/page.tsx` suben y
//     reenvían direcciones recién subidas.
//   Mientras eso siga así, migrar rompería esas pantallas.
import path from 'path';
import process from 'process';
import { v2 as cloudinary } from 'cloudinary';
import Database from 'better-sqlite3';

const APLICAR = process.argv.includes('--aplicar');
const iLim = process.argv.indexOf('--limite');
const LIMITE = iLim > -1 ? Number(process.argv[iLim + 1]) || 0 : 0;

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
if (!CLOUD || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Faltan las variables CLOUDINARY_*.');
  process.exit(1);
}
cloudinary.config({
  cloud_name: CLOUD,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Mismo parser que `recursoDeUrlStorage` (lib/storage.ts), reescrito aquí en JS
// porque este script corre suelto con node (sin el alias `@/` ni el compilador).
// Si se toca uno hay que tocar el otro: lo que importa es que los dos deduzcan
// EXACTAMENTE el mismo `public_id`, que es con lo que se renombra el archivo.
const CONTROL_O_BARRA = /[\u0000-\u001f\u007f\\]/;
const RE_FIRMA = /^s--[A-Za-z0-9_-]{6,}--$/;
const RE_VERSION = /^v\d{1,19}$/;
const RE_SEGMENTO = /^[A-Za-z0-9._@~-]+$/;

function recurso(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u || u.length > 1000) return null;
  if (CONTROL_O_BARRA.test(u)) return null;
  let p;
  try { p = new URL(u); } catch { return null; }
  if (p.protocol !== 'https:' || p.hostname.toLowerCase() !== 'res.cloudinary.com') return null;
  if (p.port || p.username || p.password || p.search || p.hash) return null;
  const segs = p.pathname.split('/').filter(x => x !== '');
  if (segs.length < 4 || segs.some(x => x === '.' || x === '..')) return null;
  if (segs[0] !== CLOUD) return null;
  const resourceType = segs[1];
  const entrega = segs[2];
  if (!['image', 'raw', 'video'].includes(resourceType)) return null;
  if (!['upload', 'authenticated', 'private'].includes(entrega)) return null;
  let i = 3;
  if (RE_FIRMA.test(segs[i])) { if (entrega === 'upload') return null; i++; }
  let version = null;
  if (i < segs.length && RE_VERSION.test(segs[i])) { version = segs[i]; i++; }
  const resto = segs.slice(i);
  if (!resto.length) return null;
  if (!resto.every(x => RE_SEGMENTO.test(x))) return null;
  if (resto.some(x => RE_VERSION.test(x))) return null;
  const ruta = resto.join('/');
  let publicId = ruta;
  let formato = null;
  if (resourceType !== 'raw') {
    const m = /^(.*)\.([A-Za-z0-9]{2,8})$/.exec(ruta);
    if (m && m[1]) { publicId = m[1]; formato = m[2].toLowerCase(); }
  }
  return { resourceType, entrega, version, publicId, formato };
}

const dbPath = process.env.RENTDRIVE_DB || path.join(process.cwd(), 'rentdrive.db');
const db = new Database(dbPath);

// ── Inventario: qué documentos hay y dónde se guarda cada dirección ────────
const pendientes = [];

for (const [col, clave] of [
  ['cedula_url', 'cédula (frente)'], ['cedula_url_dorso', 'cédula (dorso)'],
  ['licencia_url', 'licencia (frente)'], ['licencia_url_dorso', 'licencia (dorso)'],
  ['certificado_bancario_url', 'certificado bancario'],
]) {
  const filas = db.prepare(`SELECT id, ${col} AS url FROM usuarios WHERE ${col} IS NOT NULL AND ${col} != ''`).all();
  for (const f of filas) {
    pendientes.push({ tabla: 'usuarios', col, id: f.id, url: f.url, rotulo: `usuario #${f.id} · ${clave}` });
  }
}
for (const [col, clave] of [
  ['documento_id_url', 'documento (frente)'], ['documento_id_url_dorso', 'documento (dorso)'],
  ['licencia_url', 'licencia (frente)'], ['licencia_url_dorso', 'licencia (dorso)'],
]) {
  const filas = db.prepare(`SELECT id, ${col} AS url FROM reservas WHERE ${col} IS NOT NULL AND ${col} != ''`).all();
  for (const f of filas) {
    pendientes.push({ tabla: 'reservas', col, id: f.id, url: f.url, rotulo: `reserva #${f.id} · ${clave}` });
  }
}
// Vehículos: las direcciones viven dentro del JSON `documentos`, así que se reescribe
// el JSON entero (conservando cualquier otra clave que tenga, incluidas las legadas).
const vehiculos = db.prepare("SELECT id, documentos FROM vehiculos WHERE documentos IS NOT NULL AND documentos != ''").all();
for (const v of vehiculos) {
  let docs;
  try { docs = JSON.parse(v.documentos); } catch { continue; }
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) continue;
  for (const [clave, entrada] of Object.entries(docs)) {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) continue;
    for (const campo of ['url', 'url_dorso']) {
      const url = entrada[campo];
      if (typeof url !== 'string' || !url.trim()) continue;
      pendientes.push({
        tabla: 'vehiculos', col: 'documentos', id: v.id, url,
        jsonClave: clave, jsonCampo: campo,
        rotulo: `vehículo #${v.id} · ${clave}.${campo}`,
      });
    }
  }
}

const migrables = pendientes.filter(p => { const r = recurso(p.url); return r && r.entrega === 'upload'; });
const yaPrivados = pendientes.filter(p => { const r = recurso(p.url); return r && r.entrega !== 'upload'; });
const raros = pendientes.filter(p => !recurso(p.url));

console.log(`Documentos referenciados en la base: ${pendientes.length}`);
console.log(`  · ya privados         : ${yaPrivados.length}`);
console.log(`  · a migrar (públicos) : ${migrables.length}`);
console.log(`  · fuera del storage   : ${raros.length}${raros.length ? ' (legado /uploads/… o direcciones externas: NO se tocan)' : ''}`);
for (const r of raros.slice(0, 20)) console.log(`      - ${r.rotulo}: ${String(r.url).slice(0, 80)}`);

const lote = LIMITE > 0 ? migrables.slice(0, LIMITE) : migrables;
if (!APLICAR) {
  console.log(`\nENSAYO (sin --aplicar). Se migrarían ${lote.length}:`);
  for (const p of lote.slice(0, 40)) console.log(`  · ${p.rotulo}`);
  process.exit(0);
}

let ok = 0;
let fallos = 0;
for (const p of lote) {
  const r = recurso(p.url);
  try {
    const res = await cloudinary.uploader.rename(r.publicId, r.publicId, {
      resource_type: r.resourceType,
      type: 'upload',
      to_type: 'authenticated',
      overwrite: false,
      invalidate: true,
    });
    const nueva = res.secure_url;
    const comprobado = recurso(nueva);
    if (!comprobado || comprobado.entrega === 'upload') {
      throw new Error(`Cloudinary devolvió una dirección inesperada: ${nueva}`);
    }
    // Escritura inmediata: si el proceso muere aquí, lo hecho queda consistente.
    if (p.tabla === 'vehiculos') {
      const fila = db.prepare('SELECT documentos FROM vehiculos WHERE id = ?').get(p.id);
      const docs = JSON.parse(fila.documentos);
      docs[p.jsonClave][p.jsonCampo] = nueva;
      db.prepare('UPDATE vehiculos SET documentos = ? WHERE id = ?').run(JSON.stringify(docs), p.id);
    } else {
      db.prepare(`UPDATE ${p.tabla} SET ${p.col} = ? WHERE id = ?`).run(nueva, p.id);
    }
    ok++;
    console.log(`  OK  ${p.rotulo}`);
  } catch (e) {
    fallos++;
    console.log(`  ERR ${p.rotulo}: ${e?.message || e}`);
  }
}
console.log(`\nMigrados: ${ok} · fallos: ${fallos}`);
