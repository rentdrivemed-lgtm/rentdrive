'use client';
import { useState, useEffect, useRef } from 'react';
import { IconArrowL, IconArrowR } from '@/components/Icons';

export type ReservaCalendario = {
  id: number;
  vehiculo_id: number;
  marca: string;
  modelo: string;
  anio: number;
  usuario_nombre: string;
  usuario_correo?: string;
  propietario_nombre?: string;
  fecha_inicio: string;
  fecha_fin: string;
  total: number;
  estado: string;
  /**
   * Cómo se paga: en mostrador es cómo entró la plata (`METODOS_PAGO`); por la web,
   * lo que el cliente dijo que iba a hacer (`METODOS_PAGO_WEB`). NO implica que ya
   * esté pagado: eso lo dice `pago_estado`.
   */
  metodo_pago?: string;
  recogida?: string;
  cancelacion_pct?: number | null;
};

const ESTADO_DOT: Record<string, string> = {
  pendiente:  'bg-warning',
  confirmada: 'bg-brand',
  en_curso:   'bg-success/100',
  completada: 'bg-brand/30',
  cancelada:  'bg-danger',
};
const ESTADO_CHIP: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning',
  confirmada: 'bg-brand-muted text-ink',
  en_curso:   'bg-success/15 text-success',
  completada: 'bg-surface text-ink/50',
  cancelada:  'bg-danger/15 text-danger',
};
const ESTADO_BARRA: Record<string, string> = {
  pendiente:  'bg-warning',
  confirmada: 'bg-brand/80',
  en_curso:   'bg-success/100',
  completada: 'bg-brand/30',
  cancelada:  'bg-danger/15',
};

const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const p2 = (n: number) => String(n).padStart(2, '0');
const fechaStr = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const normalizar = (s: string) => s.slice(0, 10);

export default function CalendarioReservas({ reservas }: { reservas: ReservaCalendario[] }) {
  const hoyDate = new Date();
  const [base, setBase] = useState(() => new Date(hoyDate.getFullYear(), hoyDate.getMonth(), 1));
  const [diaSelec, setDiaSelec] = useState<string | null>(null);
  const autoNavRef = useRef(false);

  // Auto-navegar al mes de la próxima reserva si el mes actual no tiene ninguna
  useEffect(() => {
    if (autoNavRef.current || reservas.length === 0) return;
    autoNavRef.current = true;

    const hoy = new Date();
    const y = hoy.getFullYear(), m = hoy.getMonth();
    const ini = `${y}-${p2(m + 1)}-01`;
    const fin = `${y}-${p2(m + 1)}-${p2(new Date(y, m + 1, 0).getDate())}`;

    const hayEsteMes = reservas.some(r =>
      r.estado !== 'cancelada' &&
      normalizar(r.fecha_inicio) <= fin &&
      normalizar(r.fecha_fin) > ini
    );

    if (!hayEsteMes) {
      const proxima = [...reservas]
        .filter(r => r.estado !== 'cancelada' && normalizar(r.fecha_fin) > ini)
        .sort((a, b) => normalizar(a.fecha_inicio).localeCompare(normalizar(b.fecha_inicio)))[0];
      if (proxima) {
        const [yr, mo] = normalizar(proxima.fecha_inicio).split('-').map(Number);
        setBase(new Date(yr, mo - 1, 1));
      }
    }
  }, [reservas]);

  const año = base.getFullYear();
  const mesN = base.getMonth();

  const offsetLu = (new Date(año, mesN, 1).getDay() + 6) % 7;
  const totalDias = new Date(año, mesN + 1, 0).getDate();
  const celdas: (number | null)[] = [
    ...Array<null>(offsetLu).fill(null),
    ...Array.from({ length: totalDias }, (_, i) => i + 1),
  ];

  const str = (d: number) => `${año}-${p2(mesN + 1)}-${p2(d)}`;
  const hoyStr = fechaStr(hoyDate);

  function enDia(d: number, activas = true) {
    const dia = str(d);
    return reservas.filter(r =>
      (!activas || r.estado !== 'cancelada') &&
      normalizar(r.fecha_inicio) <= dia &&
      normalizar(r.fecha_fin) > dia
    );
  }

  function navMes(delta: number) {
    setBase(new Date(año, mesN + delta, 1));
    setDiaSelec(null);
  }

  const detalles = diaSelec
    ? reservas.filter(r =>
        r.estado !== 'cancelada' &&
        normalizar(r.fecha_inicio) <= diaSelec &&
        normalizar(r.fecha_fin) > diaSelec
      )
    : [];

  // Stats del mes
  const ini = str(1);
  const fin = str(totalDias);
  const reservasMes = reservas.filter(r =>
    r.estado !== 'cancelada' &&
    normalizar(r.fecha_inicio) <= fin &&
    normalizar(r.fecha_fin) > ini
  );
  const ingresosMes = reservasMes.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const diasOcupados = new Set(
    reservasMes.flatMap(r => {
      const days: string[] = [];
      const [sy, sm, sd] = normalizar(r.fecha_inicio).split('-').map(Number);
      const [ey, em, ed] = normalizar(r.fecha_fin).split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const f = new Date(ey, em - 1, ed);
      while (c < f) {
        const ds = fechaStr(c);
        if (ds >= ini && ds <= fin) days.push(ds);
        c.setDate(c.getDate() + 1);
      }
      return days;
    })
  ).size;

  return (
    <div className="space-y-5">
      {/* Mini-stats del mes */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-2 rounded-xl border border-border p-3 text-center">
          <p className="text-xl font-black text-accent">{reservasMes.length}</p>
          <p className="text-[11px] text-ink/50 mt-0.5">Reservas activas</p>
        </div>
        <div className="bg-surface-2 rounded-xl border border-border p-3 text-center">
          <p className="text-xl font-black text-ink">{diasOcupados}</p>
          <p className="text-[11px] text-ink/50 mt-0.5">Días ocupados</p>
        </div>
        <div className="bg-surface-2 rounded-xl border border-border p-3 text-center">
          <p className="text-xl font-black text-accent">${Math.round(ingresosMes / 1000)}k</p>
          <p className="text-[11px] text-ink/50 mt-0.5">Ingresos mes</p>
        </div>
      </div>

      {/* Cabecera de navegación */}
      <div className="flex items-center justify-between">
        <button onClick={() => navMes(-1)} aria-label="Mes anterior"
          className="p-2 rounded-xl hover:bg-brand-muted transition text-ink/60 hover:text-ink">
          <IconArrowL size={16} />
        </button>
        <span className="font-bold text-ink">{MESES[mesN]} {año}</span>
        <button onClick={() => navMes(1)} aria-label="Mes siguiente"
          className="p-2 rounded-xl hover:bg-brand-muted transition text-ink/60 hover:text-ink">
          <IconArrowR size={16} />
        </button>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3">
        {[
          { e: 'confirmada', l: 'Confirmada' },
          { e: 'en_curso',   l: 'En curso' },
          { e: 'pendiente',  l: 'Pendiente' },
          { e: 'completada', l: 'Completada' },
        ].map(({ e, l }) => (
          <div key={e} className="flex items-center gap-1.5 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ESTADO_DOT[e]}`} />
            <span className="text-ink/60">{l}</span>
          </div>
        ))}
      </div>

      {/* Calendario grid */}
      <div className="bg-surface-2 rounded-2xl border border-border overflow-hidden shadow-sm">
        {/* Encabezado días */}
        <div className="grid grid-cols-7 border-b border-border bg-brand-muted">
          {DIAS.map(d => (
            <div key={d} className="py-2 text-center text-[11px] font-bold text-ink/50 uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {/* Celdas */}
        <div className="grid grid-cols-7 auto-rows-[minmax(72px,auto)]">
          {celdas.map((d, i) => {
            if (!d) return (
              <div key={`empty-${i}`}
                className="border-r border-b border-border last:border-r-0 bg-surface/40" />
            );

            const rdDia = enDia(d);
            const dStr = str(d);
            const esHoy = dStr === hoyStr;
            const selec = diaSelec === dStr;
            const nReservas = rdDia.length;

            return (
              <div
                key={dStr}
                role="button" tabIndex={0}
                aria-label={`${dStr}${nReservas > 0 ? `, ${nReservas} reserva${nReservas !== 1 ? 's' : ''}` : ''}`}
                aria-pressed={selec}
                onClick={() => setDiaSelec(selec ? null : dStr)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDiaSelec(selec ? null : dStr); } }}
                className={`border-r border-b border-border last:border-r-0 p-1.5 cursor-pointer transition select-none
                  ${selec ? 'bg-accent/5 ring-1 ring-inset ring-accent/30' : nReservas > 0 ? 'hover:bg-accent/5' : 'hover:bg-surface'}
                `}
              >
                {/* Número del día */}
                <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold mb-1 flex-shrink-0
                  ${esHoy ? 'bg-accent text-white' : 'text-ink/70'}
                `}>
                  {d}
                </div>

                {/* Barras de reservas */}
                <div className="space-y-0.5">
                  {rdDia.slice(0, 3).map(r => (
                    <div
                      key={r.id}
                      title={`${r.marca} ${r.modelo} — ${r.usuario_nombre}`}
                      className={`text-[9px] leading-none px-1 py-0.5 rounded font-semibold truncate text-white ${ESTADO_BARRA[r.estado]}`}
                    >
                      {r.marca} {r.modelo.slice(0, 8)}
                    </div>
                  ))}
                  {nReservas > 3 && (
                    <div className="text-[9px] text-ink/50 pl-1 font-medium">+{nReservas - 3} más</div>
                  )}
                  {nReservas === 0 && (
                    <div className="w-full h-0.5 rounded bg-border mt-1 opacity-0" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Panel de detalle del día seleccionado */}
      {diaSelec && (
        <div className="bg-surface-2 rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-brand-muted flex items-center justify-between">
            <h4 className="font-bold text-ink text-sm">
              {new Date(diaSelec + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h4>
            <span className="text-xs text-ink/50 font-medium">{detalles.length} reserva{detalles.length !== 1 ? 's' : ''}</span>
          </div>

          {detalles.length === 0 ? (
            <div className="px-4 py-6 text-center text-ink/50 text-sm">
              Sin reservas activas este día.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {detalles.map(r => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink text-sm truncate">
                      {r.marca} {r.modelo} {r.anio}
                    </p>
                    <p className="text-xs text-ink/50 truncate">
                      Cliente: {r.usuario_nombre}
                    </p>
                    <p className="text-xs text-ink/50">
                      {r.fecha_inicio} → {r.fecha_fin}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <p className="font-bold text-accent text-sm">${r.total.toLocaleString('es-CO')}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ESTADO_CHIP[r.estado] || 'bg-surface'}`}>
                      {r.estado}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
