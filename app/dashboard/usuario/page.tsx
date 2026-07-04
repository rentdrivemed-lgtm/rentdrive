'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconCar, IconSearch, IconCalendar, IconX } from '@/components/Icons';
import { fechaHoraRecogida, calcularPoliticaCancelacion } from '@/lib/cancelacion';

type Reserva = {
  id: number; vehiculo_id: number; marca: string; modelo: string; anio: number;
  fecha_inicio: string; fecha_fin: string; total: number;
  pago_estado: string; estado: string; recogida?: string;
  cancelacion_pct?: number | null;
};
type User = { nombre: string; correo: string; rol: string };

const estadoColor: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning',
  confirmada: 'bg-brand-muted text-ink',
  en_curso:   'bg-success/15 text-success',
  completada: 'bg-surface text-ink/50',
  cancelada:  'bg-danger/15 text-danger',
};

export default function DashboardUsuario() {
  const [user, setUser] = useState<User | null>(null);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [modal, setModal] = useState<{ reserva: Reserva; pct: number; motivo: string } | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const cargarReservas = () =>
    fetch('/api/reservas').then(r => r.json()).then(d => setReservas(d.reservas || [])).catch(() => {});

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.rol !== 'usuario') { router.push('/login'); return; }
      setUser(d.user);
    }).catch(() => router.push('/login'));
    cargarReservas();
  }, [router]);

  const abrirConfirmacion = (r: Reserva) => {
    let recogida: { hora?: string } = {};
    try { recogida = JSON.parse(r.recogida || '{}'); } catch { recogida = {}; }
    const pickup = fechaHoraRecogida(r.fecha_inicio, recogida);
    const { pct, motivo } = calcularPoliticaCancelacion(pickup);
    setError('');
    setModal({ reserva: r, pct, motivo });
  };

  const confirmarCancelacion = async () => {
    if (!modal) return;
    setCancelando(true);
    setError('');
    try {
      const res = await fetch(`/api/reservas/${modal.reserva.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'cancelada' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No pudimos cancelar la reserva. Intenta de nuevo.'); return; }
      setReservas(rs => rs.map(x => x.id === modal.reserva.id
        ? { ...x, estado: 'cancelada', cancelacion_pct: data.cancelacion_pct ?? modal.pct }
        : x));
      setModal(null);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setCancelando(false);
    }
  };

  if (!user) return <div className="text-center py-20 text-ink/40">Cargando...</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">

      {/* Header */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Hola, {user.nombre}</h1>
          <p className="text-ink/50 text-sm mt-0.5">{user.correo}</p>
        </div>
        <Link href="/"
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-sm shadow-accent/20">
          <IconSearch size={15} /> Buscar vehículos
        </Link>
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Total reservas',  value: reservas.length,                                             color: 'bg-brand-muted text-ink'  },
          { label: 'Confirmadas',     value: reservas.filter(r => r.estado === 'confirmada').length,       color: 'bg-brand-muted text-ink'  },
          { label: 'En curso',        value: reservas.filter(r => r.estado === 'en_curso').length,         color: 'bg-success/10 text-success' },
          { label: 'Canceladas',      value: reservas.filter(r => r.estado === 'cancelada').length,        color: 'bg-danger/10 text-danger'     },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 border border-border ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs opacity-70 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-ink flex items-center gap-2">
          <IconCalendar size={16} className="text-accent" /> Mis reservas
        </h2>
        {reservas.length > 0 && (
          <Link href="/historial" className="text-xs text-accent hover:text-accent-hover font-medium transition">
            Ver historial completo →
          </Link>
        )}
      </div>

      {reservas.length === 0 ? (
        <div className="bg-surface-2 rounded-2xl shadow-sm border border-border p-10 text-center">
          <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
          <p className="text-ink/40 font-medium mb-2">No tienes reservas aún.</p>
          <Link href="/" className="text-accent font-semibold hover:text-accent-hover text-sm transition">
            ¡Busca un vehículo!
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {reservas.map(r => (
            <div key={r.id} className="bg-surface-2 rounded-2xl shadow-sm border border-border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-ink">{r.marca} {r.modelo} {r.anio}</h3>
                <p className="text-sm text-ink/50 mt-0.5">{r.fecha_inicio} → {r.fecha_fin}</p>
                <p className="text-accent font-bold mt-1">${r.total.toLocaleString('es-CO')}</p>
                {r.estado === 'cancelada' && typeof r.cancelacion_pct === 'number' && (
                  <p className="text-xs text-danger mt-1">
                    {r.cancelacion_pct > 0 ? `Se cobró el ${r.cancelacion_pct}% ($${(r.total * r.cancelacion_pct / 100).toLocaleString('es-CO')})` : 'Cancelada sin costo'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${estadoColor[r.estado] || 'bg-surface'}`}>
                  {r.estado}
                </span>
                {(r.estado === 'confirmada' || r.estado === 'pendiente') && (
                  <button onClick={() => abrirConfirmacion(r)}
                    className="text-xs border border-danger/25 text-danger px-3 py-1.5 rounded-xl hover:bg-danger/10 transition font-medium"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de confirmación de cancelación */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => !cancelando && setModal(null)}>
          <div className="bg-surface-2 rounded-2xl border border-border shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-bold text-ink text-lg">¿Cancelar esta reserva?</h3>
              <button onClick={() => !cancelando && setModal(null)} className="text-ink/40 hover:text-ink" aria-label="Cerrar">
                <IconX size={18} />
              </button>
            </div>
            <p className="text-sm text-ink/60 mb-2">{modal.reserva.marca} {modal.reserva.modelo} {modal.reserva.anio} · {modal.reserva.fecha_inicio} → {modal.reserva.fecha_fin}</p>
            <div className={`rounded-xl px-4 py-3 text-sm mb-4 ${modal.pct > 0 ? 'bg-danger/10 text-danger border border-danger/25' : 'bg-success/10 text-success border border-success/25'}`}>
              {modal.motivo}
              {modal.pct > 0 && (
                <p className="font-bold mt-1">Monto a cobrar: ${(modal.reserva.total * modal.pct / 100).toLocaleString('es-CO')}</p>
              )}
            </div>
            {error && <p className="text-xs text-danger font-medium mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setModal(null)} disabled={cancelando}
                className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-xl border border-border text-ink/70 hover:bg-surface transition disabled:opacity-60">
                Volver
              </button>
              <button onClick={confirmarCancelacion} disabled={cancelando}
                className="flex-1 text-sm font-bold px-4 py-2.5 rounded-xl bg-danger text-white hover:bg-danger/90 transition disabled:opacity-60">
                {cancelando ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
