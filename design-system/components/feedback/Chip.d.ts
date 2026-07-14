import * as React from "react";

/** Selectable filter chip. `selected` paints it orange; pass `onRemove` to show an × for active-filter chips. */
export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** When provided, renders a remove (×) affordance. */
  onRemove?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

export function Chip(props: ChipProps): JSX.Element;
