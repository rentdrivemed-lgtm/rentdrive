import * as React from "react";

/** Centered glass dialog with blurred overlay. Closes on backdrop click and the × button. */
export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  /** Footer actions row. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

export function Modal(props: ModalProps): JSX.Element | null;

/** Side panel. `responsive` (default) = right on desktop, bottom sheet on mobile. Used for catalog filters. */
export interface DrawerProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  side?: "right" | "bottom" | "responsive";
  children?: React.ReactNode;
}

export function Drawer(props: DrawerProps): JSX.Element | null;
