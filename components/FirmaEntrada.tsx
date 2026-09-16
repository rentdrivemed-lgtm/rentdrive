'use client';
// ── Las dos vías para firmar ────────────────────────────────────────────────
//
// El dueño lo pidió así: «permite que la persona cargue su firma digital o que
// utilice el celular para firmar». Este componente es esas dos vías en un solo
// control, y devuelve siempre lo mismo: un PNG en data URI y por qué vía llegó.
//
//   · TRAZO   → reutiliza components/FirmaCanvas.tsx, el mismo widget con el que
//               los propietarios firman su cuenta de cobro desde 2026. Funciona
//               con el dedo en el celular y con el mouse en el escritorio (usa
//               pointer events, no dos implementaciones distintas).
//   · CARGA   → el archivo se manda a /api/contratos/firma-imagen, que lo recorta,
//               le quita el fondo y lo devuelve a tamaño de firma. Lo que se ve en
//               la vista previa es EXACTAMENTE lo que se va a guardar.
//
// Componente de cliente puro: no importa nada de servidor (lib/firma-imagen.ts usa
// `sharp` y `Buffer`, así que aquí solo se replican los topes de tamaño para poder
// avisar antes de subir; la validación de verdad la hace el servidor).
import { useRef, useState } from 'react';
import FirmaCanvas from '@/components/FirmaCanvas';

export type MetodoFirmaUI = 'trazo' | 'carga';

type Props = {
  /** Se llama con '' cuando se borra el trazo o se descarta la imagen. */
  onChange: (dataUrl: string, metodo: MetodoFirmaUI) => void;
  disabled?: boolean;
};

/**
 * Tope de lo que se deja SUBIR, en bytes del archivo original. Es el mismo número
 * que `FIRMA_SUBIDA_MAX_BYTES` en lib/firma-imagen.ts, repetido aquí porque ese
 * módulo usa `sharp` y no se puede importar en el navegador. El servidor es la
 * fuente de verdad: esto solo evita subir 20 MB para que los rechacen.
 */
const SUBIDA_MAX_BYTES = 8 * 1024 * 1024;

const TIPOS_ACEPTADOS = 'image/png,image/jpeg,image/webp';

export default function FirmaEntrada({ onChange, disabled }: Props) {
  const [metodo, setMetodo] = useState<MetodoFirmaUI>('trazo');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [previa, setPrevia] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const cambiarMetodo = (nuevo: MetodoFirmaUI) => {
    if (nuevo === metodo || disabled) return;
    setMetodo(nuevo);
    setError('');
    setPrevia('');
    // Cambiar de vía invalida lo que hubiera: si no, el padre se quedaría con el
    // trazo viejo y mandaría `metodo: 'carga'` con una imagen dibujada a mano.
    onChange('', nuevo);
  };

  const elegirArchivo = async (archivo: File | undefined) => {
    if (!archivo) return;
    setError('');
    if (archivo.size > SUBIDA_MAX_BYTES) {
      setError('La imagen pesa demasiado. Usa una foto de menos de 8 MB.');
      return;
    }
    setSubiendo(true);
    setPrevia('');
    onChange('', 'carga');
    try {
      const dataUrl = await new Promise<string>((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onload = () => resolver(String(lector.result || ''));
        lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'));
        lector.readAsDataURL(archivo);
      });
      const res = await fetch('/api/contratos/firma-imagen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: dataUrl }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'No se pudo procesar la imagen.');
        return;
      }
      setPrevia(json.imagen);
      onChange(json.imagen, 'carga');
    } catch {
      setError('No se pudo procesar la imagen. Intenta con otra foto.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const botonClase = (activo: boolean) =>
    `flex-1 text-xs font-semibold px-3 py-2 rounded-lg transition ${
      activo ? 'bg-accent text-white' : 'bg-surface-2 text-ink/60 hover:text-ink'
    } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <button type="button" onClick={() => cambiarMetodo('trazo')} disabled={disabled} className={botonClase(metodo === 'trazo')}>
          Firmar aquí
        </button>
        <button type="button" onClick={() => cambiarMetodo('carga')} disabled={disabled} className={botonClase(metodo === 'carga')}>
          Cargar mi firma
        </button>
      </div>

      {metodo === 'trazo' ? (
        <FirmaCanvas disabled={disabled} onChange={dataUrl => onChange(dataUrl, 'trazo')} />
      ) : (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={TIPOS_ACEPTADOS}
            disabled={disabled || subiendo}
            onChange={e => elegirArchivo(e.target.files?.[0])}
            className="block w-full text-xs text-ink/70 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent-light file:text-accent hover:file:bg-accent/20 disabled:opacity-60"
          />
          <div className="mt-2 rounded-xl border-2 border-dashed border-border bg-white h-40 flex items-center justify-center overflow-hidden">
            {subiendo ? (
              <p className="text-[11px] text-ink/40">Procesando la imagen…</p>
            ) : previa ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previa} alt="Vista previa de la firma cargada" className="max-h-36 max-w-full object-contain" />
            ) : (
              <p className="text-[11px] text-ink/40 px-4 text-center">
                Sube una foto de tu firma sobre papel blanco. Se recorta y se limpia el fondo automáticamente.
              </p>
            )}
          </div>
          <p className="text-[11px] text-ink/40 mt-1.5">Formatos: PNG, JPG o WEBP. Máximo 8 MB.</p>
        </div>
      )}

      {error && <p className="text-[11px] text-danger mt-1.5">{error}</p>}
    </div>
  );
}
