'use client';
import { useRef, useState } from 'react';
import { IconPhoto, IconUpload } from '@/components/Icons';

type Props = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  blurPlaca?: boolean;
};

export default function FotoUpload({ label, value, onChange, required, blurPlaca = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [difuminada, setDifuminada] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSubiendo(true);
    setDifuminada(false);

    const fd = new FormData();
    fd.append('file', file);
    if (blurPlaca) fd.append('blurPlaca', '1');
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json() as { url?: string; error?: string; difuminada?: boolean };
    setSubiendo(false);

    if (!res.ok) { setError(data.error || 'Error al subir'); return; }
    if (data.difuminada) setDifuminada(true);
    onChange(data.url!);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      <div
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed transition
          ${value
            ? 'border-success/30 bg-success/10'
            : 'border-border bg-surface hover:border-accent/50 hover:bg-accent-light'}
          ${subiendo ? 'opacity-60 pointer-events-none' : ''}
        `}
        style={{ height: 110 }}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="w-full h-full object-cover rounded-xl" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl opacity-0 hover:opacity-100 transition">
              <span className="text-white text-xs font-medium">Cambiar foto</span>
            </div>
            <span className="absolute top-1.5 right-1.5 bg-success/100 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">✓</span>
            {difuminada && (
              <span className="absolute bottom-1.5 left-1.5 bg-black/70 text-white text-[9px] rounded-full px-1.5 py-0.5 font-medium">🔵 placa ocultada</span>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink/30">
            {subiendo ? (
              <span className="text-sm text-ink/50">Subiendo…</span>
            ) : (
              <>
                <IconPhoto size={22} className="text-ink/25" />
                <span className="text-[11px] text-center px-2 text-ink/40">Clic para subir</span>
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
