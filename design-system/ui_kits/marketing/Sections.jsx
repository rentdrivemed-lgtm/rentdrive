// DrivePass marketing — content sections.
function Categories({ onPick }) {
  const I = window.Icons;
  const cats = [
    { t: "Sedán", icon: <I.Car/> }, { t: "SUV", icon: <I.Car/> }, { t: "Pickup", icon: <I.Car/> },
    { t: "Lujo", icon: <I.Star/> }, { t: "Eléctrico", icon: <I.Plug/> },
  ];
  return (
    <section className="mk-sec">
      <div className="mk-cats">
        {cats.map((c, i) => (
          <button key={c.t} className="mk-cat fade-up" style={{ "--i": i }} onClick={() => onPick(c.t)}>
            <span className="mk-cat__ic">{c.icon}</span>
            <span>{c.t}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Featured({ cars, onOpen, favs, toggleFav }) {
  const { VehiculoCard, Button } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return (
    <section className="mk-sec">
      <div className="mk-sechead">
        <div>
          <h2 className="mk-h2">Vehículos destacados</h2>
          <p className="mk-lead">Los favoritos de la comunidad esta semana.</p>
        </div>
        <Button variant="secondary" onClick={() => onOpen()} iconRight={<I.Arrow size={16}/>}>Ver todo el catálogo</Button>
      </div>
      <div className="mk-grid">
        {cars.slice(0, 4).map((c, i) => (
          <div className="fade-up" style={{ "--i": i }} key={c.id}>
            <VehiculoCard vehiculo={c} favorite={favs.has(c.id)} onFavorite={() => toggleFav(c.id)} onClick={() => onOpen(c)} />
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const I = window.Icons;
  const steps = [
    { n: "01", icon: <I.Search/>, t: "Elige tu carro", d: "Filtra por tipo, precio y fechas. Compara y guarda tus favoritos." },
    { n: "02", icon: <I.FileSign/>, t: "Reserva en minutos", d: "Sube tus documentos una vez, firma el contrato y paga seguro." },
    { n: "03", icon: <I.Car/>, t: "Conduce libre", d: "Recoge el carro, registra las fotos y disfruta el viaje." },
  ];
  return (
    <section className="mk-sec">
      <h2 className="mk-h2 mk-center">Reservar es así de simple</h2>
      <div className="mk-steps">
        {steps.map((s, i) => (
          <div className="mk-step fade-up" style={{ "--i": i }} key={s.n}>
            <span className="mk-step__n t-mono">{s.n}</span>
            <span className="mk-step__ic">{s.icon}</span>
            <h3 className="mk-h3">{s.t}</h3>
            <p className="mk-lead">{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DualAudience() {
  const { Button } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return (
    <section className="mk-sec">
      <div className="mk-dual">
        <div className="mk-dual__card">
          <span className="mk-dual__ic"><I.Car/></span>
          <h3 className="mk-h3">¿Quieres conducir?</h3>
          <p className="mk-lead">Cientos de carros verificados te esperan. Reserva el tuyo hoy.</p>
          <Button>Crear cuenta</Button>
        </div>
        <div className="mk-dual__card mk-dual__card--accent">
          <span className="mk-dual__ic"><I.Wallet/></span>
          <h3 className="mk-h3">¿Tienes un carro? Monetízalo.</h3>
          <p className="mk-lead">Genera ingresos con tu vehículo cuando no lo usas. Tú pones las reglas.</p>
          <Button variant="secondary">Publicar mi carro</Button>
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const I = window.Icons;
  const items = [
    { icon: <I.Shield/>, t: "Documentos verificados", d: "Validamos licencia e identidad de cada parte." },
    { icon: <I.Camera/>, t: "Fotos antes y después", d: "Registro del estado del carro en cada reserva." },
    { icon: <I.FileSign/>, t: "Contrato firmado", d: "Acuerdo digital firmado para tu tranquilidad." },
    { icon: <I.Clock/>, t: "Soporte 24/7", d: "Estamos contigo durante todo el viaje." },
  ];
  return (
    <section className="mk-sec mk-trust">
      <div className="mk-trust__grid">
        {items.map((it, i) => (
          <div className="mk-trust__item fade-up" style={{ "--i": i }} key={it.t}>
            <span className="mk-trust__ic">{it.icon}</span>
            <div><h4 className="mk-h4">{it.t}</h4><p className="mk-lead">{it.d}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Testimonials() {
  const { Avatar } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const t = [
    { n: "Daniela R.", r: "Conductora", q: "Reservé en cinco minutos y el carro estaba impecable. La app es clarísima." },
    { n: "Andrés M.", r: "Propietario", q: "Mi carro ya genera ingresos cada semana. El proceso de documentos es seguro." },
    { n: "Valentina O.", r: "Conductora", q: "Me encantó poder ver las fotos antes y después. Todo transparente." },
  ];
  return (
    <section className="mk-sec">
      <h2 className="mk-h2 mk-center">Lo que dice la comunidad</h2>
      <div className="mk-testi">
        {t.map((x, i) => (
          <div className="mk-testi__card fade-up" style={{ "--i": i }} key={x.n}>
            <div className="mk-stars">{[0,1,2,3,4].map((s) => <I.Star key={s} size={15} fill="currentColor" />)}</div>
            <p className="mk-testi__q">“{x.q}”</p>
            <div className="mk-testi__who">
              <Avatar name={x.n} size={38} />
              <div><div className="mk-testi__name">{x.n}</div><div className="mk-lead" style={{fontSize:13}}>{x.r}</div></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCTA({ onSearch }) {
  const { Button } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return (
    <section className="mk-sec">
      <div className="mk-final gradient-hero">
        <h2 className="mk-final__title">Tu próximo viaje empieza aquí.</h2>
        <p className="mk-lead">Encuentra el carro perfecto en Medellín y conduce libre.</p>
        <Button size="lg" onClick={onSearch} iconRight={<I.Arrow size={18}/>}>Buscar carros</Button>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    { h: "Producto", links: ["Explorar carros", "Cómo funciona", "Precios", "Ciudades"] },
    { h: "Para propietarios", links: ["Publicar mi carro", "Calculadora de ingresos", "Garantías", "Centro de ayuda"] },
    { h: "Para usuarios", links: ["Requisitos", "Reservas", "Seguros", "Preguntas frecuentes"] },
    { h: "Legal", links: ["Términos", "Privacidad", "Cookies", "Contrato"] },
  ];
  return (
    <footer className="mk-footer">
      <div className="mk-footer__top">
        <div className="mk-footer__brand">
          <img src="../../assets/logo-wordmark.svg" width="160" height="44" alt="DrivePass" />
          <p className="mk-lead" style={{maxWidth:260, marginTop:12}}>Conduce libre. Alquiler de carros entre particulares en Medellín.</p>
        </div>
        {cols.map((c) => (
          <div className="mk-footer__col" key={c.h}>
            <h5>{c.h}</h5>
            {c.links.map((l) => <a key={l} href="#">{l}</a>)}
          </div>
        ))}
      </div>
      <div className="mk-footer__bottom">
        <span>© 2026 DrivePass Medellín</span>
        <span className="t-mono">Conduce libre.</span>
      </div>
    </footer>
  );
}

Object.assign(window, { Categories, Featured, HowItWorks, DualAudience, Trust, Testimonials, FinalCTA, Footer });
