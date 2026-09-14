// Banco de pruebas MANUAL del detector determinístico de placas por color
// (`lib/detectar-placa-color.ts`). El proyecto no tiene runner de tests (no hay
// jest/vitest en package.json), así que esta es la forma de verificar el
// detector: correrlo contra fotos reales y MIRAR el resultado anotado.
//
// Cómo correrlo (desde la raíz del proyecto):
//   npx tsx scripts/probar-deteccion-placa.ts foto1.jpg foto2.jpg ...
//
// Por cada foto imprime los candidatos (caja en %, proporción, relleno, área) y
// escribe una copia anotada en `./deteccion-placa-salida/` con un rectángulo
// verde sobre el candidato más grande y magenta sobre el resto, para verificar a
// ojo que la caja cae DE VERDAD sobre la placa.
//
// Se puede pasar `--esperado x,y,w,h` DESPUÉS de una foto para declarar dónde
// está su placa real (en % de la imagen); en ese caso el script imprime
// OK/FALLA según si algún candidato se solapa con esa caja. Ejemplo:
//   npx tsx scripts/probar-deteccion-placa.ts tracker.jpg --esperado 40,49,18,7
//
// NOTA: las fotos de prueba son fotos reales de clientes (placas visibles), así
// que NO se versionan en el repo — este script recibe rutas, no trae fixtures.

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { detectarPlacasPorColor, type CandidatoPlaca } from '../lib/detectar-placa-color';

const DIR_SALIDA = path.resolve(process.cwd(), 'deteccion-placa-salida');

/** ¿Se solapan las dos cajas (en %)? Se usa para el chequeo `--esperado`. */
function seSolapan(
  c: CandidatoPlaca,
  esperado: { x: number; y: number; w: number; h: number },
): boolean {
  const solapeX = Math.min(c.x_pct + c.w_pct, esperado.x + esperado.w) - Math.max(c.x_pct, esperado.x);
  const solapeY = Math.min(c.y_pct + c.h_pct, esperado.y + esperado.h) - Math.max(c.y_pct, esperado.y);
  return solapeX > 0 && solapeY > 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: npx tsx scripts/probar-deteccion-placa.ts <foto> [--esperado x,y,w,h] [<foto2> ...]');
    process.exit(1);
  }

  // Parsear la lista de argumentos en pares (foto, esperado?).
  const trabajos: { ruta: string; esperado?: { x: number; y: number; w: number; h: number } }[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--esperado') {
      const nums = (args[++i] ?? '').split(',').map(Number);
      if (trabajos.length === 0 || nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
        console.error('--esperado debe ir DESPUÉS de una foto y con el formato x,y,w,h (en %)');
        process.exit(1);
      }
      trabajos[trabajos.length - 1].esperado = { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
    } else {
      trabajos.push({ ruta: args[i] });
    }
  }

  fs.mkdirSync(DIR_SALIDA, { recursive: true });
  let fallas = 0;

  for (const { ruta, esperado } of trabajos) {
    const buffer = fs.readFileSync(ruta);
    const inicio = Date.now();
    const candidatos = await detectarPlacasPorColor(buffer);
    const ms = Date.now() - inicio;

    console.log(`\n=== ${path.basename(ruta)} — ${candidatos.length} candidato(s) en ${ms}ms`);
    candidatos.forEach((c, i) => {
      console.log(
        `  [${i}] x=${c.x_pct.toFixed(1)}% y=${c.y_pct.toFixed(1)}% w=${c.w_pct.toFixed(1)}% h=${c.h_pct.toFixed(1)}%` +
        ` aspecto=${c.aspecto.toFixed(2)} relleno=${c.relleno.toFixed(2)} area=${c.areaPx}px`,
      );
    });

    if (esperado) {
      const acierto = candidatos.some((c) => seSolapan(c, esperado));
      console.log(acierto ? '  ✔ OK: un candidato se solapa con la placa esperada' : '  ✘ FALLA: ningún candidato toca la placa esperada');
      if (!acierto) fallas++;
    }

    const meta = await sharp(buffer).metadata();
    const W = meta.width ?? 1;
    const H = meta.height ?? 1;
    const trazo = Math.max(3, Math.round(W / 300));
    const cajas = candidatos
      .map((c, i) => {
        const x = (c.x_pct / 100) * W;
        const y = (c.y_pct / 100) * H;
        const w = (c.w_pct / 100) * W;
        const h = (c.h_pct / 100) * H;
        const color = i === 0 ? '#00FF00' : '#FF00FF';
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${trazo}"/>`;
      })
      .join('');
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${cajas}</svg>`;
    const salida = path.join(DIR_SALIDA, `deteccion_${path.basename(ruta).replace(/\.\w+$/, '')}.jpg`);
    const anotada = await sharp(buffer)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();
    fs.writeFileSync(salida, anotada);
    console.log(`  → imagen anotada: ${salida}`);
  }

  if (fallas > 0) {
    console.error(`\n${fallas} foto(s) con --esperado NO detectadas correctamente`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
