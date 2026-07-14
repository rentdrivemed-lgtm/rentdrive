import * as React from "react";

export interface NavLink {
  label: React.ReactNode;
  href: string;
}

/** Top navigation bar — glass when `solid` (set on scroll), transparent over hero. */
export interface NavbarProps extends React.HTMLAttributes<HTMLElement> {
  links?: NavLink[];
  activeHref?: string;
  /** Glass + border treatment (toggle true after scrolling past the hero). */
  solid?: boolean;
  /** Logged-in: shows the notification bell + `user` slot. Logged-out: shows `right`. */
  authed?: boolean;
  /** User menu node (e.g. an Avatar with dropdown). */
  user?: React.ReactNode;
  /** Unread notification count for the bell badge. */
  notifications?: number;
  onNotifications?: () => void;
  /** Override the default DrivePass wordmark. */
  brand?: React.ReactNode;
  /** Right-side actions (logged-out CTAs, language selector, etc). */
  right?: React.ReactNode;
}

export function Navbar(props: NavbarProps): JSX.Element;
