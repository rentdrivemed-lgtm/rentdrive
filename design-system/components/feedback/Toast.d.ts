import * as React from "react";

/** Ephemeral glass notification. Render inside a fixed `.dp-toast-region`. Pass `duration` (ms) for auto-dismiss. */
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "success" | "info" | "warning" | "danger";
  title?: React.ReactNode;
  /** Auto-dismiss after N ms (requires onClose). */
  duration?: number;
  onClose?: () => void;
  children?: React.ReactNode;
}

export function Toast(props: ToastProps): JSX.Element;
