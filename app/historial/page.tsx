'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { exportarExcel, exportarPDF } from '@/lib/export';
import { IconHistory, IconExport, IconSearch, IconFilter, IconArrowL } from '@/components/Icons';

type Reserva = {
  id: number;
  vehiculo_id: number;
  marca: string;
  modelo: string;
  anio: number;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  total: number;
  estado: string;
  pago_estado: string;
  usuario_nombre: string;
  propietario_nombre: string;
};
type Stats = {
  total: number;
  ingresos: number;
  confirmadas: number;
  completadas: number;
  canceladas: number;
};
type User = { id: number; nombre: string; rol: string };

const ESTADOS = ['', 'pendiente', 'confirmada', 'en_curso', 'completada', 'cancelada'];
const PAGOS   = ['', 'pagado', 'pendiente', 'cancelado'];

const estadoStyle: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning',
  confirmada: 'bg-brand-muted text-ink',
  en_curso:   'bg-success/15 text-success',
  completada: 'bg-surface text-ink/50',
  cancelada:  'bg-danger/15 text-danger',
};
const pagoStyle: Record<string, string> = {
  pagado:    'bg-success/15 text-success',
  pendiente: 'bg-warning/15 text-warning',
  cancelado: 'bg-danger/15 text-danger',
};

function fmt(n: number) { return n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }); }
function dias(a: string, b: string) { return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000)); }

export default function HistorialPage() {
  const router = useRouter();
  const [user, setUser]       = useState<User | null>(null);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const [filtros, setFiltros] = useState({
    estado: '', pagoEstado: '', fechaDesde: '', fechaHasta: '', busqueda: '',
  });
  const [aplicados, setAplicados] = useState(filtros);
  const [exportando, setExportando] = useState<'pdf' | 'excel' | null>(null);
  const [errorCarga, setErrorCarga] = useState('');

  const cargar = useCallback(async (f: typeof filtros) => {
    setLoading(true);
    setErrorCarga('');
    try {
      const p = new URLSearchParams();
      if (f.estado)     p.set('estado', f.estado);
      if (f.pagoEstado) p.set('pagoEstado', f.pagoEstado);
      if (f.fechaDesde) p.set('fechaDesde', f.fechaDesde);
      if (f.fechaHasta) p.set('fechaHasta', f.fechaHasta);
      if (f.busqueda)   p.set('busqueda', f.busqueda);
      const res = await fetch('/api/reservas?' + p.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorCarga('No pudimos cargar tu historial. Intenta de nuevo.'); return; }
      setReservas(data.reservas || []);
      setStats(data.stats || null);
    } catch {
      setErrorCarga('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user) { router.push('/login'); return; }
      setUser(d.user);
    }).catch(() => router.push('/login'));
    cargar(aplicados);
  }, [router, cargar]);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    setAplicados(filtros);
    cargar(filtros);
  };

  const limpiar = () => {
    const vacio = { estado: '', pagoEstado: '', fechaDesde: '', fechaHasta: '', busqueda: '' };
    setFiltros(vacio);
    setAplicados(vacio);
    cargar(vacio);
  };

  const hayFiltros = Object.values(aplicados).some(Boolean);

  const filtrosLabel = hayFiltros
    ? [
        aplicados.busqueda   && `Búsqueda: "${aplicados.busqueda}"`,
        aplicados.estado     && `Estado: ${aplicados.estado}`,
        aplicados.pagoEstado && `Pago: ${aplicados.pagoEstado}`,
        aplicados.fechaDesde && `Desde: ${aplicados.fechaDesde}`,
        aplicados.fechaHasta && `Hasta: ${aplicados.fechaHasta}`,
      ].filter(Boolean).join(' · ')
    : 'Sin filtros aplicados';

  const handleExcel = async () => {
    if (!user) return;
    setExportando('excel');
    try {
      await exportarExcel(reservas, user.rol, filtrosLabel);
    } catch (e) {
      console.error('[historial] Error al exportar Excel:', e instanceof Error ? e.message : e);
    } finally {
      setExportando(null);
    }
  };

  const handlePDF = async () => {
    if (!user || !stats) return;
    setExportando('pdf');
    try {
      await exportarPDF(reservas, user.rol, filtrosLabel, stats);
    } catch (e) {
      console.error('[historial] Error al exportar PDF:', e instanceof Error ? e.message : e);
    } finally {
      setExportando(null);
    }
  };

  const dashHref = user?.rol === 'admin' ? '/dashboard/admin'
    : user?.rol === 'propietario' ? '/dashboard/propietario'
    : '/dashboard/usuario';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center">
            <IconHistory size={20} className="text-ink" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">Historial de reservas</h1>
            {user && <p className="text-xs text-ink/50 capitalize">Vista: {user.rol}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {reservas.length > 0 && (
            <>
              <button onClick={handleExcel} disabled={!!exportando}
                className="flex items-center gap-1.5 bg-success text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-success transition disabled:opacity-60 shadow-sm"
              >
                <IconExport size={14} /> {exportando === 'excel' ? 'Generando…' : 'Excel'}
              </button>
              <button onClick={handlePDF} disabled={!!exportando}
                className="flex items-center gap-1.5 bg-danger/100 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-danger transition disabled:opacity-60 shadow-sm"
              >
                <IconExport size={14} /> {exportando === 'pdf' ? 'Generando…' : 'PDF'}
              </button>
            </>
          )}
          <Link href={dashHref}
            className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover font-medium transition">
            <IconArrowL size={14} /> Dashboard
          </Link>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Total',       value: stats.total,          color: 'bg-brand-muted text-ink'       },
            { label: 'Confirmadas', value: stats.confirmadas,    color: 'bg-brand-muted text-ink'       },
            { label: 'Completadas', value: stats.completadas,    color: 'bg-surface text-ink/60'        },
            { label: 'Canceladas',  value: stats.canceladas,     color: 'bg-danger/10 text-danger'          },
            { label: 'Ingresos',    value: fmt(stats.ingresos),  color: 'bg-success/10 text-success', wide: true },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-3 border border-border ${s.color} ${s.wide ? 'col-span-2 sm:col-span-1' : ''}`}>
              <p className="text-xl font-bold leading-tight">{s.value}</p>
              <p className="text-xs opacity-70 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Panel de filtros */}
      <form onSubmit={buscar} className="bg-surface-2 rounded-2xl shadow-sm border border-border p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Buscar</label>
            <div className="relative">
              <input
                type="text" placeholder="Marca, modelo…"
                className="w-full border border-border rounded-xl pl-8 pr-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={filtros.busqueda}
                onChange={e => setFiltros(f => ({ ...f, busqueda: e.target.value }))}
              />
              <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Estado reserva</label>
            <select
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={filtros.estado}
              onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))}
            >
              {ESTADOS.map(e => <option key={e} value={e}>{e || 'Todos'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Estado pago</label>
            <select
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={filtros.pagoEstado}
              onChange={e => setFiltros(f => ({ ...f, pagoEstado: e.target.value }))}
            >
              {PAGOS.map(p => <option key={p} value={p}>{p || 'Todos'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Desde</label>
            <input type="date"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={filtros.fechaDesde}
              onChange={e => setFiltros(f => ({ ...f, fechaDesde: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Hasta</label>
            <input type="date"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={filtros.fechaHasta}
              onChange={e => setFiltros(f => ({ ...f, fechaHasta: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="submit"
            className="flex items-center gap-1.5 bg-brand hover:bg-brand-hover text-white px-5 py-2 rounded-xl text-sm font-medium transition shadow-sm">
            <IconFilter size={13} /> Buscar
          </button>
          {hayFiltros && (
            <button type="button" onClick={limpiar}
              className="border border-border text-ink/60 px-4 py-2 rounded-xl text-sm hover:bg-surface transition">
              Limpiar
            </button>
          )}
        </div>
      </form>

      {/* Resultados */}
      {loading ? (
        <div className="text-center py-20 text-ink/50">Cargando reservas…</div>
      ) : errorCarga ? (
        <div className="text-center py-20 bg-surface-2 rounded-2xl border border-border">
          <p className="text-ink/60 mb-4">{errorCarga}</p>
          <button onClick={() => cargar(aplicados)} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
        </div>
      ) : reservas.length === 0 ? (
        <div className="text-center py-20 bg-surface-2 rounded-2xl border border-border">
          <IconHistory size={48} className="text-ink/20 mx-auto mb-4" />
          <p className="text-ink/50 font-medium">No hay reservas con esos filtros.</p>
        </div>
      ) : (
        <>
          {/* Vista escritorio */}
          <div className="hidden md:block bg-surface-2 rounded-2xl shadow-sm border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-brand-muted text-ink/60 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Vehículo</th>
                  {user?.rol !== 'usuario'    && <th className="px-4 py-3 text-left">Cliente</th>}
                  {user?.rol !== 'propietario' && user?.rol !== 'usuario' && <th className="px-4 py-3 text-left">Propietario</th>}
                  <th className="px-4 py-3 text-left">Fechas</th>
                  <th className="px-4 py-3 text-left">Días</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reservas.map(r => (
                  <tr key={r.id} className="hover:bg-surface transition">
                    <td className="px-4 py-3 text-ink/40 font-mono text-xs">#{r.id}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{r.marca} {r.modelo}</p>
                      <p className="text-xs text-ink/50">{r.anio} · {r.tipo}</p>
                    </td>
                    {user?.rol !== 'usuario' && (
                      <td className="px-4 py-3 text-ink/70">{r.usuario_nombre}</td>
                    )}
                    {user?.rol !== 'propietario' && user?.rol !== 'usuario' && (
                      <td className="px-4 py-3 text-ink/70">{r.propietario_nombre}</td>
                    )}
                    <td className="px-4 py-3 text-ink/60 whitespace-nowrap text-xs">
                      {r.fecha_inicio}<br />
                      <span className="text-ink/40">→ {r.fecha_fin}</span>
                    </td>
                    <td className="px-4 py-3 text-ink/60 text-center text-sm">{dias(r.fecha_inicio, r.fecha_fin)}</td>
                    <td className="px-4 py-3 text-right font-bold text-ink">{fmt(r.total)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${estadoStyle[r.estado] || 'bg-surface text-ink/50'}`}>
                        {r.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${pagoStyle[r.pago_estado] || 'bg-surface text-ink/50'}`}>
                        {r.pago_estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Vista móvil */}
          <div className="md:hidden space-y-3">
            {reservas.map(r => (
              <div key={r.id} className="bg-surface-2 rounded-2xl shadow-sm border border-border p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-ink">{r.marca} {r.modelo} {r.anio}</p>
                    <p className="text-xs text-ink/50">{r.fecha_inicio} → {r.fecha_fin} · {dias(r.fecha_inicio, r.fecha_fin)} días</p>
                  </div>
                  <p className="font-bold text-accent text-sm">{fmt(r.total)}</p>
                </div>
                {user?.rol !== 'usuario' && (
                  <p className="text-xs text-ink/50 mb-2">Cliente: {r.usuario_nombre}</p>
                )}
                <div className="flex gap-2 flex-wrap">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${estadoStyle[r.estado] || 'bg-surface'}`}>{r.estado}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${pagoStyle[r.pago_estado] || 'bg-surface'}`}>{r.pago_estado}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-ink/40 mt-4 text-right">{reservas.length} resultado{reservas.length !== 1 ? 's' : ''}</p>
        </>
      )}
    </div>
  );
}
