import { NextRequest, NextResponse } from 'next/server';
import { origenNoPermitido } from '@/lib/csrf';
import { consumirIntento, ipCliente } from '@/lib/limite-tasa';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { leerDocumentoRegistro, type TipoDocumentoRegistro } from '@/lib/registro-ocr';
import { tipoRealImagen, formDataConLimite, PAYLOAD_TOO_LARGE } from '@/lib/subida-imagen';
import { uploadFile } from '@/lib/storage';

export const runtime = 'nodejs';

// ── Endpoint PÚBLICO: se usa antes de que la persona tenga cuenta ────────────
//
// Es el atajo opcional del registro ("sube tu cédula y te lleno el formulario").
// Al no exigir sesión, cualquiera puede llamarlo, y cada llamada cuesta plata
// (una consulta de visión a Claude). Protecciones, y por qué cada una:
//
// 1) Origin (lib/csrf.ts → origenNoPermitido): si el navegador manda Origin, debe
//    ser nuestro dominio. No sirve el `bloqueadoPorCsrf` completo porque ese exige
//    Content-Type: application/json y aquí el body es multipart (una imagen).
//    No hay CSRF "de verdad" que prevenir (no muta nada ni toca la sesión), pero
//    corta el uso del endpoint como OCR gratis desde otro sitio web.
// 2) Límite de tasa por IP: 6 lecturas por 10 minutos y 40 por día. Un registro
//    real necesita 1-2 (cédula y licencia), más algún reintento por foto movida.
// 3) Techo global por hora: aunque alguien rote IPs (VPN, botnet), el gasto de IA
//    queda acotado. Se prefiere degradar el atajo (la persona escribe a mano) antes
//    que quemar el presupuesto. IMPORTANTE: este techo solo se consume DESPUÉS de
//    validar tipo/tamaño real del archivo (ver más abajo) — si contara desde el
//    principio, cualquiera podría agotar el cupo de TODOS mandando basura que ni
//    siquiera llega a costar una consulta de IA. El límite por IP (6/10min, 40/día)
//    sí cuenta cualquier intento, válido o no: ese es para frenar abuso de una sola
//    fuente, no para cuidar el gasto de IA.
// 4) Tamaño: se corta en dos capas. (a) Content-Length declarado, rechazado antes
//    de tocar el body — pero un cliente puede omitir ese header (p. ej. chunked) y
//    saltarse esta capa por completo. (b) Por eso el body se lee como stream con un
//    límite duro impuesto mientras se lee (`formDataConLimite`, en lib/subida-imagen.ts,
//    compartido con app/api/vehiculos/extraer-matricula/): si en algún punto de la
//    lectura se supera MAX_BYTES, se corta ahí mismo, ANTES de tener el FormData
//    completo en memoria. Ver el comentario de esa función para el detalle y la
//    limitación conocida.
// 5) Tipo MIME REAL: no se confía en `file.type` (lo pone el cliente y se falsifica
//    trivialmente); se leen los bytes mágicos. Solo JPG/PNG/WebP — nada de PDF, que
//    consume muchos más tokens y no aporta para una foto de cédula.
// 6) Consentimiento (Ley 1581 de 2012): el checkbox del formulario es solo la
//    superficie visible. El enforcement real es este endpoint: si no llega
//    `consiente=true` en el FormData, se rechaza ANTES de tocar el archivo o llamar
//    a la IA. Sin esto, cualquiera que le pegue directo al endpoint (curl, etc.) se
//    saltaría por completo el aviso de tratamiento de datos que se le muestra a la
//    persona en pantalla.
//
// La imagen SÍ se guarda (a partir de esta versión): tras una lectura exitosa
// (es_legible && coincide_tipo, con al menos un dato transcrito) se sube a
// Cloudinary reusando el mismo uploadFile() de lib/storage.ts que usa
// POST /api/upload/documento, y la URL resultante se devuelve al cliente como
// `urlGuardada` (ver el POST más abajo). Como este endpoint es público y la
// cuenta todavía no existe en este punto, la URL NO se asocia a ningún usuario
// aquí: el cliente (app/(auth)/registro/page.tsx o app/completar-perfil/page.tsx)
// la retiene en memoria y la manda en el submit final, donde SÍ queda guardada en
// `usuarios.cedula_url`/`cedula_url_dorso`/`licencia_url` (ver lib/db.ts). El motivo del cambio: antes
// se pedía la misma foto de nuevo más adelante (al reservar, en app/pago/page.tsx)
// — Victor decidió explícitamente que se guardara para no repetirle el trámite a
// la persona.
//
// ⚠️ La subida NO es permanente por defecto: se hace bajo la carpeta
// `registro-temp/` (ver `uploadFile(..., { folder: 'registro-temp' })` más abajo)
// precisamente porque, en este punto, NO existe ninguna cuenta a la cual asociarla
// todavía. Si la persona abandona el registro (cierra la pestaña, el correo ya
// existe → 409, retoma la foto una segunda vez, etc.) esa imagen queda subida sin
// ningún `usuario_id` — el hallazgo era que antes se guardaba en la carpeta normal
// de documentos, sin límite de tiempo ni forma de distinguirla de un documento real
// ya reclamado por una cuenta. `POST /api/admin/limpiar-documentos-huerfanos`
// (admin-only, ver ese archivo) es el mecanismo que, corrido periódicamente,
// revisa `registro-temp/` y borra lo que lleve más de 48h sin haber sido
// reclamado (su URL no aparece en ningún `usuarios.cedula_url`/`cedula_url_dorso`/
// `licencia_url`; ver lib/limpieza-documentos.ts, que ya consulta las 4 columnas).
// El checkbox de consentimiento en el formulario refleja esto: la foto se guarda
// asociada a la cuenta SOLO si el registro se completa; si no, se borra sola
// pasado ese plazo corto.
//
// La subida es SIEMPRE best-effort: si falla por cualquier motivo, NO rompe la
// respuesta de lectura (que ya costó una consulta real de IA) — simplemente se
// omite `urlGuardada` de la respuesta y se deja un `console.error`. Los límites
// de tasa de arriba (por IP y global) siguen acotando igual el costo/abuso de
// este endpoint; guardar la imagen no cambia ese perfil de riesgo porque ya
// estaba acotado por esos mismos límites.

const MAX_BYTES = 8 * 1024 * 1024;          // 8 MB
// Subido de 6 a 12 (sep-2026) al volverse obligatorio el dorso de la cédula: el camino
// feliz de un registro pasó de 2 lecturas (cédula + licencia) a 3 (cédula frente, cédula
// dorso, licencia). Con 6, un solo reintento por foto —normal: sale movida, con reflejo,
// mal encuadrada— ya chocaba contra el 429, y peor en oficinas o casas con IP compartida,
// donde varias personas registrándose suman contra el mismo contador. 12 deja margen para
// un reintento por foto sin aflojar de forma relevante el tope diario (40) ni el global.
const IP_MAX_CORTO = 12;
const IP_VENTANA_CORTA_MS = 10 * 60 * 1000; // 10 minutos
const IP_MAX_DIARIO = 40;
const DIA_MS = 24 * 60 * 60 * 1000;
const GLOBAL_MAX_HORA = 300;
const HORA_MS = 60 * 60 * 1000;

// 'cedula_dorso' (reverso del documento de identidad) pasa por el MISMO camino que el
// frente —mismos límites de tasa, mismo chequeo de bytes mágicos, mismo consentimiento y
// misma lectura con IA— a propósito: es la única forma de subir el reverso sin sesión
// (la cuenta todavía no existe) sin abrir una vía de subida de archivos sin validar. Lo
// que cambia es que de ahí no sale ningún dato para el formulario (ver lib/registro-ocr.ts):
// la IA solo confirma que la foto SEA un reverso, y la URL guardada termina en
// `usuarios.cedula_url_dorso` en el submit final.
const TIPOS_VALIDOS: TipoDocumentoRegistro[] = ['cedula', 'cedula_dorso', 'licencia'];

// tipoRealImagen y formDataConLimite viven en lib/subida-imagen.ts (compartidos con
// app/api/vehiculos/extraer-matricula/route.ts, mismo patrón de validación).

/** Le dice al formulario si puede ofrecer el atajo (sin clave de IA no se muestra). */
export async function GET() {
  return NextResponse.json({ disponible: tieneClaveAnthropic() });
}

export async function POST(req: NextRequest) {
  const errOrigen = origenNoPermitido(req);
  if (errOrigen) return errOrigen;

  if (!tieneClaveAnthropic()) {
    return NextResponse.json(
      { error: 'La lectura automática no está disponible por ahora. Puedes llenar el formulario a mano.' },
      { status: 503 },
    );
  }

  const ip = ipCliente(req);
  const esperaCorta = consumirIntento(`registro-ocr:corto:${ip}`, IP_MAX_CORTO, IP_VENTANA_CORTA_MS);
  if (esperaCorta !== null) {
    return NextResponse.json(
      { error: `Muchos intentos seguidos. Espera ${Math.ceil(esperaCorta / 60)} minuto(s) o llena el formulario a mano.` },
      { status: 429 },
    );
  }
  const esperaDiaria = consumirIntento(`registro-ocr:dia:${ip}`, IP_MAX_DIARIO, DIA_MS);
  if (esperaDiaria !== null) {
    return NextResponse.json(
      { error: 'Alcanzaste el máximo de lecturas por hoy. Puedes llenar el formulario a mano.' },
      { status: 429 },
    );
  }
  // OJO: el techo GLOBAL (registro-ocr:global) NO se consume acá todavía — se
  // consume más abajo, solo si la request pasa validación de tipo/tamaño real
  // (ver comentario 3 al inicio del archivo).

  // Corte por Content-Length antes de bufferizar nada (capa 1; ver formDataConLimite
  // para la capa 2, que cubre el caso sin este header).
  const declarado = Number(req.headers.get('content-length') || 0);
  if (declarado && declarado > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'La imagen no puede pesar más de 8 MB.' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await formDataConLimite(req, MAX_BYTES + 64 * 1024);
  } catch (e) {
    if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
      return NextResponse.json({ error: 'La imagen no puede pesar más de 8 MB.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'No pudimos leer el archivo enviado.' }, { status: 400 });
  }

  // Consentimiento (Ley 1581): enforcement real en servidor. Se revisa apenas se
  // tiene el FormData, ANTES de mirar el tipo/archivo o llamar a la IA. La casilla
  // del formulario (app/(auth)/registro/page.tsx) es solo la superficie visible de
  // este requisito — sin este chequeo, un curl directo se lo saltaría entero.
  const consiente = String(formData.get('consiente') || '') === 'true';
  if (!consiente) {
    return NextResponse.json(
      { error: 'Debes autorizar el tratamiento de la foto de tu documento para usar la lectura automática.' },
      { status: 400 },
    );
  }

  const tipoRaw = String(formData.get('tipo') || '');
  if (!TIPOS_VALIDOS.includes(tipoRaw as TipoDocumentoRegistro)) {
    return NextResponse.json({ error: 'Tipo de documento inválido.' }, { status: 400 });
  }
  const tipo = tipoRaw as TipoDocumentoRegistro;

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No recibimos ninguna imagen.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'La imagen llegó vacía. Intenta de nuevo.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'La imagen no puede pesar más de 8 MB.' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = tipoRealImagen(buffer);
  if (!mediaType) {
    return NextResponse.json(
      { error: 'Solo aceptamos fotos en JPG, PNG o WebP. Toma una foto del documento con la cámara.' },
      { status: 400 },
    );
  }

  // Recién acá se sabe que la request va a costar una consulta real de IA:
  // consume el techo global en este punto, no antes (comentario 3 al inicio).
  const esperaGlobal = consumirIntento('registro-ocr:global', GLOBAL_MAX_HORA, HORA_MS);
  if (esperaGlobal !== null) {
    return NextResponse.json(
      { error: 'La lectura automática está saturada en este momento. Puedes llenar el formulario a mano.' },
      { status: 429 },
    );
  }

  const etiqueta = tipo === 'licencia'
    ? 'licencia de conducción'
    : tipo === 'cedula_dorso' ? 'documento de identidad por el reverso' : 'documento de identidad';

  try {
    const lectura = await leerDocumentoRegistro(buffer, mediaType, tipo);

    if (!lectura.es_legible) {
      return NextResponse.json({
        error: `No logramos leer la foto de tu ${etiqueta}${lectura.nota ? ` (${lectura.nota})` : ''}. ` +
               'Puedes intentar con otra foto o escribir los datos a mano.',
      }, { status: 422 });
    }
    if (!lectura.coincide_tipo) {
      return NextResponse.json({
        error: `Esa foto no parece ser tu ${etiqueta}` +
               `${lectura.tipo_detectado && lectura.tipo_detectado !== 'desconocido' ? ` (parece ${lectura.tipo_detectado.toLowerCase()})` : ''}. ` +
               'Revisa la imagen o escribe los datos a mano.',
      }, { status: 422 });
    }

    // El reverso no transcribe ningún campo (ver lib/registro-ocr.ts): exigirle datos
    // lo rechazaría siempre. Para ese tipo basta con es_legible + coincide_tipo de arriba.
    const algunDato = tipo === 'cedula_dorso' || Object.values(lectura.datos).some(v => v !== null);
    if (!algunDato) {
      return NextResponse.json({
        error: `No pudimos sacar ningún dato de la foto de tu ${etiqueta}. ` +
               'Intenta con mejor luz y sin reflejos, o escribe los datos a mano.',
      }, { status: 422 });
    }

    // Guarda la foto en Cloudinary bajo `registro-temp/` (best-effort — ver el
    // comentario grande al inicio del archivo sobre por qué esta carpeta es
    // temporal y quién la limpia). Solo se llega acá con una lectura exitosa.
    let urlGuardada: string | undefined;
    try {
      const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
      const nombre = `doc-registro-${tipo}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const subida = await uploadFile(nombre, mediaType, buffer, { folder: 'registro-temp' });
      urlGuardada = subida.url;
    } catch (e) {
      console.error('[registro-ocr] No se pudo guardar la foto en el storage (best-effort, no bloquea la lectura):', e instanceof Error ? e.message : e);
    }

    // Nota para quien lea esto después: esto NO verifica identidad. Solo transcribe.
    return NextResponse.json({
      datos: lectura.datos,
      confianza: lectura.confianza,
      campos_no_leidos: lectura.campos_no_leidos,
      nota: lectura.nota,
      verificado: false,
      ...(urlGuardada ? { urlGuardada } : {}),
    });
  } catch (e) {
    console.error('[registro-ocr] Falló la lectura del documento:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'No pudimos leer el documento en este momento. Puedes llenar el formulario a mano.' },
      { status: 502 },
    );
  }
}
