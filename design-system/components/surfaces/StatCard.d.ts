import * as React from "react";

/** Dashboard metric: mono value, label, optional trend delta and sparkline. */
export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  /** Big number (rendered in Geist Mono). */
  value: React.ReactNode;
  icon?: React.ReactNode;
  /** Trend string e.g. "+12%" (green) or "-3%" (red). */
  delta?: string;
  /** Optional sparkline node (inline SVG). */
  spark?: React.ReactNode;
}

export function StatCard(props: StatCardProps): JSX.Element;
