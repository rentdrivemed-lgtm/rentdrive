import * as React from "react";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  /** Optional count shown after the label. */
  count?: number;
}

/** Horizontal tabs with an animated orange indicator; scrolls horizontally on mobile. Controlled via value/onChange. */
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Strings or {id,label,count} objects. */
  tabs: (string | TabItem)[];
  /** Active tab id. */
  value: string;
  onChange?: (id: string) => void;
}

export function Tabs(props: TabsProps): JSX.Element;
