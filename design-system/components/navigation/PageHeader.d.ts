import * as React from "react";

/** Reusable internal-page header: title + subtitle + right-aligned actions, with optional breadcrumbs. */
export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned action buttons. */
  actions?: React.ReactNode;
  /** Breadcrumbs node rendered above the title. */
  breadcrumbs?: React.ReactNode;
}

export function PageHeader(props: PageHeaderProps): JSX.Element;

export interface Crumb { label: React.ReactNode; href?: string; }
export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: Crumb[];
}
export function Breadcrumbs(props: BreadcrumbsProps): JSX.Element;
