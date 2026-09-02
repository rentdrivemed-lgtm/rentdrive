'use client';
import { useEffect, useState } from 'react';
import { IconCar, IconCheck } from '@/components/Icons';
import { BUS_CATEGORIAS, categoriaPorPasajeros, CAPACIDAD_MIN_PASAJEROS, CAPACIDAD_MAX_PASAJEROS } from '@/lib/busCotizador';
import type { BusRow } from './types';
import TarifasBusVehiculoTab from './TarifasBusVehiculoTab';

function categoriaLabel(cat: string | null): string {
  if (!cat) return '—';
  return BUS_CATEGORIAS.find(c => c.codigo === cat)?.nombre || cat;
}

const FORM_INICIAL = {
  marca: '', modelo: '', anio: '', placa: '',
  capacidad_pasajeros: '', ubicacion: 'Medellín', descripcion: '',
};

// Sección "🚌 Buses" del dashboard del propietario (COTIZADOR-BUSES-SPEC.md §6, Etapa 4).
// A diferencia del formulario de carros (fuertemente acoplado a precio_dia/valor_comercial/
// categorías de rentabilidad de lib/rentabilidad.ts), este es un flujo de alta SEPARADO y
// simple: marca, modelo, año, placa, capacidad de pasajeros, ubicación, descripción — la
// categoría (§1 del spec) la asigna el servidor a partir de la capacidad, nunca se elige a
// mano (POST /api/buses).
//
// Solo usa los endpoints ya existentes de app/api/buses/* (Etapa 2/3, no se tocan en esta
// ronda): GET/POST /api/buses, PUT /api/buses/[id] (toggle disponible). Las tarifas de cada
// bus + su historial de cambios viven en TarifasBusVehiculoTab.tsx (GET/PUT
// /api/buses/tarifas-vehiculo).
export default function MisBusesPanel({ propietarioId }: { propietarioId: number }) {
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null);
  const [cambiandoDisponible, setCambiandoDisponible] = useState<number | null>(null);

  // Alta de bus
  const [formAbierto, setFormAbierto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [publicando, setPublicando] = useState(false);
  const [msg, setMsg] = useState('');
  const [exito, setExito] = useState<{ marca: string; modelo: string; categoria: string } | null>(null);

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch(`/api/buses?propietarioId=${propietarioId}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar tus buses.'); return; }
      const bs: BusRow[] = d.buses || [];
      setBuses(bs);
      // Mantiene la selección vigente si sigue existiendo; si no, selecciona el primero.
      setSeleccionadoId(prev => (prev && bs.some(b => b.id === prev)) ? prev : (bs[0]?.id ?? null));
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const capacidadNum = Number(form.capacidad_pasajeros);
  const categoriaEstimada = Number.isInteger(capacidadNum) && capacidadNum >= CAPACIDAD_MIN_PASAJEROS && capacidadNum <= CAPACIDAD_MAX_PASAJEROS
    ? categoriaPorPasajeros(capacidadNum)
    : null;

  const registrarBus = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setExito(null);
    if (!form.marca.trim() || !form.modelo.trim() || !form.anio || !form.placa.trim()) {
      setMsg('Marca, modelo, año y placa son obligatorios.');
      return;
    }
    if (!Number.isInteger(capacidadNum) || capacidadNum < CAPACIDAD_MIN_PASAJEROS || capacidadNum > CAPACIDAD_MAX_PASAJEROS) {
      setMsg(`La capacidad de pasajeros debe ser un número entero entre ${CAPACIDAD_MIN_PASAJEROS} y ${CAPACIDAD_MAX_PASAJEROS}.`);
      return;
    }
    setPublicando(true);
    try {
      const res = await fetch('/api/buses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marca: form.marca.trim(), modelo: form.modelo.trim(), anio: Number(form.anio),
          placa: form.placa.trim(), capacidad_pasajeros: capacidadNum,
          ubicacion: form.ubicacion.trim() || 'Medellín', descripcion: form.descripcion.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || 'No se pudo registrar el bus.'); return; }
      setExito({ marca: form.marca.trim(), modelo: form.modelo.trim(), categoria: categoriaLabel(d.bus_categoria) });
      setForm(FORM_INICIAL);
      setFormAbierto(false);
      await cargar();
      setSeleccionadoId(d.id);
    } catch {
      setMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setPublicando(false);
    }
  };

  const toggleDisponible = async (b: BusRow) => {
    const nuevo = b.disponible ? 0 : 1;
    setCambiandoDisponible(b.id);
    try {
      const res = await fetch(`/api/buses/${b.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disponible: nuevo }),
      });
      if (res.ok) {
        setBuses(bs => bs.map(x => x.id === b.id ? { ...x, disponible: nuevo } : x));
      } else {
        const d = await res.json().catch(() => ({}));
        setMsg((d as { error?: string }).error || 'No se pudo cambiar la disponibilidad.');
      }
    } catch {
      setMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setCambiandoDisponible(null);
    }
  };

  const busSeleccionado = buses.find(b => b.id === seleccionadoId) ?? null;

  if (error) {
    return (
      <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
        <p className="text-danger mb-4">{error}</p>
        <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-ink text-lg flex items-center gap-2">🚌 Mis buses</h2>
          <p className="text-sm text-ink/50">Registra tus buses para el cotizador de viajes ocasionales y ajusta sus tarifas.</p>
        </div>
        <button onClick={() => { setFormAbierto(v => !v); setMsg(''); setExito(null); }}
          className="glow-accent inline-flex items-center gap-2 text-white font-semibold px-5 h-11 rounded-xl text-sm transition hover:-translate-y-0.5"
          style={{ background: 'var(--gradient-accent)' }}>
          <IconCheck size={16} /> {formAbierto ? 'Cancelar' : '+ Registrar bus'}
        </button>
      </div>

      {exito && (
        <div className="bg-success/10 border border-success/25 rounded-2xl p-4">
          <p className="text-success font-semibold text-sm">✅ {exito.marca} {exito.modelo} registrado — categoría asignada: {exito.categoria}.</p>
          <p className="text-xs text-ink/60 mt-1">
            Sus tarifas iniciales ya se copiaron de la referencia de esa categoría, así que arranca con precios razonables. Puedes ajustarlas en &quot;Tarifas de mi bus&quot; más abajo. El bus queda como &quot;No disponible&quot; hasta que lo actives.
          </p>
        </div>
      )}

      {formAbierto && (
        <form onSubmit={registrarBus} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Marca</label>
              <input value={form.marca} onChange={e => setForm(f => ({ ...f, marca: e.target.value }))}
                placeholder="Ej. Chevrolet" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Modelo</label>
              <input value={form.modelo} onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))}
                placeholder="Ej. NPR Buseta" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Año</label>
              <input type="number" value={form.anio} onChange={e => setForm(f => ({ ...f, anio: e.target.value }))}
                placeholder="Ej. 2020" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Placa</label>
              <input value={form.placa} onChange={e => setForm(f => ({ ...f, placa: e.target.value.toUpperCase() }))}
                placeholder="Ej. PWY837" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Capacidad de pasajeros</label>
              <input type="number" value={form.capacidad_pasajeros} onChange={e => setForm(f => ({ ...f, capacidad_pasajeros: e.target.value }))}
                placeholder="Ej. 19" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
              {categoriaEstimada && (
                <p className="text-[11px] text-accent mt-1">Categoría estimada: {categoriaLabel(categoriaEstimada)}</p>
              )}
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Ubicación</label>
              <input value={form.ubicacion} onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))}
                className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-ink/50 block mb-1">Descripción (opcional)</label>
            <textarea rows={2} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Cuéntale a los clientes sobre tu bus: comodidades, estado, etc."
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink resize-none" />
          </div>

          {msg && <p className="text-xs text-danger">{msg}</p>}

          <button disabled={publicando}
            className="text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl transition disabled:opacity-60">
            {publicando ? 'Registrando…' : 'Registrar bus'}
          </button>
        </form>
      )}

      {cargando ? (
        <div className="text-center py-14 text-ink/50 text-sm">Cargando tus buses…</div>
      ) : buses.length === 0 ? (
        !formAbierto && (
          <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
            <IconCar size={40} className="text-ink/20 mx-auto mb-3" />
            <p className="text-ink/50">Todavía no tienes buses registrados.</p>
            <p className="text-xs text-ink/40 mt-1">Usa &quot;+ Registrar bus&quot; para publicar tu primer bus en el cotizador de viajes ocasionales.</p>
          </div>
        )
      ) : (
        <>
          {msg && !formAbierto && <p className="text-xs text-danger">{msg}</p>}

          {/* Lista / selector de buses (solo se muestra selector si hay más de uno) */}
          <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                  <th className="px-4 py-3 font-semibold">Marca / modelo</th>
                  <th className="px-4 py-3 font-semibold">Placa</th>
                  <th className="px-4 py-3 font-semibold">Capacidad → categoría</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {buses.map(b => (
                  <tr key={b.id}
                    onClick={() => setSeleccionadoId(b.id)}
                    className={`border-b border-border/60 last:border-0 cursor-pointer transition ${
                      seleccionadoId === b.id ? 'bg-accent-light' : 'hover:bg-surface'
                    }`}>
                    <td className="px-4 py-3 font-medium text-ink">{b.marca} {b.modelo} {b.anio}</td>
                    <td className="px-4 py-3 text-ink/70">{b.placa || '—'}</td>
                    <td className="px-4 py-3 text-ink/70">{b.capacidad_pasajeros ?? '—'} pax → {categoriaLabel(b.bus_categoria)}</td>
                    <td className="px-4 py-3">
                      {b.disponible ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-success/15 text-success border-success/30">Disponible</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-ink/10 text-ink/60 border-border">No disponible</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={e => { e.stopPropagation(); toggleDisponible(b); }} disabled={cambiandoDisponible === b.id}
                        title={b.disponible ? 'Desactivar (se oculta del catálogo público)' : 'Activar (visible para clientes)'}
                        className={`text-xs border px-2.5 py-1.5 rounded-xl transition font-medium disabled:opacity-50 ${
                          b.disponible ? 'border-success/30 bg-success/10 text-success hover:bg-success/15' : 'border-border text-ink/60 hover:bg-surface-2'
                        }`}>
                        {cambiandoDisponible === b.id ? '…' : b.disponible ? '✓ Activo' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {busSeleccionado && (
            <div>
              <h3 className="font-bold text-ink mb-1">
                Tarifas de mi bus — {busSeleccionado.marca} {busSeleccionado.modelo} {busSeleccionado.placa ? `(${busSeleccionado.placa})` : ''}
              </h3>
              <p className="text-xs text-ink/50 mb-3">
                Categoría {categoriaLabel(busSeleccionado.bus_categoria)}. Los cambios dentro de un rango razonable respecto a la referencia se aplican de inmediato; fuera de ese rango quedan pendientes de aprobación del administrador.
              </p>
              <TarifasBusVehiculoTab vehiculoId={busSeleccionado.id} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
