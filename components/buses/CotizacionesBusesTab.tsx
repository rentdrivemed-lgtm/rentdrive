'use client';
import { useEffect, useMemo, useState } from 'react';
import { IconRoute } from '@/components/Icons';
import type { CotizacionBus, EstadoCotizacionBus } from './types';
import { cop } from './types';

const ESTADOS: { key: '' | EstadoCotizacionBus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'nueva', label: 'Nueva' },
  { key: 'contactada', label: 'Contactada' },
  { key: 'confirmada', label: 'Confirmada' },
  { key: 'descartada', label: 'Descartada' },
];
const ESTADO_BADGE: Record<EstadoCotizacionBus, string> = {
  nueva: 'bg-accent-light text-accent border-accent/20',
  contactada: 'bg-warning/15 text-warning border-warning/25',
  confirmada: 'bg-success/15 text-success border-success/30',
  descartada: 'bg-ink/10 text-ink/50 border-border',
};
const MODO_LABEL: Record<string, string> = { destino: 'Por destino', trayecto: 'Por trayecto (km)', horas: 'Por horas' };

// Sub-sección "Cotizaciones" (§5/§8 del spec): historial de solicitudes de clientes desde
// la vitrina pública (POST /api/buses/cotizar). GET /api/buses/cotizaciones ya filtra por
// `estado` en el servidor; cliente y fecha se filtran en el cliente sobre lo ya cargado
// (el endpoint no expone esos dos parámetros).
export default function CotizacionesBusesTab() {
  const [cotizaciones, setCotizaciones] = useState<CotizacionBus[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'' | EstadoCotizacionBus>('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [cambiandoId, setCambiandoId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const url = filtroEstado ? `/api/buses/cotizaciones?estado=${filtroEstado}` : '/api/buses/cotizaciones';
      const res = await fetch(url, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar las cotizaciones.'); return; }
      setCotizaciones(d.cotizaciones || []);
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, [filtroEstado]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiarEstado = async (id: number, estado: EstadoCotizacionBus) => {
    setCambiandoId(id);
    setMsg('');
    try {
      const res = await fetch('/api/buses/cotizaciones', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, estado }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || 'No se pudo actualizar el estado.'); return; }
      setCotizaciones(cs => cs.map(c => c.id === id ? { ...c, estado } : c));
    } catch {
      setMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setCambiandoId(null);
    }
  };

  const filtradas = useMemo(() => {
    return cotizaciones.filter(c => {
      if (filtroCliente.trim()) {
        const q = filtroCliente.trim().toLowerCase();
        const enCliente = c.cliente_nombre?.toLowerCase().includes(q) || c.cliente_telefono?.toLowerCase().includes(q);
        const enBus = c.marca?.toLowerCase().includes(q) || c.modelo?.toLowerCase().includes(q) || c.placa?.toLowerCase().includes(q);
        if (!enCliente && !enBus) return false;
      }
      const fecha = (c.fecha_servicio || c.created_at || '').slice(0, 10);
      if (filtroDesde && fecha < filtroDesde) return false;
      if (filtroHasta && fecha > filtroHasta) return false;
      return true;
    });
  }, [cotizaciones, filtroCliente, filtroDesde, filtroHasta]);

  const totalFiltrado = filtradas.reduce((s, c) => s + (c.total || 0), 0);

  if (error) {
    return (
      <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
        <p className="text-danger mb-4">{error}</p>
        <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {ESTADOS.map(e => (
          <button key={e.key || 'todas'} onClick={() => setFiltroEstado(e.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${
              filtroEstado === e.key ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface-2'
            }`}>
            {e.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Cliente / bus</label>
          <input value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)} placeholder="Nombre, teléfono, placa…"
            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink w-56" />
        </div>
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Desde</label>
          <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)}
            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
        </div>
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Hasta</label>
          <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)}
            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
        </div>
        <p className="text-xs text-ink/50 pb-2">{filtradas.length} cotización{filtradas.length !== 1 ? 'es' : ''} · Total: <span className="font-bold text-ink">{cop(totalFiltrado)}</span></p>
      </div>

      {msg && <p className="text-xs text-danger">{msg}</p>}

      {cargando ? (
        <div className="text-center py-14 text-ink/50 text-sm">Cargando…</div>
      ) : filtradas.length === 0 ? (
        <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
          <IconRoute size={40} className="text-ink/20 mx-auto mb-3" />
          <p className="text-ink/50">No hay cotizaciones que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                <th className="px-4 py-3 font-semibold">N°</th>
                <th className="px-4 py-3 font-semibold">Bus</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Modalidad</th>
                <th className="px-4 py-3 font-semibold">Fecha servicio</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(c => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-ink/70 font-mono text-xs">{c.numero}</td>
                  <td className="px-4 py-3 text-ink/70">{c.marca} {c.modelo}{c.placa ? ` (${c.placa})` : ''}</td>
                  <td className="px-4 py-3 text-ink/70">
                    <p>{c.cliente_nombre || '—'}</p>
                    {c.cliente_telefono && <p className="text-xs text-ink/40">{c.cliente_telefono}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {MODO_LABEL[c.modo] || c.modo}
                    {c.destino ? ` · ${c.destino}` : c.km ? ` · ${c.km} km` : c.horas ? ` · ${c.horas}h` : ''}
                    {Number(c.con_recargo) === 1 && <span className="ml-1 text-[10px] text-accent">(+30%)</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/70 text-xs">{c.fecha_servicio || '—'}</td>
                  <td className="px-4 py-3 font-semibold text-ink">{cop(c.total)}</td>
                  <td className="px-4 py-3">
                    <select value={c.estado} disabled={cambiandoId === c.id}
                      onChange={e => cambiarEstado(c.id, e.target.value as EstadoCotizacionBus)}
                      className={`text-xs font-semibold px-2 py-1 rounded-full border ${ESTADO_BADGE[c.estado]} disabled:opacity-50`}>
                      <option value="nueva">Nueva</option>
                      <option value="contactada">Contactada</option>
                      <option value="confirmada">Confirmada</option>
                      <option value="descartada">Descartada</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
