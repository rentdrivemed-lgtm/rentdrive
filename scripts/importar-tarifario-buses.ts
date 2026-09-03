// Importación del tarifario de referencia de buses (~300 destinos) desde CSV.
// Ver COTIZADOR-BUSES-SPEC.md §0, §9 y §11 (paso 9).
//
// ⚠️ Esto es dinero real: un dígito mal transcrito en un precio se traduce directo en
// plata mal cobrada a un cliente. Por eso este script valida cada fila ANTES de escribir
// nada, y ante cualquier duda SALTA la fila (con motivo explícito) en vez de adivinar o
// abortar el import completo — una fila corrupta no debe tumbar las otras ~299 buenas.
//
// Cómo correrlo (desde la raíz del proyecto):
//   npx tsx scripts/importar-tarifario-buses.ts [ruta/al/archivo.csv]
//
// Si no se pasa ruta, usa por defecto `plantilla_tarifario_buses.csv` en la raíz del
// repo (útil para probar el script con las 3 filas de ejemplo que ya trae la plantilla).
//
// El CSV debe traer EXACTAMENTE estas 15 columnas, en este orden (mismas que
// `plantilla_tarifario_buses.csv` y que la tabla `bus_tarifas_destino_ref` de lib/db.ts):
//   destino,km,px12,px12_30,px14,px14_30,px16,px16_30,px19,px19_30,px22_25,px22_25_30,
//   px30_42,px30_42_30,observaciones
//
// Idempotente: hace upsert por `destino` (columna UNIQUE en bus_tarifas_destino_ref, el
// mismo patrón INSERT ... ON CONFLICT(destino) DO UPDATE que usa
// `PUT /api/buses/tarifas-referencia`) — correr el script dos veces con el mismo CSV no
// duplica filas, solo actualiza las que ya existían.

import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db';

// Mismas 12 columnas de precio por categoría que usa app/api/buses/tarifas-referencia
// (se repiten aquí a propósito en vez de importar la route de Next: ese archivo tiene
// dependencias de next/server y de auth pensadas para correr dentro de una request HTTP,
// no desde un script de consola — pero el SQL de abajo es una copia literal del mismo
// patrón de upsert, no una reinvención).
const CAMPOS_CATEGORIA = [
  'px12', 'px12_30', 'px14', 'px14_30', 'px16', 'px16_30',
  'px19', 'px19_30', 'px22_25', 'px22_25_30', 'px30_42', 'px30_42_30',
] as const;

const COLUMNAS_ESPERADAS = [
  'destino', 'km', ...CAMPOS_CATEGORIA, 'observaciones',
] as const;

type FilaValida = {
  destino: string;
  km: number | null;
  valores: (number | null)[];
  observaciones: string;
};

type FilaSaltada = {
  numeroLinea: number;
  destino: string;
  motivo: string;
};

// --- Parser CSV mínimo (RFC4180-ish): soporta campos entre comillas dobles, comas y
// comillas escapadas ("") dentro de un campo, y saltos de línea dentro de un campo entre
// comillas. `observaciones` es texto libre y podría traer comas reales, así que no basta
// con partir cada línea por ",".
function parsearCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let dentroComillas = false;
  // Normaliza CRLF -> LF para no dejar '\r' colgado al final de campo.
  const s = texto.replace(/\r\n/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (dentroComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      dentroComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  // Última fila (si el archivo no termina en salto de línea).
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  // Descarta líneas totalmente vacías (ej. una línea en blanco al final del archivo).
  return filas.filter(f => !(f.length === 1 && f[0].trim() === ''));
}

// Convierte un valor crudo de celda a número o null, distinguiendo "vacío" (-> NULL,
// válido) de "tiene texto pero no es un número" (-> inválido, la fila se salta).
//
// Los precios de bus y `km` son siempre enteros sin decimales (ver
// plantilla_tarifario_buses.csv). Por eso: (1) se rechaza explícitamente cualquier valor
// con un punto — `Number("150.000")` da `150` en JS (lo interpreta como decimal, no como
// separador de miles del formato colombiano), lo que aceptaría silenciosamente un valor
// 1000x menor al real; y (2) se valida con un regex de entero estricto en vez de
// `Number.isFinite` genérico, para no aceptar tampoco notación científica, signos "+", etc.
function parsearNumeroOVacio(raw: string): { ok: true; valor: number | null } | { ok: false; motivo: string } {
  const v = (raw ?? '').trim();
  if (v === '') return { ok: true, valor: null };
  if (v.includes('.')) {
    return {
      ok: false,
      motivo: `valor "${v}" formato con punto no soportado (¿separador de miles? escribe el número sin puntos, ej. 150000 en vez de 150.000)`,
    };
  }
  if (!/^-?\d+$/.test(v)) {
    return { ok: false, motivo: `valor "${v}" no es un número válido` };
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return { ok: false, motivo: `valor "${v}" no es un número válido` };
  }
  return { ok: true, valor: n };
}

function validarFila(campos: string[], numeroLinea: number): FilaValida | { error: FilaSaltada } {
  const rawDestino = (campos[0] ?? '').trim();
  const destinoParaLog = rawDestino || `(fila ${numeroLinea}, sin destino)`;

  // Fila truncada o con columnas de más: con `campos[2+i] ?? ''` las columnas faltantes se
  // tratarían silenciosamente como "vacío" (-> NULL), y el upsert sobrescribiría con NULL
  // las tarifas reales que ya existieran para ese destino. Se salta ANTES de tocar nada.
  if (campos.length !== COLUMNAS_ESPERADAS.length) {
    return {
      error: {
        numeroLinea,
        destino: destinoParaLog,
        motivo: `fila con ${campos.length} columnas, se esperaban ${COLUMNAS_ESPERADAS.length}`,
      },
    };
  }

  if (!rawDestino) {
    return { error: { numeroLinea, destino: destinoParaLog, motivo: 'falta el destino (columna vacía)' } };
  }

  const kmResult = parsearNumeroOVacio(campos[1] ?? '');
  if (!kmResult.ok) {
    return { error: { numeroLinea, destino: rawDestino, motivo: `columna "km": ${kmResult.motivo}` } };
  }

  const valores: (number | null)[] = [];
  for (let i = 0; i < CAMPOS_CATEGORIA.length; i++) {
    const nombreCampo = CAMPOS_CATEGORIA[i];
    const raw = campos[2 + i] ?? '';
    const r = parsearNumeroOVacio(raw);
    if (!r.ok) {
      return { error: { numeroLinea, destino: rawDestino, motivo: `columna "${nombreCampo}": ${r.motivo}` } };
    }
    valores.push(r.valor);
  }

  // Mismo límite de largo que usa PUT /api/buses/tarifas-referencia para observaciones.
  const observaciones = (campos[14] ?? '').trim().slice(0, 200);

  return { destino: rawDestino, km: kmResult.valor, valores, observaciones };
}

// Cuerpo real del import. Separado de `main()` para poder envolverlo en un try/catch que
// imprima un mensaje controlado (en vez de un stack trace crudo de Node) ante cualquier
// error inesperado leyendo el archivo o hablando con la base de datos.
function ejecutarImportacion() {
  const rutaArg = process.argv[2];
  const rutaCSV = rutaArg
    ? path.resolve(process.cwd(), rutaArg)
    : path.resolve(process.cwd(), 'plantilla_tarifario_buses.csv');

  if (!fs.existsSync(rutaCSV)) {
    console.error(`No se encontró el archivo CSV: ${rutaCSV}`);
    process.exit(1);
  }

  console.log(`Importando tarifario de buses desde: ${rutaCSV}`);

  const contenido = fs.readFileSync(rutaCSV, 'utf-8');
  const filasCSV = parsearCSV(contenido);

  if (filasCSV.length === 0) {
    console.error('El CSV está vacío.');
    process.exit(1);
  }

  const header = filasCSV[0].map(h => h.trim());
  const headerEsperado = [...COLUMNAS_ESPERADAS];
  const headerCoincide =
    header.length === headerEsperado.length &&
    header.every((h, i) => h === headerEsperado[i]);

  if (!headerCoincide) {
    console.error('El encabezado del CSV no coincide con las 15 columnas esperadas.');
    console.error(`  Esperado: ${headerEsperado.join(',')}`);
    console.error(`  Recibido: ${header.join(',')}`);
    console.error('Corrige el archivo (mismo orden y nombres que plantilla_tarifario_buses.csv) y vuelve a intentar.');
    process.exit(1);
  }

  const filasDatos = filasCSV.slice(1);

  const db = getDb();

  const stmtBuscar = db.prepare(
    `SELECT id, ${CAMPOS_CATEGORIA.join(', ')} FROM bus_tarifas_destino_ref WHERE destino = ?`
  );
  const stmtUpsert = db.prepare(`
    INSERT INTO bus_tarifas_destino_ref
      (destino, km, ${CAMPOS_CATEGORIA.join(', ')}, observaciones, activo)
    VALUES (?, ?, ${CAMPOS_CATEGORIA.map(() => '?').join(', ')}, ?, 1)
    ON CONFLICT(destino) DO UPDATE SET
      km = excluded.km,
      ${CAMPOS_CATEGORIA.map(c => `${c} = excluded.${c}`).join(', ')},
      observaciones = excluded.observaciones,
      updated_at = datetime('now')
  `);

  const saltadas: FilaSaltada[] = [];
  const avisosSobrescrituraNull: string[] = [];
  let nuevas = 0;
  let actualizadas = 0;
  let avisosEjemplo = 0;

  for (let idx = 0; idx < filasDatos.length; idx++) {
    const numeroLinea = idx + 2; // +2: 1 por el header, 1 porque las líneas empiezan en 1.
    const campos = filasDatos[idx];

    // Fila totalmente vacía (línea en blanco suelta en medio del archivo): se ignora sin
    // contarla como error.
    if (campos.every(c => c.trim() === '')) continue;

    const resultado = validarFila(campos, numeroLinea);
    if ('error' in resultado) {
      saltadas.push(resultado.error);
      console.warn(`[SALTADA] línea ${resultado.error.numeroLinea} — "${resultado.error.destino}": ${resultado.error.motivo}`);
      continue;
    }

    if (resultado.destino.includes('[EJEMPLO]')) {
      avisosEjemplo++;
      console.warn(`[AVISO] "${resultado.destino}" está marcado [EJEMPLO] — valores inventados, no son tarifas reales. Se importa igual (para eso es la plantilla de prueba).`);
    }

    try {
      const existente = stmtBuscar.get(resultado.destino) as
        | ({ id: number } & Record<(typeof CAMPOS_CATEGORIA)[number], number | null>)
        | undefined;

      // Defensa en profundidad (redundante con la validación de columnas de arriba, pero
      // esto es dinero real): si el destino ya tenía al menos una tarifa cargada y la fila
      // nueva dejaría las 12 columnas de precio en NULL, avisa de forma visible en el
      // resumen final en vez de dejar que el upsert borre en silencio datos reales.
      if (existente) {
        const teniaAlgunaTarifa = CAMPOS_CATEGORIA.some(c => existente[c] !== null && existente[c] !== undefined);
        const nuevaFilaTodoNull = resultado.valores.every(v => v === null);
        if (teniaAlgunaTarifa && nuevaFilaTodoNull) {
          const msg = `destino "${resultado.destino}" (línea ${numeroLinea}) ya tenía tarifas cargadas y el CSV nuevo las deja todas vacías — revisa si es intencional`;
          avisosSobrescrituraNull.push(msg);
          console.warn(`[AVISO] ${msg}`);
        }
      }

      stmtUpsert.run(resultado.destino, resultado.km, ...resultado.valores, resultado.observaciones);

      if (existente) {
        actualizadas++;
      } else {
        nuevas++;
      }
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      saltadas.push({ numeroLinea, destino: resultado.destino, motivo: `error de base de datos: ${motivo}` });
      console.warn(`[SALTADA] línea ${numeroLinea} — "${resultado.destino}": error de base de datos: ${motivo}`);
    }
  }

  console.log('');
  console.log('== Resumen de importación (SQLite) ==');
  console.log(`  Filas procesadas: ${filasDatos.length}`);
  console.log(`  Importadas OK:    ${nuevas + actualizadas} (${nuevas} nuevas, ${actualizadas} actualizadas)`);
  console.log(`  Saltadas:         ${saltadas.length}`);
  if (avisosEjemplo > 0) {
    console.log(`  (${avisosEjemplo} fila(s) marcadas [EJEMPLO] — datos de prueba, no reales)`);
  }
  if (saltadas.length > 0) {
    console.log('');
    console.log('  Detalle de filas saltadas:');
    for (const s of saltadas) {
      console.log(`    - línea ${s.numeroLinea} ("${s.destino}"): ${s.motivo}`);
    }
  }
  if (avisosSobrescrituraNull.length > 0) {
    console.log('');
    console.log(`  [AVISO] ${avisosSobrescrituraNull.length} destino(s) con tarifas existentes vaciadas por este import:`);
    for (const a of avisosSobrescrituraNull) {
      console.log(`    - ${a}`);
    }
  }

  sincronizarSupabase();
}

// SQLite y Postgres/Supabase en paralelo (§9 del spec). Se buscó en el proyecto algún
// patrón de conexión ACTIVA a Supabase/Postgres reutilizable desde un script (`pg`,
// `@supabase/supabase-js`, una `DATABASE_URL`, etc.) en `scripts/`, `lib/` y `supabase/`,
// y no existe ninguna: ni `pg` ni `@supabase/supabase-js` están en package.json, y no hay
// ninguna variable tipo SUPABASE_URL/DATABASE_URL referenciada en el código.
//
// Lo único que existe es `supabase/_export_data.py`: un script Python de una sola vía que
// lee `rentdrive.db` y REGENERA por completo `supabase/seed.sql` con sentencias INSERT
// (no hace upsert incremental, no se conecta en vivo a Postgres, y hoy ni siquiera incluye
// `bus_tarifas_destino_ref` en su diccionario de tablas). No es un patrón de escritura
// real a Supabase que este script pueda replicar sin inventarlo desde cero.
//
// TODO(supabase): si en algún momento el equipo activa una conexión real a Supabase desde
// Node (con las credenciales reales, típicamente vía `@supabase/supabase-js` o `pg` +
// `DATABASE_URL`), completar aquí el mismo upsert por `destino` contra Postgres
// (`INSERT ... ON CONFLICT (destino) DO UPDATE SET ...`, igual que arriba). Mientras tanto,
// la paridad SQLite -> Supabase para este tarifario queda MANUAL: correr
// `python3 supabase/_export_data.py` (después de agregar `bus_tarifas_destino_ref` a su
// diccionario `TABLES`) y aplicar el `seed.sql` resultante contra la instancia real de
// Supabase.
function sincronizarSupabase() {
  console.log('');
  console.log('== Supabase/Postgres ==');
  console.log('  No se encontró ninguna conexión activa a Supabase/Postgres en el proyecto');
  console.log('  (sin `pg` ni `@supabase/supabase-js` en package.json, sin DATABASE_URL en uso).');
  console.log('  Este script NO escribió nada en Supabase. Ver el comentario TODO(supabase)');
  console.log('  en scripts/importar-tarifario-buses.ts para el paso manual pendiente.');
}

function main() {
  try {
    ejecutarImportacion();
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error('');
    console.error(`Error inesperado importando el tarifario: ${motivo}`);
    process.exit(1);
  }
}

main();
