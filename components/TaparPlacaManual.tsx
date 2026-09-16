'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconCheck, IconX } from '@/components/Icons';
import {
  MAX_ZONAS,
  MIN_LADO_FRAC,
  prepararZonas,
  validarZonas,
  type ZonaPlaca,
} from '@/lib/tapar-placa';

// ── Tapar la placa a mano ───────────────────────────────────────────────────
//
// Red de seguridad para cuando la detección automática no tapa la placa (o tapa donde no
// es): la persona marca con el dedo o el mouse un rectángulo sobre CADA placa visible y el
// servidor (app/api/admin/tapar-placa) estampa encima el sello opaco de marca DrivePass.
//
// SOLO importa módulos puros (lib/tapar-placa.ts). La geometría final —incluido el ajuste
// a proporción de placa 2:1— la calcula `prepararZonas`, la MISMA función que usa el
// servidor: si acá se calculara aparte, la vista previa mentiría.
//
// Un dedo y un mouse se manejan con el MISMO código (Pointer Events + `touch-action:none`):
// el editor se usa tanto desde el escritorio como desde el celular, que es donde el dueño
// y la secretaria revisan las fotos la mayor parte del tiempo.

type Props = {
  vehiculoId: number;
  /** Foto tal como está publicada hoy (es la que se va a reemplazar). */
  url: string;
  /** Imagen sobre la que se marca: la ORIGINAL, sin tapados previos. */
  origenUrl: string;
  titulo: string;
  onCerrar: () => void;
  /** `aviso` llega solo en el caso raro de que la foto ya no estuviera en la publicación. */
  onGuardado: (nuevaUrl: string, aviso?: string) => void;
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

type Gesto =
  | { tipo: 'dibujar'; x0: number; y0: number }
  | { tipo: 'mover'; i: number; dx: number; dy: number }
  | { tipo: 'redim'; i: number; anclaX: number; anclaY: number }
  | { tipo: 'pan'; sx: number; sy: number; px: number; py: number }
  | { tipo: 'pellizco'; d0: number; z0: number }
  | null;

type Esquina = 'nw' | 'ne' | 'se' | 'sw';
const ESQUINAS: Esquina[] = ['nw', 'ne', 'se', 'sw'];

function recortar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Sello de marca tal como se va a estampar, dibujado con CSS.
 *
 * Es un ESPEJO de `generarRectanguloMarca` (lib/blur-placas.ts, que es quien lo genera de
 * verdad del lado del servidor): mismos colores, mismo radio (18% del lado más chico),
 * mismo borde (6%) y mismo ícono al 60%. Sirve solo para la vista previa — la imagen final
 * siempre la produce el servidor.
 */
function Sello({ anchoPx, altoPx, opacidad }: { anchoPx: number; altoPx: number; opacidad: number }) {
  const min = Math.max(1, Math.min(anchoPx, altoPx));
  const radio = Math.max(4, min * 0.18);
  const borde = Math.max(2, min * 0.06);
  const icono = min * 0.6;
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background: '#1B3356',
        border: `${borde}px solid #F25C2B`,
        borderRadius: radio,
        boxSizing: 'border-box',
        opacity: opacidad,
      }}
    >
      {/* Mismos paths que public/brand/logo-mark.svg SIN el fondo navy (ese fondo ya lo pone
          el propio sello), igual que en lib/blur-placas.ts. */}
      <svg width={icono} height={icono} viewBox="0 0 96 96" aria-hidden="true">
        <path d="M26 38 H63" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round" />
        <polyline points="55,29 66,38 55,47" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M70 58 H33" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round" />
        <polyline points="41,49 30,58 41,67" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function TaparPlacaManual({ vehiculoId, url, origenUrl, titulo, onCerrar, onGuardado }: Props) {
  const [zonas, setZonas] = useState<ZonaPlaca[]>([]);
  const [borrador, setBorrador] = useState<ZonaPlaca | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [modo, setModo] = useState<'marcar' | 'mover'>('marcar');
  const [previa, setPrevia] = useState(false);
  const [proporcionPlaca, setProporcionPlaca] = useState(true);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [caja, setCaja] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // Los cambios de un `useRef` no repintan, y el botón "Deshacer" necesita activarse solo.
  const [puedeDeshacer, setPuedeDeshacer] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const gesto = useRef<Gesto>(null);
  const punteros = useRef<Map<number, { x: number; y: number }>>(new Map());
  const historial = useRef<ZonaPlaca[][]>([]);

  const registrarCambio = useCallback((previas: ZonaPlaca[]) => {
    historial.current.push(previas.map(z => ({ ...z })));
    if (historial.current.length > 30) historial.current.shift();
    setPuedeDeshacer(true);
  }, []);

  const deshacer = () => {
    const anterior = historial.current.pop();
    if (!anterior) return;
    setZonas(anterior);
    setSel(null);
    setError('');
    setPuedeDeshacer(historial.current.length > 0);
  };

  // ── Encaje de la imagen en el visor ───────────────────────────────────────
  // La foto se muestra "contenida" (nunca recortada) en el visor a zoom 1; el zoom y el
  // desplazamiento se aplican con un transform encima. El tamaño base se recalcula cuando
  // carga la imagen y cuando cambia el tamaño del visor (girar el teléfono, aparecer el
  // teclado), con ResizeObserver.
  const recalcularCaja = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !natural) return;
    const dw = wrap.clientWidth;
    const dh = wrap.clientHeight;
    if (!dw || !dh) return;
    const escala = Math.min(dw / natural.w, dh / natural.h);
    setCaja({ w: natural.w * escala, h: natural.h * escala });
  }, [natural]);

  useEffect(() => {
    recalcularCaja();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recalcularCaja());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [recalcularCaja]);

  // Zonas tal como van a quedar estampadas (con el ajuste a proporción de placa aplicado).
  const zonasFinales = useMemo(
    () => (natural ? prepararZonas(zonas, natural.w, natural.h, proporcionPlaca) : zonas),
    [zonas, natural, proporcionPlaca],
  );

  // ── Conversión pantalla → fracción de la imagen ───────────────────────────
  // Se usa el rectángulo REAL del `<img>` (`getBoundingClientRect`), que ya incluye el
  // transform de zoom/desplazamiento: así no hay que deshacer la transformación a mano.
  const aFraccion = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: recortar((clientX - r.left) / r.width, 0, 1),
      y: recortar((clientY - r.top) / r.height, 0, 1),
    };
  };

  const distanciaPunteros = (): number => {
    const p = [...punteros.current.values()];
    if (p.length < 2) return 0;
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setError('');
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    wrapRef.current?.setPointerCapture(e.pointerId);

    // Dos dedos = pellizco para acercar/alejar. Cancela lo que se estuviera dibujando: es
    // un gesto de navegación, no de marcado.
    if (punteros.current.size === 2) {
      gesto.current = { tipo: 'pellizco', d0: distanciaPunteros() || 1, z0: zoom };
      setBorrador(null);
      return;
    }
    if (punteros.current.size > 2) return;

    const destino = e.target as HTMLElement;
    const manija = destino.closest<HTMLElement>('[data-manija]');
    if (manija && !previa) {
      const i = Number(manija.dataset.zona);
      const esquina = manija.dataset.manija as Esquina;
      const z = zonas[i];
      if (z) {
        registrarCambio(zonas);
        // La esquina OPUESTA queda clavada mientras se arrastra esta.
        const anclaX = esquina === 'nw' || esquina === 'sw' ? z.x + z.w : z.x;
        const anclaY = esquina === 'nw' || esquina === 'ne' ? z.y + z.h : z.y;
        gesto.current = { tipo: 'redim', i, anclaX, anclaY };
        setSel(i);
        return;
      }
    }

    const cuerpo = destino.closest<HTMLElement>('[data-zona-cuerpo]');
    if (cuerpo && !previa) {
      const i = Number(cuerpo.dataset.zonaCuerpo);
      const z = zonas[i];
      if (z) {
        registrarCambio(zonas);
        const p = aFraccion(e.clientX, e.clientY);
        gesto.current = { tipo: 'mover', i, dx: p.x - z.x, dy: p.y - z.y };
        setSel(i);
        return;
      }
    }

    if (modo === 'mover' || previa) {
      gesto.current = { tipo: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      return;
    }

    if (zonas.length >= MAX_ZONAS) {
      setError(`Ya marcaste el máximo de ${MAX_ZONAS} zonas en esta foto.`);
      return;
    }
    const p = aFraccion(e.clientX, e.clientY);
    gesto.current = { tipo: 'dibujar', x0: p.x, y0: p.y };
    setSel(null);
    setBorrador({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!punteros.current.has(e.pointerId)) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesto.current;
    if (!g) return;

    if (g.tipo === 'pellizco') {
      const d = distanciaPunteros();
      if (g.d0 > 0 && d > 0) setZoom(recortar(g.z0 * (d / g.d0), ZOOM_MIN, ZOOM_MAX));
      return;
    }
    if (g.tipo === 'pan') {
      setPan({ x: g.px + (e.clientX - g.sx), y: g.py + (e.clientY - g.sy) });
      return;
    }

    const p = aFraccion(e.clientX, e.clientY);
    if (g.tipo === 'dibujar') {
      setBorrador({
        x: Math.min(g.x0, p.x),
        y: Math.min(g.y0, p.y),
        w: Math.abs(p.x - g.x0),
        h: Math.abs(p.y - g.y0),
      });
      return;
    }
    if (g.tipo === 'mover') {
      setZonas(zs =>
        zs.map((z, i) =>
          i === g.i ? { ...z, x: recortar(p.x - g.dx, 0, 1 - z.w), y: recortar(p.y - g.dy, 0, 1 - z.h) } : z,
        ),
      );
      return;
    }
    if (g.tipo === 'redim') {
      const x = Math.min(g.anclaX, p.x);
      const y = Math.min(g.anclaY, p.y);
      const w = Math.max(MIN_LADO_FRAC, Math.abs(p.x - g.anclaX));
      const h = Math.max(MIN_LADO_FRAC, Math.abs(p.y - g.anclaY));
      setZonas(zs =>
        zs.map((z, i) =>
          i === g.i
            ? { x: recortar(x, 0, 1 - w), y: recortar(y, 0, 1 - h), w: Math.min(w, 1), h: Math.min(h, 1) }
            : z,
        ),
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    punteros.current.delete(e.pointerId);
    const g = gesto.current;

    if (g?.tipo === 'dibujar') {
      const b = borrador;
      setBorrador(null);
      if (b && b.w >= MIN_LADO_FRAC && b.h >= MIN_LADO_FRAC) {
        registrarCambio(zonas);
        setZonas(zs => [...zs, b]);
        setSel(zonas.length);
      } else if (b && (b.w > 0.0005 || b.h > 0.0005)) {
        // Un arrastre de dos píxeles casi siempre es un toque accidental, no una placa.
        setError('El rectángulo quedó demasiado pequeño. Acerca con el zoom y vuelve a marcarlo.');
      }
    }

    if (punteros.current.size === 0) gesto.current = null;
    else if (punteros.current.size === 1 && g?.tipo === 'pellizco') gesto.current = null;
  };

  // Rueda del mouse = acercar/alejar. Va como listener NATIVO y no como `onWheel` de React:
  // React registra `wheel` en la raíz como PASIVO, así que un `preventDefault()` dentro de un
  // `onWheel` no hace nada y encima avisa por consola. Con `{ passive: false }` sí se puede
  // impedir el scroll de la página mientras se hace zoom sobre la foto.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => recortar(z * (e.deltaY < 0 ? 1.12 : 0.89), ZOOM_MIN, ZOOM_MAX));
    };
    wrap.addEventListener('wheel', alRodar, { passive: false });
    return () => wrap.removeEventListener('wheel', alRodar);
  }, []);

  const borrarSeleccionada = () => {
    if (sel === null) return;
    registrarCambio(zonas);
    setZonas(zs => zs.filter((_, i) => i !== sel));
    setSel(null);
  };

  const limpiarTodo = () => {
    if (zonas.length === 0) return;
    registrarCambio(zonas);
    setZonas([]);
    setSel(null);
  };

  const ajustar = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const cerrarConAviso = () => {
    if (zonas.length > 0 && !window.confirm('Vas a salir sin aplicar el tapado. ¿Descartar lo que marcaste?')) return;
    onCerrar();
  };

  // Suprimir/Retroceso borra la zona seleccionada; Escape cierra (con confirmación si hay
  // trabajo sin guardar). Solo teclado de escritorio; en el celular están los botones.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cerrarConAviso(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) {
        e.preventDefault();
        borrarSeleccionada();
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, zonas]);

  const aplicar = async () => {
    const v = validarZonas(zonas);
    if (!v.ok) { setError(v.error); return; }
    setGuardando(true);
    setError('');
    try {
      const r = await fetch('/api/admin/tapar-placa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculo_id: vehiculoId, url, zonas, proporcion_placa: proporcionPlaca }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(typeof d?.error === 'string' ? d.error : 'No se pudo tapar la placa.');
        return;
      }
      onGuardado(String(d.url || ''), typeof d?.aviso === 'string' ? d.aviso : undefined);
    } catch {
      setError('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const derivada = origenUrl !== url;

  return (
    <div className="fixed inset-0 bg-black/90 z-[110] flex flex-col">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 text-white flex-shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">Tapar placa a mano — {titulo}</p>
          <p className="text-[11px] text-white/60 leading-snug">
            {previa
              ? 'Vista previa: así va a quedar la foto publicada.'
              : modo === 'marcar'
              ? 'Arrastra sobre cada placa para marcarla. Puedes marcar varias.'
              : 'Arrastra para desplazar la foto. Vuelve a “✏️ Marcar” para seguir marcando.'}
          </p>
        </div>
        <button onClick={cerrarConAviso} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-white/10 transition flex-shrink-0">
          <IconX size={20} />
        </button>
      </div>

      {/* Lienzo */}
      <div
        ref={wrapRef}
        className="relative flex-1 min-h-0 overflow-hidden select-none"
        style={{ touchAction: 'none', cursor: modo === 'mover' || previa ? 'grab' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{
              width: caja.w || undefined,
              height: caja.h || undefined,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={origenUrl}
              alt={`Foto de ${titulo}`}
              draggable={false}
              className="block w-full h-full object-contain pointer-events-none"
              onLoad={e => {
                // `naturalWidth/Height` ya vienen con la rotación EXIF aplicada por el
                // navegador, igual que las dimensiones que calcula el servidor tras
                // `normalizarOrientacion` — por eso las fracciones coinciden en los dos lados.
                const img = e.currentTarget;
                setNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
              }}
            />

            {/* Zonas ya marcadas: el sello tal como va a quedar. */}
            {zonasFinales.map((z, i) => (
              <div
                key={`sello-${i}`}
                className="absolute pointer-events-none"
                style={{
                  left: `${z.x * 100}%`,
                  top: `${z.y * 100}%`,
                  width: `${z.w * 100}%`,
                  height: `${z.h * 100}%`,
                }}
              >
                {/* Tamaño SIN el zoom: este div ya está dentro del contenedor con
                    `scale(zoom)`, así que el navegador escala su borde y su radio otra vez.
                    Si se le pasara el tamaño ya multiplicado por el zoom, el borde saldría
                    `zoom²` de grueso y la vista previa mentiría justo cuando más se mira
                    (acercado sobre una placa chica). */}
                <Sello
                  anchoPx={z.w * caja.w}
                  altoPx={z.h * caja.h}
                  opacidad={previa ? 1 : 0.78}
                />
              </div>
            ))}

            {/* Rectángulo que la persona dibujó (puede diferir del sello si está activo el
                ajuste a proporción de placa) + manijas de la zona seleccionada. */}
            {!previa &&
              zonas.map((z, i) => (
                <div
                  key={`zona-${i}`}
                  data-zona-cuerpo={i}
                  className="absolute"
                  style={{
                    left: `${z.x * 100}%`,
                    top: `${z.y * 100}%`,
                    width: `${z.w * 100}%`,
                    height: `${z.h * 100}%`,
                    outline: sel === i ? '2px dashed #F25C2B' : '1px dashed rgba(255,255,255,.75)',
                    outlineOffset: 0,
                    cursor: 'move',
                  }}
                >
                  <span className="absolute -top-5 left-0 text-[10px] font-bold text-white bg-black/60 px-1.5 rounded">
                    {i + 1}
                  </span>
                  {sel === i &&
                    ESQUINAS.map(esq => (
                      <span
                        key={esq}
                        data-manija={esq}
                        data-zona={i}
                        style={{
                          position: 'absolute',
                          width: 22,
                          height: 22,
                          background: '#F25C2B',
                          border: '2px solid #fff',
                          borderRadius: 11,
                          left: esq === 'nw' || esq === 'sw' ? -11 : undefined,
                          right: esq === 'ne' || esq === 'se' ? -11 : undefined,
                          top: esq === 'nw' || esq === 'ne' ? -11 : undefined,
                          bottom: esq === 'sw' || esq === 'se' ? -11 : undefined,
                          cursor: esq === 'nw' || esq === 'se' ? 'nwse-resize' : 'nesw-resize',
                          touchAction: 'none',
                        }}
                      />
                    ))}
                </div>
              ))}

            {/* Rectángulo en curso */}
            {borrador && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${borrador.x * 100}%`,
                  top: `${borrador.y * 100}%`,
                  width: `${borrador.w * 100}%`,
                  height: `${borrador.h * 100}%`,
                  background: 'rgba(27,51,86,.45)',
                  outline: '2px dashed #F25C2B',
                }}
              />
            )}
          </div>
        </div>

        {zonas.length === 0 && !borrador && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-white/80 bg-black/60 px-3 py-1.5 rounded-full pointer-events-none text-center max-w-[92%]">
            Arrastra sobre la placa para taparla · dos dedos (o la rueda) para acercar
          </div>
        )}
      </div>

      {/* Controles */}
      <div className="bg-surface-2 px-4 py-3 space-y-2.5 flex-shrink-0 max-h-[52%] overflow-y-auto overscroll-contain">
        {derivada && (
          <p className="text-[11px] text-ink/60 leading-snug">
            Estás marcando sobre la foto <strong>original</strong> (sin el tapado anterior), para no apilar sellos.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setModo('marcar'); setPrevia(false); }}
            aria-pressed={modo === 'marcar' && !previa}
            className={`text-[11px] font-semibold px-3 py-2 rounded-full border transition ${
              modo === 'marcar' && !previa ? 'bg-accent border-accent text-white' : 'border-border text-ink/70 hover:bg-surface'
            }`}
          >
            ✏️ Marcar
          </button>
          <button
            type="button"
            onClick={() => { setModo('mover'); setPrevia(false); }}
            aria-pressed={modo === 'mover' && !previa}
            className={`text-[11px] font-semibold px-3 py-2 rounded-full border transition ${
              modo === 'mover' && !previa ? 'bg-accent border-accent text-white' : 'border-border text-ink/70 hover:bg-surface'
            }`}
          >
            ✋ Mover foto
          </button>
          <button
            type="button"
            onClick={() => setPrevia(p => !p)}
            aria-pressed={previa}
            disabled={zonas.length === 0}
            className={`text-[11px] font-semibold px-3 py-2 rounded-full border transition disabled:opacity-40 ${
              previa ? 'bg-accent border-accent text-white' : 'border-border text-ink/70 hover:bg-surface'
            }`}
          >
            👁 Vista previa
          </button>
          <button
            type="button"
            onClick={deshacer}
            disabled={!puedeDeshacer}
            className="text-[11px] font-semibold px-3 py-2 rounded-full border border-border text-ink/70 hover:bg-surface transition disabled:opacity-40"
          >
            ↶ Deshacer
          </button>
          <button
            type="button"
            onClick={borrarSeleccionada}
            disabled={sel === null}
            className="text-[11px] font-semibold px-3 py-2 rounded-full border border-danger/30 text-danger hover:bg-danger/10 transition disabled:opacity-40"
          >
            🗑 Quitar zona
          </button>
          <button
            type="button"
            onClick={limpiarTodo}
            disabled={zonas.length === 0}
            className="text-[11px] font-semibold px-3 py-2 rounded-full border border-border text-ink/70 hover:bg-surface transition disabled:opacity-40"
          >
            Quitar todas
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="placa-zoom" className="text-[11px] font-medium text-ink/60">
              Zoom ×{zoom.toFixed(1)}
            </label>
            <button type="button" onClick={ajustar} className="text-[11px] font-semibold text-accent hover:text-accent-hover transition px-2 py-1.5 -my-1 rounded-lg">
              Ver foto completa
            </button>
          </div>
          <input
            id="placa-zoom" type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.1} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox" checked={proporcionPlaca}
            onChange={e => setProporcionPlaca(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="text-[11px] text-ink/70 leading-snug">
            <strong>Proporción de placa (2:1)</strong> — el sello se ajusta a la forma de una placa colombiana
            cuando el rectángulo marcado se le parece. Desactívalo para tapar exactamente lo que dibujaste.
          </span>
        </label>

        <p className="text-[11px] text-ink/50">
          {zonas.length === 0
            ? 'Ninguna zona marcada todavía.'
            : `${zonas.length} zona${zonas.length !== 1 ? 's' : ''} marcada${zonas.length !== 1 ? 's' : ''} de ${MAX_ZONAS}. El tapado es 100% opaco (no es un desenfoque).`}
        </p>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={cerrarConAviso} disabled={guardando}
            className="flex-1 text-sm font-semibold border border-border text-ink/70 py-2.5 rounded-xl hover:bg-surface transition disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={aplicar} disabled={guardando || zonas.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl transition disabled:opacity-60"
          >
            <IconCheck size={15} /> {guardando ? 'Aplicando…' : 'Aplicar tapado'}
          </button>
        </div>
      </div>
    </div>
  );
}
