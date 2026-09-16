// Prueba del TAPADO MANUAL de placas (lib/tapar-placa.ts + lib/tapar-placa-imagen.ts).
//
// No toca la base de datos ni Cloudinary: baja la foto real de prueba, corre exactamente
// las mismas funciones que usa POST /api/admin/tapar-placa y escribe los JPG resultantes a
// disco para poder mirarlos.
//
// Uso:  node scripts/probar-tapar-placa.mjs --salida ./salida-tapar-placa
import { createJiti } from 'jiti';
import fs from 'fs/promises';
import path from 'path';

const jiti = createJiti(import.meta.url);
const puro = await jiti.import('../lib/tapar-placa.ts');
const img = await jiti.import('../lib/tapar-placa-imagen.ts');
const sharp = (await import('sharp')).default;

const args = process.argv.slice(2);
const iSalida = args.indexOf('--salida');
const SALIDA = iSalida !== -1 ? args[iSalida + 1] : './salida-tapar-placa';
await fs.mkdir(SALIDA, { recursive: true });

// Caso real con TRES placas (3024x4032): la del carro protagonista abajo al centro-izquierda,
// una de un tercero partida por los barrotes de una reja, y una BLANCA de una camioneta al
// fondo a la derecha medio tapada por un árbol — esta última es la que el detector de color
// no ve y la IA reporta de forma inconsistente.
const URL_FOTO = 'https://res.cloudinary.com/dvtmbf1oe/image/upload/uploads/1787855568689-g5o8xsr8cjc.jpg';

const ZONAS = [
  { nombre: 'A carro (amarilla, KZR 957)', x: 0.165, y: 0.569, w: 0.115, h: 0.065 },
  { nombre: 'B tercero tras la reja',      x: 0.165, y: 0.385, w: 0.0262, h: 0.0091 },
  { nombre: 'C camioneta al fondo (BLANCA)', x: 0.8182, y: 0.3728, w: 0.0341, h: 0.0091 },
];
const zonas = ZONAS.map(({ x, y, w, h }) => ({ x, y, w, h }));

let fallos = 0;
const ok = (c, msg) => { console.log(`${c ? '  ok  ' : ' FALLA'} ${msg}`); if (!c) fallos++; };

// ⚠️ `sharp(x).extract(r).stats()` NO mide el recorte: `stats()` se calcula sobre la imagen
// de ENTRADA, saltándose el pipeline. Hay que materializar el recorte a un buffer primero.
async function pixeles(buffer, r) {
  const { data, info } = await sharp(buffer).extract(r).raw().toBuffer({ resolveWithObject: true });
  return { data, canales: info.channels, n: info.width * info.height };
}
async function medio(buffer, r) {
  const { data, canales, n } = await pixeles(buffer, r);
  const s = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) s[c] += data[i * canales + c];
  return s.map(v => v / n);
}
/** Fracción de píxeles del recorte que están dentro de `tol` del color `col`. */
async function fraccionColor(buffer, r, col, tol) {
  const { data, canales, n } = await pixeles(buffer, r);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(data[i * canales] - col[0], data[i * canales + 1] - col[1], data[i * canales + 2] - col[2]);
    if (d <= tol) hit++;
  }
  return hit / n;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/**
 * Fracción de píxeles del recorte `r` que en `b` son distintos de los de `a`. Es la prueba
 * DIRECTA de que el tapado es 100% opaco: si un solo píxel del original sobrevive dentro
 * del rectángulo, el sello no está reemplazando, está mezclando.
 */
async function fraccionCambiada(bufA, bufB, r, tol) {
  const A = await pixeles(bufA, r);
  const B = await pixeles(bufB, r);
  let cambiados = 0;
  for (let i = 0; i < A.n; i++) {
    const d = Math.hypot(
      A.data[i * A.canales] - B.data[i * B.canales],
      A.data[i * A.canales + 1] - B.data[i * B.canales + 1],
      A.data[i * A.canales + 2] - B.data[i * B.canales + 2],
    );
    if (d > tol) cambiados++;
  }
  return cambiados / A.n;
}

// ── 1. Validación de zonas (lo que el servidor acepta y rechaza) ────────────
console.log('\n── validarZonas ─────────────────────────────────────────────');
ok(puro.validarZonas(zonas).ok, 'acepta las 3 zonas reales');
ok(!puro.validarZonas([]).ok, 'rechaza lista vacía');
ok(!puro.validarZonas('no soy lista').ok, 'rechaza no-lista');
ok(!puro.validarZonas([{ x: 0, y: 0, w: 1, h: 1 }]).ok, 'rechaza tapar la foto entera');
ok(!puro.validarZonas([{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }]).ok, 'rechaza zona que se sale del lienzo');
ok(!puro.validarZonas([{ x: -0.1, y: 0.5, w: 0.1, h: 0.05 }]).ok, 'rechaza x negativa');
ok(!puro.validarZonas([{ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }]).ok, 'rechaza zona microscópica (toque accidental)');
ok(!puro.validarZonas([{ x: 0.1, y: 0.1, w: NaN, h: 0.05 }]).ok, 'rechaza NaN');
ok(!puro.validarZonas([{ x: 0.1, y: 0.1, w: Infinity, h: 0.05 }]).ok, 'rechaza Infinity');
ok(!puro.validarZonas([{ x: '0.1', y: 0.1, w: 0.1, h: 0.05 }]).ok, 'rechaza string en vez de número');
ok(!puro.validarZonas([null]).ok, 'rechaza null dentro de la lista');
ok(!puro.validarZonas(Array.from({ length: puro.MAX_ZONAS + 1 }, () => ({ x: 0.1, y: 0.1, w: 0.05, h: 0.03 }))).ok,
   `rechaza más de MAX_ZONAS (${puro.MAX_ZONAS})`);
ok(!puro.validarZonas(Array.from({ length: 6 }, (_, i) => ({ x: 0.01 + i * 0.16, y: 0.1, w: 0.15, h: 0.6 }))).ok,
   'rechaza cuando el ÁREA TOTAL sumada pasa el tope');
// Tolerancia de redondeo del navegador: x+w = 1.0000004 debe pasar y quedar recortado.
const borde = puro.validarZonas([{ x: 0.95, y: 0.5, w: 0.0500004, h: 0.05 }]);
ok(borde.ok && borde.zonas[0].x + borde.zonas[0].w <= 1, 'tolera el redondeo del navegador y recorta a <= 1');

// ── 2. Geometría: cliente y servidor calculan lo MISMO ─────────────────────
console.log('\n── prepararZonas / zonaAPixeles ─────────────────────────────');
const W = 3024, H = 4032;
const finalesCon = puro.prepararZonas(zonas, W, H, true);
const finalesSin = puro.prepararZonas(zonas, W, H, false);
ok(JSON.stringify(finalesSin) === JSON.stringify(zonas), 'sin proporción de placa, las zonas pasan intactas');
for (const [i, z] of finalesCon.entries()) {
  const r = puro.zonaAPixeles(z, W, H);
  const dentro = r.left >= 0 && r.top >= 0 && r.left + r.width <= W && r.top + r.height <= H;
  const visual = (z.w * W) / (z.h * H);
  ok(dentro, `zona ${i + 1} (${ZONAS[i].nombre}) cabe en el lienzo -> ${JSON.stringify(r)} · aspecto ${visual.toFixed(2)}:1`);
}
// Un rectángulo casi cuadrado y chiquito debe ensancharse a 2:1; uno absurdo debe quedarse igual.
// visual = (0.04*0.75)/0.02 = 1.5 -> crece x1.33, por debajo de CRECIMIENTO_MAX_PROPORCION.
const casiPlaca = puro.ajustarAProporcionPlaca({ x: 0.5, y: 0.5, w: 0.04, h: 0.02 }, W / H);
ok(Math.abs((casiPlaca.w * W) / (casiPlaca.h * H) - 2) < 0.01, 'un rectángulo parecido a una placa se lleva a 2:1');
// visual = (0.03*0.75)/0.02 = 1.125 -> habría que crecer x1.78: se deja como está.
const muyCuadrado = { x: 0.5, y: 0.5, w: 0.03, h: 0.02 };
ok(JSON.stringify(puro.ajustarAProporcionPlaca(muyCuadrado, W / H)) === JSON.stringify(muyCuadrado),
   'un rectángulo demasiado cuadrado NO se infla hasta 2:1 (tope de crecimiento)');
const absurdo = { x: 0.1, y: 0.1, w: 0.5, h: 0.006 };
ok(JSON.stringify(puro.ajustarAProporcionPlaca(absurdo, W / H)) === JSON.stringify(absurdo),
   'una franja larguísima NO se infla (se deja tal cual)');

// ── 3. Seguridad de la descarga ────────────────────────────────────────────
console.log('\n── descargarFotoParaTapar (allowlist) ───────────────────────');
for (const mala of [
  'http://169.254.169.254/latest/meta-data/',
  'http://127.0.0.1:3000/api/config',
  'https://evil.example.com/foto.jpg',
  'file:///etc/passwd',
  '/uploads/vieja.jpg',
]) {
  let rechazada = false;
  try { await img.descargarFotoParaTapar(mala); } catch { rechazada = true; }
  ok(rechazada, `rechaza ${mala}`);
}

// ── 4. Tapado real sobre la foto de prueba ─────────────────────────────────
console.log('\n── taparPlacasManual (foto real, 3 placas) ──────────────────');
const original = await img.descargarFotoParaTapar(URL_FOTO);
await fs.writeFile(path.join(SALIDA, '00-original.jpg'), original.buffer);
const metaOrig = await sharp(original.buffer).metadata();
ok(metaOrig.width === W && metaOrig.height === H, `la original mide ${metaOrig.width}x${metaOrig.height}`);

const conProp = await img.taparPlacasManual(original.buffer, original.mediaType, zonas, true);
await fs.writeFile(path.join(SALIDA, '02-tapada-3-placas-proporcion.jpg'), conProp.buffer);
ok(conProp.rectangulos.length === 3, 'estampa 3 rectángulos (proporción de placa ON)');
ok(conProp.ancho === W && conProp.alto === H, 'el lienzo no cambia de tamaño');

const sinProp = await img.taparPlacasManual(original.buffer, original.mediaType, zonas, false);
await fs.writeFile(path.join(SALIDA, '03-tapada-3-placas-exacta.jpg'), sinProp.buffer);
ok(sinProp.rectangulos.length === 3, 'estampa 3 rectángulos (proporción de placa OFF)');

// Una sola zona, para comprobar que el caso simple también cae donde toca.
const soloBlanca = await img.taparPlacasManual(original.buffer, original.mediaType, [zonas[2]], true);
await fs.writeFile(path.join(SALIDA, '04-tapada-solo-blanca.jpg'), soloBlanca.buffer);
ok(soloBlanca.rectangulos.length === 1, 'estampa 1 rectángulo sobre la placa blanca del fondo');

// ── 5. ¿El sello cayó DONDE se marcó? ──────────────────────────────────────
// Se mide el color medio dentro del rectángulo: el sello es navy #1B3356 opaco, así que el
// parche tiene que quedar prácticamente de ese color y MUY distinto del original.
console.log('\n── el sello cae donde se marcó ──────────────────────────────');
const NAVY = [0x1b, 0x33, 0x56];      // fondo del sello
const NARANJA = [0xf2, 0x5c, 0x2b];   // borde del sello
for (const [i, r] of conProp.rectangulos.entries()) {
  const antes = await medio(original.buffer, r);
  const despues = await medio(conProp.buffer, r);
  const fNavy = await fraccionColor(conProp.buffer, r, NAVY, 60);
  const fNaranja = await fraccionColor(conProp.buffer, r, NARANJA, 70);
  ok(dist(antes, despues) > 25,
     `zona ${i + 1} (${ZONAS[i].nombre}): los píxeles cambiaron (antes ${antes.map(n => n.toFixed(0))} -> después ${despues.map(n => n.toFixed(0))}, dist ${dist(antes, despues).toFixed(1)})`);
  ok(fNavy > 0.5, `zona ${i + 1}: el ${(fNavy * 100).toFixed(1)}% del parche es el navy del sello`);
  ok(fNaranja > 0.05, `zona ${i + 1}: el ${(fNaranja * 100).toFixed(1)}% es el borde/flecha naranja de marca`);
  // Opacidad real: prácticamente NINGÚN píxel del original puede sobrevivir dentro del sello.
  // (El resto hasta el 100% son píxeles del original que por casualidad ya se parecían al
  // navy/naranja del sello, no foto que "asome" — el composite es opaco por construcción.)
  const cambiados = await fraccionCambiada(original.buffer, conProp.buffer, r, 24);
  ok(cambiados > 0.985, `zona ${i + 1}: el ${(cambiados * 100).toFixed(2)}% de los píxeles del original fue REEMPLAZADO (tapado opaco, no mezcla)`);
  ok(fNavy + fNaranja > 0.75, `zona ${i + 1}: el parche es paleta de marca (${((fNavy + fNaranja) * 100).toFixed(1)}% navy+naranja; el resto es el antialias entre ambos)`);
  // Justo al lado del sello la foto NO debe haber cambiado.
  const fuera = { left: Math.max(0, r.left - r.width * 3), top: r.top, width: r.width, height: r.height };
  if (fuera.left + fuera.width <= W && fuera.left + fuera.width < r.left) {
    const dFuera = dist(await medio(original.buffer, fuera), await medio(conProp.buffer, fuera));
    ok(dFuera < 6, `zona ${i + 1}: justo al lado del sello la foto queda intacta (dist ${dFuera.toFixed(1)})`);
  }
}
// El amarillo de placa colombiana debe DESAPARECER del rectángulo de la placa del carro.
const AMARILLO = [0xf5, 0xc2, 0x18];
const amAntes = await fraccionColor(original.buffer, conProp.rectangulos[0], AMARILLO, 90);
const amDespues = await fraccionColor(conProp.buffer, conProp.rectangulos[0], AMARILLO, 90);
ok(amAntes > 0.2 && amDespues < 0.01,
   `la placa amarilla del carro desaparece: ${(amAntes * 100).toFixed(1)}% de amarillo antes -> ${(amDespues * 100).toFixed(2)}% después`);

// ── 6. Rehacer el tapado NO apila sellos ───────────────────────────────────
// El servidor siempre parte de `placa_origen_url` (la original). Se simulan las dos vías
// para dejar constancia de la diferencia.
console.log('\n── rehacer el tapado parte de la ORIGINAL ───────────────────');
// Se corrige el tapado moviéndolo a OTRO sitio que no se solapa con el anterior: así se
// puede comprobar si el sello viejo desapareció o si quedó apilado.
const zonasCorregidas = [{ ...zonas[0], x: zonas[0].x + 0.25 }];
const bien = await img.taparPlacasManual(original.buffer, original.mediaType, zonasCorregidas, true);
await fs.writeFile(path.join(SALIDA, '05-rehecho-desde-original.jpg'), bien.buffer);
const mal = await img.taparPlacasManual(conProp.buffer, 'image/jpeg', zonasCorregidas, true);
await fs.writeFile(path.join(SALIDA, '06-CONTRAEJEMPLO-rehecho-sobre-la-tapada.jpg'), mal.buffer);

// En el rehecho BIEN, el sitio del sello viejo volvió a ser la foto original (ya no es navy).
const viejo = puro.zonaAPixeles(puro.prepararZonas([zonas[0]], W, H, true)[0], W, H);
const nBien = await fraccionColor(bien.buffer, viejo, NAVY, 60);
const nMal = await fraccionColor(mal.buffer, viejo, NAVY, 60);
ok(nBien < 0.05, `rehecho desde la ORIGINAL: en el sitio del sello viejo solo queda ${(nBien * 100).toFixed(2)}% de navy — el sello anterior desapareció`);
ok(nMal > 0.6, `contraejemplo (rehecho sobre la tapada): el sello viejo SIGUE ahí (${(nMal * 100).toFixed(1)}% navy) — por eso se guarda placa_origen_url`);
// El rehecho bueno es idéntico a la original en el sitio del sello viejo: recuperable de verdad.
const difRehecho = await fraccionCambiada(original.buffer, bien.buffer, viejo, 24);
ok(difRehecho < 0.02, `rehecho desde la original: el sitio del sello viejo vuelve a ser la FOTO (solo ${(difRehecho * 100).toFixed(2)}% de píxeles distintos, ruido de recompresión JPEG)`);
const amRehecho = await fraccionColor(bien.buffer, viejo, AMARILLO, 90);
ok(amRehecho > 0.2, `rehecho desde la original: la placa amarilla vuelve a verse (${(amRehecho * 100).toFixed(1)}% de amarillo) — la original es recuperable`);

// ── 7. Semáforo de concurrencia ────────────────────────────────────────────
console.log('\n── tomarTurnoTapado ─────────────────────────────────────────');
ok(img.tomarTurnoTapado() === true, 'primer turno concedido');
ok(img.tomarTurnoTapado() === true, 'segundo turno concedido');
ok(img.tomarTurnoTapado() === false, 'tercer turno DENEGADO (tope de 2 en curso)');
img.liberarTurnoTapado(); img.liberarTurnoTapado(); img.liberarTurnoTapado();
ok(img.tomarTurnoTapado() === true, 'tras liberar, vuelve a conceder');
img.liberarTurnoTapado();

// ── 8. Enganche con la RETENCIÓN del detector automático ───────────────────
// `esRetencionPorPlaca` es lo único que separa "puede haber una placa a la vista"
// (resoluble con esta herramienta) de "la IA vio contenido inapropiado" / "la moderación
// no corrió" (que NO se resuelven tapando una placa). Las cadenas de abajo son las que
// producen de verdad lib/blur-placas.ts y app/api/upload/route.ts.
console.log('\n── esRetencionPorPlaca ──────────────────────────────────────');
const MOTIVOS_PLACA = [
  `${puro.PREFIJO_REVISION_PLACA} La IA cree ver la placa del vehículo pero no está segura de dónde, y el detector de color no la encuentra.`,
  `${puro.PREFIJO_REVISION_PLACA} La IA cree ver la placa legible de otro vehículo pero no está segura de dónde, y el detector de color no la encuentra.`,
  `${puro.PREFIJO_REVISION_PLACA} Un tapado medido sobre los píxeles salió más grande de lo razonable y hubo que recortarlo.`,
  `${puro.PREFIJO_REVISION_PLACA} El tapado calculado desde la caja de la IA era desproporcionado y hubo que recortarlo.`,
  `${puro.PREFIJO_REVISION_PLACA} Se detectaron 9 placas y solo se taparon 6.`,
];
for (const m of MOTIVOS_PLACA) ok(puro.esRetencionPorPlaca(m), `reconoce retención: "${m.slice(0, 72)}…"`);
const MOTIVOS_NO_PLACA = [
  'No se pudo evaluar automáticamente el contenido de esta foto (fallo de moderación) — pendiente de revisión manual.',
  'Límite de detección automática de placa alcanzado — pendiente de revisión manual.',
  'La foto muestra contenido sexual explícito.',
  '', null, undefined, 42,
];
for (const m of MOTIVOS_NO_PLACA) ok(!puro.esRetencionPorPlaca(m), `NO la confunde con: ${JSON.stringify(m)}`);
// El prefijo tiene que seguir siendo el que blur-placas ESCRIBE de verdad.
const fuente = await fs.readFile(path.join(import.meta.dirname, '../lib/blur-placas.ts'), 'utf8');
ok(fuente.includes('`${PREFIJO_REVISION_PLACA} ${[...new Set(motivosRevision)]'),
   'lib/blur-placas.ts escribe el motivo con la MISMA constante que se lee acá');

console.log(`\n${fallos === 0 ? '✔ TODO OK' : `✘ ${fallos} FALLO(S)`} · imágenes en: ${path.resolve(SALIDA)}`);
process.exit(fallos === 0 ? 0 : 1);
