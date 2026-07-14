export function Tabs({ tabs = [], value, onChange, className = "", ...rest }) {
  return (
    <div className={["dp-tabs", "scrollbar-none", className].filter(Boolean).join(" ")} role="tablist" {...rest}>
      {tabs.map((t) => {
        const id = typeof t === "string" ? t : t.id;
        const label = typeof t === "string" ? t : t.label;
        const count = typeof t === "object" ? t.count : undefined;
        const active = id === value;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            className={["dp-tab", active ? "dp-tab--active" : ""].filter(Boolean).join(" ")}
            onClick={() => onChange && onChange(id)}
          >
            {label}{count != null && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{count}</span>}
            {active && <span className="dp-tab__indicator" />}
          </button>
        );
      })}
    </div>
  );
}
