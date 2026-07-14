import * as React from "react";

/** Hover/focus tooltip. Wraps a trigger; shows `label` above on hover. */
export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: React.ReactNode;
  children: React.ReactNode;
}

export function Tooltip(props: TooltipProps): JSX.Element;
