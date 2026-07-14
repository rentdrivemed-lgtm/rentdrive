import * as React from "react";

/** Circular avatar with initials fallback, optional verified check and status ring. */
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name — used for initials and img alt. */
  name?: string;
  /** Photo URL; falls back to initials when absent. */
  src?: string;
  /** Diameter in px. Default 40. */
  size?: number;
  /** Green check badge bottom-right. */
  verified?: boolean;
  /** Green status ring. */
  ring?: boolean;
}

export function Avatar(props: AvatarProps): JSX.Element;

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Avatar children. */
  children?: React.ReactNode;
  /** Max avatars before a +N chip. Default 4. */
  max?: number;
  size?: number;
  /** Override the +N count. */
  more?: number;
}

export function AvatarGroup(props: AvatarGroupProps): JSX.Element;
