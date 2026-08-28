'use client';
import { PAISES_TEL, limpiarCelular } from '@/lib/validacion';

type Props = {
  indicativo: string;
  numero: string;
  onChangeIndicativo: (dial: string) => void;
  onChangeNumero: (numero: string) => void;
  className?: string;
};

export default function TelefonoInput({ indicativo, numero, onChangeIndicativo, onChangeNumero, className }: Props) {
  return (
    <div className={`flex gap-2 ${className || ''}`}>
      {/* El <select> nativo sigue siendo el control real (teclado, lector de pantalla,
          selector nativo en móvil) y sus opciones muestran indicativo + nombre completo
          del país. Se pinta invisible (opacity-0) y encima se ve una caja decorativa que
          muestra SOLO el indicativo (ej. "+57"): así el campo cerrado nunca corta el
          nombre del país, que solo aparece al desplegar la lista. */}
      <div className="relative w-[72px] flex-shrink-0">
        <select
          value={indicativo}
          onChange={e => onChangeIndicativo(e.target.value)}
          aria-label="Indicativo del país"
          className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          {PAISES_TEL.map(p => (
            <option key={p.nombre} value={p.dial}>{p.dial || '+'} {p.nombre}</option>
          ))}
        </select>
        <div
          aria-hidden="true"
          className="pointer-events-none h-full flex items-center justify-center gap-1 border border-border rounded-xl px-2 py-2.5 text-sm text-ink bg-surface peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 peer-focus-visible:border-accent"
        >
          <span>{indicativo || '+'}</span>
          <span className="text-ink/40 text-[9px]">▾</span>
        </div>
      </div>
      <input
        type="tel" inputMode="numeric" placeholder="300 123 4567"
        value={numero}
        onChange={e => onChangeNumero(limpiarCelular(indicativo, e.target.value))}
        className="flex-1 min-w-0 border border-border rounded-xl px-4 py-3 text-base sm:text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
    </div>
  );
}
