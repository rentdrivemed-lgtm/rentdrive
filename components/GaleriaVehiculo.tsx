'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { IconArrowL, IconArrowR, IconPhoto } from '@/components/Icons';

// Galería de las fotos que sube el propietario, con transición (crossfade) + autoplay.
export default function GaleriaVehiculo({ fotos }: { fotos: string[] }) {
  const [cur, setCur] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const n = fotos.length;

  const play = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (n > 1) timer.current = setInterval(() => setCur(c => (c + 1) % n), 4000);
  }, [n]);
  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); }, []);
  const go = useCallback((i: number) => { setCur((i + n) % n); play(); }, [n, play]);

  useEffect(() => { play(); return stop; }, [play, stop]);

  if (n === 0) {
    return (
      <div className="aspect-[4/3] rounded-2xl border border-border bg-surface grid place-items-center text-ink/30">
        <div className="text-center">
          <IconPhoto size={40} className="mx-auto mb-2" />
          <p className="text-sm">Sin fotos aún</p>
        </div>
      </div>
    );
  }

  return (
    <div className="select-none" onMouseEnter={stop} onMouseLeave={play}>
      {/* Imagen principal con crossfade */}
      <div className="relative aspect-[4/3] rounded-2xl overflow-hidden border border-border bg-surface-2 group">
        {fotos.map((src, i) => (
          <img key={src + i} src={src} alt={`Foto ${i + 1}`}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[600ms] ease-out"
            style={{ opacity: i === cur ? 1 : 0 }} />
        ))}

        {/* Contador */}
        <span className="absolute top-3 left-3 z-10 text-[11px] font-semibold text-white bg-black/45 backdrop-blur-sm px-2.5 py-1 rounded-full">
          {cur + 1} / {n}
        </span>

        {n > 1 && (
          <>
            <button onClick={() => go(cur - 1)} aria-label="Anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full grid place-items-center text-white glass border border-border-strong opacity-0 group-hover:opacity-100 transition hover:bg-surface-3">
              <IconArrowL size={17} />
            </button>
            <button onClick={() => go(cur + 1)} aria-label="Siguiente"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full grid place-items-center text-white glass border border-border-strong opacity-0 group-hover:opacity-100 transition hover:bg-surface-3">
              <IconArrowR size={17} />
            </button>
          </>
        )}

        {/* Dots */}
        {n > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
            {fotos.map((_, i) => (
              <button key={i} onClick={() => go(i)} aria-label={`Foto ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === cur ? 'w-5 bg-accent' : 'w-1.5 bg-white/50 hover:bg-white/80'}`} />
            ))}
          </div>
        )}
      </div>

      {/* Miniaturas */}
      {n > 1 && (
        <div className="flex gap-2 mt-2.5 overflow-x-auto scrollbar-none pb-1">
          {fotos.map((src, i) => (
            <button key={src + i} onClick={() => go(i)}
              className={`relative flex-none w-16 h-12 rounded-lg overflow-hidden border-2 transition ${i === cur ? 'border-accent' : 'border-border opacity-60 hover:opacity-100'}`}>
              <img src={src} alt={`Miniatura ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
