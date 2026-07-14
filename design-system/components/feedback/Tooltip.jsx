export function Tooltip({ label, children, className = "", ...rest }) {
  return (
    <span className={["dp-tooltip", className].filter(Boolean).join(" ")} {...rest}>
      {children}
      <span className="dp-tooltip__bubble" role="tooltip">{label}</span>
    </span>
  );
}
