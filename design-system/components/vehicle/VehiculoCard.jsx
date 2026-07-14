import React from "react";

const Pin = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>;
const Heart = ({ filled }) => <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>;

function formatCOP(n) {
  return "$" + Math.round(n).toLocaleString("es-CO");
}

export function VehiculoCard({ vehiculo, favorite = false, onFavorite, onClick, className = "", ...rest }) {
  const v = vehiculo || {};
  const inReview = !v.precioDia || v.precioDia === 0;
  return (
    <article className={["dp-vcard", className].filter(Boolean).join(" ")} onClick={onClick} {...rest}>
      <div className="dp-vcard__media">
        {v.foto ? (
          <img className="dp-vcard__img" src={v.foto} alt={`${v.marca} ${v.modelo}`} loading="lazy" />
        ) : null}
        {v.tipo && <span className="dp-vcard__type"><span className="dp-badge dp-badge--neutral glass">{v.tipo}</span></span>}
        <span className="dp-vcard__state">
          {inReview
            ? <span className="dp-badge dp-badge--warning">En revisión</span>
            : v.verificado !== false
              ? <span className="dp-badge dp-badge--success"><span className="dp-badge__dot" />Verificado</span>
              : null}
        </span>
        <button
          className={["dp-vcard__fav", favorite ? "dp-vcard__fav--on" : ""].filter(Boolean).join(" ")}
          aria-label={favorite ? "Quitar de guardados" : "Guardar"}
          aria-pressed={favorite}
          onClick={(e) => { e.stopPropagation(); onFavorite && onFavorite(e); }}
        >
          <Heart filled={favorite} />
        </button>
      </div>
      <div className="dp-vcard__body">
        <h3 className="dp-vcard__title">{v.marca} {v.modelo}</h3>
        <div className="dp-vcard__meta">
          <span>{v.anio}</span>
          <span aria-hidden="true">·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Pin />{v.ubicacion}</span>
        </div>
        {v.descripcion && <p className="dp-vcard__desc">{v.descripcion}</p>}
        <div className="dp-vcard__foot">
          {inReview ? (
            <span className="dp-vcard__price dp-vcard__price--review">Precio en revisión</span>
          ) : (
            <span className="dp-vcard__price">{formatCOP(v.precioDia)} <small>/día</small></span>
          )}
          <span className="dp-btn dp-btn--secondary dp-btn--sm">Ver más</span>
        </div>
      </div>
    </article>
  );
}
