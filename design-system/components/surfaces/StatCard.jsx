export function StatCard({ label, value, icon, delta, spark, className = "", ...rest }) {
  const dir = delta && delta.trim().startsWith("-") ? "down" : "up";
  return (
    <div className={["dp-stat", className].filter(Boolean).join(" ")} {...rest}>
      <div className="dp-stat__head">
        {icon && <span className="dp-stat__icon">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="dp-stat__value">{value}</div>
      {delta && (
        <span className={`dp-stat__delta dp-stat__delta--${dir}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dir === "down" ? "rotate(180deg)" : "none" }}><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          {delta.replace(/^-/, "")}
        </span>
      )}
      {spark && <div className="dp-stat__spark">{spark}</div>}
    </div>
  );
}
