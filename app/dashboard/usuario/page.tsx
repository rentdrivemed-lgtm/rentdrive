'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconCar, IconSearch, IconCalendar } from '@/components/Icons';

type Reserva = {
  id: number; vehiculo_id: number; marca: string; modelo: string; anio: number;
  fecha_inicio: string; fecha_fin: string; total: number;
  pago_estado: string; estado: string;
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
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.rol !== 'usuario') { router.push('/login'); return; }
      setUser(d.user);
    });
    fetch('/api/reservas').then(r => r.json()).then(d => setReservas(d.reservas || []));
  }, [router]);

  const cancelar = async (id: number) => {
    await fetch(`/api/reservas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'cancelada' }),
    });
    setReservas(r => r.map(x => x.id === id ? { ...x, estado: 'cancelada' } : x));
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
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${estadoColor[r.estado] || 'bg-surface'}`}>
                  {r.estado}
                </span>
                {r.estado === 'confirmada' && (
                  <button onClick={() => cancelar(r.id)}
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
    </div>
  );
}
