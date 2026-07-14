export function Checkbox({ label, id, className = "", ...rest }) {
  return (
    <label className={["dp-check", className].filter(Boolean).join(" ")}>
      <input type="checkbox" id={id} {...rest} />
      <span className="dp-check__box">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
