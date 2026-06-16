'use client';
import Link from 'next/link';
import { IconPin, IconArrowR } from '@/components/Icons';

type Vehiculo = {
  id: number;
  marca: string;
  modelo: string;
  anio: number;
  tipo: string;
  ubicacion: string;
  precio_dia: number;
  descripcion: string;
  fotos: string;
  propietario_nombre?: string;
};

export default function VehiculoCard({ v }: { v: Vehiculo }) {
  let fotos: string[] = [];
  try { fotos = JSON.parse(v.fotos); } catch { fotos = []; }
  const foto = fotos[0] || 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400';

  return (
    <div className="bg-surface-2 rounded-2xl shadow-sm border border-border overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all group">
      <div className="relative overflow-hidden">
        <img src={foto} alt={`${v.marca} ${v.modelo}`}
          className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-500" />
        <span className="absolute top-3 left-3 bg-brand/80 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize">
          {v.tipo}
        </span>
        {v.precio_dia === 0 && (
          <span className="absolute top-3 right-3 bg-accent/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            Precio por asignar
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="mb-2">
          <h3 className="font-bold text-base text-ink leading-tight">{v.marca} {v.modelo}</h3>
          <p className="text-ink/50 text-xs mt-0.5 flex items-center gap-1">
            <IconPin size={11} /> {v.ubicacion} · {v.anio}
          </p>
        </div>
        {v.descripcion && (
          <p className="text-ink/60 text-xs mb-3 line-clamp-2 leading-relaxed">{v.descripcion}</p>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          {v.precio_dia > 0 ? (
            <div>
              <span className="text-accent font-bold text-lg">${v.precio_dia.toLocaleString('es-CO')}</span>
              <span className="text-ink/40 text-xs font-normal"> /día</span>
            </div>
          ) : (
            <span className="text-accent/70 text-sm font-medium">En revisión</span>
          )}
          <Link href={`/vehiculos/${v.id}`}
            className="flex items-center gap-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-sm">
            Ver más <IconArrowR size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
