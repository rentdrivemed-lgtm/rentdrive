import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

export type UploadResult = { url: string; path: string };

export async function uploadFile(
  filename: string,
  _contentType: string,
  data: ArrayBuffer | Buffer
): Promise<UploadResult> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;
  await writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return { url: `/uploads/${filename}`, path: filename };
}
