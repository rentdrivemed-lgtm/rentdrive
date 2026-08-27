'use client';
import { useRef, useState } from 'react';
import { IconPhoto, IconUpload, IconRotate } from '@/components/Icons';
import { crearImagen, recortarImagen, tamanioRotado } from '@/lib/imagenRecorte';

type Props = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  blurPlaca?: boolean;
};

/**
 * Rota 90° en sentido horario una imagen ya subida (identificada por su URL)
 * y devuelve el resultado como Blob JPEG. La rotación se "hornea" en los
 * píxeles (no es un `transform` cosmético), así que al volver a subir el
 * blob queda una imagen nueva ya rotada de verdad, sin depender de que cada
 * visor respete ningún metadato.
 *
 * Reutiliza `recortarImagen` de `lib/imagenRecorte.ts` (la misma utilidad de
 * canvas que usa `RecortarImagen.tsx`/`DocUpload.tsx`) pidiendo un "recorte"
 * que cubre la imagen rotada completa — así no duplicamos la lógica de
 * canvas/rotación aquí.
 */
async function rotarImagenUrl(url: string): Promise<Blob> {
  const img = await crearImagen(url);
  const { width, height } = tamanioRotado(img.width, img.height, 90);
  return recortarImagen(url, { x: 0, y: 0, width, height }, 90);
}

export default function FotoUpload({ label, value, onChange, required, blurPlaca = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [rotando, setRotando] = useState(false);
  const [error, setError] = useState('');
  const [difuminada, setDifuminada] = useState(false);

  const subirArchivo = async (fileOrBlob: File | Blob, filename: string) => {
    const fd = new FormData();
    fd.append('file', fileOrBlob, filename);
    if (blurPlaca) fd.append('blurPlaca', '1');
    let res: Response;
    try {
      res = await fetch('/api/upload', { method: 'POST', body: fd });
    } catch {
      throw new Error('Sin conexión — revisa tu internet e intenta de nuevo.');
    }
    const data = await res.json().catch(() => ({})) as { url?: string; error?: string; difuminada?: boolean };
    if (!res.ok || !data.url) throw new Error(data.error || 'Error al subir');
    if (data.difuminada) setDifuminada(true);
    onChange(data.url);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSubiendo(true);
    setDifuminada(false);

    try {
      await subirArchivo(file, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRotate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value || subiendo || rotando) return;
    setError('');
    setRotando(true);
    try {
      const blob = await rotarImagenUrl(value);
      await subirArchivo(blob, 'rotada.jpg');
    } catch {
      setError('No se pudo rotar la foto — intenta de nuevo.');
    } finally {
      setRotando(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      <div
        role="button" tabIndex={0} aria-label={`Subir ${label}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed transition
          ${value
            ? 'border-success/30 bg-success/10'
            : 'border-border bg-surface hover:border-accent/50 hover:bg-accent-light'}
          ${subiendo || rotando ? 'opacity-60 pointer-events-none' : ''}
        `}
        style={{ height: 110 }}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="w-full h-full object-cover rounded-xl" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl opacity-0 hover:opacity-100 transition">
              <span className="text-white text-xs font-medium">{rotando ? 'Rotando…' : 'Cambiar foto'}</span>
            </div>
            <span className="absolute top-1.5 right-1.5 bg-success/100 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">✓</span>
            <button
              type="button"
              onClick={handleRotate}
              disabled={subiendo || rotando}
              aria-label="Rotar foto 90°"
              title="Rotar foto 90°"
              className="absolute top-1.5 left-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition disabled:opacity-50"
            >
              <IconRotate size={13} />
            </button>
            {difuminada && (
              <span className="absolute bottom-1.5 left-1.5 bg-black/70 text-white text-[9px] rounded-full px-1.5 py-0.5 font-medium">🔵 placa ocultada</span>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink/40">
            {subiendo ? (
              <span className="text-sm text-ink/50">Subiendo…</span>
            ) : (
              <>
                <IconPhoto size={22} className="text-ink/25" />
                <span className="text-[11px] text-center px-2 text-ink/50">Clic para subir</span>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
