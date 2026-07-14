import * as React from "react";

/** Native select styled to match the system, with a custom chevron. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  required?: boolean;
  help?: string;
  error?: string;
  /** <option> elements. */
  children?: React.ReactNode;
}

export function Select(props: SelectProps): JSX.Element;
