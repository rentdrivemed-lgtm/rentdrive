export function Select({ label, required = false, help, error, children, id, className = "", ...rest }) {
  const fieldId = id || (label ? `sel-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className={["dp-field", error ? "dp-field--error" : "", className].filter(Boolean).join(" ")}>
      {label && (
        <label className="dp-field__label" htmlFor={fieldId}>
          {label}{required && <span className="dp-field__req">*</span>}
        </label>
      )}
      <div className="dp-select-wrap">
        <select id={fieldId} className="dp-select" aria-invalid={!!error} {...rest}>
          {children}
        </select>
        <svg className="dp-select-wrap__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      {error ? <span className="dp-field__error">{error}</span> : help && <span className="dp-field__help">{help}</span>}
    </div>
  );
}
