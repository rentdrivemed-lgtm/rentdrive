// ── Contratos digitales, fase 4: EL MOSTRADOR (firma en papel) ──────────────
//
// El dueño lo pidió con estas palabras: «En el caso del mostrador debe permitir
// descargar para imprimir, que se firme y que se escanee para ser guardado dentro de
// la misma base de datos».
//
// Este archivo es la mitad de servidor de esa vía:
//
//   · valida el ESCANEADO por sus BYTES (cabecera real del PDF o de la imagen), no
//     por el `content-type` que declare quien sube, que es texto libre del cliente
//     — mismo criterio que `fetchAsBase64` (lib/verificacion-docs.ts) y
//     `validarFirmaPng` (lib/firma-imagen.ts);
//   · lo guarda EN LA BASE (tabla `contrato_escaneos`), no en el CDN: es el original
//     probatorio de un contrato y el sello cubre su huella, cosa que una dirección de
//     Cloudinary no permitiría garantizar;
//   · lo SELLA con HMAC-SHA256 (`cp1:`) sobre el texto íntegro del documento MÁS la
//     huella del escaneado, de modo que alterar cualquiera de los dos rompa el sello;
//   · impide que un mismo documento quede firmado por las DOS vías.
//
// ── Qué afirma este sello y qué NO ──────────────────────────────────────────
// `cf1:` (lib/contratos-firma.ts) dice «esta firma electrónica se recogió sobre este
// texto». `cp1:` dice otra cosa mucho más modesta y hay que leerla literal: «este
// archivo escaneado se registró contra este texto, en esta fecha y por este
// administrador». NO afirma que se haya verificado una firma electrónica —no la hay—
// ni que los trazos del papel sean de quien dice el documento. Esa diferencia se
// imprime en el PDF y se muestra en pantalla, porque es toda la diferencia.
//
// ⚠️ Server-only (better-sqlite3, `crypto`): no importar desde un componente
// 'use client'. Para los tipos, `import type`.

import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { igualesEnTiempoConstante, sellarHmac } from './firma-sello';
import {
  ahoraLocalContrato, faltantesQueBloquean, leerContrato, parsearFaltantes,
  type ContratoRow, type ErrorOperacion, type VerificacionSello,
} from './contratos-firma';
import { TITULOS_DOCUMENTO } from './contratos-datos';
import { registrarAuditoriaEstricta } from './permisos';

type DB = Database.Database;

const err = (status: number, error: string): ErrorOperacion => ({ ok: false, status, error });

// ── Límites del escaneado ───────────────────────────────────────────────────

/**
 * Tope del archivo ya decodificado.
 *
 * 8 MB cubre de sobra lo que produce el mostrador: un PDF escaneado de tres o cuatro
 * hojas o la foto de un celular. Es la mitad de lo que admite /api/upload/documento
 * (15 MB) a propósito: esto NO va a un CDN, va a una fila de SQLite que se lee entera
 * cada vez que alguien descarga el archivo, y el contenedor de Railway sirve el sitio
 * completo. Lo que no quepa se vuelve a escanear con menos resolución.
 */
export const ESCANEO_MAX_BYTES = 8 * 1024 * 1024;

/** Cota rápida por longitud de cadena antes de decodificar base64 (~4/3 + el prefijo). */
export const ESCANEO_MAX_BASE64_CHARS = Math.ceil((ESCANEO_MAX_BYTES / 3) * 4) + 64;

/** Un archivo de menos de 1 KB no es un contrato escaneado. */
const ESCANEO_MIN_BYTES = 1024;

export const ESCANEO_NOMBRE_MAX_CHARS = 120;

// ── Reconocimiento por bytes ────────────────────────────────────────────────
//
// Solo formatos que una persona pueda ABRIR y LEER: el escaneado de un contrato es
// prueba, y un .zip o un .docx dentro de esta tabla no lo sería. Cada uno se reconoce
// por su cabecera real.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Marcas de tipo de la caja `ftyp` de ISO-BMFF que corresponden a HEIC/HEIF. */
const MARCAS_HEIF = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

type FormatoEscaneo = { mime: string; extension: string; esImagen: boolean; test: (b: Buffer) => boolean };

const FORMATOS: readonly FormatoEscaneo[] = [
  {
    mime: 'application/pdf', extension: 'pdf', esImagen: false,
    test: b => b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
  {
    mime: 'image/jpeg', extension: 'jpg', esImagen: true,
    test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png', extension: 'png', esImagen: true,
    test: b => b.subarray(0, 8).equals(PNG_MAGIC),
  },
  {
    mime: 'image/webp', extension: 'webp', esImagen: true,
    test: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/heic', extension: 'heic', esImagen: true,
    test: b => b.subarray(4, 8).toString('ascii') === 'ftyp' && MARCAS_HEIF.includes(b.subarray(8, 12).toString('ascii')),
  },
];

/** Qué se le puede ofrecer al usuario en el `accept` del campo de archivo. */
export const ESCANEO_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';

export type EscaneoValido = {
  ok: true;
  bytes: Buffer;
  mime: string;
  extension: string;
  esImagen: boolean;
  sha256: string;
  base64: string;
};
export type EscaneoInvalido = { ok: false; error: string };

export function sha256Hex(b: Buffer | string): string {
  return createHash('sha256').update(typeof b === 'string' ? Buffer.from(b, 'utf8') : b).digest('hex');
}

/**
 * Valida el archivo que se sube como escaneado del contrato firmado a mano.
 *
 * Acepta un data URI (`data:<lo que sea>;base64,<…>`) y se queda ÚNICAMENTE con la
 * parte base64: el tipo declarado en el prefijo se ignora por completo y el formato
 * real se decide leyendo la cabecera del archivo. Un PDF renombrado a .jpg entra como
 * PDF; un ejecutable con el prefijo de un PDF se rechaza.
 */
export function validarEscaneo(dataUrl: string): EscaneoValido | EscaneoInvalido {
  const s = String(dataUrl ?? '').trim();
  if (!s) return { ok: false, error: 'Falta el archivo escaneado.' };
  if (s.length > ESCANEO_MAX_BASE64_CHARS) {
    return { ok: false, error: 'El archivo escaneado es demasiado pesado.' };
  }
  const m = /^data:[a-z0-9.+/-]*;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(s);
  if (!m) return { ok: false, error: 'El archivo no llegó en un formato que podamos leer.' };

  // `Buffer.from(..., 'base64')` ignora en silencio lo que no sea base64 (devolvería un
  // búfer corto en vez de un error), por eso el alfabeto se valida en la propia expresión.
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > ESCANEO_MAX_BYTES) return { ok: false, error: 'El archivo escaneado es demasiado pesado.' };
  if (bytes.length < ESCANEO_MIN_BYTES) return { ok: false, error: 'El archivo escaneado está vacío o es demasiado pequeño.' };

  const formato = FORMATOS.find(f => f.test(bytes));
  if (!formato) {
    return { ok: false, error: 'El archivo tiene que ser un PDF o una imagen (JPG, PNG, WEBP o HEIC).' };
  }

  return {
    ok: true,
    bytes,
    mime: formato.mime,
    extension: formato.extension,
    esImagen: formato.esImagen,
    sha256: sha256Hex(bytes),
    base64: m[1],
  };
}

/** Extensión que le corresponde a un escaneado ya guardado, a partir de su mime. */
export function extensionEscaneo(mime: string): string {
  return FORMATOS.find(f => f.mime === mime)?.extension ?? 'bin';
}

export function escaneoEsImagen(mime: string): boolean {
  return FORMATOS.find(f => f.mime === mime)?.esImagen === true;
}

// ── Sello del acto de firma en papel ────────────────────────────────────────

const SELLO_PAPEL_PREFIJO = 'cp1:';

/**
 * Lo que cubre el sello del mostrador.
 *
 * Igual que `cf1:` ata una firma electrónica a ESTE texto, `cp1:` ata el ESCANEADO a
 * ESTE texto: `texto_sha256` es el digest del documento tal como se congeló y
 * `escaneo_sha256` el de los bytes del archivo que se subió. Cambiar una cláusula en
 * la base, o sustituir el escaneado por otro, rompe el sello.
 *
 * Se incluye además quién lo subió y cuándo, para que no se pueda retrodatar el
 * registro ni atribuírselo a otra persona editando las columnas.
 */
function baseCanonicaPapel(c: ContratoRow): string {
  return JSON.stringify({
    v: 1,
    doc: 'contrato-papel',
    contrato_id: Number(c.id) || 0,
    reserva_id: Number(c.reserva_id) || 0,
    tipo: String(c.tipo || ''),
    numero: String(c.numero || ''),
    version: Number(c.version) || 1,
    texto_sha256: sha256Hex(String(c.texto || '')),
    datos_sha256: sha256Hex(String(c.datos_json || '')),
    escaneo_sha256: String(c.papel_sha256 || ''),
    escaneo_bytes: Number(c.papel_bytes) || 0,
    escaneo_mime: String(c.papel_mime || ''),
    escaneo_nombre: String(c.papel_nombre_archivo || ''),
    subido_en: String(c.papel_subido_en || ''),
    subido_por: c.papel_subido_por === null || c.papel_subido_por === undefined ? null : Number(c.papel_subido_por),
    subido_por_nombre: String(c.papel_subido_por_nombre || ''),
  });
}

export function calcularSelloPapel(c: ContratoRow): string {
  return SELLO_PAPEL_PREFIJO + sellarHmac(baseCanonicaPapel(c));
}

/**
 * Verifica el sello del escaneado. Devuelve `null` cuando el documento no se firmó en
 * papel (no hay nada que verificar), para que quien llame distinga «no aplica» de
 * «no verifica».
 */
export function verificarSelloPapel(c: ContratoRow): VerificacionSello | null {
  if (String(c.via_firma || '') !== 'papel') return null;
  const guardado = String(c.papel_sello || '').trim();
  if (!guardado) return { ok: false, motivo: 'el escaneado no tiene sello de integridad' };
  if (!guardado.startsWith(SELLO_PAPEL_PREFIJO)) {
    return { ok: false, motivo: 'el sello de integridad del escaneado usa un esquema desconocido' };
  }
  let esperado: string;
  try {
    esperado = calcularSelloPapel(c);
  } catch {
    // Falta FIRMA_SECRET en producción: es un problema de configuración del servidor,
    // no una sospecha de manipulación. Mismo criterio que `verificarSelloFirma`.
    return { ok: false, motivo: 'no se pudo verificar el sello: falta configurar FIRMA_SECRET en el servidor' };
  }
  return igualesEnTiempoConstante(guardado, esperado)
    ? { ok: true, motivo: '' }
    : { ok: false, motivo: 'el sello no corresponde al texto del documento ni al escaneado guardados' };
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export type EscaneoRow = {
  id: number;
  contrato_id: number;
  contenido_base64: string;
  mime: string;
  bytes: number;
  sha256: string;
  nombre_archivo: string;
  subido_por: number | null;
  subido_por_nombre: string;
  subido_ip: string;
  subido_user_agent: string;
  created_at: string;
};

/** El escaneado COMPLETO (con sus bytes). Solo lo pide la ruta que lo descarga. */
export function leerEscaneo(db: DB, contratoId: number): EscaneoRow | null {
  return (db.prepare('SELECT * FROM contrato_escaneos WHERE contrato_id = ?').get(contratoId) as EscaneoRow | undefined) ?? null;
}

/**
 * Lo que se le cuenta a la interfaz del escaneado: nunca el contenido.
 *
 * Sale de las columnas de `contratos` (no de `contrato_escaneos`) justamente para no
 * tocar la fila pesada al pintar una pantalla.
 */
export type ResumenPapel = {
  firmado_en_papel: boolean;
  subido_en: string;
  subido_por_nombre: string;
  nombre_archivo: string;
  mime: string;
  bytes: number;
  sha256: string;
  integridad: VerificacionSello | null;
};

export function resumenPapel(c: ContratoRow): ResumenPapel {
  const enPapel = String(c.via_firma || '') === 'papel';
  return {
    firmado_en_papel: enPapel,
    subido_en: String(c.papel_subido_en || ''),
    subido_por_nombre: String(c.papel_subido_por_nombre || ''),
    nombre_archivo: String(c.papel_nombre_archivo || ''),
    mime: String(c.papel_mime || ''),
    bytes: Number(c.papel_bytes) || 0,
    sha256: String(c.papel_sha256 || ''),
    integridad: verificarSelloPapel(c),
  };
}

// ── Registro del escaneado ──────────────────────────────────────────────────

export type ActorPapel = { id: number; nombre: string; correo?: string; nivel?: string };

export type RegistrarPapelOpciones = {
  /** Data URI del archivo. El tipo real se decide por los bytes. */
  archivo: string;
  /** Nombre con el que lo subieron. Solo informativo; no decide el formato. */
  nombreArchivo?: string;
  /** Versión del documento que quien sube tenía en pantalla. */
  version: number;
  /** Casilla explícita: quien sube declara que ese papel es el de ESTE documento. */
  confirma: boolean;
  ip: string;
  userAgent: string;
};

export type RegistrarPapelOk = { ok: true; contrato: ContratoRow; sha256: string; bytes: number };

/**
 * Registra el contrato firmado A MANO: guarda el escaneado en la base, sella el acto y
 * deja el documento en estado 'firmado' por la vía 'papel'.
 *
 * Controles, en este orden:
 *   1. el documento existe, no está anulado y no está ya firmado;
 *   2. NO tiene ninguna firma electrónica puesta y su `via_firma` no es 'digital'
 *      — las dos vías son excluyentes y la exclusión se cierra en la BD, no solo aquí;
 *   3. no cambió de versión mientras se imprimía y se firmaba;
 *   4. no quedan huecos subsanables en el texto (el mismo bloqueo que la vía digital:
 *      un documento que no se puede firmar en pantalla tampoco se puede firmar a mano);
 *   5. hay confirmación explícita;
 *   6. el archivo es de verdad un PDF o una imagen, y pesa lo razonable.
 */
export function registrarFirmaEnPapel(
  db: DB, contratoId: number, actor: ActorPapel, opts: RegistrarPapelOpciones,
): RegistrarPapelOk | ErrorOperacion {
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return err(404, 'El documento no existe.');
  if (contrato.estado === 'anulado') return err(409, 'Este documento está anulado: no se le puede añadir un escaneado.');
  if (String(contrato.via_firma || '') === 'papel') {
    return err(409, 'Este documento ya tiene registrado su escaneado firmado. Para cambiarlo hay que anularlo y emitirlo de nuevo.');
  }
  if (String(contrato.via_firma || '') === 'digital') {
    return err(409, 'Este documento se está firmando electrónicamente. Un contrato no puede firmarse por las dos vías: anúlalo y emítelo de nuevo si quieres pasarlo al mostrador.');
  }

  // Cinturón y tirantes: aunque `via_firma` esté en '', se comprueba que de verdad no
  // haya ningún trazo recogido. Si alguna vez se escribiera una firma sin actualizar la
  // columna, el escaneado seguiría rechazándose.
  const puestas = db.prepare("SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND firmada_en <> ''")
    .get(contratoId) as { n: number };
  if ((Number(puestas?.n) || 0) > 0) {
    return err(409, 'Este documento ya tiene firmas electrónicas. Un contrato no puede firmarse por las dos vías.');
  }

  if (Number(opts.version) !== Number(contrato.version)) {
    return err(409, 'Este documento cambió mientras lo firmabas en papel. Recárgalo, vuelve a imprimirlo y repite la firma.');
  }

  const bloquean = faltantesQueBloquean(parsearFaltantes(contrato.faltantes_json));
  if (bloquean.length > 0) {
    return err(409, `El documento tiene datos pendientes que sí se pueden completar (${bloquean.map(f => f.etiqueta).join(', ')}). Complétalos, anula el documento y emítelo de nuevo.`);
  }

  if (opts.confirma !== true) {
    return err(400, 'Confirma expresamente que el archivo es el escaneado de ESTE documento firmado a mano.');
  }

  const archivo = validarEscaneo(opts.archivo);
  if (!archivo.ok) return err(400, archivo.error);

  const nombreArchivo = (opts.nombreArchivo || '').trim().slice(0, ESCANEO_NOMBRE_MAX_CHARS);
  const subidoEn = ahoraLocalContrato();

  // El sello se calcula sobre la fila COMO VA A QUEDAR, no sobre la actual.
  const candidato: ContratoRow = {
    ...contrato,
    via_firma: 'papel',
    papel_subido_en: subidoEn,
    papel_subido_por: actor.id,
    papel_subido_por_nombre: actor.nombre || '',
    papel_nombre_archivo: nombreArchivo,
    papel_mime: archivo.mime,
    papel_bytes: archivo.bytes.length,
    papel_sha256: archivo.sha256,
  };
  let sello: string;
  try {
    sello = calcularSelloPapel(candidato);
  } catch {
    // Producción sin FIRMA_SECRET: se prefiere no registrar a registrar sin sello.
    return err(500, 'No se puede registrar el escaneado: falta configurar el secreto de firma en el servidor.');
  }

  const aplicado = db.transaction(() => {
    // La condición `via_firma = ''` es la garantía a nivel de BD de que dos peticiones
    // simultáneas no registren dos escaneados ni pisen una vía ya elegida: la segunda no
    // actualiza ninguna fila. Misma técnica que el `firma_imagen = ''` de la vía digital.
    const upd = db.prepare(`
      UPDATE contratos SET
        via_firma = 'papel', estado = 'firmado', firmado_en = ?,
        papel_subido_en = ?, papel_subido_por = ?, papel_subido_por_nombre = ?,
        papel_nombre_archivo = ?, papel_mime = ?, papel_bytes = ?, papel_sha256 = ?, papel_sello = ?
      WHERE id = ? AND via_firma = '' AND estado = 'pendiente'
    `).run(
      subidoEn, subidoEn, actor.id, actor.nombre || '',
      nombreArchivo, archivo.mime, archivo.bytes.length, archivo.sha256, sello,
      contratoId,
    );
    if (upd.changes !== 1) return false;

    db.prepare(`
      INSERT INTO contrato_escaneos (
        contrato_id, contenido_base64, mime, bytes, sha256, nombre_archivo,
        subido_por, subido_por_nombre, subido_ip, subido_user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contratoId, archivo.base64, archivo.mime, archivo.bytes.length, archivo.sha256, nombreArchivo,
      actor.id, actor.nombre || '', opts.ip || '', (opts.userAgent || '').slice(0, 300),
    );

    // Bitácora ESTRICTA, dentro de la misma transacción: o queda el rastro de quién
    // registró el papel, con qué huella y desde qué IP, o no hay registro. Mismo criterio
    // que la firma electrónica.
    registrarAuditoriaEstricta(db, { id: actor.id, nombre: actor.nombre, correo: actor.correo, nivel: actor.nivel }, {
      area: 'contratos', accion: 'registrar_contrato_papel', entidad: 'contrato', entidad_id: contratoId,
      detalle: `Registró el escaneado del ${TITULOS_DOCUMENTO[contrato.tipo]} ${contrato.numero} firmado a mano`
        + ` · ${archivo.mime}, ${archivo.bytes.length} bytes, SHA-256 ${archivo.sha256}`
        + ` · IP ${opts.ip || 'desconocida'}`,
    });
    return true;
  })();

  if (!aplicado) {
    return err(409, 'Este documento ya no admite el escaneado: alguien acaba de firmarlo o de registrarlo.');
  }

  return { ok: true, contrato: leerContrato(db, contratoId)!, sha256: archivo.sha256, bytes: archivo.bytes.length };
}
