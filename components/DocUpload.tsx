'use client';
import { useRef, useState } from 'react';
import RecortarImagen from '@/components/RecortarImagen';
import { IconPhoto } from '@/components/Icons';

type Props = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  /**
   * true para documentos que NUNCA son un PDF (cédula/pasaporte, licencia de
   * conducción: siempre es la foto de una tarjeta física). En ese caso el
   * input queda como `accept="image/*" capture="environment"` — SIN mezclar
   * con `application/pdf` — porque en muchos navegadores móviles (sobre todo
   * Android) un `accept` mixto de imagen+PDF esconde la opción de cámara del
   * selector nativo y solo deja elegir un archivo ya existente.
   *
   * Cuando es `false` (SOAT/tarjeta de propiedad/tecno-mecánica/seguro todo
   * riesgo, que sí a veces llegan como PDF escaneado), el recuadro se queda
   * igual que antes (imagen o PDF, sin `capture`) para no quitarle a nadie la
   * posibilidad de subir un PDF, pero se agrega un botón aparte de "Tomar
   * foto" con su propio input de solo cámara.
   */
  soloImagen?: boolean;
};

export default function DocUpload({ label, value, onChange, required, soloImagen }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [recorteUrl, setRecorteUrl] = useState<string | null>(null);

  const subirArchivo = async (file: File | Blob, nombreArchivo: string) => {
    setError('');
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('file', file, nombreArchivo);
      // `soloImagen` ya identifica en este componente los documentos que NUNCA son un
      // PDF (cédula/pasaporte, licencia — ver el comentario del prop arriba). Se manda
      // también al servidor para que /api/upload/documento pueda rechazar un PDF real
      // (por bytes mágicos, no por el Content-Type que declare el archivo) cuando el
      // documento es de este tipo — antes solo se restringía en el `accept` del input,
      // que no impide nada del lado del servidor.
      fd.append('soloImagen', soloImagen ? 'true' : 'false');
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
    if (camaraRef.current) camaraRef.current.value = '';
    subirArchivo(blob, 'documento.jpg');
  };

  const cancelarRecorte = () => {
    if (recorteUrl) URL.revokeObjectURL(recorteUrl);
    setRecorteUrl(null);
    if (inputRef.current) inputRef.current.value = '';
    if (camaraRef.current) camaraRef.current.value = '';
  };

  const isPdf = value?.toLowerCase().endsWith('.pdf');
  const fileName = value ? value.split('/').pop() : '';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
          {label} {required && <span className="text-accent">*</span>}
        </label>
        {/* SOAT/tarjeta/tecno/seguro: el recuadro de abajo sigue aceptando PDF (sin
            `capture`), así que se ofrece la cámara aparte con este botón — ver el
            comentario de `soloImagen` en el tipo Props. */}
        {!soloImagen && (
          <button
            type="button"
            onClick={() => camaraRef.current?.click()}
            disabled={subiendo}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent hover:text-accent-hover disabled:opacity-50 transition flex-shrink-0"
          >
            <IconPhoto size={11} /> Tomar foto
          </button>
        )}
      </div>
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
        accept={soloImagen ? 'image/*' : 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'}
        capture={soloImagen ? 'environment' : undefined}
        className="hidden"
        onChange={handleFile}
      />
      {!soloImagen && (
        <input
          ref={camaraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFile}
        />
      )}
      {recorteUrl && (
        <RecortarImagen imagenUrl={recorteUrl} onConfirmar={confirmarRecorte} onCancelar={cancelarRecorte} />
      )}
    </div>
  );
}
