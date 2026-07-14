import * as React from "react";

/** Text input with label, optional left icon, help and error text. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  required?: boolean;
  /** Helper text shown below when there's no error. */
  help?: string;
  /** Error message; turns the field red and overrides help. */
  error?: string;
  /** Inline SVG rendered inside the field on the left. */
  icon?: React.ReactNode;
}

export function Input(props: InputProps): JSX.Element;
