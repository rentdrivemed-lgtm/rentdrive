import * as React from "react";

export interface Vehiculo {
  marca: string;
  modelo: string;
  anio: number;
  tipo?: string;
  ubicacion?: string;
  /** Price per day in COP. 0 / falsy => "Precio en revisión". */
  precioDia?: number;
  descripcion?: string;
  /** Photo URL (16:9 recommended). */
  foto?: string;
  /** Verified badge (default true unless precio in review). */
  verificado?: boolean;
}

/**
 * Vehicle catalog card — 16:9 photo, type chip, status badge, favorite heart,
 * mono COP price in orange. The core unit of the catalog and featured grids.
 *
 * @startingPoint section="Vehicle" subtitle="Catalog vehicle card with photo, price & favorite" viewport="360x380"
 */
export interface VehiculoCardProps extends React.HTMLAttributes<HTMLElement> {
  vehiculo: Vehiculo;
  favorite?: boolean;
  onFavorite?: (e: React.MouseEvent) => void;
}

export function VehiculoCard(props: VehiculoCardProps): JSX.Element;
