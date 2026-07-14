import React from "react";

function CloseBtn({ onClick }) {
  return (
    <button className="dp-modal__close" onClick={onClick} aria-label="Cerrar">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  );
}

export function Modal({ open = true, onClose, title, children, footer, className = "", ...rest }) {
  if (!open) return null;
  return (
    <div className="dp-overlay" onClick={onClose}>
      <div className={["dp-modal", className].filter(Boolean).join(" ")} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} {...rest}>
        {(title || onClose) && (
          <div className="dp-modal__head">
            {title && <h2 className="dp-modal__title">{title}</h2>}
            {onClose && <CloseBtn onClick={onClose} />}
          </div>
        )}
        <div className="dp-modal__body">{children}</div>
        {footer && <div className="dp-modal__body" style={{ paddingTop: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open = true, onClose, title, side = "responsive", children, className = "", ...rest }) {
  if (!open) return null;
  const sideClass = side === "right" ? "dp-drawer--right" : side === "bottom" ? "dp-drawer--bottom" : "dp-drawer--responsive dp-drawer--right";
  return (
    <div className="dp-overlay dp-drawer-overlay" onClick={onClose}>
      <div className={["dp-drawer", sideClass, className].filter(Boolean).join(" ")} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} {...rest}>
        {(title || onClose) && (
          <div className="dp-modal__head">
            {title && <h2 className="dp-modal__title">{title}</h2>}
            {onClose && <CloseBtn onClick={onClose} />}
          </div>
        )}
        <div className="dp-modal__body">{children}</div>
      </div>
    </div>
  );
}
