export function Skeleton({ variant = "line", width, height, className = "", style = {}, ...rest }) {
  return (
    <div
      className={["shimmer", "dp-skeleton", `dp-skeleton--${variant}`, className].filter(Boolean).join(" ")}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}
