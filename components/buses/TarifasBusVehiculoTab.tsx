'use client';
import { Fragment, useEffect, useState } from 'react';
import { IconClock } from '@/components/Icons';
import { cop, type TarifaDestinoVeh, type TarifaHoraVeh, type TarifaKmVeh, type CambioTarifaVehiculo, type EstadoCambioTarifa } from './types';

// Sub-sección "Tarifas de mi bus" + "Historial de cambios de este bus" (COTIZADOR-BUSES-SPEC.md
// §6, Etapa 4): mismos 3 campos por tipo que ve el admin en el tarifario de referencia
// (components/buses/TarifarioReferenciaTab.tsx), pero acotados a UN vehiculo_id — el propietario
// solo ve/edita las tarifas de SU bus, nunca las 12 columnas por categoría de la referencia.
// Usa exclusivamente GET/PUT /api/buses/tarifas-vehiculo (Etapa 2, ya cerrada); el propio GET
// ya trae el historial de bus_tarifas_cambios de este bus, así que no hace falta otra llamada.

type Vista = 'destino' | 'hora' | 'km' | 'historial';

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

type DestinoForm = { destino: string; tarifa_base: string; tarifa_30: string };
const DESTINO_FORM_VACIO: DestinoForm = { destino: '', tarifa_base: '', tarifa_30: '' };

export default function TarifasBusVehiculoTab({ vehiculoId }: { vehiculoId: number }) {
  const [vista, setVista] = useState<Vista>('destino');
  const [destinos, setDestinos] = useState<TarifaDestinoVeh[]>([]);
  const [cambios, setCambios] = useState<CambioTarifaVehiculo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; texto: string } | null>(null);

  // Por destino
  const [busqueda, setBusqueda] = useState('');
  const [editandoDestino, setEditandoDestino] = useState<string | null>(null);
  const [nuevoDestinoAbierto, setNuevoDestinoAbierto] = useState(false);
  const [destinoForm, setDestinoForm] = useState<DestinoForm>(DESTINO_FORM_VACIO);
  const [guardandoDestino, setGuardandoDestino] = useState(false);

  // Por hora / por km
  const [horaForm, setHoraForm] = useState({ tarifa_hora: '0', minimo_horas: '4', hora_adicional: '0' });
  const [kmForm, setKmForm] = useState({ valor_km: '0', tarifa_minima: '0' });
  const [guardandoHora, setGuardandoHora] = useState(false);
  const [guardandoKm, setGuardandoKm] = useState(false);

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch(`/api/buses/tarifas-vehiculo?vehiculoId=${vehiculoId}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar las tarifas de este bus.'); return; }
      const dest: TarifaDestinoVeh[] = d.destinos || [];
      const h: TarifaHoraVeh | null = d.hora ?? null;
      const k: TarifaKmVeh | null = d.km ?? null;
      setDestinos(dest);
      setCambios(d.cambios || []);
      setHoraForm({
        tarifa_hora: h ? String(h.tarifa_hora) : '0',
        minimo_horas: h ? String(h.minimo_horas) : '4',
        hora_adicional: h ? String(h.hora_adicional) : '0',
      });
      setKmForm({ valor_km: k ? String(k.valor_km) : '0', tarifa_minima: k ? String(k.tarifa_minima) : '0' });
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  // Cambia el bus seleccionado (vehiculoId) → recarga todo desde cero y limpia estado de
  // edición del bus anterior, para no arrastrar un formulario de destino abierto de otro bus.
  useEffect(() => {
    setVista('destino');
    setEditandoDestino(null);
    setNuevoDestinoAbierto(false);
    setFeedback(null);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiculoId]);

  const feedbackDeRespuesta = (aplicado: boolean) => {
    setFeedback(aplicado
      ? { ok: true, texto: '✅ Aplicado — ya es visible para los clientes.' }
      : { ok: false, texto: '⏳ Enviado para aprobación — mientras tanto sigue cobrándose la tarifa anterior.' });
  };

  const guardarDestino = async (f: DestinoForm) => {
    const tarifa_base = Number(f.tarifa_base);
    const tarifa_30 = Number(f.tarifa_30);
    if (!f.destino.trim() || !Number.isFinite(tarifa_base) || tarifa_base <= 0 || !Number.isFinite(tarifa_30) || tarifa_30 <= 0) {
      setFeedback({ ok: false, texto: 'Completa destino, tarifa base y tarifa +30% (mayores a cero).' });
      return;
    }
    setGuardandoDestino(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/buses/tarifas-vehiculo', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculoId, tipo: 'destino', destino: f.destino.trim(), valores: { tarifa_base, tarifa_30 } }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setFeedback({ ok: false, texto: d.error || 'No se pudo guardar la tarifa de este destino.' }); return; }
      feedbackDeRespuesta(!!d.aplicado);
      setEditandoDestino(null);
      setNuevoDestinoAbierto(false);
      setDestinoForm(DESTINO_FORM_VACIO);
      await cargar();
    } catch {
      setFeedback({ ok: false, texto: 'Sin conexión — intenta de nuevo.' });
    } finally {
      setGuardandoDestino(false);
    }
  };

  const guardarHora = async () => {
    const tarifa_hora = Number(horaForm.tarifa_hora);
    const minimo_horas = Number(horaForm.minimo_horas);
    const hora_adicional = Number(horaForm.hora_adicional) || 0;
    if (!Number.isFinite(tarifa_hora) || tarifa_hora <= 0 || !Number.isFinite(minimo_horas) || minimo_horas <= 0 || hora_adicional < 0) {
      setFeedback({ ok: false, texto: 'Revisa los valores de la tarifa por hora.' });
      return;
    }
    setGuardandoHora(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/buses/tarifas-vehiculo', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculoId, tipo: 'hora', valores: { tarifa_hora, minimo_horas, hora_adicional } }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setFeedback({ ok: false, texto: d.error || 'No se pudo guardar la tarifa por hora.' }); return; }
      feedbackDeRespuesta(!!d.aplicado);
      await cargar();
    } catch {
      setFeedback({ ok: false, texto: 'Sin conexión — intenta de nuevo.' });
    } finally {
      setGuardandoHora(false);
    }
  };

  const guardarKm = async () => {
    const valor_km = Number(kmForm.valor_km);
    const tarifa_minima = Number(kmForm.tarifa_minima) || 0;
    if (!Number.isFinite(valor_km) || valor_km <= 0 || tarifa_minima < 0) {
      setFeedback({ ok: false, texto: 'Revisa los valores del valor por km.' });
      return;
    }
    setGuardandoKm(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/buses/tarifas-vehiculo', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculoId, tipo: 'km', valores: { valor_km, tarifa_minima } }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setFeedback({ ok: false, texto: d.error || 'No se pudo guardar el valor por km.' }); return; }
      feedbackDeRespuesta(!!d.aplicado);
      await cargar();
    } catch {
      setFeedback({ ok: false, texto: 'Sin conexión — intenta de nuevo.' });
    } finally {
      setGuardandoKm(false);
    }
  };

  const destinosFiltrados = busqueda.trim()
    ? destinos.filter(d => d.destino.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : destinos;

  if (error) {
    return (
      <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
        <p className="text-danger mb-4">{error}</p>
        <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
      </div>
    );
  }

  if (cargando) return <div className="text-center py-14 text-ink/50 text-sm">Cargando tarifas…</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {([
          { key: 'destino', label: 'Por destino' },
          { key: 'hora', label: 'Por hora' },
          { key: 'km', label: 'Por km' },
          { key: 'historial', label: `Historial (${cambios.length})` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => { setVista(t.key); setFeedback(null); }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${
              vista === t.key ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface-2'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <p className={`text-sm font-medium rounded-xl px-3 py-2 border ${
          feedback.ok ? 'bg-success/10 text-success border-success/25' : 'bg-warning/10 text-warning border-warning/25'
        }`}>
          {feedback.texto}
        </p>
      )}

      {/* ── POR DESTINO ── */}
      {vista === 'destino' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar destino…"
              className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40 w-56" />
            <button onClick={() => { setNuevoDestinoAbierto(v => !v); setEditandoDestino(null); setDestinoForm(DESTINO_FORM_VACIO); setFeedback(null); }}
              className="text-xs font-semibold bg-accent hover:bg-accent-hover text-white px-3 py-2 rounded-xl transition">
              {nuevoDestinoAbierto ? 'Cancelar' : '+ Nuevo destino'}
            </button>
          </div>

          {nuevoDestinoAbierto && (
            <DestinoFormPanel form={destinoForm} setForm={setDestinoForm} guardando={guardandoDestino}
              esNuevo onGuardar={() => guardarDestino(destinoForm)} onCancelar={() => setNuevoDestinoAbierto(false)} />
          )}

          {destinos.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <p className="text-ink/50">Todavía no hay destinos cargados para este bus.</p>
              <p className="text-xs text-ink/40 mt-1">Se copian automáticamente de la referencia al registrar el bus, o los puedes agregar con &quot;+ Nuevo destino&quot;.</p>
            </div>
          ) : (
            <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                    <th className="px-4 py-3 font-semibold">Destino</th>
                    <th className="px-4 py-3 font-semibold">KM</th>
                    <th className="px-4 py-3 font-semibold">Base</th>
                    <th className="px-4 py-3 font-semibold">+30%</th>
                    <th className="px-4 py-3 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {destinosFiltrados.map(d => (
                    <Fragment key={d.id}>
                      <tr className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 font-medium text-ink">{d.destino}</td>
                        <td className="px-4 py-3 text-ink/70">{d.km ?? '—'}</td>
                        <td className="px-4 py-3 text-ink/70">{cop(d.tarifa_base)}</td>
                        <td className="px-4 py-3 text-ink/70">{cop(d.tarifa_30)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => {
                              if (editandoDestino === d.destino) { setEditandoDestino(null); return; }
                              setEditandoDestino(d.destino);
                              setNuevoDestinoAbierto(false);
                              setDestinoForm({ destino: d.destino, tarifa_base: String(d.tarifa_base), tarifa_30: String(d.tarifa_30) });
                            }}
                            className="text-xs border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                            {editandoDestino === d.destino ? 'Cerrar' : 'Editar'}
                          </button>
                        </td>
                      </tr>
                      {editandoDestino === d.destino && (
                        <tr>
                          <td colSpan={5} className="px-4 pb-4">
                            <DestinoFormPanel form={destinoForm} setForm={setDestinoForm} guardando={guardandoDestino}
                              esNuevo={false} onGuardar={() => guardarDestino(destinoForm)} onCancelar={() => setEditandoDestino(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {destinosFiltrados.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/40">Ningún destino coincide con la búsqueda.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── POR HORA ── */}
      {vista === 'hora' && (
        <div className="bg-surface-2 rounded-2xl border border-border p-4 space-y-3 max-w-md">
          <div>
            <label className="text-[11px] text-ink/50 block mb-1">Tarifa / hora</label>
            <input type="number" value={horaForm.tarifa_hora} onChange={e => setHoraForm(f => ({ ...f, tarifa_hora: e.target.value }))}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
          </div>
          <div>
            <label className="text-[11px] text-ink/50 block mb-1">Mínimo de horas contratables</label>
            <input type="number" value={horaForm.minimo_horas} onChange={e => setHoraForm(f => ({ ...f, minimo_horas: e.target.value }))}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
          </div>
          <div>
            <label className="text-[11px] text-ink/50 block mb-1">Hora adicional</label>
            <input type="number" value={horaForm.hora_adicional} onChange={e => setHoraForm(f => ({ ...f, hora_adicional: e.target.value }))}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
          </div>
          <button onClick={guardarHora} disabled={guardandoHora}
            className="text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl transition disabled:opacity-60">
            {guardandoHora ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}

      {/* ── POR KM ── */}
      {vista === 'km' && (
        <div className="bg-surface-2 rounded-2xl border border-border p-4 space-y-3 max-w-md">
          <div>
            <label className="text-[11px] text-ink/50 block mb-1">Valor / km</label>
            <input type="number" value={kmForm.valor_km} onChange={e => setKmForm(f => ({ ...f, valor_km: e.target.value }))}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
          </div>
          <div>
            <label className="text-[11px] text-ink/50 block mb-1">Tarifa mínima</label>
            <input type="number" value={kmForm.tarifa_minima} onChange={e => setKmForm(f => ({ ...f, tarifa_minima: e.target.value }))}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
          </div>
          <button onClick={guardarKm} disabled={guardandoKm}
            className="text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl transition disabled:opacity-60">
            {guardandoKm ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {vista === 'historial' && (
        cambios.length === 0 ? (
          <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
            <IconClock size={40} className="text-ink/20 mx-auto mb-3" />
            <p className="text-ink/50">Todavía no has propuesto cambios de tarifa para este bus.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cambios.map(c => (
              <div key={c.id} className="bg-surface-2 rounded-2xl border border-border p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ink text-sm">{TIPO_LABEL[c.tipo] || c.tipo}{c.destino ? ` — ${c.destino}` : ''}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${ESTADO_BADGE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
                </div>
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
            ))}
          </div>
        )
      )}
    </div>
  );
}

// Formulario de alta/edición de UN destino de este bus — solo 2 precios (base y +30%), a
// diferencia del panel admin (TarifarioReferenciaTab), que expone las 12 columnas de las 6
// categorías porque ahí SÍ hace falta ver/editar todas a la vez.
function DestinoFormPanel({
  form, setForm, guardando, esNuevo, onGuardar, onCancelar,
}: {
  form: DestinoForm; setForm: (f: DestinoForm) => void; guardando: boolean; esNuevo: boolean;
  onGuardar: () => void; onCancelar: () => void;
}) {
  return (
    <div className="bg-surface border border-accent/25 rounded-2xl p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Destino</label>
          <input value={form.destino} onChange={e => setForm({ ...form, destino: e.target.value })} disabled={!esNuevo}
            placeholder="Ej. Guatapé"
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink disabled:opacity-60" />
        </div>
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Tarifa base</label>
          <input type="number" value={form.tarifa_base} onChange={e => setForm({ ...form, tarifa_base: e.target.value })}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
        </div>
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Tarifa +30%</label>
          <input type="number" value={form.tarifa_30} onChange={e => setForm({ ...form, tarifa_30: e.target.value })}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
        </div>
      </div>
      <div className="flex gap-2">
        <button disabled={guardando || !form.destino.trim()} onClick={onGuardar}
          className="text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl transition disabled:opacity-60">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onCancelar} className="text-sm border border-border text-ink/60 px-4 py-2 rounded-xl hover:bg-surface-2 transition">
          Cancelar
        </button>
      </div>
    </div>
  );
}
