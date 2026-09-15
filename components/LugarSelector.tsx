'use client';
import { useId } from 'react';
import { LUGARES, getLugar, esAeropuerto, type Lugar } from '@/lib/lugares';
import { IconPin, IconClock, IconPlane } from '@/components/Icons';
import { useLang } from '@/contexts/LanguageContext';

type Props = {
  label: string;
  value: Lugar;
  onChange: (l: Lugar) => void;
  /** Color del encabezado/acento. */
  tone?: 'accent' | 'brand';
};

const T = {
  es: {
    municipioLabel: 'Municipio / lugar', selecLugar: 'Selecciona un lugar…',
    recargoAviso: (n: string) => `Aplica un recargo de $${n} por este trayecto.`,
    sinRecargo: 'Sin recargo por este trayecto.',
    terminalLabel: 'Terminal / N.º de vuelo (opcional)', terminalPlaceholder: 'Ej: Terminal 1, vuelo AV8420',
    barrioLabel: 'Barrio', barrioPlaceholder: 'Ej: El Poblado',
    direccionLabel: 'Dirección exacta', direccionPlaceholder: 'Ej: Carrera 43A # 5-15, apto 302 / Torre 2',
    hora: 'Hora',
  },
  en: {
    municipioLabel: 'City / place', selecLugar: 'Select a place…',
    recargoAviso: (n: string) => `A $${n} surcharge applies for this trip.`,
    sinRecargo: 'No surcharge for this trip.',
    terminalLabel: 'Terminal / flight number (optional)', terminalPlaceholder: 'E.g.: Terminal 1, flight AV8420',
    barrioLabel: 'Neighborhood', barrioPlaceholder: 'E.g.: El Poblado',
    direccionLabel: 'Exact address', direccionPlaceholder: 'E.g.: Carrera 43A # 5-15, apt 302 / Tower 2',
    hora: 'Time',
  },
};

export default function LugarSelector({ label, value, onChange, tone = 'accent' }: Props) {
  const { lang } = useLang();
  const c = T[lang];
  // Todo sale del catálogo (lib/lugares.ts): el precio que se le muestra al
  // cliente es el mismo que cobra el servidor, no una copia que se desactualiza.
  const muni = getLugar(value.municipio);
  const aeropuerto = esAeropuerto(value.municipio);
  const set = (patch: Partial<Lugar>) => onChange({ ...value, ...patch });
  const toneText = tone === 'brand' ? 'text-ink' : 'text-accent';
  const barriosId = useId();

  const inputCls =
    'w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40';

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        <IconPin size={13} className={toneText} />
        <span className="text-xs font-bold text-ink/60 uppercase tracking-wide">{label}</span>
      </div>

      {/* Municipio */}
      <div>
        <label className="text-[11px] font-medium text-ink/50 block mb-1">{c.municipioLabel}</label>
        <select
          className={inputCls}
          value={value.municipio}
          onChange={e => set({ municipio: e.target.value, barrio: '', direccion: '' })}
        >
          <option value="">{c.selecLugar}</option>
          {LUGARES.map(m => (
            <option key={m.id} value={m.id}>{m.nombre}</option>
          ))}
        </select>
      </div>

      {/* Aviso del lugar elegido: recargo (o "sin recargo") y dirección fija si la tiene */}
      {muni && (
        muni.recargo > 0 ? (
          <div className="flex items-start gap-2 bg-accent-light border border-accent/20 rounded-xl px-3 py-2">
            {aeropuerto
              ? <IconPlane size={14} className="text-accent flex-shrink-0 mt-0.5" />
              : <IconPin size={14} className="text-accent flex-shrink-0 mt-0.5" />}
            <p className="text-[11px] text-accent font-medium">
              {c.recargoAviso(muni.recargo.toLocaleString('es-CO'))}
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2">
            <IconPin size={14} className="text-success flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-ink/60 font-medium">
              <span className="text-success font-bold">{c.sinRecargo}</span>
              {muni.direccionFija && <span className="block text-ink/70">{muni.nombre} — {muni.direccionFija}</span>}
            </p>
          </div>
        )
      )}

      {/* Aeropuerto: campo opcional terminal / vuelo */}
      {aeropuerto && (
        <div>
          <label className="text-[11px] font-medium text-ink/50 block mb-1">{c.terminalLabel}</label>
          <input
            type="text"
            placeholder={c.terminalPlaceholder}
            className={inputCls}
            value={value.direccion}
            onChange={e => set({ direccion: e.target.value })}
          />
        </div>
      )}

      {/* Lugar con dirección del cliente: barrio + dirección exacta.
          El barrio es texto libre (las listas de barrios nunca están completas);
          donde haya sugerencias, salen como datalist. */}
      {muni?.pideDireccion && (
        <>
          <div>
            <label className="text-[11px] font-medium text-ink/50 block mb-1">{c.barrioLabel}</label>
            <input
              type="text"
              list={muni.barrios?.length ? barriosId : undefined}
              placeholder={c.barrioPlaceholder}
              className={inputCls}
              value={value.barrio}
              onChange={e => set({ barrio: e.target.value })}
            />
            {!!muni.barrios?.length && (
              <datalist id={barriosId}>
                {muni.barrios.map(b => <option key={b} value={b} />)}
              </datalist>
            )}
          </div>
          <div>
            <label className="text-[11px] font-medium text-ink/50 block mb-1">{c.direccionLabel}</label>
            <input
              type="text"
              placeholder={c.direccionPlaceholder}
              className={inputCls}
              value={value.direccion}
              onChange={e => set({ direccion: e.target.value })}
            />
          </div>
        </>
      )}

      {/* Hora */}
      {value.municipio && (
        <div>
          <label className="text-[11px] font-medium text-ink/50 mb-1 flex items-center gap-1">
            <IconClock size={11} className="text-ink/50" /> {c.hora}
          </label>
          <input
            type="time"
            className={inputCls}
            value={value.hora}
            onChange={e => set({ hora: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
