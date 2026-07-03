'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { IconKey, IconSearch, IconArrowR, IconArrowL, IconShield, IconCar } from '@/components/Icons';

type VehiculoVitrina = {
  id: number; marca: string; modelo: string; anio: number;
  tipo: string; precio_dia: number; fotos: string;
};

type Slide = {
  id: number | null; img: string | null; chip: string; h: string;
  price: { pre: string; strong: string; post: string };
  cta: string; href: string;
};

const HEADLINES = [
  'Estrena sin comprar',
  'Muévete a tu ritmo por Medellín',
  'Reserva en minutos, conduce libre',
  'Tu próximo viaje empieza aquí',
];

const FALLBACK_SLIDE: Slide = {
  id: null, img: null, chip: 'Alquiler entre particulares',
  h: 'Tu ciudad. Tu ritmo. Tu DrivePass.',
  price: { pre: 'Verificada y lista para entregar', strong: '', post: '' },
  cta: 'Buscar vehículo', href: '#vehiculos',
};

const DELAY = 5000;

function vehiculosASlides(vehiculos: VehiculoVitrina[]): Slide[] {
  return vehiculos
    .filter(v => {
      try { return (JSON.parse(v.fotos) as string[]).length > 0; } catch { return false; }
    })
    .map((v, i) => {
      let fotos: string[] = [];
      try { fotos = JSON.parse(v.fotos); } catch { fotos = []; }
      return {
        id: v.id,
        img: fotos[0],
        chip: `${v.tipo} · ${v.marca} ${v.modelo}`,
        h: HEADLINES[i % HEADLINES.length],
        price: { pre: 'Desde ', strong: `$${Math.round(v.precio_dia).toLocaleString('es-CO')}`, post: ' / día' },
        cta: 'Reservar ahora',
        href: `/vehiculos/${v.id}`,
      };
    });
}

export default function HeroSlider() {
  const [slides, setSlides] = useState<Slide[]>([FALLBACK_SLIDE]);
  const [cur, setCur] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/vehiculos?vitrina=1')
      .then(r => r.json())
      .then((d: { vehiculos?: VehiculoVitrina[] }) => {
        const s = vehiculosASlides(d.vehiculos || []);
        if (s.length > 0) setSlides(s);
      })
      .catch(() => { /* deja el fallback */ });
  }, []);

  const play = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (slides.length <= 1) return;
    timer.current = setInterval(() => setCur(c => (c + 1) % slides.length), DELAY);
  }, [slides.length]);
  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); }, []);

  const go = useCallback((n: number) => { setCur((n + slides.length) % slides.length); play(); }, [play, slides.length]);

  useEffect(() => { play(); return stop; }, [play, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(cur + 1);
      if (e.key === 'ArrowLeft') go(cur - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, go]);

  const s = slides[Math.min(cur, slides.length - 1)];

  return (
    <section className="hs relative overflow-hidden isolate" onMouseEnter={stop} onMouseLeave={play}>
      {/* Fondo decorativo (ya no es la foto estirada — evita el efecto pixelado) */}
      <div className="hs-bg" />

      <div className="relative mx-auto max-w-[1240px] px-4 sm:px-8 py-12 lg:py-20 flex flex-col lg:flex-row items-center gap-10 lg:gap-14">
        {/* Izquierda — texto fijo */}
        <div className="max-w-[520px] w-full">
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

        {/* Derecha — tarjeta de foto del vehículo en vitrina (tamaño acotado, buena calidad) */}
        <div className="w-full max-w-[480px] lg:max-w-[520px] flex-shrink-0 mx-auto lg:mx-0">
          <div className="relative w-full aspect-[4/3] rounded-[28px] overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.45)] border border-white/10">
            {slides.map((sl, i) => (
              sl.img ? (
                <Image
                  key={sl.id ?? i}
                  src={sl.img}
                  alt={sl.chip}
                  fill
                  quality={90}
                  sizes="(min-width: 1024px) 520px, 92vw"
                  priority={i === 0}
                  className={`hs-frame-img${i === cur ? ' is-active' : ''}`}
                />
              ) : (
                <div key={sl.id ?? i}
                  className={`hs-frame-img${i === cur ? ' is-active' : ''}`}
                  style={{ background: 'var(--gradient-accent)' }} />
              )
            ))}

            {/* Badges de confianza — sobre el borde inferior de la tarjeta */}
            <div className="hidden sm:flex absolute left-3 bottom-3 items-center gap-2.5 px-3.5 py-2.5 rounded-xl glass border border-border-strong">
              <span className="w-8 h-8 rounded-lg grid place-items-center bg-accent/15 text-accent flex-none"><IconShield size={16} /></span>
              <div><div className="font-bold text-xs text-white leading-tight whitespace-nowrap">Pagos Seguros</div><div className="text-[10px] text-ink-soft whitespace-nowrap">Garantía DrivePass</div></div>
            </div>
            <div className="hidden sm:flex absolute right-3 top-3 items-center gap-2 px-3 py-2 rounded-xl glass border border-border-strong">
              <IconCar size={14} className="text-accent" />
              <span className="font-bold text-[11px] text-white whitespace-nowrap">100% Verificados</span>
            </div>
          </div>

          {/* Caption rotativo — debajo de la tarjeta, siempre legible */}
          <div key={cur} className="mt-4 flex items-end justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <span className="fade-up inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-ink px-3 py-1.5 rounded-full bg-brand-muted border border-border capitalize">
                <i className="w-1.5 h-1.5 rounded-full bg-accent inline-block" /> {s.chip}
              </span>
              <h2 className="fade-up font-bold text-ink mt-2.5 leading-tight tracking-[-0.01em] text-xl"
                style={{ animationDelay: '50ms' }}>
                {s.h}
              </h2>
              <div className="fade-up font-mono text-sm text-ink-soft mt-1" style={{ animationDelay: '95ms', fontFeatureSettings: "'tnum' 1" }}>
                {s.price.pre}{s.price.strong && <b className="text-accent font-semibold">{s.price.strong}</b>}{s.price.post}
              </div>
            </div>
            <Link href={s.href}
              className="fade-up glow-accent inline-flex flex-shrink-0 items-center gap-2 text-white font-semibold rounded-xl px-4 h-10 text-sm transition hover:-translate-y-0.5"
              style={{ background: 'var(--gradient-accent)', animationDelay: '140ms' }}>
              {s.cta} <IconArrowR size={17} />
            </Link>
          </div>

          {/* Controles */}
          {slides.length > 1 && (
            <div className="mt-4 flex items-center gap-3.5">
              <button onClick={() => go(cur - 1)} aria-label="Anterior"
                className="w-9 h-9 rounded-full grid place-items-center text-ink bg-surface-2 border border-border transition hover:bg-surface-3 flex-shrink-0">
                <IconArrowL size={16} />
              </button>
              <div className="flex gap-2">
                {slides.map((_, i) => (
                  <button key={i} onClick={() => go(i)} aria-label={`Ir al slide ${i + 1}`}
                    className="relative w-[26px] h-[5px] rounded-full overflow-hidden p-0 border-0 cursor-pointer bg-border">
                    {i === cur && <span key={cur} className="hs-dotbar" />}
                  </button>
                ))}
              </div>
              <button onClick={() => go(cur + 1)} aria-label="Siguiente"
                className="w-9 h-9 rounded-full grid place-items-center text-ink bg-surface-2 border border-border transition hover:bg-surface-3 flex-shrink-0">
                <IconArrowR size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
