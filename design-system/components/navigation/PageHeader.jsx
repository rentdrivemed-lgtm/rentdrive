import React from "react";

export function PageHeader({ title, subtitle, actions, breadcrumbs, className = "", ...rest }) {
  return (
    <div className={className} {...rest}>
      {breadcrumbs && <div className="dp-crumbs">{breadcrumbs}</div>}
      <div className="dp-pageheader">
        <div>
          <h1 className="dp-pageheader__title">{title}</h1>
          {subtitle && <p className="dp-pageheader__sub">{subtitle}</p>}
        </div>
        {actions && <div className="dp-pageheader__actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Breadcrumbs({ items = [], className = "", ...rest }) {
  return (
    <nav className={["dp-crumbs", className].filter(Boolean).join(" ")} aria-label="Breadcrumb" {...rest}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {last ? (
              <span className="dp-crumbs__current" aria-current="page">{it.label}</span>
            ) : (
              <a href={it.href || "#"}>{it.label}</a>
            )}
            {!last && <span className="dp-crumbs__sep">/</span>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
