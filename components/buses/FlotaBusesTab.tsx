'use client';
import { useEffect, useState } from 'react';
import { IconCar } from '@/components/Icons';
import { BUS_CATEGORIAS } from '@/lib/busCotizador';
import type { BusRow } from './types';

function categoriaLabel(cat: string | null): string {
  if (!cat) return '—';
  return BUS_CATEGORIAS.find(c => c.codigo === cat)?.nombre || cat;
}

// Sub-sección "Flota de buses" (§5 del spec): todos los buses de todos los propietarios,
// con toggle de disponibilidad. `panelAdmin=1` es el mismo query param que ya usa
// GET /api/vehiculos para que el admin vea también los buses no disponibles/pendientes.
export default function FlotaBusesTab() {
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [cambiando, setCambiando] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch('/api/buses?panelAdmin=1', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar la flota de buses.'); return; }
      setBuses(d.buses || []);
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  // Mismo patrón que toggleDisponible en app/dashboard/admin/page.tsx para vehículos: body
  // SOLO con `{ disponible }`, sin campos extra (PUT /api/buses/[id] los ignoraría igual,
  // pero así queda explícito qué se está cambiando).
  const toggleDisponible = async (b: BusRow) => {
    const nuevo = b.disponible ? 0 : 1;
    setCambiando(b.id);
    try {
      const res = await fetch(`/api/buses/${b.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disponible: nuevo }),
      });
      if (res.ok) {
        setBuses(bs => bs.map(x => x.id === b.id ? { ...x, disponible: nuevo } : x));
      } else {
        const d = await res.json().catch(() => ({}));
        alert((d as { error?: string }).error || 'No se pudo cambiar la disponibilidad.');
      }
    } catch {
      alert('Sin conexión — intenta de nuevo.');
    } finally {
      setCambiando(null);
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

  if (cargando) {
    return <div className="text-center py-14 text-ink/50 text-sm">Cargando flota…</div>;
  }

  const filtrados = busqueda.trim()
    ? buses.filter(b => {
        const q = busqueda.trim().toLowerCase();
        return b.marca?.toLowerCase().includes(q) || b.modelo?.toLowerCase().includes(q)
          || b.placa?.toLowerCase().includes(q) || b.propietario_nombre?.toLowerCase().includes(q);
      })
    : buses;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-ink/50">{buses.length} bus{buses.length !== 1 ? 'es' : ''} registrado{buses.length !== 1 ? 's' : ''} en total.</p>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por marca, placa o propietario…"
          className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40 w-64 max-w-full" />
      </div>

      {buses.length === 0 ? (
        <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
          <IconCar size={40} className="text-ink/20 mx-auto mb-3" />
          <p className="text-ink/50">Todavía no hay buses registrados.</p>
        </div>
      ) : (
        <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                <th className="px-4 py-3 font-semibold">Marca / modelo</th>
                <th className="px-4 py-3 font-semibold">Placa</th>
                <th className="px-4 py-3 font-semibold">Capacidad → categoría</th>
                <th className="px-4 py-3 font-semibold">Propietario</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(b => (
                <tr key={b.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{b.marca} {b.modelo} {b.anio}</td>
                  <td className="px-4 py-3 text-ink/70">{b.placa || '—'}</td>
                  <td className="px-4 py-3 text-ink/70">{b.capacidad_pasajeros ?? '—'} pax → {categoriaLabel(b.bus_categoria)}</td>
                  <td className="px-4 py-3 text-ink/70">{b.propietario_nombre}</td>
                  <td className="px-4 py-3">
                    {b.disponible ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-success/15 text-success border-success/30">Disponible</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-ink/10 text-ink/60 border-border">No disponible</span>
                    )}
                    {Number(b.contenido_revision) === 1 && (
                      <span className="ml-1.5 text-xs px-2 py-0.5 rounded-full border bg-danger/15 text-danger border-danger/25">🔞 En revisión</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleDisponible(b)} disabled={cambiando === b.id}
                      title={b.disponible ? 'Desactivar (se oculta del catálogo público)' : 'Activar (visible para clientes)'}
                      className={`text-xs border px-2.5 py-1.5 rounded-xl transition font-medium disabled:opacity-50 ${
                        b.disponible ? 'border-success/30 bg-success/10 text-success hover:bg-success/15' : 'border-border text-ink/60 hover:bg-surface'
                      }`}>
                      {cambiando === b.id ? '…' : b.disponible ? '✓ Activo' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/40">Ningún bus coincide con la búsqueda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
