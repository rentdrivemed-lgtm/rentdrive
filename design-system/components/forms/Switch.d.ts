import * as React from "react";

/** Toggle switch with orange active state. */
export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export function Switch(props: SwitchProps): JSX.Element;
