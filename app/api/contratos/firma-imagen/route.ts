// Normaliza la imagen de firma que sube el firmante (la segunda vía que pidió el
// dueño: «que la persona cargue su firma digital o que utilice el celular para
// firmar»). Devuelve un PNG recortado, con fondo transparente y a tamaño de firma,
// para que lo VEA antes de firmar y luego lo mande al endpoint de firma.
//
// ⚠️ Esto es COMODIDAD, no un control de seguridad: quien llame directamente al
// endpoint de firma puede saltárselo y mandar un PNG sin normalizar. La validación
// que sí manda (bytes de PNG de verdad, dimensiones y tamaño) la aplica siempre
// lib/contratos-firma.ts al escribir la firma.
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { consumirIntento, ipCliente } from '@/lib/limite-tasa';
import { normalizarFirmaSubida, FIRMA_SUBIDA_MAX_BASE64_CHARS } from '@/lib/firma-imagen';

export const dynamic = 'force-dynamic';

// Procesar una foto de celular cuesta CPU. El límite es por cuenta Y por IP: firmar
// un documento son dos o tres intentos, no cuarenta por minuto.
const MAX_POR_MINUTO = 12;
const VENTANA_MS = 60_000;

/** Tope duro del cuerpo de la petición, antes de parsear el JSON. */
const CUERPO_MAX_BYTES = FIRMA_SUBIDA_MAX_BASE64_CHARS + 4096;

export async function POST(req: NextRequest) {
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const declarado = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declarado) && declarado > CUERPO_MAX_BYTES) {
    return NextResponse.json({ error: 'La imagen es demasiado pesada.' }, { status: 413 });
  }

  const esperaUsuario = consumirIntento(`firma-img:u:${user.id}`, MAX_POR_MINUTO, VENTANA_MS);
  const esperaIp = consumirIntento(`firma-img:ip:${ipCliente(req)}`, MAX_POR_MINUTO * 3, VENTANA_MS);
  const espera = esperaUsuario ?? esperaIp;
  if (espera) {
    return NextResponse.json({ error: `Demasiados intentos. Espera ${espera} segundos.` }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as { imagen?: unknown };
  const imagen = typeof body.imagen === 'string' ? body.imagen : '';
  if (!imagen) return NextResponse.json({ error: 'Falta la imagen.' }, { status: 400 });

  const resultado = await normalizarFirmaSubida(imagen);
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: 400 });

  return NextResponse.json({ ok: true, imagen: resultado.dataUrl, ancho: resultado.ancho, alto: resultado.alto });
}
