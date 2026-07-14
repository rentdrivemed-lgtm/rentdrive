export function Switch({ label, id, className = "", ...rest }) {
  return (
    <label className={["dp-switch", className].filter(Boolean).join(" ")}>
      <input type="checkbox" role="switch" id={id} {...rest} />
      <span className="dp-switch__track">
        <span className="dp-switch__thumb" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
