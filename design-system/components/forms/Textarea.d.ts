import * as React from "react";

/** Multi-line text input with label, help and error text. */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  required?: boolean;
  help?: string;
  error?: string;
}

export function Textarea(props: TextareaProps): JSX.Element;
