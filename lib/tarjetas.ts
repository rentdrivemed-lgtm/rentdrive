import { leerTarjetaHtml, type TarjetaAudio } from './storage';

export function parseAudioManifest(json: string): TarjetaAudio[] {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// Renderiza el HTML tal cual fue diseñado, con un único cambio: cada
// referencia relativa audio/<nombre>.mp3 (como vienen las tarjetas de
// origen) se reemplaza por la URL real de Cloudinary donde vive ese audio.
// Nada más del documento se toca — ni estilos, ni animaciones, ni layout.
export async function renderizarTarjeta(slug: string, audioManifestJson: string): Promise<string> {
  let html = await leerTarjetaHtml(slug);
  for (const a of parseAudioManifest(audioManifestJson)) {
    html = html.split(`audio/${a.nombre}`).join(a.url);
  }
  return html;
}
