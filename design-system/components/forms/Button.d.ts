import * as React from "react";

/**
 * Primary action button. Gradient-orange `primary` carries the brand glow and
 * is reserved for the single key action per view; `secondary`, `ghost` and
 * `danger` support it.
 *
 * @startingPoint section="Forms" subtitle="Primary, secondary, ghost & danger actions" viewport="700x200"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Use `primary` for the one key CTA per screen. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Fully rounded (pill) corners. */
  pill?: boolean;
  /** Stretch to fill the container width. */
  block?: boolean;
  /** Show a spinner and disable interaction. */
  loading?: boolean;
  disabled?: boolean;
  /** Icon element rendered before the label. */
  iconLeft?: React.ReactNode;
  /** Icon element rendered after the label. */
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
