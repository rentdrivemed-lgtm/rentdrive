'use client';
// Widget de firma manuscrita simple: el propietario dibuja con mouse/touch sobre un
// <canvas>. Implementación a mano con pointer events (pointerdown/move/up) — sin
// librería externa, es un trazo simple. Expone la firma como data URI PNG.
import { useEffect, useRef, useState } from 'react';

type Props = {
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
};

export default function FirmaCanvas({ onChange, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const trazoVacio = useRef(true);
  const [tieneTrazo, setTieneTrazo] = useState(false);

  // Prepara el canvas (fondo blanco + escala para pantallas retina). Se reaplica cada vez
  // que cambia el tamaño real del elemento (rotar el celular, colapsar un sidebar, resize
  // de ventana) — si no, `width`/`height` quedan fijos con la escala vieja y el trazo se
  // desalinea respecto al puntero. Al redimensionar limpiamos cualquier trazo previo: es
  // preferible perderlo (el usuario vuelve a firmar) a dejarlo desalineado/cortado.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preparar = (notificarLimpieza: boolean) => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      trazoVacio.current = true;
      setTieneTrazo(false);
      if (notificarLimpieza) onChange('');
    };

    preparar(false); // primer montaje: solo configura el canvas, sin tocar el estado del padre

    let esPrimeraMedicion = true;
    const observer = new ResizeObserver(() => {
      // El propio ResizeObserver dispara una vez al observar (con el tamaño inicial),
      // que ya cubrimos con la llamada directa de arriba — se ignora para no re-preparar
      // el canvas dos veces al montar.
      if (esPrimeraMedicion) { esPrimeraMedicion = false; return; }
      preparar(true); // resize real: si había un trazo, se pierde — se avisa al padre
    });
    observer.observe(canvas);

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posicion = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const empezar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const { x, y } = posicion(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dibujando.current || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = posicion(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    trazoVacio.current = false;
    setTieneTrazo(true);
  };

  const terminar = () => {
    dibujando.current = false;
    const canvas = canvasRef.current;
    if (!canvas || trazoVacio.current) return;
    onChange(canvas.toDataURL('image/png'));
  };

  const limpiar = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.scale(ratio, ratio);
    trazoVacio.current = true;
    setTieneTrazo(false);
    onChange('');
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        className={`w-full h-40 rounded-xl border-2 border-dashed touch-none ${disabled ? 'border-border opacity-60 cursor-not-allowed' : 'border-accent/40 cursor-crosshair'} bg-white`}
      />
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-[11px] text-ink/40">Dibuja tu firma con el mouse o el dedo.</p>
        {tieneTrazo && !disabled && (
          <button type="button" onClick={limpiar} className="text-[11px] text-accent hover:underline font-medium">Borrar y repetir</button>
        )}
      </div>
    </div>
  );
}
