'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { IconKey, IconSearch, IconArrowR, IconArrowL, IconShield, IconCar } from '@/components/Icons';

type Slide = {
  img: string; chip: string; h: string;
  price: { pre: string; strong: string; post: string };
  cta: string;
};

// Banner inicial diseñado en Claude Design (full-bleed, copy rotativo).
const SLIDES: Slide[] = [
  { img: '/hero/wide1.jpg', chip: 'SUV · Hyundai Tucson',  h: 'Estrena una SUV sin comprarla',        price: { pre: 'Desde ', strong: '$180.000', post: ' / día' }, cta: 'Reservar ahora' },
  { img: '/hero/wide2.jpg', chip: 'SUV · Mazda CX-5',      h: 'Comodidad premium para tu viaje',       price: { pre: 'Desde ', strong: '$210.000', post: ' / día' }, cta: 'Ver disponibles' },
  { img: '/hero/wide3.jpg', chip: 'Sedán · Mazda 3',       h: 'Muévete ágil por Medellín',             price: { pre: 'Desde ', strong: '$120.000', post: ' / día' }, cta: 'Explorar sedanes' },
  { img: '/hero/wide4.jpg', chip: 'SUV · Hyundai Tucson',  h: 'Reserva en minutos, conduce libre',     price: { pre: 'Verificada y lista para entregar', strong: '', post: '' }, cta: 'Buscar vehículo' },
];
const DELAY = 5000;

export default function HeroSlider() {
  const [cur, setCur] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const play = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setCur(c => (c + 1) % SLIDES.length), DELAY);
  }, []);
  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); }, []);

  const go = useCallback((n: number) => { setCur((n + SLIDES.length) % SLIDES.length); play(); }, [play]);

  useEffect(() => { play(); return stop; }, [play, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(cur + 1);
      if (e.key === 'ArrowLeft') go(cur - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, go]);

  const s = SLIDES[cur];

  return (
    <section
      className="hs relative overflow-hidden bg-bg isolate"
      style={{ minHeight: 'clamp(540px, 68vh, 700px)' }}
      onMouseEnter={stop}
      onMouseLeave={play}
    >
      {/* Fondo: slider de imágenes */}
      <div className="absolute inset-0 -z-20">
        {SLIDES.map((sl, i) => (
          <div
            key={sl.img}
            className={`hs-bgslide${i === cur ? ' is-active' : ''}`}
            style={{ backgroundImage: `url(${sl.img})` }}
          />
        ))}
      </div>
      <div className="hs-scrim" />

      {/* Contenido */}
      <div className="relative mx-auto flex min-h-[inherit] max-w-[1240px] items-center px-4 sm:px-8 py-10">
        {/* Izquierda — texto fijo */}
        <div className="max-w-[520px]">
          <span className="inline-flex items-center gap-2 text-accent font-semibold text-sm px-4 py-2 rounded-full border border-accent/40 bg-accent/10 backdrop-blur-sm">
            <IconKey size={15} /> Alquiler entre particulares
          </span>
          <h1 className="font-black text-ink leading-[1.04] tracking-[-0.03em] mt-5 mb-4"
            style={{ fontSize: 'clamp(38px, 5vw, 60px)' }}>
            Tu ciudad.<br />Tu ritmo.<br /><span className="text-accent">Tu DrivePass.</span>
          </h1>
          <p className="text-ink-soft text-lg leading-relaxed max-w-[30ch]">
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

        {/* Derecha — caption rotativo (desktop) */}
        <div key={cur} className="hidden lg:block absolute right-8 bottom-[52px] max-w-[360px] text-right z-[3]">
          <span className="fade-up inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-ink px-3 py-1.5 rounded-full glass border border-border-strong">
            <i className="w-1.5 h-1.5 rounded-full bg-accent inline-block" /> {s.chip}
          </span>
          <h2 className="fade-up font-bold text-white mt-3.5 mb-2 leading-tight tracking-[-0.01em]"
            style={{ fontSize: 'clamp(22px, 2.4vw, 30px)', textShadow: '0 2px 22px rgba(0,0,0,0.6)', animationDelay: '50ms' }}>
            {s.h}
          </h2>
          <div className="fade-up font-mono text-sm text-ink-soft" style={{ animationDelay: '95ms', fontFeatureSettings: "'tnum' 1" }}>
            {s.price.pre}{s.price.strong && <b className="text-accent font-semibold">{s.price.strong}</b>}{s.price.post}
          </div>
          <a href="#vehiculos"
            className="fade-up glow-accent inline-flex items-center gap-2 text-white font-semibold rounded-xl px-4 h-10 text-sm mt-4 transition hover:-translate-y-0.5"
            style={{ background: 'var(--gradient-accent)', animationDelay: '140ms' }}>
            {s.cta} <IconArrowR size={17} />
          </a>
        </div>

        {/* Badges de confianza flotantes (desktop) */}
        <div className="hidden lg:flex absolute top-[92px] right-8 z-[4] items-center gap-3 px-4 py-3 rounded-xl glass border border-border-strong"
          style={{ boxShadow: 'var(--shadow-float)' }}>
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-accent/15 text-accent flex-none"><IconShield size={18} /></span>
          <div><div className="font-bold text-sm text-white leading-tight whitespace-nowrap">Pagos Seguros</div><div className="text-xs text-ink-soft whitespace-nowrap">Garantía DrivePass</div></div>
        </div>
        <div className="hidden lg:flex absolute top-[176px] right-[calc(2rem+26px)] z-[4] items-center gap-3 px-4 py-3 rounded-xl glass border border-border-strong"
          style={{ boxShadow: 'var(--shadow-float)' }}>
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-accent/15 text-accent flex-none"><IconCar size={18} /></span>
          <div><div className="font-bold text-sm text-white leading-tight whitespace-nowrap">100% Verificados</div><div className="text-xs text-ink-soft whitespace-nowrap">Vehículos con fotos</div></div>
        </div>
      </div>

      {/* Controles */}
      <div className="absolute left-4 sm:left-8 bottom-10 z-[5] flex items-center gap-3.5">
        <button onClick={() => go(cur - 1)} aria-label="Anterior"
          className="w-[42px] h-[42px] rounded-full grid place-items-center text-white glass border border-border-strong transition hover:bg-surface-3">
          <IconArrowL size={20} />
        </button>
        <div className="flex gap-2">
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => go(i)} aria-label={`Ir al slide ${i + 1}`}
              className="relative w-[26px] h-[5px] rounded-full overflow-hidden p-0 border-0 cursor-pointer"
              style={{ background: i === cur ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.28)' }}>
              {i === cur && <span key={cur} className="hs-dotbar" />}
            </button>
          ))}
        </div>
        <button onClick={() => go(cur + 1)} aria-label="Siguiente"
          className="w-[42px] h-[42px] rounded-full grid place-items-center text-white glass border border-border-strong transition hover:bg-surface-3">
          <IconArrowR size={20} />
        </button>
      </div>
    </section>
  );
}
