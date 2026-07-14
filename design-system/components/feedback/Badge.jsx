export function Badge({ children, variant = "neutral", dot = false, className = "", ...rest }) {
  return (
    <span className={["dp-badge", `dp-badge--${variant}`, className].filter(Boolean).join(" ")} {...rest}>
      {dot && <span className="dp-badge__dot" />}
      {children}
    </span>
  );
}
