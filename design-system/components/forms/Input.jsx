export function Input({
  label,
  required = false,
  help,
  error,
  icon = null,
  id,
  className = "",
  ...rest
}) {
  const fieldId = id || (label ? `in-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className={["dp-field", error ? "dp-field--error" : "", className].filter(Boolean).join(" ")}>
      {label && (
        <label className="dp-field__label" htmlFor={fieldId}>
          {label}{required && <span className="dp-field__req">*</span>}
        </label>
      )}
      <div className="dp-field__wrap">
        {icon && <span className="dp-field__icon">{icon}</span>}
        <input
          id={fieldId}
          className={["dp-input", icon ? "dp-input--has-icon" : ""].filter(Boolean).join(" ")}
          aria-invalid={!!error}
          {...rest}
        />
      </div>
      {error ? <span className="dp-field__error">{error}</span> : help && <span className="dp-field__help">{help}</span>}
    </div>
  );
}
