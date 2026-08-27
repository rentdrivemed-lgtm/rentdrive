'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconCar, IconSearch, IconCalendar, IconX } from '@/components/Icons';
import { fechaHoraRecogida, calcularPoliticaCancelacion } from '@/lib/cancelacion';
import ReferidosCard from '@/components/ReferidosCard';
import { descargarFacturaPDF, type FacturaPDFDatos } from '@/lib/contabilidad-pdf';

type Reserva = {
  id: number; vehiculo_id: number; marca: string; modelo: string; anio: number;
  fecha_inicio: string; fecha_fin: string; total: number;
  pago_estado: string; estado: string; recogida?: string;
  cancelacion_pct?: number | null;
};
type User = { nombre: string; correo: string; rol: string };

const estadoColor: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning',
  confirmada: 'bg-success/15 text-success',
  en_curso:   'bg-info/15 text-info',
  completada: 'bg-surface-3 text-ink/60',
  cancelada:  'bg-danger/15 text-danger',
};
const estadoLabel: Record<string, string> = {
  pendiente: 'Pendiente', confirmada: 'Confirmada', en_curso: 'En curso',
  completada: 'Completada', cancelada: 'Cancelada',
};

export default function DashboardUsuario() {
  const [user, setUser] = useState<User | null>(null);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [modal, setModal] = useState<{ reserva: Reserva; pct: number; motivo: string } | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [error, setError] = useState('');
  const [facturas, setFacturas] = useState<Record<number, { factura: FacturaPDFDatos | null; empresa: { nombre: string; nit: string } | null }>>({});
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

  // Consulta si ya existe factura para cada reserva pagada (una sola vez por reserva) — así
  // el botón "Descargar factura" solo aparece cuando de verdad hay algo que descargar, sin
  // mostrar un botón roto si el enganche automático todavía no la generó.
  useEffect(() => {
    const pendientes = reservas.filter(r => r.pago_estado === 'pagado' && !(r.id in facturas));
    if (pendientes.length === 0) return;
    pendientes.forEach(r => {
      fetch(`/api/reservas/${r.id}/factura`).then(res => res.json()).then(d => {
        setFacturas(prev => ({ ...prev, [r.id]: { factura: d.factura || null, empresa: d.empresa || null } }));
      }).catch(() => {
        setFacturas(prev => ({ ...prev, [r.id]: { factura: null, empresa: null } }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservas]);

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

  if (!user) return <div className="text-center py-20 text-ink/50">Cargando...</div>;

  const proximos = reservas.filter(r => ['confirmada', 'pendiente', 'en_curso'].includes(r.estado)).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">

      {/* Header (template App Dashboard: saludo grande + subtítulo contextual + CTA en gradiente) */}
      <div className="flex items-end justify-between mb-6 pb-6 border-b border-border flex-wrap gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-ink tracking-[-0.02em]">
            Hola, {user.nombre.split(' ')[0]}
          </h1>
          <p className="text-ink-soft mt-1.5">
            {proximos > 0
              ? `Tienes ${proximos} ${proximos === 1 ? 'viaje próximo' : 'viajes próximos'}. ¡Prepárate para conducir!`
              : 'Sin viajes próximos — encuentra tu próximo carro.'}
          </p>
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <Link href="/soporte"
            className="inline-flex items-center gap-2 border border-border-strong text-ink font-semibold px-5 h-11 rounded-xl text-sm bg-surface-2 hover:bg-surface-3 transition">
            Soporte
          </Link>
          <Link href="/"
            className="glow-accent inline-flex items-center gap-2 text-white font-semibold px-5 h-11 rounded-xl text-sm transition hover:-translate-y-0.5"
            style={{ background: 'var(--gradient-accent)' }}>
            <IconSearch size={16} /> Explorar carros
          </Link>
        </div>
      </div>

      <div className="mb-8">
        <ReferidosCard />
      </div>

      {/* Stats (StatCards del Design System) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-8">
        {[
          { label: 'Total reservas', value: reservas.length,                                       accent: false },
          { label: 'Confirmadas',    value: reservas.filter(r => r.estado === 'confirmada').length, accent: true  },
          { label: 'En curso',       value: reservas.filter(r => r.estado === 'en_curso').length,   accent: false },
          { label: 'Canceladas',     value: reservas.filter(r => r.estado === 'cancelada').length,  accent: false },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-4 sm:p-5 border border-border bg-surface-2 shadow-[var(--shadow-card)]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{s.label}</p>
            <p className={`text-3xl font-black mt-2 font-mono ${s.accent ? 'text-accent' : 'text-ink'}`}
              style={{ fontFeatureSettings: "'tnum' 1" }}>{s.value}</p>
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
          <p className="text-ink/50 font-medium mb-2">No tienes reservas aún.</p>
          <Link href="/" className="text-accent font-semibold hover:text-accent-hover text-sm transition">
            ¡Busca un vehículo!
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {reservas.map(r => (
            <div key={r.id}
              className="bg-surface-2 rounded-2xl border border-border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]">
              {/* Tile del vehículo */}
              <div className="w-14 h-14 rounded-xl bg-surface-3 border border-border flex items-center justify-center flex-shrink-0">
                <IconCar size={24} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-ink text-lg leading-tight">{r.marca} {r.modelo} <span className="text-ink-soft font-semibold">{r.anio}</span></h3>
                <p className="text-sm text-ink-soft mt-0.5 font-mono" style={{ fontFeatureSettings: "'tnum' 1" }}>{r.fecha_inicio} — {r.fecha_fin}</p>
                <p className="text-accent font-bold mt-1 font-mono" style={{ fontFeatureSettings: "'tnum' 1" }}>${r.total.toLocaleString('es-CO')}</p>
                {r.estado === 'cancelada' && typeof r.cancelacion_pct === 'number' && (
                  <p className="text-xs text-danger mt-1">
                    {r.cancelacion_pct > 0 ? `Se cobró el ${r.cancelacion_pct}% ($${(r.total * r.cancelacion_pct / 100).toLocaleString('es-CO')})` : 'Cancelada sin costo'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2.5 flex-wrap sm:justify-end">
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold ${estadoColor[r.estado] || 'bg-surface-3 text-ink/60'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" /> {estadoLabel[r.estado] || r.estado}
                </span>
                <Link href={`/vehiculos/${r.vehiculo_id}`}
                  className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-border-strong text-ink bg-surface hover:bg-surface-3 transition">
                  Ver detalle
                </Link>
                {r.pago_estado === 'pagado' && (
                  facturas[r.id]?.factura && facturas[r.id]?.empresa ? (
                    <button onClick={() => descargarFacturaPDF(facturas[r.id].empresa!, facturas[r.id].factura!)}
                      className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-accent/30 text-accent hover:bg-accent-light transition">
                      Descargar factura
                    </button>
                  ) : (r.id in facturas) ? (
                    <span className="text-xs text-ink/40 px-1">Factura en proceso</span>
                  ) : null
                )}
                {(r.estado === 'confirmada' || r.estado === 'pendiente') && (
                  <button onClick={() => abrirConfirmacion(r)}
                    className="text-xs font-semibold px-3.5 py-2 rounded-xl text-danger hover:bg-danger/10 transition">
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
              <button onClick={() => !cancelando && setModal(null)} className="text-ink/50 hover:text-ink" aria-label="Cerrar">
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
