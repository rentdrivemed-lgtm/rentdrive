export function Chip({ children, selected = false, onRemove, className = "", ...rest }) {
  return (
    <button
      type="button"
      className={["dp-chip", selected ? "dp-chip--selected" : "", className].filter(Boolean).join(" ")}
      aria-pressed={selected}
      {...rest}
    >
      {children}
      {onRemove && (
        <span
          className="dp-chip__x"
          role="button"
          aria-label="Quitar"
          onClick={(e) => { e.stopPropagation(); onRemove(e); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </span>
      )}
    </button>
  );
}
