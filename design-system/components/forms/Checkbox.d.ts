import * as React from "react";

/** Checkbox with orange checked state. */
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Text label rendered to the right of the box. */
  label?: React.ReactNode;
}

export function Checkbox(props: CheckboxProps): JSX.Element;
