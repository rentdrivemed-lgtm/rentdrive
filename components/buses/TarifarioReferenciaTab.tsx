'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { IconExport, IconUpload } from '@/components/Icons';
import { BUS_CATEGORIAS, COL_DESTINO, type CategoriaBus } from '@/lib/busCotizador';
import type { TarifaDestinoRef, TarifaHoraRef, TarifaKmRef } from './types';

// Las 12 columnas de precio de bus_tarifas_destino_ref, en el mismo orden que usa
// PUT /api/buses/tarifas-referencia (CAMPOS_CATEGORIA en ese archivo). IMPORTANTE: ese PUT
// hace upsert de LAS 12 A LA VEZ (un campo ausente en el body se guarda como NULL), así que
// el formulario de edición siempre debe enviar las 12, no solo la categoría que se esté
// mirando — de lo contrario se borrarían en silencio las tarifas de las demás categorías
// de ese destino.
const CAMPOS_CATEGORIA = [
  'px12', 'px12_30', 'px14', 'px14_30', 'px16', 'px16_30',
  'px19', 'px19_30', 'px22_25', 'px22_25_30', 'px30_42', 'px30_42_30',
] as const;
type CampoCategoria = typeof CAMPOS_CATEGORIA[number];

type DestinoForm = { destino: string; km: string; observaciones: string; activo: boolean } & Record<CampoCategoria, string>;

function formVacio(): DestinoForm {
  const base: Record<CampoCategoria, string> = {} as Record<CampoCategoria, string>;
  for (const c of CAMPOS_CATEGORIA) base[c] = '';
  return { destino: '', km: '', observaciones: '', activo: true, ...base };
}

function filaAForm(row: TarifaDestinoRef): DestinoForm {
  const base: Record<CampoCategoria, string> = {} as Record<CampoCategoria, string>;
  for (const c of CAMPOS_CATEGORIA) {
    const v = row[c];
    base[c] = v === null || v === undefined ? '' : String(v);
  }
  return {
    destino: row.destino,
    km: row.km === null || row.km === undefined ? '' : String(row.km),
    observaciones: row.observaciones || '',
    activo: Number(row.activo) !== 0,
    ...base,
  };
}

function cop(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${Math.round(n).toLocaleString('es-CO')}`;
}

// CSV con exactamente las mismas 15 columnas que plantilla_tarifario_buses.csv (raíz del
// repo), para poder reabrirlo/editarlo en Excel con el mismo formato que se usaría para
// importar (script de la Etapa 9, aún no construido — ver nota en el botón "Importar CSV").
const CABECERAS_CSV = ['destino', 'km', ...CAMPOS_CATEGORIA, 'observaciones'] as const;

function escaparCSV(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function destinosACSV(destinos: TarifaDestinoRef[]): string {
  const filas = destinos.map(d => CABECERAS_CSV.map(h => escaparCSV((d as unknown as Record<string, unknown>)[h])).join(','));
  return [CABECERAS_CSV.join(','), ...filas].join('\n');
}

function descargarCSV(destinos: TarifaDestinoRef[]) {
  const csv = destinosACSV(destinos);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tarifario-buses-referencia-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Formulario de alta/edición de UN destino — se usa tanto para "+ Nuevo destino" como para
// "Editar" una fila existente. Siempre expone las 12 columnas de precio (agrupadas por
// categoría) para que el admin nunca pierda de vista qué otras categorías tiene cargadas ese
// destino mientras edita una sola.
function DestinoFormPanel({
  inicial, guardando, onGuardar, onCancelar, esNuevo,
}: {
  inicial: DestinoForm; guardando: boolean; esNuevo: boolean;
  onGuardar: (f: DestinoForm) => void; onCancelar: () => void;
}) {
  const [f, setF] = useState<DestinoForm>(inicial);
  const set = <K extends keyof DestinoForm>(k: K, v: DestinoForm[K]) => setF(prev => ({ ...prev, [k]: v }));

  return (
    <div className="bg-surface border border-accent/25 rounded-2xl p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Destino</label>
          <input value={f.destino} onChange={e => set('destino', e.target.value)} disabled={!esNuevo}
            placeholder="Ej. Guatapé"
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink disabled:opacity-60" />
        </div>
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">KM (referencia)</label>
          <input type="number" value={f.km} onChange={e => set('km', e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-ink/70 mb-2">
            <input type="checkbox" checked={f.activo} onChange={e => set('activo', e.target.checked)} />
            Activo (visible en cotizaciones)
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {BUS_CATEGORIAS.map(cat => {
          const col = COL_DESTINO[cat.codigo];
          return (
            <div key={cat.codigo} className="bg-surface-2 rounded-xl border border-border p-3">
              <p className="text-[11px] font-semibold text-ink/60 mb-2">{cat.nombre}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-ink/40 block mb-0.5">Base</label>
                  <input type="number" value={f[col.base as CampoCategoria]} onChange={e => set(col.base as CampoCategoria, e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-ink" />
                </div>
                <div>
                  <label className="text-[10px] text-ink/40 block mb-0.5">+30%</label>
                  <input type="number" value={f[col.recargo as CampoCategoria]} onChange={e => set(col.recargo as CampoCategoria, e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-ink" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <label className="text-[11px] text-ink/50 block mb-1">Observaciones</label>
        <input value={f.observaciones} onChange={e => set('observaciones', e.target.value)}
          className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
      </div>

      <div className="flex gap-2">
        <button disabled={guardando || !f.destino.trim()} onClick={() => onGuardar(f)}
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

type Vista = 'destino' | 'hora' | 'km';

// Sub-sección "Tarifario de referencia" (§5 del spec): las 3 tablas por categoría
// (bus_tarifas_destino_ref / _hora_ref / _valor_km_ref) que sirven de punto de partida a
// cada bus nuevo y de banda de comparación para aprobar/rechazar cambios (§4).
export default function TarifarioReferenciaTab() {
  const [vista, setVista] = useState<Vista>('destino');
  const [destinos, setDestinos] = useState<TarifaDestinoRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Destinos
  const [categoriaFiltro, setCategoriaFiltro] = useState<CategoriaBus>(BUS_CATEGORIAS[0].codigo);
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<string | null>(null); // destino en edición
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [guardandoDestino, setGuardandoDestino] = useState(false);

  // Hora / Km — edición siempre visible por fila (solo 6 categorías, pocos campos).
  const [horaForm, setHoraForm] = useState<Record<string, { tarifa_hora: string; minimo_horas: string; hora_adicional: string }>>({});
  const [kmForm, setKmForm] = useState<Record<string, { valor_km: string; tarifa_minima: string }>>({});
  const [guardandoCat, setGuardandoCat] = useState<string | null>(null);

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch('/api/buses/tarifas-referencia', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar el tarifario de referencia.'); return; }
      const dest: TarifaDestinoRef[] = d.destinos || [];
      const hor: TarifaHoraRef[] = d.horas || [];
      const km: TarifaKmRef[] = d.km || [];
      setDestinos(dest);

      const hf: Record<string, { tarifa_hora: string; minimo_horas: string; hora_adicional: string }> = {};
      for (const cat of BUS_CATEGORIAS) {
        const r = hor.find(h => h.categoria === cat.codigo);
        hf[cat.codigo] = {
          tarifa_hora: r ? String(r.tarifa_hora) : '0',
          minimo_horas: r ? String(r.minimo_horas) : '4',
          hora_adicional: r ? String(r.hora_adicional) : '0',
        };
      }
      setHoraForm(hf);

      const kf: Record<string, { valor_km: string; tarifa_minima: string }> = {};
      for (const cat of BUS_CATEGORIAS) {
        const r = km.find(k => k.categoria === cat.codigo);
        kf[cat.codigo] = { valor_km: r ? String(r.valor_km) : '0', tarifa_minima: r ? String(r.tarifa_minima) : '0' };
      }
      setKmForm(kf);
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const guardarDestino = async (f: DestinoForm) => {
    setGuardandoDestino(true);
    setMsg('');
    try {
      const body: Record<string, unknown> = {
        tipo: 'destino', destino: f.destino.trim(), km: f.km, observaciones: f.observaciones, activo: f.activo ? 1 : 0,
      };
      for (const c of CAMPOS_CATEGORIA) body[c] = f[c];
      const res = await fetch('/api/buses/tarifas-referencia', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || 'No se pudo guardar el destino.'); return; }
      setMsg('✓ Destino guardado');
      setEditando(null);
      setNuevoAbierto(false);
      await cargar();
    } catch {
      setMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setGuardandoDestino(false);
    }
  };

  const guardarHora = async (categoria: CategoriaBus) => {
    const f = horaForm[categoria];
    if (!f) return;
    setGuardandoCat(`hora:${categoria}`);
    setMsg('');
    try {
      const res = await fetch('/api/buses/tarifas-referencia', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'hora', categoria, ...f }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || 'No se pudo guardar la tarifa por hora.'); return; }
      setMsg('✓ Tarifa por hora guardada');
      await cargar();
    } catch {
      setMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setGuardandoCat(null);
    }
  };

  const guardarKm = async (categoria: CategoriaBus) => {
    const f = kmForm[categoria];
    if (!f) return;
    setGuardandoCat(`km:${categoria}`);
    setMsg('');
    try {
      const res = await fetch('/api/buses/tarifas-referencia', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'km', categoria, ...f }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || 'No se pudo guardar el valor por km.'); return; }
      setMsg('✓ Valor por km guardado');
      await cargar();
    } catch {
      setMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setGuardandoCat(null);
    }
  };

  const destinosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? destinos.filter(d => d.destino.toLowerCase().includes(q)) : destinos;
  }, [destinos, busqueda]);

  const [copiado, setCopiado] = useState(false);
  const copiarCSV = async () => {
    try {
      await navigator.clipboard.writeText(destinosACSV(destinos));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setMsg('No se pudo copiar al portapapeles.');
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

  if (cargando) return <div className="text-center py-14 text-ink/50 text-sm">Cargando tarifario…</div>;

  const colFiltro = COL_DESTINO[categoriaFiltro];

  return (
    <div className="space-y-4">
      {/* Vista interna: destino / hora / km */}
      <div className="flex gap-1 flex-wrap">
        {([
          { key: 'destino', label: 'Por destino' },
          { key: 'hora', label: 'Por hora' },
          { key: 'km', label: 'Por km' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setVista(t.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${
              vista === t.key ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface-2'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{msg}</p>}

      {/* ── POR DESTINO ── */}
      {vista === 'destino' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select value={categoriaFiltro} onChange={e => setCategoriaFiltro(e.target.value as CategoriaBus)}
                className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
                {BUS_CATEGORIAS.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
              </select>
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar destino…"
                className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40 w-56" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => descargarCSV(destinos)} disabled={destinos.length === 0}
                className="flex items-center gap-1.5 text-xs font-semibold border border-border text-ink/70 px-3 py-2 rounded-xl hover:bg-surface-2 transition disabled:opacity-50">
                <IconExport size={14} /> Exportar CSV
              </button>
              <button onClick={copiarCSV} disabled={destinos.length === 0}
                className="text-xs font-semibold border border-border text-ink/70 px-3 py-2 rounded-xl hover:bg-surface-2 transition disabled:opacity-50">
                {copiado ? '✓ Copiado' : 'Copiar CSV'}
              </button>
              <button disabled title="Requiere el script de importación de la Etapa 9 (scripts/importar-tarifario-buses.ts), todavía no construido."
                className="flex items-center gap-1.5 text-xs font-semibold border border-border text-ink/30 px-3 py-2 rounded-xl cursor-not-allowed">
                <IconUpload size={14} /> Importar CSV (próximamente)
              </button>
              <button onClick={() => { setNuevoAbierto(v => !v); setEditando(null); }}
                className="text-xs font-semibold bg-accent hover:bg-accent-hover text-white px-3 py-2 rounded-xl transition">
                {nuevoAbierto ? 'Cancelar' : '+ Nuevo destino'}
              </button>
            </div>
          </div>

          {nuevoAbierto && (
            <DestinoFormPanel inicial={formVacio()} guardando={guardandoDestino} esNuevo
              onGuardar={guardarDestino} onCancelar={() => setNuevoAbierto(false)} />
          )}

          {destinos.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <p className="text-ink/50">Todavía no hay destinos cargados en el tarifario de referencia.</p>
              <p className="text-xs text-ink/40 mt-1">Se cargan importando el tarifario original (ver plantilla_tarifario_buses.csv) o agregándolos uno por uno con &quot;+ Nuevo destino&quot;.</p>
            </div>
          ) : (
            <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                    <th className="px-4 py-3 font-semibold">Destino</th>
                    <th className="px-4 py-3 font-semibold">KM</th>
                    <th className="px-4 py-3 font-semibold">Base ({categoriaFiltro})</th>
                    <th className="px-4 py-3 font-semibold">+30%</th>
                    <th className="px-4 py-3 font-semibold">Estado</th>
                    <th className="px-4 py-3 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {destinosFiltrados.map(d => (
                    <Fragment key={d.id}>
                      <tr className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 font-medium text-ink">{d.destino}</td>
                        <td className="px-4 py-3 text-ink/70">{d.km ?? '—'}</td>
                        <td className="px-4 py-3 text-ink/70">{cop(d[colFiltro.base as keyof TarifaDestinoRef] as number | null)}</td>
                        <td className="px-4 py-3 text-ink/70">{cop(d[colFiltro.recargo as keyof TarifaDestinoRef] as number | null)}</td>
                        <td className="px-4 py-3">
                          {Number(d.activo) ? (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-success/15 text-success border-success/30">Activo</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-ink/10 text-ink/60 border-border">Inactivo</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => { setEditando(editando === d.destino ? null : d.destino); setNuevoAbierto(false); }}
                            className="text-xs border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                            {editando === d.destino ? 'Cerrar' : 'Editar'}
                          </button>
                        </td>
                      </tr>
                      {editando === d.destino && (
                        <tr>
                          <td colSpan={6} className="px-4 pb-4">
                            <DestinoFormPanel inicial={filaAForm(d)} guardando={guardandoDestino}
                              onGuardar={guardarDestino} onCancelar={() => setEditando(null)} esNuevo={false} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {destinosFiltrados.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/40">Ningún destino coincide con la búsqueda.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── POR HORA ── */}
      {vista === 'hora' && (
        <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                <th className="px-4 py-3 font-semibold">Categoría</th>
                <th className="px-4 py-3 font-semibold">Tarifa / hora</th>
                <th className="px-4 py-3 font-semibold">Mínimo (horas)</th>
                <th className="px-4 py-3 font-semibold">Hora adicional</th>
                <th className="px-4 py-3 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {BUS_CATEGORIAS.map(cat => {
                const f = horaForm[cat.codigo] || { tarifa_hora: '0', minimo_horas: '4', hora_adicional: '0' };
                const clave = `hora:${cat.codigo}`;
                return (
                  <tr key={cat.codigo} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{cat.nombre}</td>
                    <td className="px-4 py-3">
                      <input type="number" value={f.tarifa_hora}
                        onChange={e => setHoraForm(prev => ({ ...prev, [cat.codigo]: { ...f, tarifa_hora: e.target.value } }))}
                        className="w-32 bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-ink" />
                    </td>
                    <td className="px-4 py-3">
                      <input type="number" value={f.minimo_horas}
                        onChange={e => setHoraForm(prev => ({ ...prev, [cat.codigo]: { ...f, minimo_horas: e.target.value } }))}
                        className="w-24 bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-ink" />
                    </td>
                    <td className="px-4 py-3">
                      <input type="number" value={f.hora_adicional}
                        onChange={e => setHoraForm(prev => ({ ...prev, [cat.codigo]: { ...f, hora_adicional: e.target.value } }))}
                        className="w-28 bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-ink" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => guardarHora(cat.codigo)} disabled={guardandoCat === clave}
                        className="text-xs font-semibold bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-xl transition disabled:opacity-60">
                        {guardandoCat === clave ? 'Guardando…' : 'Guardar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── POR KM ── */}
      {vista === 'km' && (
        <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                <th className="px-4 py-3 font-semibold">Categoría</th>
                <th className="px-4 py-3 font-semibold">Valor / km</th>
                <th className="px-4 py-3 font-semibold">Tarifa mínima</th>
                <th className="px-4 py-3 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {BUS_CATEGORIAS.map(cat => {
                const f = kmForm[cat.codigo] || { valor_km: '0', tarifa_minima: '0' };
                const clave = `km:${cat.codigo}`;
                return (
                  <tr key={cat.codigo} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{cat.nombre}</td>
                    <td className="px-4 py-3">
                      <input type="number" value={f.valor_km}
                        onChange={e => setKmForm(prev => ({ ...prev, [cat.codigo]: { ...f, valor_km: e.target.value } }))}
                        className="w-32 bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-ink" />
                    </td>
                    <td className="px-4 py-3">
                      <input type="number" value={f.tarifa_minima}
                        onChange={e => setKmForm(prev => ({ ...prev, [cat.codigo]: { ...f, tarifa_minima: e.target.value } }))}
                        className="w-32 bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-ink" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => guardarKm(cat.codigo)} disabled={guardandoCat === clave}
                        className="text-xs font-semibold bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-xl transition disabled:opacity-60">
                        {guardandoCat === clave ? 'Guardando…' : 'Guardar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
