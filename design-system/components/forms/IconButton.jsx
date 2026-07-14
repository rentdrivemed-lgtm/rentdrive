export function IconButton({
  children,
  label,
  size = "md",
  ghost = false,
  className = "",
  ...rest
}) {
  const cls = [
    "dp-iconbtn",
    size === "sm" ? "dp-iconbtn--sm" : "",
    ghost ? "dp-iconbtn--ghost" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
