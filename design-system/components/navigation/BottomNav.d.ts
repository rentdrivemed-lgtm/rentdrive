import * as React from "react";

export interface BottomNavItem {
  id: string;
  label: React.ReactNode;
  /** Line icon (inline SVG, stroke 1.5–2px). */
  icon: React.ReactNode;
  /** Unread count (e.g. Chat). */
  badge?: number;
}

/** Fixed mobile bottom navigation (glass, safe-area aware). Destinations vary by role. */
export interface BottomNavProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  /** 4–5 destinations. */
  items: BottomNavItem[];
  value: string;
  onChange?: (id: string) => void;
}

export function BottomNav(props: BottomNavProps): JSX.Element;
