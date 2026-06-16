'use client';
import { MUNICIPIOS, getMunicipio, esAeropuerto, RECARGO_AEROPUERTO, type Lugar } from '@/lib/lugares';
import { IconPin, IconClock, IconPlane } from '@/components/Icons';

type Props = {
  label: string;
  value: Lugar;
  onChange: (l: Lugar) => void;
  /** Color del encabezado/acento. */
  tone?: 'accent' | 'brand';
};

export default function LugarSelector({ label, value, onChange, tone = 'accent' }: Props) {
  const muni = getMunicipio(value.municipio);
  const aeropuerto = esAeropuerto(value.municipio);
  const set = (patch: Partial<Lugar>) => onChange({ ...value, ...patch });
  const toneText = tone === 'brand' ? 'text-ink' : 'text-accent';

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
        <label className="text-[11px] font-medium text-ink/50 block mb-1">Municipio / lugar</label>
        <select
          className={inputCls}
          value={value.municipio}
          onChange={e => set({ municipio: e.target.value, barrio: '' })}
        >
          <option value="">Selecciona un lugar…</option>
          {MUNICIPIOS.map(m => (
            <option key={m.id} value={m.id}>{m.nombre}</option>
          ))}
        </select>
      </div>

      {/* Aeropuerto: aviso de recargo + campo opcional terminal/vuelo */}
      {aeropuerto && (
        <>
          <div className="flex items-start gap-2 bg-accent-light border border-accent/20 rounded-xl px-3 py-2">
            <IconPlane size={14} className="text-accent flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-accent font-medium">
              Punto especial — aplica un recargo de ${RECARGO_AEROPUERTO.toLocaleString('es-CO')} por este trayecto.
            </p>
          </div>
          <div>
            <label className="text-[11px] font-medium text-ink/50 block mb-1">Terminal / N.º de vuelo (opcional)</label>
            <input
              type="text"
              placeholder="Ej: Terminal 1, vuelo AV8420"
              className={inputCls}
              value={value.direccion}
              onChange={e => set({ direccion: e.target.value })}
            />
          </div>
        </>
      )}

      {/* Municipio normal: barrio + dirección exacta */}
      {value.municipio && !aeropuerto && (
        <>
          <div>
            <label className="text-[11px] font-medium text-ink/50 block mb-1">Barrio</label>
            <select
              className={inputCls}
              value={value.barrio}
              onChange={e => set({ barrio: e.target.value })}
            >
              <option value="">Selecciona el barrio…</option>
              {(muni?.barrios ?? []).map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-ink/50 block mb-1">Dirección exacta</label>
            <input
              type="text"
              placeholder="Ej: Carrera 43A # 5-15, apto 302 / Torre 2"
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
            <IconClock size={11} className="text-ink/40" /> Hora
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
