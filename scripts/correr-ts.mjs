// Runner mínimo para los scripts .ts de este proyecto.
//
// El proyecto no tiene runner de tests ni `tsx` instalado (ver package.json), y
// `npx tsx` se baja de la red. `jiti` ya está en node_modules —lo trae Next— y
// ejecuta TypeScript con resolución extensionless, que es justo lo que necesitan
// los scripts para importar `../lib/...`.
//
// Uso (desde la raíz del proyecto):
//   node scripts/correr-ts.mjs scripts/probar-contratos-conversores.ts
//   node scripts/correr-ts.mjs scripts/probar-contratos.ts --salida ./salida-contratos
//
// Si algún día se agrega `tsx` como devDependency, estos mismos scripts corren
// con `npx tsx scripts/<archivo>.ts` sin tocarles una línea.
import { createJiti } from 'jiti';
import path from 'path';

const objetivo = process.argv[2];
if (!objetivo) {
  console.error('Uso: node scripts/correr-ts.mjs <archivo.ts> [args…]');
  process.exit(1);
}

// Los argumentos siguientes quedan como si el script se hubiera invocado directo.
process.argv = [process.argv[0], path.resolve(objetivo), ...process.argv.slice(3)];

const jiti = createJiti(import.meta.url);
await jiti.import(path.resolve(objetivo));
