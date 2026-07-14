'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { IconKey, IconSearch, IconArrowR } from '@/components/Icons';

// Hero a sangre completa (template "Landing DrivePass" del Design System):
// la foto del vehículo es el fondo, con un degradado oscuro a la izquierda para
// que el titular fijo de marca sea legible. Rota entre las fotos de la vitrina.
type VehiculoVitrina = { id: number; fotos: string };

const DELAY = 6000;

export default function HeroSlider() {
  const [fotos, setFotos] = useState<string[]>([]);
  const [cur, setCur] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/vehiculos?vitrina=1')
      .then(r => r.json())
      .then((d: { vehiculos?: VehiculoVitrina[] }) => {
        const imgs = (d.vehiculos || [])
          .map(v => { try { return (JSON.parse(v.fotos) as string[])[0]; } catch { return null; } })
          .filter((x): x is string => !!x);
        if (imgs.length) setFotos(imgs);
      })
      .catch(() => { /* deja el fondo con gradiente */ });
  }, []);

  useEffect(() => {
    if (fotos.length <= 1) return;
    timer.current = setInterval(() => setCur(c => (c + 1) % fotos.length), DELAY);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [fotos.length]);

  return (
    <section className="relative overflow-hidden isolate flex items-center min-h-[540px] sm:min-h-[600px]">
      {/* Fondo: fotos rotativas de la vitrina, o gradiente decorativo si no hay */}
      {fotos.length === 0 && <div className="hs-bg" style={{ zIndex: -20 }} />}
      {fotos.map((img, i) => (
        <div key={i}
          className={`hs-frame-bg${i === cur ? ' is-active' : ''}`}
          style={{ backgroundImage: `url(${img})`, backgroundPosition: 'right center' }} />
      ))}

      {/* Degradado: oscuro a la izquierda → transparente a la derecha + base inferior */}
      <div className="absolute inset-0" style={{
        zIndex: -10,
        background:
          'linear-gradient(90deg,#0A1422 0%,#0A1422 18%,rgba(10,20,34,0.78) 38%,rgba(10,20,34,0.30) 58%,rgba(10,20,34,0) 72%),' +
          'linear-gradient(0deg,rgba(8,15,26,0.65) 0%,rgba(8,15,26,0) 42%)',
      }} />

      <div className="relative w-full mx-auto max-w-[1240px] px-5 sm:px-10 py-14">
        <div className="max-w-[540px]">
          <span className="inline-flex items-center gap-2 text-accent font-semibold text-sm px-4 py-2 rounded-full border border-accent/40 bg-accent/10 backdrop-blur-sm">
            <IconKey size={15} /> Alquiler entre particulares
          </span>
          <h1 className="font-black text-ink leading-[1.04] tracking-[-0.03em] mt-5 mb-4"
            style={{ fontSize: 'clamp(36px, 5.5vw, 60px)' }}>
            Tu ciudad.<br />Tu ritmo.<br /><span className="text-accent">Tu DrivePass.</span>
          </h1>
          <p className="text-ink-soft text-lg leading-relaxed max-w-[32ch]">
            Conectamos propietarios y alquiladores en Medellín de forma simple, segura y transparente.
          </p>
          <div className="flex flex-wrap gap-3.5 mt-8">
            <a href="#vehiculos"
              className="glow-accent inline-flex items-center justify-center gap-2 text-white font-semibold rounded-xl px-6 h-[54px] text-base transition hover:-translate-y-0.5"
              style={{ background: 'var(--gradient-accent)' }}>
              <IconSearch size={20} /> Buscar vehículo
            </a>
            <Link href="/registro?rol=propietario"
              className="inline-flex items-center justify-center gap-2 text-ink font-semibold rounded-xl px-6 h-[54px] text-base border border-border-strong bg-surface-2/60 backdrop-blur-sm transition hover:bg-surface-3">
              Publicar mi carro <IconArrowR size={20} />
            </Link>
          </div>
        </div>
      </div>

      {/* Indicadores del slider */}
      {fotos.length > 1 && (
        <div className="absolute bottom-5 left-5 sm:left-10 flex gap-2">
          {fotos.map((_, i) => (
            <button key={i} onClick={() => setCur(i)} aria-label={`Ver foto ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === cur ? 'w-7 bg-accent' : 'w-3 bg-white/30 hover:bg-white/50'}`} />
          ))}
        </div>
      )}
    </section>
  );
}
