// DrivePass marketing — vehicle detail (conversion screen).
function VehicleDetail({ car, onBack, fav, toggleFav }) {
  const { Button, Badge, Avatar, Card, CardBody } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  if (!car) return null;
  const inReview = !car.precioDia;
  const days = 4;
  const deposit = 200000;
  const subtotal = car.precioDia * days;
  const total = subtotal + deposit;

  const specs = [
    { icon: <I.Gear size={18}/>, l: "Transmisión", v: car.transmision },
    { icon: <I.Gas size={18}/>, l: "Combustible", v: car.combustible },
    { icon: <I.Users size={18}/>, l: "Pasajeros", v: car.pasajeros },
    { icon: <I.Doc size={18}/>, l: "Placa", v: car.placa, mono: true },
  ];

  return (
    <div className="vd-wrap">
      <button className="vd-back" onClick={onBack}><I.ChevL size={18}/> Volver al catálogo</button>

      <div className="vd-gallery">
        <div className="vd-gallery__main">
          <img src={car.foto} alt={`${car.marca} ${car.modelo}`} />
          <div className="vd-gallery__chips">
            <span className="dp-badge dp-badge--neutral glass">{car.tipo}</span>
            {car.verificado && <span className="dp-badge dp-badge--success"><span className="dp-badge__dot"/>Verificado</span>}
          </div>
        </div>
        <div className="vd-gallery__thumbs">
          {[0,1,2].map((i) => <div key={i} className="vd-thumb" style={{backgroundImage:`url(${car.foto})`}} />)}
        </div>
      </div>

      <div className="vd-body">
        <div className="vd-content">
          <div className="vd-header">
            <div>
              <h1 className="mk-h1">{car.marca} {car.modelo} <span style={{color:"var(--text-muted)",fontWeight:400}}>· {car.anio}</span></h1>
              <div className="vd-meta"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><I.Pin size={16}/>{car.ubicacion}</span><span className="vd-meta__sep">·</span><span style={{display:"inline-flex",alignItems:"center",gap:6}}><I.Star size={15} fill="currentColor"/>4.9 (38 reseñas)</span></div>
            </div>
            <button className={["dp-iconbtn", fav ? "" : ""].join(" ")} aria-label="Guardar" onClick={toggleFav} style={{color: fav ? "var(--accent)" : "var(--text-soft)"}}>
              <I.Heart size={20} fill={fav ? "currentColor" : "none"} />
            </button>
          </div>

          <p className="vd-desc">{car.descripcion} Mantenimiento al día, llantas nuevas y kit de carretera incluido. Entrega en el punto que acordemos por el chat.</p>

          <div className="vd-specs">
            {specs.map((s) => (
              <div className="vd-spec" key={s.l}>
                <span className="vd-spec__ic">{s.icon}</span>
                <div><div className="vd-spec__l">{s.l}</div><div className={"vd-spec__v" + (s.mono ? " t-mono" : "")}>{s.v}</div></div>
              </div>
            ))}
          </div>

          <Card>
            <CardBody>
              <div className="vd-owner">
                <Avatar name="Andrés Mejía" verified size={52} />
                <div style={{flex:1}}>
                  <div className="vd-owner__name">Andrés Mejía <Badge variant="success" dot>Propietario verificado</Badge></div>
                  <div className="mk-lead" style={{fontSize:14}}>Responde en ~15 min · 4.9 ★ · 64 viajes</div>
                </div>
                <Button variant="secondary" iconLeft={<I.Chat size={16}/>}>Mensaje</Button>
              </div>
            </CardBody>
          </Card>

          <div className="vd-trust">
            <div className="vd-trust__item"><span className="vd-trust__ic"><I.Shield/></span><div><h4 className="mk-h4">Depósito protegido</h4><p className="mk-lead">Se devuelve tras la entrega sin novedades.</p></div></div>
            <div className="vd-trust__item"><span className="vd-trust__ic"><I.Camera/></span><div><h4 className="mk-h4">Fotos antes / después</h4><p className="mk-lead">Registro del estado del carro en cada reserva.</p></div></div>
          </div>
        </div>

        <aside className="vd-reserve">
          <Card className="vd-reserve__card glass">
            <CardBody>
              {inReview ? (
                <div className="vd-price vd-price--review">Precio en revisión</div>
              ) : (
                <div className="vd-price"><span className="t-mono">{window.formatCOP(car.precioDia)}</span> <small>/día</small></div>
              )}
              <div className="vd-dates">
                <div className="vd-date"><span className="vd-date__l">Inicio</span><span className="t-mono">12 jun</span></div>
                <div className="vd-date"><span className="vd-date__l">Fin</span><span className="t-mono">16 jun</span></div>
              </div>
              {!inReview && (
                <div className="vd-breakdown">
                  <div className="vd-brow"><span>{window.formatCOP(car.precioDia)} × {days} días</span><span className="t-mono">{window.formatCOP(subtotal)}</span></div>
                  <div className="vd-brow"><span>Depósito (reembolsable)</span><span className="t-mono">{window.formatCOP(deposit)}</span></div>
                  <div className="vd-brow vd-brow--total"><span>Total</span><span className="t-mono vd-total">{window.formatCOP(total)}</span></div>
                </div>
              )}
              <Button block size="lg" disabled={inReview}>{inReview ? "No disponible aún" : "Reservar ahora"}</Button>
              <p className="vd-note"><I.Check size={14}/> Cancela gratis hasta 24h antes</p>
            </CardBody>
          </Card>
        </aside>
      </div>

      {/* Mobile sticky reserve bar */}
      <div className="vd-bar glass">
        {inReview ? <span className="vd-price vd-price--review" style={{margin:0}}>En revisión</span>
          : <span className="vd-price" style={{margin:0,fontSize:20}}><span className="t-mono">{window.formatCOP(car.precioDia)}</span> <small>/día</small></span>}
        <Button disabled={inReview}>Reservar</Button>
      </div>
    </div>
  );
}
window.VehicleDetail = VehicleDetail;
