import { v2 as cloudinary } from 'cloudinary';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import path from 'path';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export type UploadResult = { url: string; path: string };

export async function uploadFile(filename: string, contentType: string, data: ArrayBuffer | Buffer): Promise<UploadResult> {
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;
  const folder = contentType === 'application/pdf' ? 'docs' : filename.startsWith('doc-') ? 'docs' : 'uploads';

  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, resource_type: contentType === 'application/pdf' ? 'raw' : 'image', public_id: filename.replace(/\.[^.]+$/, '') },
      (err, res) => { if (err || !res) reject(err ?? new Error('Upload failed')); else resolve(res); }
    ).end(buffer);
  });

  return { url: result.secure_url, path: result.public_id };
}

// ── Tarjetas NFC ──────────────────────────────────────────────────────────
// El HTML autocontenido (pequeño, <8MB) se guarda en el volumen persistente
// de Railway — mismo criterio que rentdrive.db en lib/db.ts (fuera del
// volumen, cualquier redeploy borra el filesystem del contenedor). Los
// audios (binarios más pesados, pensados para CDN) van a Cloudinary como el
// resto de los uploads, bajo resource_type "video" (así maneja Cloudinary
// audio: mp3/wav/etc.).
const TARJETAS_DIR = process.env.NODE_ENV === 'production'
  ? '/app/data/tarjetas'
  : path.join(process.cwd(), 'data', 'tarjetas');

function slugDir(slug: string): string {
  // Defensa en profundidad: el slug ya se valida antes de llegar aquí, pero
  // no debe poder escapar del directorio.
  const limpio = slug.replace(/[^a-z0-9-]/g, '');
  if (!limpio || limpio !== slug) throw new Error('Slug inválido');
  return path.join(TARJETAS_DIR, limpio);
}

export async function guardarTarjetaHtml(slug: string, data: ArrayBuffer | Buffer): Promise<void> {
  const dir = slugDir(slug);
  await mkdir(dir, { recursive: true });
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;
  await writeFile(path.join(dir, 'index.html'), buffer);
}

export async function leerTarjetaHtml(slug: string): Promise<string> {
  return readFile(path.join(slugDir(slug), 'index.html'), 'utf-8');
}

export async function eliminarTarjetaHtml(slug: string): Promise<void> {
  try { await rm(slugDir(slug), { recursive: true, force: true }); } catch { /* si no existe, no pasa nada */ }
}

export type TarjetaAudio = { nombre: string; url: string; public_id: string };

export async function subirAudioTarjeta(slug: string, filename: string, data: ArrayBuffer | Buffer): Promise<TarjetaAudio> {
  const nombre = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;

  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: `tarjetas/${slug}/audio`, resource_type: 'video', public_id: nombre.replace(/\.[^.]+$/, '') },
      (err, res) => { if (err || !res) reject(err ?? new Error('Upload failed')); else resolve(res); }
    ).end(buffer);
  });

  return { nombre, url: result.secure_url, public_id: result.public_id };
}

export async function eliminarAudioTarjeta(publicId: string): Promise<void> {
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }); } catch { /* no bloquea */ }
}
