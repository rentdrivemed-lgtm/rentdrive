import React from "react";

export function Accordion({ items = [], defaultOpen = 0, allowMultiple = false, className = "", ...rest }) {
  const [open, setOpen] = React.useState(() =>
    Array.isArray(defaultOpen) ? defaultOpen : defaultOpen == null ? [] : [defaultOpen]
  );
  const toggle = (i) => {
    setOpen((prev) => {
      const has = prev.includes(i);
      if (allowMultiple) return has ? prev.filter((x) => x !== i) : [...prev, i];
      return has ? [] : [i];
    });
  };
  return (
    <div className={["dp-acc", className].filter(Boolean).join(" ")} {...rest}>
      {items.map((it, i) => {
        const isOpen = open.includes(i);
        return (
          <div key={i} className={["dp-acc__item", isOpen ? "dp-acc__item--open" : ""].filter(Boolean).join(" ")}>
            <button className="dp-acc__trigger" aria-expanded={isOpen} onClick={() => toggle(i)}>
              <span>{it.q}</span>
              <span className="dp-acc__chev">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </span>
            </button>
            {isOpen && <div className="dp-acc__panel">{it.a}</div>}
          </div>
        );
      })}
    </div>
  );
}
