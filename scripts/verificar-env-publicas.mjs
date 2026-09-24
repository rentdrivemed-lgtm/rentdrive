#!/usr/bin/env node
/**
 * Caza el fallo que dejó sin poder pagar a todos los clientes en sep-2026.
 *
 * ── Qué falla y por qué es invisible ────────────────────────────────────────
 * Next.js NO lee las `NEXT_PUBLIC_*` en runtime: las INLINEA en el bundle de JS al
 * compilar. En Railway el build corre dentro de Docker, y Docker descarta cualquier
 * build-arg que el Dockerfile no declare con `ARG`. Resultado: basta con crear la
 * variable en el panel de Railway y olvidarse del Dockerfile para que:
 *
 *   · el build compile sin un solo aviso,
 *   · la app arranque con normalidad,
 *   · y el valor llegue VACÍO únicamente al navegador del cliente.
 *
 * Pasó con `NEXT_PUBLIC_WOMPI_PUBLIC_KEY`: estaba en Railway pero no en el Dockerfile,
 * así que el widget de pago se abría con la clave en blanco y nadie podía pagar con
 * tarjeta. No lo detectó ni el build, ni los tipos, ni el lint, ni un smoke test — la
 * página respondía 200 perfectamente.
 *
 * ── Qué comprueba ───────────────────────────────────────────────────────────
 * Que toda `NEXT_PUBLIC_*` que el CÓDIGO lee esté declarada en el Dockerfile como
 * `ARG` y como `ENV`. Las dos: con `ARG` sola, Docker acepta el valor pero no lo
 * expone al `npm run build`.
 *
 * Uso:  node scripts/verificar-env-publicas.mjs   (o `npm run verificar-env`)
 * Sale con código 1 si falta alguna, para poder encadenarlo antes de desplegar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['app', 'lib', 'components', 'contexts'];
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const RE_VAR = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;

function archivos(dir) {
  const out = [];
  let entradas;
  try { entradas = readdirSync(dir); } catch { return out; }
  for (const e of entradas) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const ruta = join(dir, e);
    if (statSync(ruta).isDirectory()) out.push(...archivos(ruta));
    else if (EXT.test(e)) out.push(ruta);
  }
  return out;
}

// 1. Las que el código realmente lee, y desde dónde.
const usadas = new Map(); // variable -> [archivos]
for (const dir of DIRS) {
  for (const f of archivos(join(RAIZ, dir))) {
    const txt = readFileSync(f, 'utf8');
    for (const m of txt.matchAll(RE_VAR)) {
      const rel = f.slice(RAIZ.length + 1);
      if (!usadas.has(m[1])) usadas.set(m[1], []);
      if (!usadas.get(m[1]).includes(rel)) usadas.get(m[1]).push(rel);
    }
  }
}

// 2. Las que el Dockerfile declara, separando ARG de ENV.
const dockerfile = readFileSync(join(RAIZ, 'Dockerfile'), 'utf8');
const args = new Set([...dockerfile.matchAll(/^\s*ARG\s+(NEXT_PUBLIC_[A-Z0-9_]+)/gm)].map(m => m[1]));
const envs = new Set([...dockerfile.matchAll(/^\s*ENV\s+(NEXT_PUBLIC_[A-Z0-9_]+)=/gm)].map(m => m[1]));

// 3. Comparar.
//
// Declarar NO es tener valor. Este script se escribió tras la caída de sep-2026 y
// comprobaba solo el Dockerfile, así que seguía dejando pasar la mitad del fallo: un
// `ARG` declarado al que Railway no le pasa nada compila igual, con la variable VACÍA
// en el navegador, que es exactamente el síntoma original. Por eso ahora, cuando corre
// DENTRO del build (`process.env` ya tiene los ARG convertidos en ENV), también se
// exige que el valor no esté vacío.
//
// Fuera del build (alguien lo corre a mano en su portátil) esa parte se omite: ahí no
// hay variables de producción y fallar sería ruido.
const DENTRO_DEL_BUILD = process.env.VERIFICAR_VALORES === '1'
  || !!process.env.RAILWAY_ENVIRONMENT
  || !!process.env.RAILWAY_SERVICE_ID;

const fallos = [];
for (const [v, donde] of [...usadas].sort()) {
  const faltaArg = !args.has(v);
  const faltaEnv = !envs.has(v);
  const sinValor = DENTRO_DEL_BUILD && !String(process.env[v] ?? '').trim();
  if (faltaArg || faltaEnv || sinValor) {
    fallos.push({ v, donde, faltaArg, faltaEnv, sinValor });
  }
}

console.log(`Variables NEXT_PUBLIC_* que el código lee: ${usadas.size}`);
console.log(DENTRO_DEL_BUILD
  ? 'Se comprueba la declaración en el Dockerfile Y que el valor llegue al build.'
  : 'Fuera del build: se comprueba solo la declaración en el Dockerfile.');
for (const [v] of [...usadas].sort()) {
  const ok = args.has(v) && envs.has(v)
    && (!DENTRO_DEL_BUILD || !!String(process.env[v] ?? '').trim());
  console.log(`  ${ok ? '✓' : '✗'} ${v}`);
}

if (fallos.length === 0) {
  console.log('\n✅ Todas están declaradas en el Dockerfile (ARG + ENV).');
  process.exit(0);
}

console.error('\n❌ El valor llegaría VACÍO al navegador. Sin esto el build pasa igual y el fallo solo se ve en el celular del cliente:\n');
for (const { v, donde, faltaArg, faltaEnv, sinValor } of fallos) {
  console.error(`  ${v}`);
  console.error(`     la usa: ${donde.join(', ')}`);
  if (faltaArg || faltaEnv) {
    console.error(`     falta en el Dockerfile: ${[faltaArg && 'ARG', faltaEnv && 'ENV'].filter(Boolean).join(' y ')}`);
    console.error(`     añade:  ARG ${v}`);
    console.error(`             ENV ${v}=$${v}`);
  }
  if (sinValor) {
    console.error('     declarada en el Dockerfile, pero SIN VALOR en este build.');
    console.error('     créala en el panel de Railway (o compruébala si ya está: puede estar');
    console.error('     en otro entorno, o sellada, y entonces no llega al build).');
  }
  console.error('');
}
process.exit(1);
