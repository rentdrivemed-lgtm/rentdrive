'use client';
import { useRef, useState } from 'react';
import { esPdfUrl } from '@/lib/documento-tipo';
import RecortarImagen from '@/components/RecortarImagen';
import { IconPhoto } from '@/components/Icons';

type Props = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  /**
   * `true` en los documentos que casi siempre se fotografían en el momento
   * (cédula/pasaporte, licencia de conducción: es una tarjeta física). Lo único
   * que cambia es que el botón «Tomar foto» se pone PRIMERO y más visible.
   *
   * ⚠️ NO bloquea el PDF, y antes sí lo hacía. El motivo original era de
   * usabilidad, no de formato: en muchos navegadores móviles (sobre todo
   * Android) un `accept` mixto de imagen+PDF esconde la opción de cámara del
   * selector nativo. La solución no era prohibir el PDF, sino la que este
   * mismo componente ya usaba para SOAT y tarjeta de propiedad: input mixto
   * para elegir archivo MÁS un botón aparte con su propio input de solo
   * cámara. Así se conserva la cámara y se acepta el PDF.
   *
   * El otro motivo que se daba —que la verificación con IA necesita ver el
   * documento— tampoco aplica: `lib/verificacion-docs.ts` procesa PDF de forma
   * nativa desde hace tiempo (lo manda a Claude como `type: 'document'`).
   *
   * El dueño lo pidió expresamente: mucha gente descarga su cédula o su
   * licencia en PDF y no tiene por qué convertirla a foto para poder reservar.
   */
  preferirCamara?: boolean;
};

export default function DocUpload({ label, value, onChange, required, preferirCamara }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [recorteUrl, setRecorteUrl] = useState<string | null>(null);
  // Si la vista previa no se puede pintar (un PDF que el navegador no dibuja, un
  // archivo que el CDN no entrega, un formato que esta máquina no soporta) NO se deja
  // el icono de imagen rota: se cae a la ficha de archivo, que dice el nombre y sigue
  // siendo válida para guardar. El cuadro roto no informa de nada y parece un fallo.
  const [previaFallo, setPreviaFallo] = useState(false);

  const subirArchivo = async (file: File | Blob, nombreArchivo: string) => {
    setError('');
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('file', file, nombreArchivo);
      // Ya no se manda `soloImagen`: ningún documento rechaza PDF. El servidor sigue
      // comprobando por BYTES MÁGICOS que el archivo sea de verdad lo que dice ser
      // (imagen o PDF), que es la validación que importa y que no depende de lo que
      // declare el cliente.
      const res = await fetch('/api/upload/documento', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Error al subir'); return; }
      setPreviaFallo(false);
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

  const isPdf = esPdfUrl(value);
  const fileName = value ? value.split('/').pop() : '';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
          {label} {required && <span className="text-accent">*</span>}
        </label>
        {/* El recuadro de abajo acepta imagen o PDF (sin `capture`), así que la cámara
            se ofrece SIEMPRE aparte con este botón. Es lo que permite aceptar PDF sin
            perder la foto en móvil — ver el comentario de `preferirCamara` en Props. */}
        <button
          type="button"
          onClick={() => camaraRef.current?.click()}
          disabled={subiendo}
          className={`inline-flex items-center gap-1 font-semibold disabled:opacity-50 transition flex-shrink-0 ${
            preferirCamara
              // Cédula y licencia: es una tarjeta física que casi siempre se
              // fotografía ahí mismo, así que la cámara se ofrece destacada.
              ? 'text-[11px] text-white bg-accent hover:bg-accent-hover px-2.5 py-1 rounded-lg'
              : 'text-[10px] text-accent hover:text-accent-hover'
          }`}
        >
          <IconPhoto size={preferirCamara ? 12 : 11} /> Tomar foto
        </button>
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
          ) : previaFallo ? (
            <div className="flex flex-col items-center gap-1 py-3 px-2 w-full">
              <span className="text-2xl">📄</span>
              <span className="text-[10px] text-success font-medium text-center break-all px-1">{fileName}</span>
              <span className="text-[9px] text-ink/40">Archivo cargado (sin vista previa)</span>
              <span className="absolute top-1.5 right-1.5 bg-success/100 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">✓</span>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value} alt={label}
                onError={() => setPreviaFallo(true)}
                className="w-full h-full object-cover rounded-xl" style={{ maxHeight: 80 }}
              />
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
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="hidden"
        onChange={handleFile}
      />
      <input
        ref={camaraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />
      {recorteUrl && (
        // `key` para que cada foto entre al editor con el estado limpio (zoom,
        // giro y proporción) aunque se reemplace la imagen sin desmontar.
        <RecortarImagen key={recorteUrl} imagenUrl={recorteUrl} onConfirmar={confirmarRecorte} onCancelar={cancelarRecorte} />
      )}
    </div>
  );
}
