// El ejemplar firmado A MANO de un contrato: subirlo y descargarlo.
//
// POST /api/contratos/<id>/escaneo → registra el escaneado del contrato que se imprimió
//                                    y se firmó en el mostrador. Deja el documento en
//                                    estado 'firmado' por la vía 'papel'.
// GET  /api/contratos/<id>/escaneo → descarga ese archivo tal como se subió.
//
// ── Quién puede subirlo ─────────────────────────────────────────────────────
// Solo una cuenta del equipo con el área `contratos` (la que definió la fase 2 para ver,
// emitir y anular: hoy `principal` y `socio`, más las excepciones por empleado). No es
// una acción del cliente ni del propietario: quien registra el papel está afirmando que
// tuvo delante el ejemplar firmado, y esa afirmación la hace la empresa. Queda en la
// Bitácora quién lo subió, cuándo, desde qué IP y con qué huella SHA-256.
//
// ── Por qué el archivo va a la BASE y no a Cloudinary ───────────────────────
// Lo pidió el dueño («que se escanee para ser guardado dentro de la misma base de
// datos») y además es lo correcto aquí: el sello `cp1:` cubre la huella de los BYTES del
// archivo, cosa que no tendría sentido si lo que se guardara fuera una dirección de CDN
// que puede caducar o ser sustituida. Ver lib/contratos-papel.ts.
//
// ── Un contrato no puede firmarse por las dos vías ──────────────────────────
// Si ya tiene alguna firma electrónica, esta ruta responde 409; y al revés, un documento
// con escaneado registrado deja de admitir firma electrónica. La exclusión la cierra la
// base de datos con UPDATE condicionados, no una comprobación en memoria.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { consumirIntento, ipCliente } from '@/lib/limite-tasa';
import { registrarAuditoria, nivelDe } from '@/lib/permisos';
import { accesoContrato } from '@/lib/contratos-acceso';
import { leerContrato, tituloDocumento } from '@/lib/contratos-firma';
import {
  registrarFirmaEnPapel, leerEscaneo, extensionEscaneo,
  ESCANEO_MAX_BASE64_CHARS, ESCANEO_NOMBRE_MAX_CHARS,
} from '@/lib/contratos-papel';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Tope duro del cuerpo de la petición, antes de parsear el JSON. */
const CUERPO_MAX_BYTES = ESCANEO_MAX_BASE64_CHARS + 4096;

const MAX_SUBIDAS_POR_MINUTO = 6;
const MAX_DESCARGAS_POR_MINUTO = 20;
const VENTANA_MS = 60_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const contratoId = Number(id);
  if (!Number.isInteger(contratoId) || contratoId <= 0) {
    return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  }

  // El tope de tamaño se aplica ANTES de leer el cuerpo: un archivo de 50 MB no tiene
  // que llegar a memoria para que se le diga que no cabe.
  const declarado = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declarado) && declarado > CUERPO_MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo escaneado es demasiado pesado.' }, { status: 413 });
  }

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  // Primero el acceso de LECTURA (404 a quien no debería saber que existe), después el
  // permiso de gestión (403 a quien sí puede verlo pero no puede registrar el papel).
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  if (!acceso.puedeGestionar) {
    return NextResponse.json({ error: 'No tienes permiso para registrar el contrato firmado en papel.' }, { status: 403 });
  }

  const espera = consumirIntento(`contrato-escaneo:${user.id}`, MAX_SUBIDAS_POR_MINUTO, VENTANA_MS);
  if (espera !== null) {
    return NextResponse.json({ error: `Demasiadas subidas seguidas. Espera ${espera} segundos.` }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as {
    archivo?: unknown; nombre_archivo?: unknown; version?: unknown; confirma?: unknown;
  };

  const archivo = typeof body.archivo === 'string' ? body.archivo.trim() : '';
  if (!archivo) return NextResponse.json({ error: 'Falta el archivo escaneado.' }, { status: 400 });
  if (archivo.length > ESCANEO_MAX_BASE64_CHARS) {
    return NextResponse.json({ error: 'El archivo escaneado es demasiado pesado.' }, { status: 400 });
  }
  // La versión es OBLIGATORIA, igual que al firmar: sin ella bastaría con no mandarla
  // para saltarse el «este documento cambió mientras lo firmabas».
  const version = Number(body.version);
  if (!Number.isInteger(version) || version <= 0) {
    return NextResponse.json({ error: 'Falta la versión del documento. Recarga la página e inténtalo de nuevo.' }, { status: 400 });
  }
  const nombreArchivo = typeof body.nombre_archivo === 'string'
    ? body.nombre_archivo.trim().slice(0, ESCANEO_NOMBRE_MAX_CHARS)
    : '';

  const resultado = registrarFirmaEnPapel(db, contratoId, {
    id: user.id, nombre: user.nombre, correo: user.correo,
    // El NIVEL, no la palabra 'admin': la bitácora tiene que distinguir si anuló
    // el principal, un socio o la secretaría. Mismo patrón que el proxy de documentos.
    nivel: user.rol === 'admin' ? (nivelDe(db, user.id) || 'admin') : user.rol,
  }, {
    archivo,
    nombreArchivo,
    version,
    confirma: body.confirma === true,
    ip: ipCliente(req),
    userAgent: req.headers.get('user-agent') || '',
  });
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  return NextResponse.json({
    ok: true,
    estado: resultado.contrato.estado,
    via_firma: resultado.contrato.via_firma,
    sha256: resultado.sha256,
    bytes: resultado.bytes,
    subido_en: resultado.contrato.papel_subido_en,
  }, { status: 201 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const contratoId = Number(id);
  if (!Number.isInteger(contratoId) || contratoId <= 0) {
    return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  }

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const espera = consumirIntento(`contrato-escaneo-ver:${user.id}`, MAX_DESCARGAS_POR_MINUTO, VENTANA_MS);
  if (espera !== null) {
    return NextResponse.json({ error: `Demasiadas descargas seguidas. Espera ${espera} segundos.` }, { status: 429 });
  }

  const escaneo = leerEscaneo(db, contratoId);
  if (!escaneo) return NextResponse.json({ error: 'Este documento no tiene un escaneado registrado.' }, { status: 404 });

  const bytes = Buffer.from(escaneo.contenido_base64, 'base64');

  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel: user.rol }, {
    area: 'contratos', accion: 'descargar_contrato_escaneado', entidad: 'contrato', entidad_id: contrato.id,
    detalle: `Escaneado de ${tituloDocumento(contrato.tipo)} ${contrato.numero} (reserva #${contrato.reserva_id})`,
  });

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': escaneo.mime || 'application/octet-stream',
      // SIEMPRE `attachment`, nunca `inline`: es un archivo que subió una persona y se
      // sirve desde nuestro propio origen. Un PDF abierto en línea ejecuta su propio
      // guion en el visor del navegador; descargado, no. Con `nosniff` encima, el
      // navegador tampoco puede reinterpretar el tipo.
      'Content-Disposition': `attachment; filename="${String(contrato.numero || 'contrato').replace(/[^A-Za-z0-9._-]+/g, '-')}-firmado.${extensionEscaneo(escaneo.mime)}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
