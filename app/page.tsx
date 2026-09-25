'use client';
import { useState, useEffect } from 'react';
import HeroSlider from '@/components/HeroSlider';
import VehiculoCard from '@/components/VehiculoCard';
import { useLang } from '@/contexts/LanguageContext';
import { IconFilter, IconKey, IconShield, IconMetrocable, IconCar, IconCalendar, IconX } from '@/components/Icons';
import { TIPO_VEHICULO_LABELS, type TipoVehiculo } from '@/lib/rentabilidad';
import { FranjaSura } from '@/components/SelloSura';
import FranjaBuses from '@/components/FranjaBuses';

const CATEGORIAS = Object.entries(TIPO_VEHICULO_LABELS) as [TipoVehiculo, string][];

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

const T = {
  es: {
    features: [
      { title: 'Acceso rápido', desc: 'Reserva en minutos desde cualquier dispositivo' },
      { title: '100% seguro', desc: 'Verificación de identidad y vehículos documentados' },
      { title: 'Tu ruta, tu precio', desc: 'Precios definidos por expertos DrivePass' },
    ],
    disponibles: 'Vehículos disponibles',
    ubicacionSub: 'Medellín y área metropolitana',
    vehiculo: (n: number) => `${n} vehículo${n !== 1 ? 's' : ''}`,
    disponibilidad: 'Disponibilidad',
    desde: 'Desde',
    hasta: 'Hasta',
    dias: (n: number) => `${n} día${n !== 1 ? 's' : ''}`,
    tipo: 'Tipo',
    todos: 'Todos',
    sedan: 'Sedán', suv: 'SUV', compacto: 'Compacto', pickup: 'Pickup',
    precioMax: 'Precio máx/día',
    filtrar: 'Filtrar',
    limpiar: 'Limpiar',
    sinResultados: 'No se encontraron vehículos con esos filtros.',
    ctaTitle: '¿Tienes un vehículo?',
    ctaSub: 'Publícalo en DrivePass y empieza a generar ingresos.',
    ctaBtn: 'Publicar mi carro',
  },
  en: {
    features: [
      { title: 'Quick access', desc: 'Book in minutes from any device' },
      { title: '100% secure', desc: 'Identity verification and documented vehicles' },
      { title: 'Your route, your price', desc: 'Prices set by DrivePass experts' },
    ],
    disponibles: 'Available vehicles',
    ubicacionSub: 'Medellín and the metropolitan area',
    vehiculo: (n: number) => `${n} vehicle${n !== 1 ? 's' : ''}`,
    disponibilidad: 'Availability',
    desde: 'From',
    hasta: 'To',
    dias: (n: number) => `${n} day${n !== 1 ? 's' : ''}`,
    tipo: 'Type',
    todos: 'All',
    sedan: 'Sedan', suv: 'SUV', compacto: 'Compact', pickup: 'Pickup',
    precioMax: 'Max price/day',
    filtrar: 'Filter',
    limpiar: 'Clear',
    sinResultados: 'No vehicles found with those filters.',
    ctaTitle: 'Do you have a vehicle?',
    ctaSub: 'List it on DrivePass and start generating income.',
    ctaBtn: 'List my car',
  },
};

export default function Home() {
  const { lang } = useLang();
  const c = T[lang];
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
      {/* ── HERO (banner a sangre completa, template DrivePass) ── */}
      <HeroSlider />

      {/* ── FEATURES STRIP (bloque de confianza, tema oscuro) ── */}
      <section className="bg-surface border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: <IconKey size={22} className="text-accent"/>, ...c.features[0] },
            { icon: <IconShield size={22} className="text-accent"/>, ...c.features[1] },
            { icon: <IconMetrocable size={22} className="text-accent"/>, ...c.features[2] },
          ].map(f => (
            <div key={f.title} className="flex items-center gap-4">
              <div className="w-[46px] h-[46px] rounded-2xl bg-accent-light flex items-center justify-center flex-shrink-0">
                {f.icon}
              </div>
              <div>
                <p className="font-bold text-sm text-ink">{f.title}</p>
                <p className="text-xs text-ink-soft">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── RESPALDO ASEGURADOR ──
          Va aquí, pegada al bloque de confianza y antes de la vitrina, para que
          se vea sin bajar del primer scroll: es la señal que convierte «seguro
          todo riesgo» en algo verificable. El texto y el aviso viven en
          `lib/i18n.ts` (clave `sura`) y salen del clausulado, no del marketing. */}
      <FranjaSura />

      {/* ── BUSES ──
          Antes de la vitrina de carros, no después: quien necesita mover un grupo no
          baja a mirar sedanes, y al final de la página no lo vería nadie. Es una sola
          franja compacta, así que no le quita protagonismo al producto principal. */}
      <FranjaBuses />

      {/* ── FILTROS ── */}
      <section id="vehiculos" className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-ink">{c.disponibles}</h2>
            <p className="text-ink/50 text-sm">{c.ubicacionSub}</p>
          </div>
          {vehiculos.length > 0 && (
            <span className="bg-brand-muted text-ink text-xs font-semibold px-3 py-1.5 rounded-full">
              {c.vehiculo(vehiculos.length)}
            </span>
          )}
        </div>

        {/* Barra de filtros */}
        <div className="bg-surface-2 rounded-2xl shadow-sm border border-border p-4 mb-8">
          {/* Fechas */}
          <div className="mb-3 pb-3 border-b border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <IconCalendar size={14} className="text-accent"/>
              <span className="text-xs font-bold text-ink/60 uppercase tracking-wide">{c.disponibilidad}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">{c.desde}</label>
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
                <label className="text-xs font-medium text-ink/60 block mb-1">{c.hasta}</label>
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
                  {c.dias(diasEntre(filtros.fechaInicio, filtros.fechaFin))}
                </span>
              </div>
            )}
          </div>

          {/* Tipo + Precio */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">{c.tipo}</label>
              <select
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={filtros.tipo} onChange={e => setFiltros(f => ({ ...f, tipo: e.target.value }))}>
                <option value="">{c.todos}</option>
                {CATEGORIAS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">{c.precioMax}</label>
              <input type="number" placeholder="$200.000"
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={filtros.precioMax} onChange={e => setFiltros(f => ({ ...f, precioMax: e.target.value }))} />
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-2">
            <button onClick={cargar}
              className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-hover text-white font-semibold px-5 py-2.5 rounded-xl transition shadow-sm text-sm">
              <IconFilter size={15}/> {c.filtrar}
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
                <IconX size={13}/> {c.limpiar}
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
            <p className="text-ink/50 font-medium">{c.sinResultados}</p>
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
            <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">{c.ctaTitle}</h3>
            <p className="text-white/60 text-sm sm:text-base">{c.ctaSub}</p>
          </div>
          <a href="/calculadora-propietarios"
            className="w-full sm:w-auto flex-shrink-0 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-8 py-3.5 rounded-xl transition shadow-lg shadow-accent/30">
            <IconKey size={18}/> {c.ctaBtn}
          </a>
        </div>
      </section>
    </div>
  );
}
