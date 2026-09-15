'use client';
// ── Visor de fotos a pantalla completa ──────────────────────────────────────
//
// COMPARTIDO por todas las pantallas que necesitan ver una foto en grande:
//   · el panel de Operaciones del admin (`components/OperacionesPanel.tsx`),
//   · la pantalla del mensajero sin login (`app/m/[token]/page.tsx`),
//   · los documentos del panel (`components/DocumentoVista.tsx`),
//   · y la galería PÚBLICA del vehículo (`components/GaleriaVehiculo.tsx`), que es
//     la que ve un cliente cuando mira un carro para alquilarlo.
// Si hay que cambiar el comportamiento del visor, se cambia acá y sirve para todas.
//
// ⚠️ Desde que lo usa la galería pública, este visor lo abre gente SIN LOGIN. Nada
// de lo que se agregue acá puede asumir que quien mira es del equipo: lo que sea
// interno va detrás de una opción apagada por defecto para el público (hoy,
// `descargable`).
//
// Por qué existe: las miniaturas usan `object-cover`, o sea que RECORTAN la foto.
// Un empleado que necesita ver un rayón no puede decidir sobre un cuadrito
// recortado. Acá la foto se muestra COMPLETA (`object-contain`) y con zoom.
//
// A propósito NO tiene botón de eliminar: borrar una foto a pantalla completa,
// de un toque, es demasiado fácil de hacer por error. Eliminar sigue siendo el
// botón × de la miniatura.
//
// Módulo de cliente puro: solo importa `lib/cloudinary-descarga` (módulo puro,
// sin fs/better-sqlite3) y los iconos.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconX, IconArrowL, IconArrowR, IconExport } from '@/components/Icons';
import { urlDescarga } from '@/lib/cloudinary-descarga';
import { esUrlFotoSegura } from '@/lib/fotos-servicio';

/**
 * Una foto del visor.
 *  · `grupo`: etiqueta visible del conjunto al que pertenece ("SALIDA" / "ENTRADA").
 *    Puede ir VACÍA cuando las fotos no se agrupan —la galería pública de un
 *    vehículo son "las fotos del carro", sin más— y entonces el encabezado muestra
 *    solo la posición ("3 de 7") en vez de " 3 de 7" con un hueco delante.
 *  · `alt`: texto alternativo propio. Sobrescribe el que se arma con el grupo, que
 *    fuera del panel de operaciones no describe nada ("foto de foto 3 de 7").
 */
export type FotoVisor = { url: string; grupo: string; alt?: string };

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASO = 0.5;
const ZOOM_CLIC = 2;      // a cuánto salta el zoom al hacer clic sobre la foto
const UMBRAL_DESLIZ = 50; // px de arrastre horizontal para cambiar de foto en móvil

type Props = {
  fotos: FotoVisor[];
  /** Índice dentro de `fotos` que se está viendo. */
  indice: number;
  /** El padre es el dueño del índice (para poder abrir el visor desde cualquier miniatura). */
  onIndice: (i: number) => void;
  onCerrar: () => void;
  /** Encabezado opcional: vehículo/placa del servicio, para saber qué se está mirando. */
  titulo?: string;
  /**
   * ¿Se ofrece el botón de descargar la foto? Por defecto SÍ, que es lo que
   * necesitan los paneles internos (el admin se lleva la foto de un rayón como
   * respaldo).
   *
   * La galería pública del vehículo lo apaga: ahí el visor lo abre un visitante
   * ANÓNIMO, y ese botón es un enlace directo a la URL cruda del CDN — nada que
   * ofrecerle a quien solo está mirando un carro para alquilarlo.
   */
  descargable?: boolean;
};

// Gesto táctil en curso. Se guarda en un ref (no en estado) porque cambia en cada
// `touchmove` y no debe provocar re-render por sí mismo.
type Gesto = {
  modo: 'ninguno' | 'arrastre' | 'pellizco';
  x0: number; y0: number;
  offset0: { x: number; y: number };
  dist0: number;
  zoom0: number;
};

const GESTO_INICIAL: Gesto = { modo: 'ninguno', x0: 0, y0: 0, offset0: { x: 0, y: 0 }, dist0: 0, zoom0: 1 };

function distanciaEntre(t1: React.Touch, t2: React.Touch): number {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function acotar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export default function VisorFotos({ fotos, indice, onIndice, onCerrar, titulo, descargable = true }: Props) {
  const total = fotos.length;
  const actual: FotoVisor | undefined = fotos[indice];
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Mientras hay un dedo encima NO se anima la transformación: con la transición
  // puesta, la foto va por detrás de los dedos al pellizcar y se siente rota.
  const [gestoActivo, setGestoActivo] = useState(false);
  const contRef = useRef<HTMLDivElement>(null);
  const gesto = useRef<Gesto>(GESTO_INICIAL);

  // "SALIDA 2 de 4": posición DENTRO de su grupo, no dentro de la lista completa
  // (la lista junta salida + entrada para poder navegarlas todas sin cerrar).
  const posicion = useMemo(() => {
    if (!actual) return { pos: 0, total: 0 };
    let pos = 0;
    let tot = 0;
    fotos.forEach((f, i) => {
      if (f.grupo !== actual.grupo) return;
      tot++;
      if (i <= indice) pos++;
    });
    return { pos, total: tot };
  }, [fotos, indice, actual]);

  const reiniciarZoom = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const irA = useCallback((i: number) => {
    if (total === 0) return;
    reiniciarZoom();
    onIndice(((i % total) + total) % total);
  }, [total, onIndice, reiniciarZoom]);

  const mover = useCallback((delta: number) => irA(indice + delta), [irA, indice]);

  const cambiarZoom = useCallback((delta: number) => {
    setZoom(z => {
      const nuevo = acotar(z + delta, ZOOM_MIN, ZOOM_MAX);
      if (nuevo === ZOOM_MIN) setOffset({ x: 0, y: 0 });
      return nuevo;
    });
  }, []);

  // Bloquea el scroll del fondo, pone el foco dentro del visor y lo devuelve al
  // elemento que lo abrió (la miniatura) al cerrar.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    contRef.current?.focus();
    return () => {
      document.body.style.overflow = overflowPrevio;
      if (previo && typeof previo.focus === 'function') previo.focus();
    };
  }, []);

  // Atajos de teclado a nivel de ventana: Esc para cerrar, flechas para pasar de
  // foto, + / − para el zoom y 0 para volver al tamaño normal. Va en la ventana y
  // no en el div para que funcionen aunque el foco esté en cualquier botón del visor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCerrar(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); mover(1); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); cambiarZoom(ZOOM_PASO); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); cambiarZoom(-ZOOM_PASO); return; }
      if (e.key === '0') { e.preventDefault(); reiniciarZoom(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar, mover, cambiarZoom, reiniciarZoom]);

  // Foco ATRAPADO dentro del visor: mientras está abierto, Tab/Shift+Tab solo
  // recorren sus propios botones y nunca se escapan al contenido de atrás.
  const enTeclado = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;

    const enfocables = Array.from(
      contRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
    );
    if (enfocables.length === 0) { e.preventDefault(); return; }
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (activo === primero || activo === contRef.current)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  // ── Gestos táctiles ───────────────────────────────────────────────────────
  // El contenedor de la foto lleva `touch-action: none`, así que el navegador no
  // se queda con el gesto y estos handlers pueden implementar los tres a la vez:
  // pellizco para acercar, arrastre para mover la foto acercada y deslizar para
  // pasar a la siguiente cuando está en tamaño normal.
  const enTouchStart = (e: React.TouchEvent) => {
    setGestoActivo(true);
    if (e.touches.length === 2) {
      gesto.current = {
        modo: 'pellizco',
        x0: 0, y0: 0,
        offset0: offset,
        dist0: distanciaEntre(e.touches[0], e.touches[1]) || 1,
        zoom0: zoom,
      };
      return;
    }
    if (e.touches.length === 1) {
      gesto.current = {
        modo: 'arrastre',
        x0: e.touches[0].clientX,
        y0: e.touches[0].clientY,
        offset0: offset,
        dist0: 0,
        zoom0: zoom,
      };
    }
  };

  const enTouchMove = (e: React.TouchEvent) => {
    const g = gesto.current;
    if (g.modo === 'pellizco' && e.touches.length === 2) {
      const d = distanciaEntre(e.touches[0], e.touches[1]);
      setZoom(acotar((g.zoom0 * d) / g.dist0, ZOOM_MIN, ZOOM_MAX));
      return;
    }
    if (g.modo === 'arrastre' && e.touches.length === 1 && zoom > 1) {
      setOffset({
        x: g.offset0.x + (e.touches[0].clientX - g.x0),
        y: g.offset0.y + (e.touches[0].clientY - g.y0),
      });
    }
  };

  const enTouchEnd = (e: React.TouchEvent) => {
    setGestoActivo(false);
    const g = gesto.current;
    gesto.current = GESTO_INICIAL;
    if (g.modo === 'pellizco') {
      if (zoom <= ZOOM_MIN) setOffset({ x: 0, y: 0 });
      return;
    }
    // Deslizar para cambiar de foto: solo con la foto en tamaño normal (si está
    // acercada, arrastrar sirve para mirar otra parte de la foto, no para pasar).
    if (g.modo !== 'arrastre' || zoom > 1) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (Math.abs(dx) > UMBRAL_DESLIZ && Math.abs(dx) > Math.abs(dy)) mover(dx < 0 ? 1 : -1);
  };

  if (!actual) return null;

  const grupo = actual.grupo.trim();
  const etiqueta = grupo
    ? `${grupo} ${posicion.pos} de ${posicion.total}`
    : `${posicion.pos} de ${posicion.total}`;
  const alt = actual.alt
    ?? (grupo
      ? `Foto de ${grupo.toLowerCase()} ${posicion.pos} de ${posicion.total}`
      : `Foto ${posicion.pos} de ${posicion.total}`);

  // La URL de la foto se valida al GUARDARLA (`esUrlFotoSegura`, lib/fotos-servicio),
  // pero las que ya están en la base se escribieron antes de esa validación — y una de
  // las pantallas que las escribe (/m/<token>) no tiene login. En el `<img>` una URL
  // rara es inerte; en el `href` del botón de descarga, un `javascript:` guardado se
  // ejecutaría en la sesión de quien hace clic, que acá es siempre un administrador.
  // Por eso el botón se deshabilita cuando la dirección no es de fiar. La FOTO se
  // sigue mostrando: esconderla sería ocultarle al equipo el respaldo de un servicio
  // real.
  const descarga = descargable && esUrlFotoSegura(actual.url) ? urlDescarga(actual.url) : undefined;

  return (
    <div
      ref={contRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Visor de fotos${titulo ? ` — ${titulo}` : ''}`}
      tabIndex={-1}
      onKeyDown={enTeclado}
      onClick={onCerrar}
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col outline-none">

      {/* Encabezado: en qué foto va + acciones */}
      <div onClick={e => e.stopPropagation()} className="shrink-0 flex items-center gap-2 px-3 py-2.5 text-white">
        <div className="min-w-0">
          <p aria-live="polite" className="text-sm font-bold truncate">{etiqueta}</p>
          {titulo && <p className="text-[11px] text-white/60 truncate">{titulo}</p>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => cambiarZoom(-ZOOM_PASO)}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Alejar la foto"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-lg leading-none disabled:opacity-30 transition">−</button>
          <button
            type="button"
            onClick={reiniciarZoom}
            disabled={zoom === ZOOM_MIN && offset.x === 0 && offset.y === 0}
            aria-label="Volver la foto a su tamaño normal"
            title="Volver la foto a su tamaño normal"
            className="text-[11px] text-white/70 hover:text-white tabular-nums w-11 text-center rounded-md py-1 disabled:opacity-40 transition">
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => cambiarZoom(ZOOM_PASO)}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Acercar la foto"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-lg leading-none disabled:opacity-30 transition">+</button>
          {descargable && (descarga ? (
            <a
              href={descarga}
              download
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Descargar esta foto"
              title="Descargar esta foto"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center transition">
              <IconExport size={17} />
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-label="Esta foto no se puede descargar"
              title="Esta foto quedó guardada con una dirección que no reconocemos, así que no se puede descargar desde aquí."
              className="w-9 h-9 rounded-full bg-white/10 grid place-items-center opacity-30 cursor-not-allowed">
              <IconExport size={17} />
            </button>
          ))}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar el visor de fotos"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center transition">
            <IconX size={18} />
          </button>
        </div>
      </div>

      {/* Escenario: la foto COMPLETA (nunca recortada) + flechas */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {total > 1 && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); mover(-1); }}
            aria-label="Foto anterior"
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition">
            <IconArrowL size={20} />
          </button>
        )}

        <div
          /* Solo frena el cierre si el toque fue SOBRE la foto: el negro que queda
             alrededor (la foto va con object-contain, nunca recortada) es fondo y
             tocarlo cierra el visor, como se espera de un visor a pantalla completa. */
          onClick={e => { if (e.target !== e.currentTarget) e.stopPropagation(); }}
          onTouchStart={enTouchStart}
          onTouchMove={enTouchMove}
          onTouchEnd={enTouchEnd}
          style={{ touchAction: 'none' }}
          className="w-full h-full flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={actual.url}
            alt={alt}
            draggable={false}
            onClick={() => (zoom > 1 ? reiniciarZoom() : setZoom(ZOOM_CLIC))}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transition: gestoActivo ? 'none' : 'transform 150ms ease-out',
            }}
            className={`max-w-full max-h-full object-contain select-none ${zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'}`} />
        </div>

        {total > 1 && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); mover(1); }}
            aria-label="Foto siguiente"
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition">
            <IconArrowR size={20} />
          </button>
        )}
      </div>

      {/* Tira de miniaturas: ir directo a cualquier foto del servicio */}
      {total > 1 && (
        <div onClick={e => e.stopPropagation()} className="shrink-0 flex gap-1.5 overflow-x-auto px-3 py-2.5">
          {fotos.map((f, i) => (
            <button
              key={`${f.url}-${i}`}
              type="button"
              onClick={() => irA(i)}
              aria-label={f.alt
                ? `Ver ${f.alt}`
                : f.grupo.trim()
                  ? `Ver foto de ${f.grupo.trim().toLowerCase()} número ${i + 1}`
                  : `Ver foto número ${i + 1}`}
              aria-current={i === indice ? 'true' : undefined}
              className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition ${i === indice ? 'border-accent' : 'border-white/20 opacity-60 hover:opacity-100'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <p className="shrink-0 text-center text-[10px] text-white/40 pb-2 px-3">
        Toca el fondo o presiona Esc para cerrar · flechas ← → para pasar de foto · toca la foto para acercar
      </p>
    </div>
  );
}
