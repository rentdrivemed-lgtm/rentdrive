import * as React from "react";

/** Square icon-only button. Always pass `label` for accessibility. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name (aria-label + tooltip). Required. */
  label: string;
  size?: "sm" | "md";
  /** Transparent until hovered. */
  ghost?: boolean;
  children?: React.ReactNode;
}

export function IconButton(props: IconButtonProps): JSX.Element;
