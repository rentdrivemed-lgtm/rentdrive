import * as React from "react";

/** Empty / zero-data placeholder: large line icon, title, description and a CTA. */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Large line icon (inline SVG). */
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** CTA element, usually a <Button>. */
  action?: React.ReactNode;
}

export function EmptyState(props: EmptyStateProps): JSX.Element;
