'use client';
import { useState } from 'react';
import { IconArrowL, IconArrowR } from '@/components/Icons';
import { diasPicoYPlaca } from '@/lib/picoYPlaca';

type Props = {
  value: string[];
  onChange: (dates: string[]) => void;
  readOnly?: boolean;
  reservedDates?: string[];
  placa?: string;
};

const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarioDisponibilidad({ value, onChange, readOnly, reservedDates, placa }: Props) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [base, setBase] = useState(() => new Date(hoy.getFullYear(), hoy.getMonth(), 1));

  const reservedSet = new Set(reservedDates || []);

  const toggle = (str: string) => {
    if (readOnly) return;
    if (reservedSet.has(str)) return;
    onChange(value.includes(str) ? value.filter(d => d !== str) : [...value, str]);
  };

  const seleccionarMes = (primerDia: Date) => {
    const año = primerDia.getFullYear();
    const mes = primerDia.getMonth();
    const total = new Date(año, mes + 1, 0).getDate();
    const nuevas = Array.from({ length: total }, (_, i) => {
      const d = new Date(año, mes, i + 1);
      if (d < hoy) return null;
      if (reservedSet.has(isoDate(d))) return null;
      return isoDate(d);
    }).filter(Boolean) as string[];
    const set = new Set(value);
    const todosEnSet = nuevas.every(d => set.has(d));
    if (todosEnSet) {
      onChange(value.filter(d => !nuevas.includes(d)));
    } else {
      onChange([...new Set([...value, ...nuevas])]);
    }
  };

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
    const totalMes = new Date(año, mes + 1, 0).getDate();
    const disponiblesMes = Array.from({ length: totalMes }, (_, i) => {
      const d = new Date(año, mes, i + 1);
      if (d < hoy) return null;
      if (reservedSet.has(isoDate(d))) return null;
      return isoDate(d);
    }).filter(Boolean) as string[];
    const todosMarcados = disponiblesMes.length > 0 && disponiblesMes.every(d => value.includes(d));

    return (
      <div key={`${año}-${mes}`}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-ink capitalize">{nombreMes}</p>
          {!readOnly && (
            <button type="button" onClick={() => seleccionarMes(primerDia)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border transition font-medium
                ${todosMarcados
                  ? 'border-success/30 text-success hover:bg-danger/10 hover:border-danger/30 hover:text-danger'
                  : 'border-accent/30 text-accent hover:bg-accent-light'}`}
            >
              {todosMarcados ? 'Quitar mes' : 'Todo el mes'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-xs">
          {DIAS.map(d => (
            <div key={d} className="text-center text-ink/30 font-semibold py-1">{d}</div>
          ))}
          {celdas.map((fecha, i) => {
            if (!fecha) return <div key={`e${i}`} />;
            const str = isoDate(fecha);
            const pasado = fecha < hoy;
            const reservada = reservedSet.has(str);
            const disp = value.includes(str);
            const esPico = picoSet.has(str);

            let cellClass = '';
            let titleAttr: string | undefined;
            let isDisabled = pasado || readOnly || reservada;

            if (pasado) {
              cellClass = 'text-ink/15 cursor-not-allowed';
            } else if (reservada) {
              cellClass = 'bg-danger/15 text-danger cursor-not-allowed';
              titleAttr = 'Reservado por arrendatario';
              isDisabled = true;
            } else if (disp && esPico) {
              cellClass = 'bg-success/100 text-white hover:bg-danger ring-1 ring-accent/40';
            } else if (disp) {
              cellClass = 'bg-success/100 text-white hover:bg-danger';
            } else if (esPico) {
              cellClass = 'text-ink/60 hover:bg-brand-muted ring-1 ring-accent/40';
            } else {
              cellClass = 'text-ink/60 hover:bg-brand-muted';
            }

            return (
              <button key={str} type="button" disabled={isDisabled}
                onClick={() => toggle(str)}
                title={titleAttr}
                className={`relative rounded-lg py-1.5 text-center transition select-none text-[11px] font-medium ${cellClass}`}
              >
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

  const mes2 = new Date(base.getFullYear(), base.getMonth() + 1, 1);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <button type="button"
          onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() - 1, 1))}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-3 py-1.5 rounded-lg hover:bg-accent-light transition text-sm font-medium"
        >
          <IconArrowL size={14} /> Anterior
        </button>
        {!readOnly && (
          <button type="button" onClick={() => onChange([])}
            className="text-xs text-danger hover:text-danger transition font-medium">
            Limpiar todo
          </button>
        )}
        <button type="button"
          onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() + 1, 1))}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-3 py-1.5 rounded-lg hover:bg-accent-light transition text-sm font-medium"
        >
          Siguiente <IconArrowR size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {renderMes(base)}
        {renderMes(mes2)}
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-ink/50 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-success/100 inline-block" /> Disponible
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-brand-muted inline-block" /> No disponible
        </span>
        {reservedDates && reservedDates.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-danger/15 border border-danger/30 inline-block" /> Reservado
          </span>
        )}
        {placa && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-accent/40 ring-1 ring-accent/40 inline-block" /> Pico y placa
          </span>
        )}
        {!readOnly && (
          <span className="text-accent font-medium ml-auto">{value.length} día{value.length !== 1 ? 's' : ''} marcados</span>
        )}
      </div>
    </div>
  );
}
