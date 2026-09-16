'use client';
// ── Contratos digitales dentro del panel unificado ──────────────────────────
//
// `components/ContratosPanel.tsx` estaba construido y SIN MONTAR en ninguna pantalla
// (su propio encabezado lo decía: se dejó suelto para no chocar con la rama que está
// tocando el panel de administración). Aquí queda montado por primera vez.
//
// El panel de contratos trabaja sobre UNA reserva (`<ContratosPanel reservaId={…} />`),
// así que esta sección aporta lo único que le faltaba: elegir de qué reserva.
// Desde la vista HOY se llega con la reserva ya elegida (?reserva=N).
import { useCallback, useEffect, useMemo, useState } from 'react';
import ContratosPanel from '@/components/ContratosPanel';
import { IconArrowL, IconSearch } from '@/components/Icons';

type ReservaFila = {
  id: number;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  total: number;
  marca: string;
  modelo: string;
  anio: number;
  usuario_nombre: string;
};

const ESTADO_TONO: Record<string, string> = {
  pendiente: 'bg-warning/15 text-warning',
  confirmada: 'bg-info/15 text-info',
  en_curso: 'bg-success/15 text-success',
  completada: 'bg-surface-3 text-ink/60',
  cancelada: 'bg-danger/15 text-danger',
};

export default function ContratosSeccion({ reservaInicial }: { reservaInicial?: number | null }) {
  const [reservas, setReservas] = useState<ReservaFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [elegida, setElegida] = useState<number | null>(reservaInicial ?? null);

  const cargar = useCallback(() => {
    fetch('/api/reservas', { cache: 'no-store' })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'No se pudieron cargar las reservas.');
        return (d.reservas || []) as ReservaFila[];
      })
      .then(lista => { setReservas(lista); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = reservas.filter(r => r.estado !== 'cancelada');
    if (!q) return base.slice(0, 60);
    return base.filter(r =>
      String(r.id) === q ||
      `${r.usuario_nombre}`.toLowerCase().includes(q) ||
      `${r.marca} ${r.modelo}`.toLowerCase().includes(q),
    ).slice(0, 60);
  }, [reservas, busqueda]);

  if (elegida !== null) {
    const r = reservas.find(x => x.id === elegida);
    return (
      <div className="max-w-4xl">
        <button
          type="button"
          onClick={() => setElegida(null)}
          className="flex items-center gap-1.5 text-xs text-ink/60 hover:text-ink mb-3 transition">
          <IconArrowL size={14} /> Todas las reservas
        </button>
        <div className="mb-4">
          <h2 className="text-lg font-black text-ink">Reserva #{elegida}</h2>
          {r && <p className="text-xs text-ink/50">{r.usuario_nombre} · {r.marca} {r.modelo} {r.anio} · {String(r.fecha_inicio).slice(0, 10)} → {String(r.fecha_fin).slice(0, 10)}</p>}
        </div>
        <ContratosPanel reservaId={elegida} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-4">
        <h1 className="text-xl font-black text-ink tracking-tight">Contratos</h1>
        <p className="text-xs text-ink/50 mt-1">Elige la reserva para ver, emitir o firmar sus documentos.</p>
      </header>

      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40"><IconSearch size={14} /></span>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por cliente, vehículo o número de reserva"
          className="w-full bg-surface-2 border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-accent/50 outline-none"
        />
      </div>

      {error && <p className="text-xs text-danger border border-danger/25 bg-danger/10 rounded-xl px-3 py-2 mb-3">{error}</p>}
      {cargando && <div className="h-24 rounded-2xl shimmer" />}
      {!cargando && !error && filtradas.length === 0 && (
        <p className="text-xs text-ink/50 border border-border rounded-2xl px-4 py-8 text-center">No hay reservas que coincidan.</p>
      )}

      <ul className="space-y-1.5">
        {filtradas.map(r => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setElegida(r.id)}
              className="w-full text-left rounded-xl border border-border bg-surface-2 hover:bg-surface-3 px-3.5 py-2.5 transition">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-ink/40">#{r.id}</span>
                <span className="text-sm font-bold text-ink">{r.usuario_nombre}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${ESTADO_TONO[r.estado] || 'bg-surface-3 text-ink/60'}`}>{r.estado}</span>
              </div>
              <p className="text-[11px] text-ink/50 mt-0.5">
                {r.marca} {r.modelo} {r.anio} · {String(r.fecha_inicio).slice(0, 10)} → {String(r.fecha_fin).slice(0, 10)}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
