import React from "react";

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function Avatar({ name = "", src, size = 40, verified = false, ring = false, className = "", style = {}, ...rest }) {
  return (
    <span
      className={["dp-avatar", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ...style }}
      {...rest}
    >
      {src ? <img className="dp-avatar__img" src={src} alt={name} /> : initials(name)}
      {ring && <span className="dp-avatar__ring" />}
      {verified && (
        <span className="dp-avatar__check" aria-label="Verificado">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </span>
      )}
    </span>
  );
}

export function AvatarGroup({ children, max = 4, size = 40, more, className = "", ...rest }) {
  const items = React.Children.toArray(children);
  const shown = items.slice(0, max);
  const extra = more != null ? more : items.length - shown.length;
  return (
    <span className={["dp-avatar-group", className].filter(Boolean).join(" ")} {...rest}>
      {shown}
      {extra > 0 && (
        <span className="dp-avatar-group__more" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>+{extra}</span>
      )}
    </span>
  );
}
