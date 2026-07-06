'use client';
import { useState } from 'react';
import Link from 'next/link';
import { IconPin, IconArrowR, IconStar } from '@/components/Icons';
import { useSession } from '@/contexts/SessionContext';
import { useLang } from '@/contexts/LanguageContext';
import { tieneAltaDisponibilidadEsteMes } from '@/lib/disponibilidad-reglas';

const T = {
  es: { precioPorAsignar: 'Precio por asignar', dia: '/día', enRevision: 'En revisión', verMas: 'Ver más', altaDisp: 'Alta disponibilidad' },
  en: { precioPorAsignar: 'Price to be set', dia: '/day', enRevision: 'Under review', verMas: 'View more', altaDisp: 'High availability' },
};

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
  en_vitrina?: number;
  dias_disponibles?: string;
};

export default function VehiculoCard({ v }: { v: Vehiculo }) {
  const { user } = useSession();
  const { lang } = useLang();
  const c = T[lang];
  const [enVitrina, setEnVitrina] = useState(!!v.en_vitrina);
  const [guardando, setGuardando] = useState(false);
  let fotos: string[] = [];
  try { fotos = JSON.parse(v.fotos); } catch { fotos = []; }
  const foto = fotos[0] || 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400';
  let diasDisp: string[] = [];
  try { diasDisp = JSON.parse(v.dias_disponibles || '[]'); } catch { diasDisp = []; }
  const altaDisponibilidad = tieneAltaDisponibilidadEsteMes(diasDisp);

  const toggleVitrina = async () => {
    const nuevo = !enVitrina;
    setEnVitrina(nuevo);
    setGuardando(true);
    try {
      await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ en_vitrina: nuevo ? 1 : 0 }),
      });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bg-surface-2 rounded-2xl shadow-sm border border-border overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all group">
      <div className="relative overflow-hidden">
        <img src={foto} alt={`${v.marca} ${v.modelo}`}
          className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-500" />
        <span className="absolute top-3 left-3 bg-brand/80 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize">
          {v.tipo}
        </span>
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
          {user?.rol === 'admin' && (
            <button onClick={toggleVitrina} disabled={guardando}
              title={enVitrina ? 'Quitar de la vitrina del inicio' : 'Mostrar en la vitrina del inicio'}
              className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-sm transition disabled:opacity-60 ${
                enVitrina ? 'bg-accent text-white' : 'bg-brand/80 text-white hover:bg-accent/80'
              }`}>
              <IconStar size={11} className={enVitrina ? 'fill-current' : ''} /> {enVitrina ? 'En vitrina' : 'Vitrina'}
            </button>
          )}
          {v.precio_dia === 0 && (
            <span className="bg-accent/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {c.precioPorAsignar}
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        <div className="mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-bold text-base text-ink leading-tight">{v.marca} {v.modelo}</h3>
            {altaDisponibilidad && (
              <span title={c.altaDisp} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/30 whitespace-nowrap">
                ⭐ {c.altaDisp}
              </span>
            )}
          </div>
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
              <span className="text-ink/50 text-xs font-normal"> {c.dia}</span>
            </div>
          ) : (
            <span className="text-accent/70 text-sm font-medium">{c.enRevision}</span>
          )}
          <Link href={`/vehiculos/${v.id}`}
            className="flex items-center gap-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-sm">
            {c.verMas} <IconArrowR size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
