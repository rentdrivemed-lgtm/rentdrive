import { v2 as cloudinary } from 'cloudinary';

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
