export function Spinner({ size = 20, className = "", ...rest }) {
  const border = Math.max(2, Math.round(size / 9));
  return (
    <span
      className={["dp-spinner", className].filter(Boolean).join(" ")}
      role="status"
      aria-label="Cargando"
      style={{ width: size, height: size, borderWidth: border }}
      {...rest}
    />
  );
}
