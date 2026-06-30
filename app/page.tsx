'use client';
import { useState, useEffect } from 'react';
import HeroSlider from '@/components/HeroSlider';
import VehiculoCard from '@/components/VehiculoCard';
import { IconFilter, IconKey, IconShield, IconRoute, IconCar, IconCalendar, IconX } from '@/components/Icons';

type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number;
  tipo: string; ubicacion: string; precio_dia: number;
  descripcion: string; fotos: string; propietario_nombre?: string;
};

const hoy = new Date().toISOString().split('T')[0];

function diasEntre(a: string, b: string) {
  if (!a || !b || a >= b) return 0;
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export default function Home() {
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [filtros, setFiltros] = useState({
    tipo: '', ubicacion: '', precioMax: '', fechaInicio: '', fechaFin: '',
  });
  const [loading, setLoading] = useState(true);

  const cargar = async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (filtros.tipo)         p.set('tipo', filtros.tipo);
    if (filtros.ubicacion)    p.set('ubicacion', filtros.ubicacion);
    if (filtros.precioMax)    p.set('precioMax', filtros.precioMax);
    if (filtros.fechaInicio)  p.set('fechaInicio', filtros.fechaInicio);
    if (filtros.fechaFin)     p.set('fechaFin', filtros.fechaFin);
    const res = await fetch('/api/vehiculos?' + p.toString());
    const data = await res.json();
    setVehiculos(data.vehiculos || []);
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  return (
    <div>
      {/* ── HERO (banner con slider, diseño Claude Design) ── */}
      <HeroSlider />

      {/* ── FEATURES STRIP ── */}
      <section className="bg-surface-2 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: <IconKey size={22} className="text-accent"/>, title: 'Acceso rápido', desc: 'Reserva en minutos desde cualquier dispositivo' },
            { icon: <IconShield size={22} className="text-accent"/>, title: '100% seguro', desc: 'Verificación de identidad y vehículos documentados' },
            { icon: <IconRoute size={22} className="text-accent"/>, title: 'Tu ruta, tu precio', desc: 'Precios definidos por expertos DrivePass' },
          ].map(f => (
            <div key={f.title} className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center flex-shrink-0">{f.icon}</div>
              <div><p className="font-semibold text-ink text-sm">{f.title}</p><p className="text-ink/50 text-xs">{f.desc}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FILTROS ── */}
      <section id="vehiculos" className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-ink">Vehículos disponibles</h2>
            <p className="text-ink/50 text-sm">Medellín y área metropolitana</p>
          </div>
          {vehiculos.length > 0 && (
            <span className="bg-brand-muted text-ink text-xs font-semibold px-3 py-1.5 rounded-full">
              {vehiculos.length} vehículo{vehiculos.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Barra de filtros */}
        <div className="bg-surface-2 rounded-2xl shadow-sm border border-border p-4 mb-8">
          {/* Fechas */}
          <div className="mb-3 pb-3 border-b border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <IconCalendar size={14} className="text-accent"/>
              <span className="text-xs font-bold text-ink/60 uppercase tracking-wide">Disponibilidad</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Desde</label>
                <input type="date" min={hoy}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={filtros.fechaInicio}
                  onChange={e => {
                    const v = e.target.value;
                    setFiltros(f => ({
                      ...f, fechaInicio: v,
                      fechaFin: f.fechaFin && f.fechaFin <= v ? '' : f.fechaFin,
                    }));
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Hasta</label>
                <input type="date" min={filtros.fechaInicio || hoy}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={filtros.fechaFin}
                  onChange={e => setFiltros(f => ({ ...f, fechaFin: e.target.value }))}
                />
              </div>
            </div>
            {filtros.fechaInicio && filtros.fechaFin && diasEntre(filtros.fechaInicio, filtros.fechaFin) > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-accent-light border border-accent/20 rounded-xl px-3 py-1.5 mt-2">
                <IconCalendar size={12} className="text-accent"/>
                <span className="text-xs font-semibold text-accent">
                  {diasEntre(filtros.fechaInicio, filtros.fechaFin)} día{diasEntre(filtros.fechaInicio, filtros.fechaFin) !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {/* Tipo + Precio */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Tipo</label>
              <select
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={filtros.tipo} onChange={e => setFiltros(f => ({ ...f, tipo: e.target.value }))}>
                <option value="">Todos</option>
                <option value="sedan">Sedán</option>
                <option value="suv">SUV</option>
                <option value="compacto">Compacto</option>
                <option value="pickup">Pickup</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Precio máx/día</label>
              <input type="number" placeholder="$200.000"
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={filtros.precioMax} onChange={e => setFiltros(f => ({ ...f, precioMax: e.target.value }))} />
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-2">
            <button onClick={cargar}
              className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-hover text-white font-semibold px-5 py-2.5 rounded-xl transition shadow-sm text-sm">
              <IconFilter size={15}/> Filtrar
            </button>
            {Object.values(filtros).some(Boolean) && (
              <button onClick={async () => {
                setFiltros({ tipo: '', ubicacion: '', precioMax: '', fechaInicio: '', fechaFin: '' });
                setLoading(true);
                const res = await fetch('/api/vehiculos');
                const data = await res.json();
                setVehiculos(data.vehiculos || []);
                setLoading(false);
              }}
                className="flex items-center gap-1.5 text-sm text-accent font-medium transition px-3 py-2.5 rounded-xl border border-accent/20 bg-accent-light hover:bg-accent/10">
                <IconX size={13}/> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Grid vehículos */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1,2,3].map(i => (
              <div key={i} className="bg-surface-2 rounded-2xl h-72 animate-pulse border border-border">
                <div className="h-44 bg-brand-muted rounded-t-2xl"/>
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-brand-muted rounded w-2/3"/>
                  <div className="h-3 bg-brand-muted rounded w-1/2"/>
                </div>
              </div>
            ))}
          </div>
        ) : vehiculos.length === 0 ? (
          <div className="text-center py-20 bg-surface-2 rounded-2xl border border-border">
            <IconCar size={48} className="text-ink/20 mx-auto mb-4"/>
            <p className="text-ink/40 font-medium">No se encontraron vehículos con esos filtros.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {vehiculos.map(v => <VehiculoCard key={v.id} v={v} />)}
          </div>
        )}
      </section>

      {/* ── CTA PROPIETARIOS ── */}
      <section className="bg-brand mx-4 sm:mx-6 mb-10 rounded-3xl overflow-hidden">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-8 sm:py-12 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="text-center sm:text-left">
            <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">¿Tienes un vehículo?</h3>
            <p className="text-white/60 text-sm sm:text-base">Publícalo en DrivePass y empieza a generar ingresos.</p>
          </div>
          <a href="/registro?rol=propietario"
            className="w-full sm:w-auto flex-shrink-0 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-8 py-3.5 rounded-xl transition shadow-lg shadow-accent/30">
            <IconKey size={18}/> Publicar mi carro
          </a>
        </div>
      </section>
    </div>
  );
}
