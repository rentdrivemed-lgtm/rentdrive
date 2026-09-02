'use client';
import Image from 'next/image';
import { IconPin, IconUsers, IconArrowR } from '@/components/Icons';
import { BUS_CATEGORIAS, type CategoriaBus } from '@/lib/busCotizador';

// Fila de `vehiculos` con tipo='bus' tal como la devuelve GET /api/buses (público, sin
// panelAdmin ni propietarioId: solo disponible=1 y contenido_revision=0, ver
// app/api/buses/route.ts). Se define aquí (no en components/buses/types.ts, que es del panel
// admin/propietario ya cerrado) para no tocar ese archivo — mismo shape que `BusRow` de ese
// módulo más los campos públicos que sí usa la vitrina (fotos, descripcion).
export type BusPublico = {
  id: number;
  marca: string;
  modelo: string;
  anio: number;
  ubicacion: string;
  descripcion: string | null;
  fotos: string | null;
  placa?: string;
  capacidad_pasajeros: number | null;
  bus_categoria: CategoriaBus | null;
  propietario_nombre?: string;
};

const CATEGORIA_LABEL: Record<CategoriaBus, string> = Object.fromEntries(
  BUS_CATEGORIAS.map(c => [c.codigo, c.nombre]),
) as Record<CategoriaBus, string>;

export function primeraFotoBus(fotos: string | null): string {
  if (!fotos) return '/uploads/placeholder-car.svg';
  try {
    const arr = JSON.parse(fotos);
    if (Array.isArray(arr) && typeof arr[0] === 'string' && arr[0]) return arr[0];
  } catch { /* ignore */ }
  return '/uploads/placeholder-car.svg';
}

export default function BusVitrinaCard({ bus, onSeleccionar }: { bus: BusPublico; onSeleccionar: (bus: BusPublico) => void }) {
  const foto = primeraFotoBus(bus.fotos);
  const esPlaceholder = foto === '/uploads/placeholder-car.svg';
  const categoriaLabel = bus.bus_categoria ? CATEGORIA_LABEL[bus.bus_categoria] : 'Bus';

  return (
    <div className="bg-surface-2 rounded-2xl shadow-sm border border-border overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all group">
      <div className="relative overflow-hidden h-48">
        <Image src={foto} alt={`${bus.marca} ${bus.modelo} — ${categoriaLabel} en ${bus.ubicacion}`} fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          unoptimized={esPlaceholder}
          className="object-cover group-hover:scale-105 transition-transform duration-500" />
        <span className="absolute top-3 left-3 bg-brand/80 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded-full">
          {categoriaLabel}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-base text-ink leading-tight mb-0.5">{bus.marca} {bus.modelo}</h3>
        <p className="text-ink/50 text-xs mb-1 flex items-center gap-1">
          <IconPin size={11} /> {bus.ubicacion} · {bus.anio}
        </p>
        {bus.capacidad_pasajeros != null && (
          <p className="text-ink/50 text-xs mb-3 flex items-center gap-1">
            <IconUsers size={11} /> Hasta {bus.capacidad_pasajeros} pasajeros
          </p>
        )}
        {bus.descripcion && (
          <p className="text-ink/60 text-xs mb-3 line-clamp-2 leading-relaxed">{bus.descripcion}</p>
        )}
        <button onClick={() => onSeleccionar(bus)}
          className="w-full flex items-center justify-center gap-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition shadow-sm">
          Cotizar este bus <IconArrowR size={12} />
        </button>
      </div>
    </div>
  );
}
