'use client';
// ── Piezas compartidas de las barras de filtros de las listas del panel ─────
//
// Las usan la pestaña Usuarios y la pestaña Vehículos de app/dashboard/admin/page.tsx.
// El ESTILO no se inventó acá: es exactamente el de los filtros que ya existían en la
// pestaña Reservas del mismo panel (etiqueta `text-xs text-ink/60` arriba, control
// `border border-border rounded-xl px-3 py-2 text-sm bg-surface-2` con el anillo de
// foco `ring-accent/40`). Si ese estilo cambia, cambia acá y en Reservas.
//
// Componente de cliente puro: solo importa `lib/fecha-registro` (módulo puro) y nada
// de servidor (`fs`, better-sqlite3).
import type { ReactNode } from 'react';
import type { OrdenLlegada } from '@/lib/fecha-registro';

/** Etiqueta + control, con el ancho mínimo que necesita cada campo. */
export function FiltroCampo({ label, children, className }: {
  label: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={className || 'min-w-36'}>
      <label className="text-xs font-medium text-ink/60 block mb-1">{label}</label>
      {children}
    </div>
  );
}

/** Clases compartidas por todos los `input`/`select` de las barras de filtros. */
export const CLASE_CONTROL_FILTRO =
  'w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40';

/**
 * Interruptor del orden por fecha de llegada.
 *
 * "Orden de llegada" se puede leer de las dos formas (el primero que llegó arriba, o el
 * último que llegó arriba), así que en vez de adivinar se deja cambiar de un clic. El
 * texto dice SIEMPRE cuál de las dos está activa — no es un icono mudo.
 */
export function BotonOrdenLlegada({ orden, onCambiar, titulo = 'fecha de registro' }: {
  orden: OrdenLlegada; onCambiar: (o: OrdenLlegada) => void; titulo?: string;
}) {
  const recientes = orden === 'recientes';
  return (
    <button
      type="button"
      onClick={() => onCambiar(recientes ? 'antiguos' : 'recientes')}
      aria-label={`Ordenar por ${titulo}. Ahora: ${recientes ? 'más recientes primero' : 'más antiguos primero'}. Clic para invertir.`}
      title="Clic para invertir el orden"
      className="inline-flex items-center gap-1.5 h-[38px] px-3 rounded-xl border border-border bg-surface-2 text-xs font-semibold text-ink/70 hover:border-accent/40 hover:text-accent transition whitespace-nowrap">
      <span aria-hidden="true">{recientes ? '↓' : '↑'}</span>
      {recientes ? 'Más recientes primero' : 'Más antiguos primero'}
    </button>
  );
}

/**
 * "Mostrando 3 de 12" + el botón que quita TODOS los filtros de golpe.
 *
 * El contador está siempre visible (también sin filtros): es la forma de que nadie crea
 * que la lista se quedó corta por un error cuando en realidad hay un filtro puesto.
 */
export function ResumenFiltros({ mostrados, total, hayFiltros, onLimpiar, etiqueta }: {
  mostrados: number; total: number; hayFiltros: boolean; onLimpiar: () => void; etiqueta: string;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <p className="text-xs text-ink/60">
        Mostrando <span className="font-bold text-ink">{mostrados}</span> de {total} {etiqueta}
        {hayFiltros && <span className="text-accent font-semibold"> · filtros activos</span>}
      </p>
      {hayFiltros && (
        <button
          type="button"
          onClick={onLimpiar}
          className="text-xs font-semibold text-ink/60 border border-border rounded-xl px-3 py-1.5 hover:border-accent/40 hover:text-accent transition">
          ✕ Limpiar filtros
        </button>
      )}
    </div>
  );
}
