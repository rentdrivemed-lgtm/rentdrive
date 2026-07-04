'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import CalendarioReserva from '@/components/CalendarioReserva';
import GaleriaVehiculo from '@/components/GaleriaVehiculo';
import LugarSelector from '@/components/LugarSelector';
import { useLang } from '@/contexts/LanguageContext';
import { IconArrowL, IconCalendar, IconPin, IconKey } from '@/components/Icons';
import {
  LUGAR_VACIO, calcularRecargo, lugarValido, cargarLugares, guardarLugares, guardarDestino, type Lugar,
} from '@/lib/lugares';

const T = {
  es: {
    cargando: 'Cargando...', volver: 'Volver al inicio', publicadoPor: 'Publicado por',
    precioEnRevision: 'Precio en revisión por el equipo DrivePass', dia: '/día',
    reservarVehiculo: 'Reservar vehículo', fechasAlquiler: 'Fechas de alquiler',
    recogidaLabel: 'Recogida', devolucionLabel: 'Devolución',
    recargoAeropuerto: 'Recargo aeropuerto', totalEstimado: 'Total estimado',
    noDisponibleAhora: 'No disponible', precioNoDisponible: 'Precio no disponible aún',
    irAlPago: 'Ir al pago', iniciarSesion: 'Iniciar sesión para reservar',
    msgInactivo: 'Este vehículo no está disponible actualmente.', msgFechas: 'Selecciona las fechas en el calendario',
    msgRecogida: 'Completa el lugar y la hora de recogida.', msgEntrega: 'Completa el lugar y la hora de entrega.',
    dia1: (n: number) => `${n} día${n !== 1 ? 's' : ''}`,
    errorVehiculo: 'No pudimos cargar este vehículo. Revisa tu conexión.', reintentar: 'Reintentar',
  },
  en: {
    cargando: 'Loading...', volver: 'Back to home', publicadoPor: 'Listed by',
    precioEnRevision: 'Price under review by the DrivePass team', dia: '/day',
    reservarVehiculo: 'Book vehicle', fechasAlquiler: 'Rental dates',
    recogidaLabel: 'Pickup', devolucionLabel: 'Return',
    recargoAeropuerto: 'Airport surcharge', totalEstimado: 'Estimated total',
    noDisponibleAhora: 'Not available', precioNoDisponible: 'Price not available yet',
    irAlPago: 'Go to payment', iniciarSesion: 'Sign in to book',
    msgInactivo: 'This vehicle is not currently available.', msgFechas: 'Select the dates on the calendar',
    msgRecogida: 'Complete the pickup place and time.', msgEntrega: 'Complete the drop-off place and time.',
    dia1: (n: number) => `${n} day${n !== 1 ? 's' : ''}`,
    errorVehiculo: 'We could not load this vehicle. Check your connection.', reintentar: 'Retry',
  },
};

type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number;
  tipo: string; ubicacion: string; precio_dia: number;
  descripcion: string; fotos: string; fotos_detalle: string;
  propietario_nombre: string; propietario_id: number;
  dias_disponibles: string; placa?: string; disponible?: number;
};
type User = { id: number; nombre: string; rol: string };

export default function VehiculoDetalle() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useLang();
  const c = T[lang];
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [ocupadas, setOcupadas] = useState<string[]>([]);
  const [recogida, setRecogida] = useState<Lugar>({ ...LUGAR_VACIO });
  const [entrega, setEntrega] = useState<Lugar>({ ...LUGAR_VACIO });
  const [msg, setMsg] = useState('');
  const [errorCarga, setErrorCarga] = useState('');

  const cargarVehiculo = () => {
    setErrorCarga('');
    fetch(`/api/vehiculos/${id}`).then(r => r.json()).then(d => { setVehiculo(d.vehiculo); setOcupadas(d.ocupadas || []); })
      .catch(() => setErrorCarga(c.errorVehiculo));
  };

  useEffect(() => {
    cargarVehiculo();
    fetch('/api/auth/me').then(r => r.json()).then(d => setUser(d.user)).catch(() => setUser(null));
    // Precarga lo elegido en el buscador del inicio.
    const { recogida: r, entrega: e } = cargarLugares();
    setRecogida(r);
    setEntrega(e);
  }, [id]);

  const cambiarRecogida = (l: Lugar) => { setRecogida(l); guardarLugares(l, entrega); };
  const cambiarEntrega  = (l: Lugar) => { setEntrega(l);  guardarLugares(recogida, l); };

  const dias = fechaInicio && fechaFin
    ? Math.max(0, Math.ceil((new Date(fechaFin).getTime() - new Date(fechaInicio).getTime()) / 86400000))
    : 0;
  const recargo = calcularRecargo(recogida, entrega);
  const subtotal = vehiculo ? dias * vehiculo.precio_dia : 0;
  const total = subtotal + recargo;
  const carInactivo = vehiculo?.disponible === 0;

  const reservar = () => {
    if (carInactivo) { setMsg(c.msgInactivo); return; }
    if (!fechaInicio || !fechaFin || dias <= 0) { setMsg(c.msgFechas); return; }
    if (!lugarValido(recogida)) { setMsg(c.msgRecogida); return; }
    if (!lugarValido(entrega))  { setMsg(c.msgEntrega); return; }
    guardarLugares(recogida, entrega);
    const p = new URLSearchParams({ vehiculo_id: String(id), fecha_inicio: fechaInicio, fecha_fin: fechaFin });
    const destino = `/pago?${p.toString()}`;
    // Sin sesión: guardamos la reserva en curso y, tras iniciar sesión/registrarse,
    // el usuario vuelve directo a este pago (no se pierde el seguimiento).
    if (!user) { guardarDestino(destino); router.push('/login'); return; }
    router.push(destino);
  };

  if (errorCarga) return (
    <div className="text-center py-20">
      <p className="text-ink/60 mb-4">{errorCarga}</p>
      <button onClick={cargarVehiculo} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">{c.reintentar}</button>
    </div>
  );

  if (!vehiculo) return (
    <div className="text-center py-20 text-ink/50">{c.cargando}</div>
  );

  let fotos: string[] = [];
  try { fotos = JSON.parse(vehiculo.fotos); } catch { fotos = []; }

  let fotosDetalle: Record<string, string> = {};
  try { fotosDetalle = JSON.parse(vehiculo.fotos_detalle || '{}'); } catch { fotosDetalle = {}; }

  // Galería: todas las fotos que subió el propietario (listado + detalle), sin duplicar.
  const galeria = [...new Set([...fotos, ...Object.values(fotosDetalle)].filter(Boolean))] as string[];

  let diasDisponibles: string[] = [];
  try { diasDisponibles = JSON.parse(vehiculo.dias_disponibles || '[]'); } catch { diasDisponibles = []; }

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-accent hover:text-accent-hover text-sm mb-5 font-medium transition">
        <IconArrowL size={14} /> {c.volver}
      </Link>

      <div className="bg-surface-2 rounded-3xl shadow-sm border border-border overflow-hidden">
        <div className="p-6 grid md:grid-cols-2 gap-6">
          {/* Info + galería */}
          <div>
            {/* Galería con transición de las fotos del propietario */}
            <div className="relative mb-5">
              <GaleriaVehiculo fotos={galeria} />
              <span className="absolute top-3 right-3 z-20 bg-brand/80 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full capitalize">
                {vehiculo.tipo}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-ink mb-1">{vehiculo.marca} {vehiculo.modelo}</h1>
            <p className="text-ink/50 text-sm mb-1 flex items-center gap-1.5">
              <IconPin size={13} /> {vehiculo.ubicacion} · {vehiculo.anio}
            </p>
            <p className="text-ink/50 text-sm mb-4">{c.publicadoPor}: {vehiculo.propietario_nombre}</p>
            <p className="text-ink/70 mb-5 text-sm leading-relaxed">{vehiculo.descripcion}</p>
            {vehiculo.precio_dia > 0 ? (
              <div className="flex items-baseline gap-1">
                <span className="text-accent font-bold text-3xl">${vehiculo.precio_dia.toLocaleString('es-CO')}</span>
                <span className="text-ink/50 text-sm">{c.dia}</span>
              </div>
            ) : (
              <div className="bg-accent-light border border-accent/20 rounded-xl px-4 py-2.5 text-sm text-accent font-medium inline-block">
                {c.precioEnRevision}
              </div>
            )}
          </div>

          {/* Reserva */}
          <div className="bg-surface rounded-2xl p-5 border border-border">
            <h2 className="font-bold text-ink mb-4 flex items-center gap-2">
              <IconCalendar size={16} className="text-accent" /> {c.reservarVehiculo}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-ink/60 block mb-2 uppercase tracking-wide">{c.fechasAlquiler}</label>
                <CalendarioReserva
                  availableDates={diasDisponibles}
                  reservedDates={ocupadas}
                  placa={vehiculo.placa}
                  inicio={fechaInicio}
                  fin={fechaFin}
                  onChange={(i, f) => { setFechaInicio(i); setFechaFin(f); setMsg(''); }}
                  disabled={carInactivo}
                />
                {fechaInicio && fechaFin && (
                  <div className="mt-2 text-xs bg-surface-2 border border-border rounded-xl px-3 py-2 flex justify-between text-ink/60">
                    <span>{c.recogidaLabel}: <b className="text-ink">{fechaInicio}</b></span>
                    <span>{c.devolucionLabel}: <b className="text-ink">{fechaFin}</b></span>
                  </div>
                )}
              </div>

              {/* Lugar y hora de recogida / entrega */}
              <div className="pt-3 mt-1 border-t border-border space-y-4">
                <LugarSelector label={c.recogidaLabel} value={recogida} onChange={cambiarRecogida} />
                <LugarSelector label={c.devolucionLabel} value={entrega} onChange={cambiarEntrega} tone="brand" />
              </div>

              {dias > 0 && vehiculo.precio_dia > 0 && (
                <div className="bg-accent-light border border-accent/20 rounded-xl p-3 text-sm">
                  <div className="flex justify-between text-ink/70"><span>{c.dia1(dias)} × ${vehiculo.precio_dia.toLocaleString('es-CO')}:</span><span>${subtotal.toLocaleString('es-CO')}</span></div>
                  {recargo > 0 && (
                    <div className="flex justify-between text-ink/70 mt-1">
                      <span>{c.recargoAeropuerto}:</span><span>+${recargo.toLocaleString('es-CO')}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-accent mt-1 pt-1 border-t border-accent/15">
                    <span>{c.totalEstimado}:</span>
                    <span>${total.toLocaleString('es-CO')}</span>
                  </div>
                </div>
              )}
              {msg && (
                <div className="text-sm px-3 py-2.5 rounded-xl border bg-danger/10 text-danger border-danger/25">
                  {msg}
                </div>
              )}
              <button onClick={reservar} disabled={vehiculo.precio_dia === 0 || carInactivo}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm"
              >
                <IconKey size={15} />
                {carInactivo ? c.noDisponibleAhora : vehiculo.precio_dia === 0 ? c.precioNoDisponible : user ? c.irAlPago : c.iniciarSesion}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
