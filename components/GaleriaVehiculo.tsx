'use client';
// ── Galería pública de las fotos del vehículo ───────────────────────────────
//
// Es lo que ve un cliente cuando entra a mirar un carro para alquilarlo
// (`app/vehiculos/[id]`) o a cotizar un bus (`components/buses/CotizadorPublico`).
// Muestra las fotos que subió el propietario con crossfade + autoplay.
//
// Las fotos de la maqueta van con `object-cover`, o sea RECORTADAS y del tamaño de
// la columna: sirven para "ver el carro", no para mirar un detalle. Por eso tocar la
// foto abre `components/VisorFotos.tsx` a pantalla completa, donde la foto sale
// COMPLETA (`object-contain`) y con zoom. Se REUTILIZA ese visor —el mismo que usan
// Operaciones y el mensajero— con el botón de descarga apagado (`descargable={false}`):
// acá quien mira es un visitante anónimo.
//
// El visor se carga con `next/dynamic`: es código que solo hace falta si alguien
// toca una foto, y esta página se indexa en buscadores, así que no puede pesar en la
// carga inicial. La maqueta (next/image, `priority` en la primera, `sizes`) queda
// exactamente igual que antes.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { IconArrowL, IconArrowR, IconPhoto, IconSearch } from '@/components/Icons';
import { useLang } from '@/contexts/LanguageContext';
import type { FotoVisor } from '@/components/VisorFotos';

const VisorFotos = dynamic(() => import('@/components/VisorFotos'), { ssr: false });

const T = {
  es: {
    sinFotos: 'Sin fotos aún', anterior: 'Anterior', siguiente: 'Siguiente',
    foto: 'Foto', miniatura: 'Miniatura', ampliar: 'Ver la foto en grande', de: 'de',
  },
  en: {
    sinFotos: 'No photos yet', anterior: 'Previous', siguiente: 'Next',
    foto: 'Photo', miniatura: 'Thumbnail', ampliar: 'View photo full screen', de: 'of',
  },
};

// Galería de las fotos que sube el propietario, con transición (crossfade) + autoplay.
export default function GaleriaVehiculo({ fotos, titulo }: { fotos: string[]; titulo?: string }) {
  const { lang } = useLang();
  const c = T[lang];
  const [curRaw, setCur] = useState(0);
  // Visor a pantalla completa abierto/cerrado. Comparte el índice con la galería:
  // al cerrarlo, la maqueta se queda en la foto que el cliente estaba mirando.
  const [abierto, setAbierto] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // ¿El mouse está encima? El autoplay ya se pausaba al entrar, pero al CERRAR el
  // visor volvía a arrancar aunque el cursor siguiera sobre la foto (el mouseenter
  // no se vuelve a disparar). Con esto, `play()` respeta el último estado conocido.
  const encima = useRef(false);
  const n = fotos.length;
  // Se acota al leer, no con un efecto: si el padre cambia el juego de fotos (otro
  // bus en el cotizador) el índice viejo puede quedar fuera de rango, y corregirlo
  // con setState dentro de un efecto provoca un render en cascada de más.
  const cur = curRaw < n ? curRaw : 0;

  // Mientras el visor está abierto NO hay autoplay: la foto se cambiaría sola por
  // debajo de quien está mirando un detalle. Como `play` depende de `abierto`, el
  // efecto de abajo se vuelve a correr al abrir y apaga el intervalo — y el
  // `onMouseLeave` del contenedor (que dispara al taparlo el visor) tampoco lo revive.
  const play = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (n > 1 && !abierto && !encima.current) timer.current = setInterval(() => setCur(c => (c + 1) % n), 4000);
  }, [n, abierto]);
  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); }, []);
  const go = useCallback((i: number) => { setCur((i + n) % n); play(); }, [n, play]);

  useEffect(() => { play(); return stop; }, [play, stop]);

  // Lo que recibe el visor. `grupo` vacío: estas fotos no se dividen en conjuntos
  // como las de salida/entrada de un servicio, así que el encabezado muestra solo
  // "3 de 7". El `alt` va en el idioma de la página.
  const fotosVisor = useMemo<FotoVisor[]>(
    () => fotos.map((url, i) => ({ url, grupo: '', alt: `${c.foto} ${i + 1} ${c.de} ${n}` })),
    [fotos, c.foto, c.de, n],
  );

  if (n === 0) {
    return (
      <div className="aspect-[4/3] rounded-2xl border border-border bg-surface grid place-items-center text-ink/40">
        <div className="text-center">
          <IconPhoto size={40} className="mx-auto mb-2" />
          <p className="text-sm">{c.sinFotos}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="select-none"
      onMouseEnter={() => { encima.current = true; stop(); }}
      onMouseLeave={() => { encima.current = false; play(); }}>
      {/* Imagen principal con crossfade */}
      <div className="relative aspect-[4/3] rounded-2xl overflow-hidden border border-border bg-surface-2 group">
        {fotos.map((src, i) => (
          <Image key={src + i} src={src} alt={`${c.foto} ${i + 1}`} fill priority={i === 0}
            sizes="(max-width: 768px) 100vw, 448px"
            className="object-cover transition-opacity duration-[600ms] ease-out"
            style={{ opacity: i === cur ? 1 : 0 }} />
        ))}

        {/* Toda la foto es el botón para ampliarla. Va por DEBAJO de las flechas, los
            puntos y el contador (z-10), que siguen funcionando como antes. */}
        <button type="button" onClick={() => setAbierto(true)} aria-label={`${c.ampliar} — ${c.foto} ${cur + 1} ${c.de} ${n}`}
          className="absolute inset-0 z-[5] cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset">
          {/* Pista visible de que la foto se puede abrir: en celular no hay hover que
              lo insinúe y, sin esto, nadie la toca. */}
          <span aria-hidden="true"
            className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full grid place-items-center text-white bg-black/45 backdrop-blur-sm md:opacity-70 md:group-hover:opacity-100 transition">
            <IconSearch size={15} />
          </span>
        </button>

        {/* Contador */}
        <span className="absolute top-3 left-3 z-10 text-[11px] font-semibold text-white bg-black/45 backdrop-blur-sm px-2.5 py-1 rounded-full">
          {cur + 1} / {n}
        </span>

        {n > 1 && (
          <>
            {/* En celular las flechas van SIEMPRE visibles: no existe el hover, y con
                `opacity-0 group-hover:…` quedaban invisibles e intocables para la
                mayoría de los clientes. En escritorio se mantienen al pasar el mouse
                (o al enfocarlas con el teclado, que antes tampoco las mostraba). */}
            <button onClick={() => go(cur - 1)} aria-label={c.anterior}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full grid place-items-center text-white glass border border-border-strong opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition hover:bg-surface-3">
              <IconArrowL size={17} />
            </button>
            <button onClick={() => go(cur + 1)} aria-label={c.siguiente}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full grid place-items-center text-white glass border border-border-strong opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition hover:bg-surface-3">
              <IconArrowR size={17} />
            </button>
          </>
        )}

        {/* Dots. El punto mide 6 px de alto: el botón se estira a 24 px con relleno
            transparente para que se pueda acertar con el dedo sin mover el diseño. */}
        {n > 1 && (
          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
            {fotos.map((_, i) => (
              <button key={i} onClick={() => go(i)} aria-label={`${c.foto} ${i + 1}`}
                aria-current={i === cur ? 'true' : undefined}
                className="h-6 px-0.5 flex items-center group/dot">
                <span className={`block h-1.5 rounded-full transition-all ${i === cur ? 'w-5 bg-accent' : 'w-1.5 bg-white/50 group-hover/dot:bg-white/80'}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Miniaturas */}
      {n > 1 && (
        <div className="flex gap-2 mt-2.5 overflow-x-auto scrollbar-none pb-1">
          {fotos.map((src, i) => (
            <button key={src + i} onClick={() => go(i)} aria-label={`${c.miniatura} ${i + 1}`}
              aria-current={i === cur ? 'true' : undefined}
              className={`relative flex-none w-16 h-12 rounded-lg overflow-hidden border-2 transition ${i === cur ? 'border-accent' : 'border-border opacity-60 hover:opacity-100'}`}>
              <Image src={src} alt={`${c.miniatura} ${i + 1}`} fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Solo se monta (y solo se descarga su código) cuando el cliente abre una foto. */}
      {abierto && (
        <VisorFotos
          fotos={fotosVisor}
          indice={cur}
          onIndice={setCur}
          onCerrar={() => setAbierto(false)}
          titulo={titulo}
          descargable={false}
        />
      )}
    </div>
  );
}
