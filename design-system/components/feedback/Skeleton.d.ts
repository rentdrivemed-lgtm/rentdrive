import * as React from "react";

/** Shimmer placeholder. `line` for text, `block` for media, `card` for whole cards. */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "line" | "block" | "card";
  width?: number | string;
  height?: number | string;
}

export function Skeleton(props: SkeletonProps): JSX.Element;
