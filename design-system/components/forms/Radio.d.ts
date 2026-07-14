import * as React from "react";

/** Radio button with orange checked state. Group by shared `name`. */
export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export function Radio(props: RadioProps): JSX.Element;
