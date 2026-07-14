export function BottomNav({ items = [], value, onChange, className = "", ...rest }) {
  return (
    <nav className={["dp-bottomnav", className].filter(Boolean).join(" ")} {...rest}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            className={["dp-bottomnav__item", active ? "dp-bottomnav__item--active" : ""].filter(Boolean).join(" ")}
            aria-current={active ? "page" : undefined}
            onClick={() => onChange && onChange(it.id)}
          >
            <span style={{ position: "relative", display: "flex" }}>
              {it.icon}
              {it.badge > 0 && <span className="dp-bottomnav__badge">{it.badge > 9 ? "9+" : it.badge}</span>}
            </span>
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
