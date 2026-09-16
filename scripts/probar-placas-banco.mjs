// BANCO DE PRUEBAS del detector automático de placas (lib/blur-placas.ts + lib/detectar-placa-color.ts).
//
// A diferencia de `probar-deteccion-placa.ts` (que solo ejerce el detector determinístico de
// color) y de `probar-tapar-placa.mjs` (que ejerce la vía MANUAL), este script corre el camino
// COMPLETO — el mismo `detectarYDifuminarPlaca` que usa POST /api/upload — contra fotos reales
// del catálogo, VARIAS VECES por foto, y mide:
//
//  - si cada placa REAL (declarada abajo como "verdad de terreno") quedó tapada;
//  - si se tapó algo donde NO hay placa (superficie sellada fuera de las placas conocidas);
//  - si la foto quedó retenida para revisión manual (`revisionManual`), que es el desenlace
//    ACEPTABLE cuando el sistema no está seguro;
//  - la VARIANZA: el modelo no es determinista con placas chicas, así que un resultado bueno
//    una vez no dice nada. Por eso se corre N veces y se reporta el desenlace de cada corrida.
//
// Cada corrida escribe a disco la foto resultante y una copia ANOTADA (marco verde sobre cada
// placa real conocida) para poder MIRARLAS una por una, que es como se detectaron todos los
// defectos anteriores de este subsistema.
//
// Uso (desde la raíz del proyecto, con ANTHROPIC_API_KEY en el entorno):
//   node scripts/probar-placas-banco.mjs --salida ./salida-placas --repeticiones 3 [--fotos DIR] [--solo A]
//
// Las fotos son fotos reales de clientes con placas visibles: NO se versionan. El script las
// baja de Cloudinary a `--fotos` (por defecto ./banco-placas-fotos) y reutiliza la copia local.

import { createJiti } from 'jiti';
import fs from 'fs/promises';
import path from 'path';

const jiti = createJiti(import.meta.url);
const blur = await jiti.import('../lib/blur-placas.ts');
const sharp = (await import('sharp')).default;

const args = process.argv.slice(2);
const opt = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i !== -1 && args[i + 1] ? args[i + 1] : porDefecto;
};
const SALIDA = path.resolve(opt('--salida', './salida-placas'));
const DIR_FOTOS = path.resolve(opt('--fotos', './banco-placas-fotos'));
const REPS = Number(opt('--repeticiones', '3'));
const SOLO = opt('--solo', null);

/**
 * VERDAD DE TERRENO — medida a mano sobre cada foto (fracciones 0–1 del lienzo).
 *  - `placas`: dónde está de verdad cada placa VISIBLE. El sistema DEBE taparlas (o retener la
 *    foto). La caja es la del panel; se mide la cobertura contra ella.
 *  - `noPlacas`: sitios donde NO hay placa y donde ya se estampó un sello por error alguna vez
 *    (falsos positivos históricos). Un sello acá es un FALLO.
 */
const BANCO = [
  {
    id: 'A',
    nombre: 'A-tres-placas',
    url: 'https://res.cloudinary.com/dvtmbf1oe/image/upload/uploads/1787855568689-g5o8xsr8cjc.jpg',
    descripcion: 'Tucson de frente, 3 placas: la amarilla del carro, una amarilla de un tercero partida por una reja y la BLANCA de una camioneta al fondo medio tapada por un árbol',
    placas: [
      { nombre: 'A1 carro KZR957 (amarilla)', x: 0.165, y: 0.569, w: 0.115, h: 0.065 },
      { nombre: 'A2 tercero tras la reja (amarilla)', x: 0.1637, y: 0.3852, w: 0.0278, h: 0.0116 },
      { nombre: 'A3 camioneta al fondo (BLANCA)', x: 0.8181, y: 0.3735, w: 0.0187, h: 0.0091 },
    ],
    noPlacas: [],
  },
  {
    id: 'B',
    nombre: 'B-reflector',
    url: 'https://res.cloudinary.com/dvtmbf1oe/image/upload/uploads/1787855537799-h7uxwqr0y1w.jpg',
    descripcion: 'Tucson de atrás 3/4, 2 placas (la del carro y la del Nissan del borde derecho) + el REFLECTOR ámbar del paragolpes, que no es una placa',
    placas: [
      { nombre: 'B1 carro KZR957 (amarilla)', x: 0.0761, y: 0.5332, w: 0.0757, h: 0.0514 },
      { nombre: 'B2 Nissan borde derecho CLP622 (amarilla)', x: 0.961, y: 0.458, w: 0.039, h: 0.018 },
    ],
    noPlacas: [
      { nombre: 'reflector ámbar del paragolpes', x: 0.323, y: 0.715, w: 0.048, h: 0.018 },
    ],
  },
  {
    id: 'C',
    nombre: 'C-control',
    url: 'https://res.cloudinary.com/dvtmbf1oe/image/upload/v1789418198/uploads/reproc-placa-6-1789418197808-zxhijtsugq8.jpg',
    descripcion: 'CONTROL DE NO-REGRESIÓN: foto trasera que YA salió bien (su placa ya está tapada con el sello de marca). No debe aparecer ningún sello nuevo ni debe retenerse.',
    placas: [],
    noPlacas: [],
  },
];

/** Lado de análisis de las máscaras de medición. Alto a propósito: la placa blanca del banco
 *  mide 57x37 px en un lienzo de 3024x4032, y a 900 px de lado quedaría en 12x8 — demasiado
 *  poco para medir una cobertura con dos decimales. */
const LADO_MEDICION = 1800;

async function rgb(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(LADO_MEDICION, LADO_MEDICION, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, ancho: info.width, alto: info.height, canales: info.channels };
}

/**
 * Máscara "acá se estampó un sello": píxeles que CAMBIARON respecto del original.
 *
 * Se mide por diferencia y no por "¿es del color del sello?" porque el sello lleva el ícono
 * blanco/naranja de marca adentro, y en un sello chico ese ícono es más de la mitad de su
 * superficie: contando solo el navy, un tapado perfecto medía 45% de cobertura. La diferencia
 * contra el original, en cambio, no depende del dibujo del sello. El umbral 20 está medido: con
 * 40, un sello estampado sobre carrocería oscura contaba como "no tapado" en sus bordes (la
 * carrocería ya se parecía al navy) y una placa perfectamente cubierta medía 89%; con 20 ese
 * mismo caso mide 100% y el ruido de recompresión JPEG sigue sin aparecer (la foto de control,
 * donde no se estampa nada, mide 0.00% de superficie tapada). Un sello que YA estaba en la foto de entrada (el control C) no cambia nada y por lo
 * tanto no cuenta, que es justo lo que se quiere.
 */
async function mascaraTapado(antes, despues) {
  const A = await rgb(antes);
  const B = await rgb(despues);
  const m = new Uint8Array(B.ancho * B.alto);
  for (let i = 0; i < m.length; i++) {
    const pa = i * A.canales, pb = i * B.canales;
    const d = Math.hypot(A.data[pa] - B.data[pb], A.data[pa + 1] - B.data[pb + 1], A.data[pa + 2] - B.data[pb + 2]);
    if (d > 20) m[i] = 1;
  }
  return { m, ancho: B.ancho, alto: B.alto };
}

/** Fracción de la caja (0–1 del lienzo) que quedó tapada. */
function fraccionSelloEn(msk, caja) {
  const x0 = Math.max(0, Math.floor(caja.x * msk.ancho));
  const y0 = Math.max(0, Math.floor(caja.y * msk.alto));
  const x1 = Math.min(msk.ancho - 1, Math.ceil((caja.x + caja.w) * msk.ancho));
  const y1 = Math.min(msk.alto - 1, Math.ceil((caja.y + caja.h) * msk.alto));
  let total = 0, hit = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { total++; if (msk.m[y * msk.ancho + x]) hit++; }
  return total === 0 ? 0 : hit / total;
}

/** Superficie total sellada (fracción del lienzo) que NO se explica por las placas conocidas. */
function selloFueraDeLasPlacas(msk, placas) {
  let fuera = 0, total = msk.ancho * msk.alto;
  for (let y = 0; y < msk.alto; y++) {
    for (let x = 0; x < msk.ancho; x++) {
      const i = y * msk.ancho + x;
      if (!msk.m[i]) continue;
      const fx = x / msk.ancho, fy = y / msk.alto;
      // Se tolera el margen de seguridad alrededor de la placa: 1.5x la caja en cada eje.
      const dentro = placas.some(p => {
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        return Math.abs(fx - cx) <= p.w * 1.5 + 0.03 && Math.abs(fy - cy) <= p.h * 1.5 + 0.03;
      });
      if (!dentro) fuera++;
    }
  }
  return fuera / total;
}

/** Copia con marcos verdes sobre las placas reales y rojos sobre los "no placas". */
async function anotar(buffer, caso, destino) {
  const meta = await sharp(buffer).metadata();
  const W = meta.width, H = meta.height;
  const caja = (c, color) => {
    const x = c.x * W, y = c.y * H, w = c.w * W, h = c.h * H;
    const m = Math.max(6, Math.round(Math.min(W, H) * 0.004));
    return `<rect x="${x - m}" y="${y - m}" width="${w + 2 * m}" height="${h + 2 * m}" fill="none" stroke="${color}" stroke-width="${m}"/>`
      + `<text x="${x - m}" y="${Math.max(24, y - m - 8)}" fill="${color}" font-size="${Math.round(Math.min(W, H) * 0.02)}" font-family="sans-serif">${c.nombre}</text>`;
  };
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
    + caso.placas.map(c => caja(c, '#00FF00')).join('')
    + caso.noPlacas.map(c => caja(c, '#FF0000')).join('')
    + `</svg>`;
  // OJO: `resize` va en OTRA instancia de sharp. En un mismo pipeline, sharp aplica el resize
  // ANTES del composite, y entonces la capa SVG (del tamaño original) ya no cabe en la imagen
  // reducida ("Image to composite must have same dimensions or smaller").
  const compuesta = await sharp(buffer).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
  await sharp(compuesta).resize(1200, null, { withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(destino);
}

async function bajar(caso) {
  const destino = path.join(DIR_FOTOS, `${caso.nombre}.jpg`);
  try { return await fs.readFile(destino); } catch { /* no está en caché */ }
  const resp = await fetch(caso.url);
  if (!resp.ok) throw new Error(`No se pudo bajar ${caso.url}: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(destino, buf);
  return buf;
}

await fs.mkdir(SALIDA, { recursive: true });
await fs.mkdir(DIR_FOTOS, { recursive: true });

const resumen = [];
for (const caso of BANCO) {
  if (SOLO && !SOLO.split(',').includes(caso.id)) continue;
  const original = await bajar(caso);
  await anotar(original, caso, path.join(SALIDA, `${caso.nombre}-00-original-anotada.jpg`));
  console.log(`\n=========== ${caso.id} · ${caso.nombre} ===========\n${caso.descripcion}`);

  for (let rep = 1; rep <= REPS; rep++) {
    const t0 = Date.now();
    const r = await blur.detectarYDifuminarPlaca(original, 'image/jpeg');
    const ms = Date.now() - t0;
    const msk = await mascaraTapado(original, r.buffer);
    const cobertura = caso.placas.map(p => ({ nombre: p.nombre, frac: fraccionSelloEn(msk, p) }));
    const falsos = caso.noPlacas.map(p => ({ nombre: p.nombre, frac: fraccionSelloEn(msk, p) }));
    const fuera = selloFueraDeLasPlacas(msk, caso.placas);

    const base = `${caso.nombre}-rep${String(rep).padStart(2, '0')}`;
    await fs.writeFile(path.join(SALIDA, `${base}-salida.jpg`), r.buffer);
    await anotar(r.buffer, caso, path.join(SALIDA, `${base}-anotada.jpg`));

    const fila = {
      caso: caso.id, rep, ms,
      difuminada: r.difuminada, via: r.via,
      revisionManual: r.revisionManual, motivo: r.motivoRevision ?? '',
      moderacionEvaluada: r.moderacionEvaluada,
      cobertura, falsos, selloFuera: fuera,
    };
    resumen.push(fila);
    console.log(
      `  rep${rep}: via=${r.via} difuminada=${r.difuminada} revision=${r.revisionManual} (${ms}ms)\n` +
      cobertura.map(c => `      ${c.frac >= 0.95 ? 'TAPADA ' : c.frac > 0.05 ? 'PARCIAL' : 'EXPUESTA'} ${(c.frac * 100).toFixed(0)}% · ${c.nombre}`).join('\n') +
      (falsos.length ? '\n' + falsos.map(c => `      ${c.frac > 0.05 ? 'FALSO+ ' : 'ok     '} ${(c.frac * 100).toFixed(0)}% · ${c.nombre}`).join('\n') : '') +
      `\n      sello fuera de las placas conocidas: ${(fuera * 100).toFixed(2)}% del lienzo` +
      (r.motivoRevision ? `\n      motivo: ${r.motivoRevision}` : ''),
    );
  }
}

await fs.writeFile(path.join(SALIDA, 'resumen.json'), JSON.stringify(resumen, null, 2));

// ── Tabla final: tasa de acierto por placa ─────────────────────────────────
console.log('\n\n================= RESUMEN =================');
for (const caso of BANCO) {
  const filas = resumen.filter(f => f.caso === caso.id);
  if (filas.length === 0) continue;
  console.log(`\n${caso.id} (${filas.length} corridas)`);
  for (const p of caso.placas) {
    const tapadas = filas.filter(f => (f.cobertura.find(c => c.nombre === p.nombre)?.frac ?? 0) >= 0.95).length;
    const retenidas = filas.filter(f => f.revisionManual && (f.cobertura.find(c => c.nombre === p.nombre)?.frac ?? 0) < 0.95).length;
    const expuestas = filas.length - tapadas - retenidas;
    console.log(`  ${p.nombre}: tapada ${tapadas}/${filas.length} · retenida ${retenidas}/${filas.length} · ` +
      `${expuestas > 0 ? `PUBLICADA EXPUESTA ${expuestas}/${filas.length}  <<<< FALLO` : 'expuesta 0'}`);
  }
  for (const p of caso.noPlacas) {
    const malas = filas.filter(f => (f.falsos.find(c => c.nombre === p.nombre)?.frac ?? 0) > 0.05).length;
    console.log(`  [no-placa] ${p.nombre}: sello indebido ${malas}/${filas.length}${malas ? '  <<<< FALLO' : ''}`);
  }
  const ret = filas.filter(f => f.revisionManual).length;
  console.log(`  retención (revisionManual): ${ret}/${filas.length} · sello fuera medio: ${(filas.reduce((s, f) => s + f.selloFuera, 0) / filas.length * 100).toFixed(2)}%`);
}
console.log(`\nImágenes en: ${SALIDA}`);
