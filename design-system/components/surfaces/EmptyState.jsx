export function EmptyState({ icon, title, description, action, className = "", ...rest }) {
  return (
    <div className={["dp-empty", className].filter(Boolean).join(" ")} {...rest}>
      {icon && <div className="dp-empty__icon">{icon}</div>}
      {title && <div className="dp-empty__title">{title}</div>}
      {description && <div className="dp-empty__desc">{description}</div>}
      {action && <div className="dp-empty__actions">{action}</div>}
    </div>
  );
}
