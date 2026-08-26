import { NextRequest, NextResponse } from 'next/server';
import { origenNoPermitido } from '@/lib/csrf';
import { consumirIntento, ipCliente } from '@/lib/limite-tasa';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { leerDocumentoRegistro, type MediaTypeImagen, type TipoDocumentoRegistro } from '@/lib/registro-ocr';

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
//    que quemar el presupuesto.
// 4) Tamaño: se rechaza por Content-Length antes de leer el body, y otra vez por
//    file.size. Evita que suban un archivo enorme solo para gastar memoria/tokens.
// 5) Tipo MIME REAL: no se confía en `file.type` (lo pone el cliente y se falsifica
//    trivialmente); se leen los bytes mágicos. Solo JPG/PNG/WebP — nada de PDF, que
//    consume muchos más tokens y no aporta para una foto de cédula.
//
// La imagen NO se guarda en ningún lado: va a la IA y se descarta. Además de ser
// mejor para la privacidad de alguien que aún no es usuario, evita que este
// endpoint sirva para llenar el almacenamiento gratis.

const MAX_BYTES = 8 * 1024 * 1024;          // 8 MB
const IP_MAX_CORTO = 6;
const IP_VENTANA_CORTA_MS = 10 * 60 * 1000; // 10 minutos
const IP_MAX_DIARIO = 40;
const DIA_MS = 24 * 60 * 60 * 1000;
const GLOBAL_MAX_HORA = 300;
const HORA_MS = 60 * 60 * 1000;

const TIPOS_VALIDOS: TipoDocumentoRegistro[] = ['cedula', 'licencia'];

/** Detecta el formato real por los bytes mágicos, ignorando lo que declare el cliente. */
function tipoRealImagen(buf: Buffer): MediaTypeImagen | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

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
  const esperaGlobal = consumirIntento('registro-ocr:global', GLOBAL_MAX_HORA, HORA_MS);
  if (esperaGlobal !== null) {
    return NextResponse.json(
      { error: 'La lectura automática está saturada en este momento. Puedes llenar el formulario a mano.' },
      { status: 429 },
    );
  }

  // Corte por Content-Length antes de bufferizar nada.
  const declarado = Number(req.headers.get('content-length') || 0);
  if (declarado && declarado > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'La imagen no puede pesar más de 8 MB.' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'No pudimos leer el archivo enviado.' }, { status: 400 });
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

  const etiqueta = tipo === 'cedula' ? 'documento de identidad' : 'licencia de conducción';

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

    const algunDato = Object.values(lectura.datos).some(v => v !== null);
    if (!algunDato) {
      return NextResponse.json({
        error: `No pudimos sacar ningún dato de la foto de tu ${etiqueta}. ` +
               'Intenta con mejor luz y sin reflejos, o escribe los datos a mano.',
      }, { status: 422 });
    }

    // Nota para quien lea esto después: esto NO verifica identidad. Solo transcribe.
    return NextResponse.json({
      datos: lectura.datos,
      confianza: lectura.confianza,
      campos_no_leidos: lectura.campos_no_leidos,
      nota: lectura.nota,
      verificado: false,
    });
  } catch (e) {
    console.error('[registro-ocr] Falló la lectura del documento:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'No pudimos leer el documento en este momento. Puedes llenar el formulario a mano.' },
      { status: 502 },
    );
  }
}
