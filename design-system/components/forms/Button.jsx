export function Button({
  children,
  variant = "primary",
  size = "md",
  pill = false,
  block = false,
  loading = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  type = "button",
  className = "",
  ...rest
}) {
  const cls = [
    "dp-btn",
    `dp-btn--${variant}`,
    `dp-btn--${size}`,
    pill ? "dp-btn--pill" : "",
    block ? "dp-btn--block" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading && <span className="dp-spin" aria-hidden="true" />}
      {!loading && iconLeft}
      {children && <span>{children}</span>}
      {!loading && iconRight}
    </button>
  );
}
