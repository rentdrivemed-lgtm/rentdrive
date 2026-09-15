// ── Escritor de archivos ZIP (solo servidor) ────────────────────────────────
//
// Arma un .zip en memoria a partir de una lista de entradas ya cargadas en
// `Buffer`. Se usa para el paquete de documentos de una persona
// (lib/paquete-documentos.ts).
//
// ── Por qué NO se agregó una dependencia (jszip / archiver) ─────────────────
// El repo no tenía librería de zip y meter una aquí costaba más de lo que daba:
//
//  1. NO HAY NADA QUE COMPRIMIR. Todo lo que entra al paquete son JPEG/WebP de
//     Cloudinary y PDF escaneados: formatos que YA están comprimidos. Pasarlos por
//     deflate gasta CPU del mismo contenedor que sirve el sitio entero (Railway,
//     una sola instancia) y devuelve un ahorro de un dígito porcentual. El único
//     archivo comprimible del paquete es el índice de texto, que pesa unos pocos
//     kilobytes.
//  2. El ZIP "store" (método 0, sin compresión) es un formato de cabeceras fijas:
//     cabecera local + datos + directorio central + EOCD. Son las ~120 líneas de
//     abajo, sin ramas, y lo abre cualquier descompresor (unzip, Finder, Windows,
//     7-Zip) porque es el mismo formato de siempre, solo que con method=0.
//  3. Este código corre en la ruta que empaqueta cédulas y certificados bancarios.
//     Una dependencia nueva ahí es superficie de suministro que hay que justificar;
//     `archiver` en particular arrastra un árbol de streams considerable.
//
// Si algún día entran al paquete archivos de texto voluminosos (CSV, XML), el
// cambio natural es deflate con `zlib` de Node —que ya viene en el runtime— fijando
// `metodo = 8` y comprimiendo el buffer: el resto de la estructura no cambia.
//
// ── Límites conocidos ───────────────────────────────────────────────────────
// No implementa ZIP64: ni el archivo completo ni una entrada individual pueden
// pasar de 4 GB, y no puede haber más de 65535 entradas. `crearZip` lo verifica y
// lanza si se sobrepasa. Los topes del paquete de documentos (60 archivos, decenas
// de MB — ver lib/paquete-documentos.ts) están varios órdenes de magnitud por
// debajo, así que en la práctica nunca se llega.

/** Una entrada del zip. `nombre` va con '/' como separador y SIN barra inicial. */
export type EntradaZip = {
  nombre: string;
  datos: Buffer;
  /** Fecha que queda escrita en la entrada. Por defecto, ahora. */
  fecha?: Date;
};

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Versión mínima para descomprimir: 2.0, la de siempre para method 0/8. */
const VERSION = 20;
/**
 * Bit 11 del campo de banderas: los nombres van en UTF-8. Sin esto, un
 * descompresor interpreta el nombre en CP437 y "Cédula" sale como "CÃ©dula". Los
 * nombres que arma el paquete son ASCII, pero la bandera se pone igual porque es
 * gratis y deja el formato correcto si mañana entra una tilde.
 */
const BANDERA_UTF8 = 0x0800;
/** Método de almacenamiento: 0 = store (los datos van tal cual). */
const METODO_STORE = 0;

const MAX_ENTRADAS = 0xffff;
const MAX_BYTES = 0xffffffff;

// ── CRC-32 (el mismo polinomio de siempre, 0xEDB88320) ──────────────────────
// La tabla se calcula una sola vez al cargar el módulo.
const TABLA_CRC: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Fecha y hora en formato MS-DOS, que es lo que guarda el ZIP: 2 bytes de hora
 * (segundos en pasos de 2) y 2 de fecha (años desde 1980). Fuera del rango
 * representable (antes de 1980 o después de 2107) se cae al 1 de enero de 1980,
 * que es lo que hacen todos los escritores: la fecha del zip es cosmética y no
 * puede tumbar la generación.
 */
export function fechaDos(d: Date): { hora: number; fecha: number } {
  const y = d.getFullYear();
  if (!Number.isFinite(y) || y < 1980 || y > 2107) return { hora: 0, fecha: (1 << 5) | 1 };
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const fecha = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, fecha };
}

/**
 * Normaliza el nombre de una entrada: separadores '/', sin barra inicial, sin
 * segmentos '..' ni '.', sin bytes de control. Un nombre que se sale de eso es un
 * intento (o un accidente) de escribir fuera de la carpeta al descomprimir —el
 * clásico "zip slip"— y aquí se corta de raíz en vez de confiar en el descompresor.
 * Devuelve '' si no queda nada utilizable.
 */
export function normalizarNombreZip(nombre: string): string {
  const partes = String(nombre ?? '')
    .replace(/\\/g, '/')
    .split('/')
    // Se quitan también los ':' — sin eso, 'C:/Users/x' sobrevive como 'C:/Users/x' y hay
    // descompresores (y herramientas de Windows) que lo tratan como ruta ABSOLUTA con letra
    // de unidad. Hoy no es explotable (todo nombre pasa antes por `segmentoLegible`), pero
    // esta función es el primitivo reutilizable y tiene que ser segura por sí sola: con el
    // ':' fuera, 'C:/Users/x' queda como la ruta relativa 'C/Users/x'.
    .map(p => p.replace(/[\u0000-\u001f\u007f]/g, '').replace(/:/g, '').trim())
    .filter(p => p && p !== '.' && p !== '..');
  return partes.join('/');
}

/**
 * Arma el zip completo en un solo Buffer. Lanza si una entrada tiene nombre
 * inválido, si hay nombres repetidos (un zip con dos entradas iguales confunde a
 * los descompresores) o si se pasan los límites del formato sin ZIP64.
 */
export function crearZip(entradas: EntradaZip[]): Buffer {
  if (entradas.length > MAX_ENTRADAS) {
    throw new Error(`El paquete tiene demasiados archivos (${entradas.length}, máximo ${MAX_ENTRADAS}).`);
  }

  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  const vistos = new Set<string>();
  let offset = 0;

  for (const entrada of entradas) {
    const nombre = normalizarNombreZip(entrada.nombre);
    if (!nombre) throw new Error('Una entrada del paquete se quedó sin nombre válido.');
    if (vistos.has(nombre)) throw new Error(`El paquete trae dos archivos con el mismo nombre: ${nombre}`);
    vistos.add(nombre);

    const nombreBuf = Buffer.from(nombre, 'utf8');
    const datos = entrada.datos;
    if (datos.length > MAX_BYTES) throw new Error(`El archivo ${nombre} es demasiado grande para un zip sin ZIP64.`);
    const suma = crc32(datos);
    const { hora, fecha } = fechaDos(entrada.fecha ?? new Date());

    const local = Buffer.alloc(30 + nombreBuf.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(BANDERA_UTF8, 6);
    local.writeUInt16LE(METODO_STORE, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(datos.length, 18); // tamaño comprimido = tamaño real (store)
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28); // sin campo extra
    nombreBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nombreBuf.length);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(VERSION, 4);  // versión del creador
    central.writeUInt16LE(VERSION, 6);  // versión mínima para extraer
    central.writeUInt16LE(BANDERA_UTF8, 8);
    central.writeUInt16LE(METODO_STORE, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(fecha, 14);
    central.writeUInt32LE(suma, 16);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comentario
    central.writeUInt16LE(0, 34); // disco donde empieza
    central.writeUInt16LE(0, 36); // atributos internos
    central.writeUInt32LE(0, 38); // atributos externos
    central.writeUInt32LE(offset, 42);
    nombreBuf.copy(central, 46);

    locales.push(local, datos);
    centrales.push(central);
    offset += local.length + datos.length;
    if (offset > MAX_BYTES) throw new Error('El paquete supera el tamaño máximo de un zip sin ZIP64 (4 GB).');
  }

  const tamCentral = centrales.reduce((n, b) => n + b.length, 0);
  if (offset + tamCentral > MAX_BYTES) {
    throw new Error('El paquete supera el tamaño máximo de un zip sin ZIP64 (4 GB).');
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);  // número de disco
  eocd.writeUInt16LE(0, 6);  // disco donde empieza el directorio central
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(tamCentral, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // sin comentario

  return Buffer.concat([...locales, ...centrales, eocd]);
}
