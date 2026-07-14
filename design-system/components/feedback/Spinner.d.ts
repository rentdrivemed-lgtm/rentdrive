import * as React from "react";

/** Indeterminate loading spinner (orange on dark track). */
export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Diameter in px. Default 20. */
  size?: number;
}

export function Spinner(props: SpinnerProps): JSX.Element;
