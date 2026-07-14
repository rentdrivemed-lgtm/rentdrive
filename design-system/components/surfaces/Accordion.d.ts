import * as React from "react";

export interface AccordionItem {
  /** Question / trigger label. */
  q: React.ReactNode;
  /** Answer / panel content. */
  a: React.ReactNode;
}

/** Collapsible list for FAQs and terms. */
export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  items: AccordionItem[];
  /** Index (or array of indices) open initially. Pass null for all closed. */
  defaultOpen?: number | number[] | null;
  /** Allow several panels open at once. */
  allowMultiple?: boolean;
}

export function Accordion(props: AccordionProps): JSX.Element;
