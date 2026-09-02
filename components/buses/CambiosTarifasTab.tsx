'use client';
import { useEffect, useState } from 'react';
import { IconCheck, IconX, IconClock } from '@/components/Icons';
import type { CambioTarifa, EstadoCambioTarifa } from './types';
import { cop } from './types';

const ESTADO_LABEL: Record<EstadoCambioTarifa, string> = {
  pendiente: '⏳ Pendiente', auto_aprobada: '✓ Auto-aprobada', aprobada: '✓ Aprobada', rechazada: '✗ Rechazada',
};
const ESTADO_BADGE: Record<EstadoCambioTarifa, string> = {
  pendiente: 'bg-warning/15 text-warning border-warning/25',
  auto_aprobada: 'bg-success/15 text-success border-success/30',
  aprobada: 'bg-success/15 text-success border-success/30',
  rechazada: 'bg-danger/15 text-danger border-danger/25',
};
const TIPO_LABEL: Record<string, string> = { destino: 'Tarifa por destino', hora: 'Tarifa por hora', km: 'Valor por km' };

function parseValor(tipo: string, raw: string): string {
  let v: Record<string, number> = {};
  try { v = JSON.parse(raw); } catch { return raw; }
  if (tipo === 'destino') return `Base ${cop(v.tarifa_base)} · +30% ${cop(v.tarifa_30)}`;
  if (tipo === 'hora') return `${cop(v.tarifa_hora)}/h · mín. ${v.minimo_horas ?? '—'}h · adicional ${cop(v.hora_adicional)}`;
  if (tipo === 'km') return `${cop(v.valor_km)}/km · mín. ${cop(v.tarifa_minima)}`;
  return raw;
}

const FILTROS: { key: '' | EstadoCambioTarifa; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'auto_aprobada', label: 'Auto-aprobada' },
  { key: 'aprobada', label: 'Aprobada' },
  { key: 'rechazada', label: 'Rechazada' },
];

// Sub-sección "🕓 Cambios de tarifas" (§4/§5 del spec): cola de aprobación de ajustes de
// tarifa propuestos por propietarios que quedaron fuera de la banda de tolerancia. Mismo
// patrón visual de Aprobar/Rechazar-con-nota que ya usa el modal de documentos del vehículo
// (revisarDocIndividual en app/dashboard/admin/page.tsx).
export default function CambiosTarifasTab() {
  const [cambios, setCambios] = useState<CambioTarifa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<'' | EstadoCambioTarifa>('pendiente');
  const [rechazando, setRechazando] = useState<{ id: number; nota: string } | null>(null);
  const [accionando, setAccionando] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const url = filtro ? `/api/buses/cambios?estado=${filtro}` : '/api/buses/cambios';
      const res = await fetch(url, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar la cola de cambios de tarifa.'); return; }
      setCambios(d.cambios || []);
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolver = async (cambioId: number, accion: 'aprobar' | 'rechazar', motivo?: string) => {
    setAccionando(cambioId);
    setMsg('');
    try {
      const res = await fetch('/api/buses/cambios', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cambioId, accion, motivo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || 'No se pudo procesar el cambio.'); return; }
      setRechazando(null);
      await cargar();
    } catch {
      setMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setAccionando(null);
    }
  };

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
        {FILTROS.map(f => (
          <button key={f.key || 'todos'} onClick={() => setFiltro(f.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${
              filtro === f.key ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface-2'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {msg && <p className="text-xs text-danger">{msg}</p>}

      {cargando ? (
        <div className="text-center py-14 text-ink/50 text-sm">Cargando…</div>
      ) : cambios.length === 0 ? (
        <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
          <IconClock size={40} className="text-ink/20 mx-auto mb-3" />
          <p className="text-ink/50">No hay cambios de tarifa {filtro ? `en estado "${filtro}"` : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cambios.map(c => (
            <div key={c.id} className="bg-surface-2 rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-ink">{c.marca} {c.modelo}{c.placa ? ` (${c.placa})` : ''}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${ESTADO_BADGE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
                  </div>
                  <p className="text-sm text-ink/50 mt-0.5">Propietario: {c.propietario_nombre} · {TIPO_LABEL[c.tipo] || c.tipo}{c.destino ? ` — ${c.destino}` : ''} · Categoría {c.categoria}</p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="bg-surface rounded-xl border border-border px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-ink/40">Valor anterior</p>
                      <p className="text-ink/70">{parseValor(c.tipo, c.valor_anterior)}</p>
                    </div>
                    <div className="bg-accent-light rounded-xl border border-accent/20 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-accent">Valor propuesto</p>
                      <p className="text-ink font-medium">{parseValor(c.tipo, c.valor_propuesto)}</p>
                    </div>
                  </div>
                  {c.estado === 'rechazada' && c.motivo_admin && (
                    <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-2.5 py-1.5 mt-2">Motivo: {c.motivo_admin}</p>
                  )}
                  <p className="text-[11px] text-ink/40 mt-1.5">{c.created_at}</p>
                </div>

                {c.estado === 'pendiente' && (
                  <div className="flex-shrink-0">
                    {rechazando?.id === c.id ? (
                      <div className="space-y-1.5 w-64">
                        <textarea rows={2} placeholder="Motivo del rechazo (opcional)…"
                          value={rechazando.nota}
                          onChange={e => setRechazando(r => r ? { ...r, nota: e.target.value } : null)}
                          className="w-full border border-danger/25 rounded-xl px-3 py-2 text-xs text-ink bg-surface resize-none" />
                        <div className="flex gap-1.5">
                          <button disabled={accionando === c.id} onClick={() => resolver(c.id, 'rechazar', rechazando.nota)}
                            className="flex-1 text-xs font-bold bg-danger hover:bg-danger/90 text-white px-3 py-1.5 rounded-xl transition disabled:opacity-50">
                            {accionando === c.id ? 'Guardando…' : 'Confirmar rechazo'}
                          </button>
                          <button onClick={() => setRechazando(null)} className="text-xs border border-border text-ink/60 px-3 py-1.5 rounded-xl hover:bg-surface transition">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button disabled={accionando === c.id} onClick={() => resolver(c.id, 'aprobar')}
                          className="flex items-center gap-1 text-xs font-bold bg-success hover:bg-success/90 text-white px-3 py-1.5 rounded-xl transition disabled:opacity-50">
                          <IconCheck size={12} /> {accionando === c.id ? '…' : 'Aprobar'}
                        </button>
                        <button onClick={() => setRechazando({ id: c.id, nota: '' })}
                          className="flex items-center gap-1 text-xs font-bold border border-danger/25 text-danger hover:bg-danger/10 px-3 py-1.5 rounded-xl transition">
                          <IconX size={12} /> Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
