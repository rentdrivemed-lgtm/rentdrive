export function Textarea({ label, required = false, help, error, id, className = "", ...rest }) {
  const fieldId = id || (label ? `ta-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className={["dp-field", error ? "dp-field--error" : "", className].filter(Boolean).join(" ")}>
      {label && (
        <label className="dp-field__label" htmlFor={fieldId}>
          {label}{required && <span className="dp-field__req">*</span>}
        </label>
      )}
      <textarea id={fieldId} className="dp-textarea" aria-invalid={!!error} {...rest} />
      {error ? <span className="dp-field__error">{error}</span> : help && <span className="dp-field__help">{help}</span>}
    </div>
  );
}
