export function Card({ children, interactive = false, as = "div", className = "", ...rest }) {
  const Tag = as;
  return (
    <Tag className={["dp-card", interactive ? "dp-card--interactive" : "", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ children, className = "", ...rest }) {
  return <div className={["dp-card__header", className].filter(Boolean).join(" ")} {...rest}>{children}</div>;
}
export function CardBody({ children, className = "", ...rest }) {
  return <div className={["dp-card__body", className].filter(Boolean).join(" ")} {...rest}>{children}</div>;
}
export function CardFooter({ children, className = "", ...rest }) {
  return <div className={["dp-card__footer", className].filter(Boolean).join(" ")} {...rest}>{children}</div>;
}
