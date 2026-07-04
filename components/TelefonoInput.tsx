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
      <select
        value={indicativo}
        onChange={e => onChangeIndicativo(e.target.value)}
        className="border border-border rounded-xl px-2 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 w-[92px] flex-shrink-0"
      >
        {PAISES_TEL.map(p => (
          <option key={p.nombre} value={p.dial}>{p.dial || '+'} {p.nombre}</option>
        ))}
      </select>
      <input
        type="tel" inputMode="numeric" placeholder="3001234567"
        value={numero}
        onChange={e => onChangeNumero(limpiarCelular(indicativo, e.target.value))}
        className="flex-1 min-w-0 border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
    </div>
  );
}
