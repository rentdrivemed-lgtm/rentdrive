'use client';
import { useRef, useState } from 'react';
import RecortarImagen from '@/components/RecortarImagen';

type Props = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
};

export default function DocUpload({ label, value, onChange, required }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [recorteUrl, setRecorteUrl] = useState<string | null>(null);

  const subirArchivo = async (file: File | Blob, nombreArchivo: string) => {
    setError('');
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('file', file, nombreArchivo);
      const res = await fetch('/api/upload/documento', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Error al subir'); return; }
      onChange(data.url);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setSubiendo(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Los PDF no se recortan — se suben directo. Las imágenes pasan por el editor
    // (girar/recortar) para mejorar la legibilidad antes de subirlas.
    if (file.type === 'application/pdf') {
      subirArchivo(file, file.name);
    } else {
      setRecorteUrl(URL.createObjectURL(file));
    }
  };

  const confirmarRecorte = (blob: Blob) => {
    if (recorteUrl) URL.revokeObjectURL(recorteUrl);
    setRecorteUrl(null);
    if (inputRef.current) inputRef.current.value = '';
    subirArchivo(blob, 'documento.jpg');
  };

  const cancelarRecorte = () => {
    if (recorteUrl) URL.revokeObjectURL(recorteUrl);
    setRecorteUrl(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const isPdf = value?.toLowerCase().endsWith('.pdf');
  const fileName = value ? value.split('/').pop() : '';

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      <div
        role="button" tabIndex={0} aria-label={`Subir ${label}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed transition flex items-center justify-center
          ${value
            ? 'border-success/30 bg-success/10'
            : 'border-border bg-surface hover:border-accent/50 hover:bg-accent-light'}
          ${subiendo ? 'opacity-60 pointer-events-none' : ''}
        `}
        style={{ minHeight: 80 }}
      >
        {value ? (
          isPdf ? (
            <div className="flex flex-col items-center gap-1 py-3 px-2 w-full">
              <span className="text-2xl">📄</span>
              <span className="text-[10px] text-success font-medium text-center break-all px-1">{fileName}</span>
              <span className="absolute top-1.5 right-1.5 bg-success/100 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">✓</span>
            </div>
          ) : (
            <>
              <img src={value} alt={label} className="w-full h-full object-cover rounded-xl" style={{ maxHeight: 80 }} />
              <span className="absolute top-1.5 right-1.5 bg-success/100 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">✓</span>
            </>
          )
        ) : (
          <div className="flex flex-col items-center gap-1 text-ink/40 py-3">
            {subiendo ? (
              <span className="text-sm text-ink/50">Subiendo…</span>
            ) : (
              <>
                <span className="text-xl">📎</span>
                <span className="text-[11px] text-ink/50">Imagen o PDF</span>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={handleFile}
      />
      {recorteUrl && (
        <RecortarImagen imagenUrl={recorteUrl} onConfirmar={confirmarRecorte} onCancelar={cancelarRecorte} />
      )}
    </div>
  );
}
