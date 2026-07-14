export function Radio({ label, id, className = "", ...rest }) {
  return (
    <label className={["dp-check", className].filter(Boolean).join(" ")}>
      <input type="radio" id={id} {...rest} />
      <span className="dp-check__box dp-check__box--radio">
        <span className="dp-check__dot" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
