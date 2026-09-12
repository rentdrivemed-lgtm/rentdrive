// Lógica de decisión para POST /api/admin/limpiar-documentos-huerfanos, separada de
// la ruta porque Next.js 16 no permite que un `route.ts` exporte nada distinto de los
// handlers HTTP/config reconocidos (ver error de tipos de `.next/types` si se exporta
// una función normal desde ahí). Vive en `lib/` como el resto de la lógica de negocio.
import type Database from 'better-sqlite3';
import type { RecursoCloudinary } from './storage';

/**
 * Núcleo de la decisión "¿qué es candidato a borrar y qué está reclamado?", separado
 * de la parte que sí habla por red con Cloudinary (`listarRecursosPorPrefijo`/
 * `borrarRecursos` en lib/storage.ts) para poder probarlo con una BD real (aunque sea
 * de prueba, en memoria) y datos de `recursos` fabricados a mano, SIN tocar la cuenta
 * real de Cloudinary.
 *
 * - `candidatos`: recursos con más de `horasAntiguedad` horas desde su creación.
 * - `huerfanos`: de esos candidatos, los que NO coinciden con ningún
 *   `usuarios.cedula_url` / `cedula_url_dorso` / `licencia_url` / `licencia_url_dorso`
 *   existente (es decir, nadie los reclamó completando su registro).
 * - `conservados`: cuántos candidatos SÍ coincidieron (se conservan sin importar su
 *   antigüedad).
 */
export function clasificarRecursos(
  db: Database.Database,
  recursos: RecursoCloudinary[],
  horasAntiguedad: number,
): { candidatos: RecursoCloudinary[]; huerfanos: RecursoCloudinary[]; conservados: number } {
  const limiteMs = Date.now() - horasAntiguedad * 60 * 60 * 1000;
  const candidatos = recursos.filter(r => new Date(r.created_at).getTime() < limiteMs);

  // Consulta puntual por recurso (en vez de traer toda la tabla `usuarios` a memoria):
  // el volumen esperado de candidatos "viejos sin reclamar" es chico (un registro
  // normal se completa en minutos), así que N consultas parametrizadas es más simple
  // y más seguro que armar un IN (...) dinámico.
  const estaReclamado = db.prepare(
    'SELECT 1 FROM usuarios WHERE cedula_url = ? OR cedula_url_dorso = ? OR licencia_url = ? OR licencia_url_dorso = ? LIMIT 1'
  );

  const huerfanos: RecursoCloudinary[] = [];
  let conservados = 0;
  for (const r of candidatos) {
    const reclamado = estaReclamado.get(r.secure_url, r.secure_url, r.secure_url, r.secure_url);
    if (reclamado) conservados++;
    else huerfanos.push(r);
  }

  return { candidatos, huerfanos, conservados };
}
