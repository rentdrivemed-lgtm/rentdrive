// DrivePass marketing — Hero with floating glass search card.
function Hero({ onSearch }) {
  const { Button } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return (
    <section className="mk-hero">
      <div className="mk-hero__glow" />
      <div className="mk-hero__inner">
        <div className="mk-hero__copy fade-up" style={{ "--i": 0 }}>
          <span className="t-overline" style={{ color: "var(--accent)" }}>Alquiler de carros entre particulares · Medellín</span>
          <h1 className="mk-hero__title">Conduce libre<br/>por Medellín.</h1>
          <p className="mk-hero__sub">Reserva el carro que necesitas en minutos. Documentos verificados, contrato firmado y soporte en cada viaje.</p>

          <div className="mk-search glass">
            <div className="mk-search__field">
              <label>Ubicación</label>
              <div className="mk-search__input"><I.Pin size={18}/><input defaultValue="Medellín, Antioquia" /></div>
            </div>
            <div className="mk-search__sep" />
            <div className="mk-search__field">
              <label>Inicio</label>
              <div className="mk-search__input"><I.Calendar size={18}/><input defaultValue="12 jun" /></div>
            </div>
            <div className="mk-search__sep" />
            <div className="mk-search__field">
              <label>Fin</label>
              <div className="mk-search__input"><I.Calendar size={18}/><input defaultValue="16 jun" /></div>
            </div>
            <Button size="lg" onClick={onSearch} iconLeft={<I.Search size={18}/>}>Buscar carros</Button>
          </div>

          <div className="mk-hero__proof">
            <span className="mk-dot" /> +800 reservas completadas este mes
          </div>
        </div>
      </div>
    </section>
  );
}
window.Hero = Hero;
