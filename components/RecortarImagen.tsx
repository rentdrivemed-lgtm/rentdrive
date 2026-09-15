'use client';
import { useCallback, useMemo, useState } from 'react';
import Cropper, { type Area, type MediaSize, type Size } from 'react-easy-crop';
import { recortarImagen, tamanioRotado } from '@/lib/imagenRecorte';
import { IconX, IconCheck } from '@/components/Icons';

type Props = {
  imagenUrl: string;
  onConfirmar: (blob: Blob) => void;
  onCancelar: () => void;
};

/**
 * Proporciones disponibles para el recuadro de recorte.
 *
 * `valor: null` = "Original": el recuadro toma la proporción REAL de la foto,
 * así que a zoom 1 encuadra la imagen completa y no se pierde nada. Es el modo
 * por defecto y el único que garantiza que el documento se suba entero.
 *
 * Antes el aspecto estaba fijo en 4/3 (o 3/4 si la foto era vertical) y el zoom
 * tenía `min={1}`, así que cualquier documento más ancho que 4:3 — una licencia
 * de conducción colombiana ronda 1,57:1 — perdía los lados SIEMPRE, sin manera
 * de evitarlo. De ahí viene este cambio.
 *
 * Nota: react-easy-crop no ofrece un recuadro redimensionable con manijas (no
 * existe un modo "libre" arrastrando esquinas), así que "Original" + poder
 * alejar el zoom es el equivalente a no imponer ninguna forma.
 */
const PROPORCIONES: { id: string; etiqueta: string; valor: number | null; ayuda: string }[] = [
  { id: 'original', etiqueta: 'Original', valor: null, ayuda: 'La foto completa, tal como está. No se recorta nada.' },
  { id: 'tarjeta', etiqueta: 'Tarjeta 3:2', valor: 3 / 2, ayuda: 'Para cédula, licencia o tarjeta de propiedad (tarjetas plásticas).' },
  { id: 'foto', etiqueta: 'Foto 4:3', valor: 4 / 3, ayuda: 'Foto de celular acostada — útil para hojas o carnés anchos.' },
  { id: 'vertical', etiqueta: 'Vertical 3:4', valor: 3 / 4, ayuda: 'Foto de celular parada — útil para SOAT o tecno-mecánica en hoja.' },
  { id: 'cuadrada', etiqueta: 'Cuadrada', valor: 1, ayuda: 'Recorte cuadrado, para fotos de perfil o sellos.' },
];

const ZOOM_MAX = 3;

export default function RecortarImagen({ imagenUrl, onConfirmar, onCancelar }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoomManual, setZoomManual] = useState<number | null>(null);
  const [orientacion, setOrientacion] = useState(0); // 0 | 90 | 180 | 270, con los botones de girar
  const [ajusteFino, setAjusteFino] = useState(0); // -15..15, para enderezar la foto
  const rotacion = (orientacion + ajusteFino + 360) % 360;
  const [areaPixeles, setAreaPixeles] = useState<Area | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');
  const [proporcion, setProporcion] = useState('original');
  // Tamaño de la imagen tal como la pinta el cropper + su tamaño natural, y
  // tamaño del recuadro de recorte. Los reporta el propio cropper, así no hay
  // que precargar la imagen aparte para conocer sus dimensiones.
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = useState<Size | null>(null);

  // Si la foto se gira 90°/270°, lo que se ve en pantalla queda acostado al
  // revés, así que la proporción "original" también se invierte.
  const girada = orientacion === 90 || orientacion === 270;
  const aspectoNatural = mediaSize && mediaSize.naturalHeight
    ? mediaSize.naturalWidth / mediaSize.naturalHeight
    : 4 / 3;
  const valorProporcion = PROPORCIONES.find(p => p.id === proporcion)?.valor ?? null;
  const aspecto = valorProporcion ?? (girada ? 1 / aspectoNatural : aspectoNatural);

  // Zoom al que la foto ENTERA cabe dentro del recuadro. Con "Original" da 1
  // (el recuadro ya tiene la forma de la foto); con una proporción fija da
  // menos de 1, y por eso el zoom debe poder bajar de 1 — con `min={1}` era
  // imposible ver el documento completo dentro de un recuadro de otra forma.
  const zoomAjuste = useMemo(() => {
    if (!mediaSize || !cropSize) return 1;
    const caja = tamanioRotado(mediaSize.width, mediaSize.height, rotacion);
    if (!caja.width || !caja.height) return 1;
    return Math.min(1, cropSize.width / caja.width, cropSize.height / caja.height);
  }, [mediaSize, cropSize, rotacion]);

  // Diferencias por debajo del 0,1% son ruido de coma flotante entre el tamaño
  // del recuadro y el de la foto (misma proporción): se toman como 1 para que
  // el caso normal salga exacto, sin un borde blanco de medio píxel.
  const zoomEncuadre = zoomAjuste > 0.999 ? 1 : zoomAjuste;
  // Redondeado hacia abajo a 2 decimales para que el `min` del deslizador caiga
  // en la misma rejilla que su `step` (si no, el navegador "encaja" el valor
  // mostrado en min + n*step y el zoom 1 quedaría inalcanzable desde el
  // deslizador). Redondear hacia abajo solo deja un margen extra de <1%.
  const zoomMin = Math.max(0.1, Math.floor(zoomEncuadre * 100) / 100);
  // Zoom de partida: con "Original", el que encuadra la foto COMPLETA (no
  // siempre es 1: al girar 90° la foto acostada puede no caber a lo alto del
  // contenedor, y ahí react-easy-crop achica el recuadro). Con una proporción
  // fija se parte de 1 (el recuadro lleno), que es lo que se espera al pedir
  // un recorte con una forma concreta.
  const zoomBase = proporcion === 'original' ? zoomEncuadre : 1;
  // `zoomManual` es null mientras el usuario no toque el zoom; así el encuadre
  // de partida se deriva en cada render y nunca queda desfasado tras girar o
  // cambiar de proporción.
  const zoomEfectivo = Math.max(zoomMin, zoomManual ?? zoomBase);

  const onCropComplete = useCallback((_area: Area, areaPx: Area) => setAreaPixeles(areaPx), []);

  // Al cambiar de proporción o de giro, el encuadre vuelve al centro y al zoom
  // de partida (con "Original", el de la foto completa).
  const recentrar = () => {
    setZoomManual(null);
    setCrop({ x: 0, y: 0 });
  };
  const cambiarProporcion = (id: string) => {
    setProporcion(id);
    recentrar();
  };
  const girar = (grados: number) => {
    setOrientacion(o => (o + grados + 360) % 360);
    recentrar();
  };

  const encuadrarCompleto = () => {
    setZoomManual(Math.min(ZOOM_MAX, Math.max(zoomMin, zoomEncuadre)));
    setCrop({ x: 0, y: 0 });
  };

  // Aviso cuando el recuadro está dejando fuera una parte apreciable de la
  // foto. Se calcula sobre la caja envolvente, que solo coincide con la foto
  // cuando la rotación es múltiplo de 90°; con el ajuste fino activo la caja
  // incluye esquinas vacías y el porcentaje no sería comparable, así que ahí
  // no se avisa (el usuario está enderezando a propósito).
  const recortandoBordes = useMemo(() => {
    if (!areaPixeles || !mediaSize || ajusteFino !== 0) return false;
    const caja = tamanioRotado(mediaSize.naturalWidth, mediaSize.naturalHeight, rotacion);
    const total = caja.width * caja.height;
    if (!total) return false;
    const dentroX = Math.max(0, Math.min(areaPixeles.x + areaPixeles.width, caja.width) - Math.max(areaPixeles.x, 0));
    const dentroY = Math.max(0, Math.min(areaPixeles.y + areaPixeles.height, caja.height) - Math.max(areaPixeles.y, 0));
    return (dentroX * dentroY) / total < 0.97;
  }, [areaPixeles, mediaSize, ajusteFino, rotacion]);

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

  const ayuda = PROPORCIONES.find(p => p.id === proporcion)?.ayuda ?? '';

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
          zoom={zoomEfectivo}
          minZoom={zoomMin}
          maxZoom={ZOOM_MAX}
          rotation={rotacion}
          aspect={aspecto}
          // Por debajo de zoom 1 el recuadro es más grande que la foto, así que
          // el cropper NO puede seguir obligando a que quede cubierto: sin esto
          // recorta igual (limita el área devuelta a los bordes de la imagen) y
          // se volvería a perder lo que se quería conservar. A zoom >= 1 se
          // mantiene el comportamiento de siempre para que un arrastre sin
          // querer no desencuadre la foto.
          restrictPosition={zoomEfectivo > 0.999}
          onCropChange={setCrop}
          onZoomChange={setZoomManual}
          onCropComplete={onCropComplete}
          // `setMediaSize`/`setCropSize` (no `onMediaLoaded`) porque el cropper
          // los llama en CADA recálculo de tamaños — también al rotar o al
          // cambiar el tamaño del contenedor (girar el teléfono, aparecer el
          // teclado). Con `onMediaLoaded`, que solo dispara una vez al cargar,
          // el tamaño quedaba viejo y el "encuadre completo" se calculaba mal.
          setMediaSize={setMediaSize}
          setCropSize={setCropSize}
        />
      </div>

      {/* Tope de altura + scroll propio: en un teléfono acostado (o uno muy
          bajito) los controles se comerían casi todo el alto y el visor
          quedaría inservible. */}
      <div className="bg-surface-2 px-4 py-3 space-y-2.5 max-h-[60%] overflow-y-auto overscroll-contain">
        <div>
          {/* En fila que se envuelve (no con scroll horizontal): en un teléfono
              angosto las 5 opciones no caben en una sola línea y con scroll la
              última queda escondida. */}
          <div className="flex flex-wrap gap-1.5 mb-1">
            {PROPORCIONES.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => cambiarProporcion(p.id)}
                aria-pressed={proporcion === p.id}
                title={p.ayuda}
                className={`flex-shrink-0 text-[11px] font-semibold px-3 py-2 rounded-full border transition ${
                  proporcion === p.id
                    ? 'bg-accent border-accent text-white'
                    : 'border-border text-ink/70 hover:bg-surface'
                }`}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-ink/60 leading-snug">{ayuda}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="recorte-zoom" className="text-[11px] font-medium text-ink/60">Zoom</label>
            <button type="button" onClick={encuadrarCompleto}
              className="text-[11px] font-semibold text-accent hover:text-accent-hover transition px-2 py-1.5 -my-1 rounded-lg">
              Encuadrar completo
            </button>
          </div>
          <input id="recorte-zoom" type="range" min={zoomMin} max={ZOOM_MAX} step={0.01} value={zoomEfectivo}
            onChange={e => setZoomManual(Math.max(zoomMin, Number(e.target.value)))}
            className="w-full accent-accent" />
        </div>
        <div>
          <label htmlFor="recorte-enderezar" className="text-[11px] font-medium text-ink/60 block mb-1">Enderezar (ajuste fino)</label>
          <input id="recorte-enderezar" type="range" min={-15} max={15} step={0.5} value={ajusteFino}
            onChange={e => setAjusteFino(Number(e.target.value))}
            className="w-full accent-accent" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => girar(-90)}
            className="flex-1 text-xs font-semibold border border-border text-ink/70 py-2.5 rounded-xl hover:bg-surface transition">
            ↺ Girar 90°
          </button>
          <button onClick={() => girar(90)}
            className="flex-1 text-xs font-semibold border border-border text-ink/70 py-2.5 rounded-xl hover:bg-surface transition">
            ↻ Girar 90°
          </button>
        </div>
        {recortandoBordes && (
          <p className="text-[11px] text-warning">
            ⚠ Estás recortando los bordes — revisa que el documento se vea completo.
          </p>
        )}
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
