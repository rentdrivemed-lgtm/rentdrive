import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Suite de pruebas del servidor. Node, no jsdom: lo que se prueba acá es la REGLA DE
// NEGOCIO (contratos, firmas, reservas, permisos), que vive en `lib/` y corre en el
// servidor contra SQLite. Las pantallas no se prueban aquí.
//
// Cada prueba levanta su propia base en memoria con el esquema real de lib/db.ts, así
// que no hay estado compartido entre archivos ni base de desarrollo que ensuciar.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // better-sqlite3 es nativo: si dos archivos comparten proceso, una base en memoria
    // de uno puede sobrevivir al otro. Un proceso por archivo lo evita.
    pool: 'forks',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
});
