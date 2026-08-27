import { NextRequest, NextResponse } from 'next/server';
import { origenNoPermitido } from '@/lib/csrf';
import { consumirIntento } from '@/lib/limite-tasa';
import { getCurrentUser } from '@/lib/auth';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { tipoRealImagen, formDataConLimite, PAYLOAD_TOO_LARGE } from '@/lib/subida-imagen';
import { leerTarjetaPropiedad } from '@/lib/vehiculo-ocr';

export const runtime = 'nodejs';

// ── Endpoint AUTENTICADO (propietario): atajo opcional al publicar un vehículo ──
//
// A diferencia de /api/registro/extraer-documento (público, se usa ANTES de tener
// cuenta), publicar un vehículo ya requiere sesión de propietario — así que este
// endpoint la exige también. Eso permite limitar por usuario (más preciso que
// solo por IP) además de por IP, y evita exponer una consulta de IA gratis a
// cualquiera sin cuenta.
//
// Mismo patrón de validación que el endpoint de registro (tipoRealImagen,
// formDataConLimite en lib/subida-imagen.ts): Content-Length + corte por stream
// para el tamaño, bytes mágicos para el tipo real (no se confía en el `type` que
// declara el cliente).
//
// Igual que en registro-ocr: EXTRAER NO ES VERIFICAR. Esto no prueba que el
// vehículo sea del propietario ni lo aprueba — eso lo sigue haciendo el equipo
// con los documentos reales subidos al vehículo (lib/verificacion-docs.ts).

const MAX_BYTES = 8 * 1024 * 1024; // por imagen
const USER_MAX_CORTO = 8;
const USER_VENTANA_CORTA_MS = 10 * 60 * 1000; // 10 minutos
const USER_MAX_DIARIO = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
const GLOBAL_MAX_HORA = 200;
const HORA_MS = 60 * 60 * 1000;

/** Le dice al formulario si puede ofrecer el atajo (sin clave de IA no se muestra). */
export async function GET() {
  return NextResponse.json({ disponible: tieneClaveAnthropic() });
}

export async function POST(req: NextRequest) {
  const errOrigen = origenNoPermitido(req);
  if (errOrigen) return errOrigen;

  const user = await getCurrentUser();
  if (!user || user.rol !== 'propietario') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  if (!tieneClaveAnthropic()) {
    return NextResponse.json(
      { error: 'La lectura automática no está disponible por ahora. Puedes llenar el formulario a mano.' },
      { status: 503 },
    );
  }

  const esperaCorta = consumirIntento(`vehiculo-ocr:corto:${user.id}`, USER_MAX_CORTO, USER_VENTANA_CORTA_MS);
  if (esperaCorta !== null) {
    return NextResponse.json(
      { error: `Muchos intentos seguidos. Espera ${Math.ceil(esperaCorta / 60)} minuto(s) o llena el formulario a mano.` },
      { status: 429 },
    );
  }
  const esperaDiaria = consumirIntento(`vehiculo-ocr:dia:${user.id}`, USER_MAX_DIARIO, DIA_MS);
  if (esperaDiaria !== null) {
    return NextResponse.json(
      { error: 'Alcanzaste el máximo de lecturas por hoy. Puedes llenar el formulario a mano.' },
      { status: 429 },
    );
  }
  // El techo global se consume más abajo, solo si las imágenes pasan validación
  // real de tipo/tamaño (mismo criterio que /api/registro/extraer-documento).

  const declarado = Number(req.headers.get('content-length') || 0);
  if (declarado && declarado > MAX_BYTES * 2 + 128 * 1024) {
    return NextResponse.json({ error: 'Cada imagen no puede pesar más de 8 MB.' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await formDataConLimite(req, MAX_BYTES * 2 + 128 * 1024);
  } catch (e) {
    if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
      return NextResponse.json({ error: 'Cada imagen no puede pesar más de 8 MB.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'No pudimos leer los archivos enviados.' }, { status: 400 });
  }

  const frenteFile = formData.get('frente');
  const reversoFile = formData.get('reverso');
  if (!frenteFile || typeof frenteFile === 'string' || !reversoFile || typeof reversoFile === 'string') {
    return NextResponse.json({ error: 'Sube la foto del frente y el reverso de la tarjeta de propiedad.' }, { status: 400 });
  }
  if (frenteFile.size === 0 || reversoFile.size === 0) {
    return NextResponse.json({ error: 'Una de las imágenes llegó vacía. Intenta de nuevo.' }, { status: 400 });
  }
  if (frenteFile.size > MAX_BYTES || reversoFile.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Cada imagen no puede pesar más de 8 MB.' }, { status: 413 });
  }

  const frenteBuf = Buffer.from(await frenteFile.arrayBuffer());
  const reversoBuf = Buffer.from(await reversoFile.arrayBuffer());
  const frenteTipo = tipoRealImagen(frenteBuf);
  const reversoTipo = tipoRealImagen(reversoBuf);
  if (!frenteTipo || !reversoTipo) {
    return NextResponse.json(
      { error: 'Solo aceptamos fotos en JPG, PNG o WebP. Toma la foto con la cámara.' },
      { status: 400 },
    );
  }

  // Recién acá se sabe que la request va a costar una consulta real de IA.
  const esperaGlobal = consumirIntento('vehiculo-ocr:global', GLOBAL_MAX_HORA, HORA_MS);
  if (esperaGlobal !== null) {
    return NextResponse.json(
      { error: 'La lectura automática está saturada en este momento. Puedes llenar el formulario a mano.' },
      { status: 429 },
    );
  }

  try {
    const lectura = await leerTarjetaPropiedad(frenteBuf, frenteTipo, reversoBuf, reversoTipo);

    if (!lectura.es_legible) {
      return NextResponse.json({
        error: `No logramos leer la tarjeta de propiedad${lectura.nota ? ` (${lectura.nota})` : ''}. ` +
               'Puedes intentar con otras fotos o llenar el formulario a mano.',
      }, { status: 422 });
    }
    if (!lectura.coincide_tipo) {
      return NextResponse.json({
        error: 'Esas fotos no parecen ser de una tarjeta de propiedad' +
               `${lectura.tipo_detectado && lectura.tipo_detectado !== 'desconocido' ? ` (parecen ${lectura.tipo_detectado.toLowerCase()})` : ''}. ` +
               'Revisa las imágenes o llena el formulario a mano.',
      }, { status: 422 });
    }

    const algunDato = Object.values(lectura.datos).some(v => v !== null);
    if (!algunDato) {
      return NextResponse.json({
        error: 'No pudimos sacar ningún dato de las fotos. Intenta con mejor luz y sin reflejos, o llena el formulario a mano.',
      }, { status: 422 });
    }

    // Nota para quien lea esto después: esto NO verifica que el vehículo sea del
    // propietario ni lo aprueba. Solo transcribe para pre-llenar el formulario.
    return NextResponse.json({
      datos: lectura.datos,
      confianza: lectura.confianza,
      campos_no_leidos: lectura.campos_no_leidos,
      nota: lectura.nota,
    });
  } catch (e) {
    console.error('[vehiculo-ocr] Falló la lectura de la tarjeta de propiedad:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'No pudimos leer la tarjeta de propiedad en este momento. Puedes llenar el formulario a mano.' },
      { status: 502 },
    );
  }
}
