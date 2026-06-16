'use client';
import { useState } from 'react';
import { IconArrowL, IconArrowR } from '@/components/Icons';
import { diasPicoYPlaca } from '@/lib/picoYPlaca';

type Props = {
  /** Días marcados disponibles por el propietario. Vacío = cualquier día futuro. */
  availableDates?: string[];
  /** Días ya ocupados por reservas activas (no seleccionables). */
  reservedDates?: string[];
  placa?: string;
  /** Rango seleccionado (ISO YYYY-MM-DD). fin = día de devolución. */
  inicio: string;
  fin: string;
  onChange: (inicio: string, fin: string) => void;
  /** Vehículo inactivo: bloquea toda selección. */
  disabled?: boolean;
};

const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarioReserva({
  availableDates, reservedDates, placa, inicio, fin, onChange, disabled,
}: Props) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [base, setBase] = useState(() => new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [aviso, setAviso] = useState('');

  const reservedSet = new Set(reservedDates || []);
  const availSet = availableDates && availableDates.length > 0 ? new Set(availableDates) : null;

  const seleccionable = (fecha: Date, str: string) => {
    if (disabled) return false;
    if (fecha < hoy) return false;
    if (reservedSet.has(str)) return false;
    if (availSet && !availSet.has(str)) return false; // si hay restricción del propietario
    return true;
  };

  // Todos los días del rango [a..b] (inclusive) deben ser seleccionables.
  const rangoLibre = (a: string, b: string) => {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    const cur = new Date(ay, am - 1, ad);
    const end = new Date(by, bm - 1, bd);
    while (cur <= end) {
      if (!seleccionable(cur, isoDate(cur))) return false;
      cur.setDate(cur.getDate() + 1);
    }
    return true;
  };

  const click = (str: string, fecha: Date) => {
    if (!seleccionable(fecha, str)) return;
    setAviso('');
    // Sin inicio, o rango ya completo → empezar de nuevo
    if (!inicio || (inicio && fin)) { onChange(str, ''); return; }
    // Hay inicio, falta fin
    if (str <= inicio) { onChange(str, ''); return; }   // click anterior o igual → reinicia
    if (rangoLibre(inicio, str)) { onChange(inicio, str); }
    else { setAviso('Ese rango incluye días no disponibles. Elige otras fechas.'); onChange(str, ''); }
  };

  const enRango = (str: string) => inicio && fin && str > inicio && str < fin;

  const renderMes = (primerDia: Date) => {
    const año = primerDia.getFullYear();
    const mes = primerDia.getMonth();
    const totalDias = new Date(año, mes + 1, 0).getDate();
    const offset = (new Date(año, mes, 1).getDay() + 6) % 7;
    const nombreMes = primerDia.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
    const picoSet = new Set(placa ? diasPicoYPlaca(placa, año, mes) : []);
    const celdas: (Date | null)[] = [
      ...Array(offset).fill(null),
      ...Array.from({ length: totalDias }, (_, i) => new Date(año, mes, i + 1)),
    ];

    return (
      <div>
        <p className="text-sm font-semibold text-ink capitalize mb-2 text-center">{nombreMes}</p>
        <div className="grid grid-cols-7 gap-0.5 text-xs">
          {DIAS.map(d => (
            <div key={d} className="text-center text-ink/30 font-semibold py-1">{d}</div>
          ))}
          {celdas.map((fecha, i) => {
            if (!fecha) return <div key={`e${i}`} />;
            const str = isoDate(fecha);
            const pasado = fecha < hoy;
            const reservada = reservedSet.has(str);
            const noDispProp = !!availSet && !availSet.has(str);
            const sel = seleccionable(fecha, str);
            const esInicio = str === inicio;
            const esFin = str === fin;
            const dentro = enRango(str);
            const esPico = picoSet.has(str);

            let cls = '';
            let title: string | undefined;
            if (pasado) { cls = 'text-ink/15 cursor-not-allowed'; }
            else if (reservada) { cls = 'bg-danger/15 text-danger cursor-not-allowed line-through'; title = 'Ocupado'; }
            else if (noDispProp) { cls = 'text-ink/20 cursor-not-allowed'; title = 'No disponible'; }
            else if (esInicio || esFin) { cls = 'bg-accent text-white font-bold shadow-sm shadow-accent/30'; }
            else if (dentro) { cls = 'bg-accent/25 text-ink'; }
            else if (sel) { cls = 'text-ink hover:bg-accent/15 ring-1 ring-success/30'; }
            else { cls = 'text-ink/30'; }

            return (
              <button key={str} type="button" disabled={!sel}
                onClick={() => click(str, fecha)} title={title}
                className={`relative rounded-lg py-1.5 text-center transition select-none text-[11px] font-medium ${cls}`}>
                {fecha.getDate()}
                {esPico && !pasado && !reservada && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent block" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (disabled) {
    return (
      <div className="bg-danger/10 border border-danger/25 rounded-xl px-4 py-3 text-sm text-danger">
        Este vehículo no está disponible para reservas en este momento.
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <button type="button" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() - 1, 1))}
          disabled={base <= new Date(hoy.getFullYear(), hoy.getMonth(), 1)}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-2 py-1 rounded-lg hover:bg-accent-light transition text-xs font-medium disabled:opacity-30">
          <IconArrowL size={13} /> Ant.
        </button>
        {(inicio || fin) && (
          <button type="button" onClick={() => { onChange('', ''); setAviso(''); }}
            className="text-[11px] text-ink/50 hover:text-danger transition font-medium">Limpiar</button>
        )}
        <button type="button" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() + 1, 1))}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-2 py-1 rounded-lg hover:bg-accent-light transition text-xs font-medium">
          Sig. <IconArrowR size={13} />
        </button>
      </div>

      {renderMes(base)}

      <p className="text-[11px] text-ink/50 mt-2">
        {!inicio ? 'Toca el día de recogida.' : !fin ? 'Ahora toca el día de devolución.' : 'Rango seleccionado ✓'}
      </p>
      {aviso && <p className="text-[11px] text-danger mt-1">{aviso}</p>}

      <div className="mt-2 flex items-center gap-3 text-[10px] text-ink/45 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-accent inline-block" /> Selección</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded ring-1 ring-success/40 inline-block" /> Disponible</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-danger/15 border border-danger/30 inline-block" /> Ocupado</span>
        {placa && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded relative inline-block"><span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" /></span> Pico y placa</span>}
      </div>
    </div>
  );
}
