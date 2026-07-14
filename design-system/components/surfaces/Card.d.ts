import * as React from "react";

/** Elevated surface (surface-2, subtle border, lg radius, card shadow). Compose with CardHeader/Body/Footer. */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Adds hover lift (-2px + float shadow) for clickable cards. */
  interactive?: boolean;
  /** Element/tag to render as (e.g. "a", "article"). */
  as?: any;
  children?: React.ReactNode;
}

export function Card(props: CardProps): JSX.Element;
export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function CardBody(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function CardFooter(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
