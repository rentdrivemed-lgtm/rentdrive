import React from "react";

const ICONS = {
  success: <path d="M20 6 9 17l-5-5" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  warning: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  danger: <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>,
};

export function Toast({ tone = "info", title, children, onClose, duration, className = "", ...rest }) {
  React.useEffect(() => {
    if (!duration || !onClose) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  return (
    <div className={["dp-toast", className].filter(Boolean).join(" ")} role="status" {...rest}>
      <span className={`dp-toast__icon dp-toast__icon--${tone}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[tone]}</svg>
      </span>
      <div className="dp-toast__body">
        {title && <div className="dp-toast__title">{title}</div>}
        {children && <div className="dp-toast__msg">{children}</div>}
      </div>
      {onClose && (
        <button className="dp-toast__close" onClick={onClose} aria-label="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      )}
    </div>
  );
}
