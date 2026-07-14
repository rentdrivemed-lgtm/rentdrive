import React from "react";

const WORDMARK = (
  <svg width="162" height="45" viewBox="0 0 210 58" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="DrivePass rent a car">
    <g transform="translate(2,2) scale(0.458)">
      <rect x="4" y="4" width="88" height="88" rx="26" fill="#1B3356"/>
      <rect x="4.5" y="4.5" width="87" height="87" rx="25.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.14"/>
      <path d="M26 38 H63" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round"/>
      <polyline points="55,29 66,38 55,47" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M70 58 H33" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round"/>
      <polyline points="41,49 30,58 41,67" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
    </g>
    <text x="54" y="30" fontFamily="Geist, system-ui, sans-serif" fontSize="23" fontWeight="800" letterSpacing="-0.5" fill="#F4F6FA">Drive<tspan fill="#F25C2B">Pass</tspan></text>
    <line x1="55" y1="41" x2="203" y2="41" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="1"/>
    <text x="55" y="52" fontFamily="Geist, system-ui, sans-serif" fontSize="10.5" fontWeight="600" letterSpacing="3.4" fill="#A9B8CE">RENT A CAR</text>
  </svg>
);

const Bell = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>;

export function Navbar({
  links = [],
  activeHref,
  solid = false,
  authed = false,
  user,
  notifications = 0,
  onNotifications,
  brand = WORDMARK,
  right,
  className = "",
  ...rest
}) {
  return (
    <header className={["dp-navbar", solid ? "dp-navbar--solid" : "dp-navbar--transparent", className].filter(Boolean).join(" ")} {...rest}>
      <a className="dp-navbar__brand" href="#">{brand}</a>
      {links.length > 0 && (
        <nav className="dp-navbar__nav">
          {links.map((l) => (
            <a key={l.href} href={l.href} className={["dp-navlink", l.href === activeHref ? "dp-navlink--active" : ""].filter(Boolean).join(" ")}>{l.label}</a>
          ))}
        </nav>
      )}
      <div className="dp-navbar__actions">
        {right}
        {authed && (
          <>
            <button className="dp-iconbtn dp-iconbtn--ghost dp-navbar__bell" aria-label="Notificaciones" onClick={onNotifications}>
              <Bell />
              {notifications > 0 && <span className="dp-navbar__count">{notifications > 9 ? "9+" : notifications}</span>}
            </button>
            {user}
          </>
        )}
      </div>
    </header>
  );
}
