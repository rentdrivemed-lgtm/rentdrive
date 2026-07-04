'use client';
import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { recortarImagen } from '@/lib/imagenRecorte';
import { IconX, IconCheck } from '@/components/Icons';

type Props = {
  imagenUrl: string;
  onConfirmar: (blob: Blob) => void;
  onCancelar: () => void;
};

export default function RecortarImagen({ imagenUrl, onConfirmar, onCancelar }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [orientacion, setOrientacion] = useState(0); // 0 | 90 | 180 | 270, con los botones de girar
  const [ajusteFino, setAjusteFino] = useState(0); // -15..15, para enderezar la foto
  const rotacion = (orientacion + ajusteFino + 360) % 360;
  const [areaPixeles, setAreaPixeles] = useState<Area | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');

  const onCropComplete = useCallback((_area: Area, areaPx: Area) => setAreaPixeles(areaPx), []);

  const confirmar = async () => {
    if (!areaPixeles) return;
    setProcesando(true);
    setError('');
    try {
      const blob = await recortarImagen(imagenUrl, areaPixeles, rotacion);
      onConfirmar(blob);
    } catch {
      setError('No pudimos procesar la imagen. Intenta de nuevo.');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="text-sm font-semibold">Ajusta el documento</p>
        <button onClick={onCancelar} aria-label="Cancelar" className="p-1.5 rounded-lg hover:bg-white/10 transition">
          <IconX size={20} />
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        <Cropper
          image={imagenUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotacion}
          aspect={4 / 3}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <div className="bg-surface-2 px-5 py-4 space-y-3">
        <div>
          <label className="text-[11px] font-medium text-ink/60 block mb-1">Zoom</label>
          <input type="range" min={1} max={3} step={0.05} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="w-full accent-accent" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-ink/60 block mb-1">Enderezar (ajuste fino)</label>
          <input type="range" min={-15} max={15} step={0.5} value={ajusteFino}
            onChange={e => setAjusteFino(Number(e.target.value))}
            className="w-full accent-accent" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setOrientacion(o => (o - 90 + 360) % 360)}
            className="flex-1 text-xs font-semibold border border-border text-ink/70 py-2.5 rounded-xl hover:bg-surface transition">
            ↺ Girar 90°
          </button>
          <button onClick={() => setOrientacion(o => (o + 90) % 360)}
            className="flex-1 text-xs font-semibold border border-border text-ink/70 py-2.5 rounded-xl hover:bg-surface transition">
            ↻ Girar 90°
          </button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onCancelar} disabled={procesando}
            className="flex-1 text-sm font-semibold border border-border text-ink/70 py-2.5 rounded-xl hover:bg-surface transition disabled:opacity-60">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={procesando || !areaPixeles}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl transition disabled:opacity-60">
            <IconCheck size={15} /> {procesando ? 'Procesando…' : 'Usar esta foto'}
          </button>
        </div>
      </div>
    </div>
  );
}
