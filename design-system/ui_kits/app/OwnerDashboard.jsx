// DrivePass app — Propietario dashboard.
function OwnerDashboard() {
  const { PageHeader, StatCard, Card, CardBody, Button, Badge, Avatar, EmptyState } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const cars = window.DP_CARS;
  const fleet = [cars[0], cars[3], cars[5]];

  const spark = (
    <svg width="100%" height="36" viewBox="0 0 120 36" preserveAspectRatio="none">
      <polyline points="0,28 20,24 40,26 60,16 80,18 100,8 120,10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const solicitudes = [
    { n: "Daniela Ríos", rating: "4.9", car: "Mazda CX-5", fechas: "12 — 16 jun" },
    { n: "Carlos Pérez", rating: "4.7", car: "Ford Ranger", fechas: "20 — 22 jun" },
  ];

  return (
    <div className="ap-page">
      <PageHeader title="Hola, Andrés" subtitle="Tu flota generó ingresos esta semana." actions={<Button iconLeft={<I.Plus size={16}/>}>Publicar nuevo carro</Button>} />

      <div className="ap-stats ap-stats--4">
        <StatCard label="Ingresos del mes" icon={<I.Wallet size={16}/>} value="$3.480.000" delta="+12%" spark={spark} />
        <StatCard label="Reservas activas" icon={<I.Calendar size={16}/>} value="5" delta="+2" />
        <StatCard label="Carros publicados" icon={<I.Car size={16}/>} value="3" />
        <StatCard label="Calificación" icon={<I.Star size={16}/>} value="4.9" />
      </div>

      <section className="ap-block">
        <h3 className="ap-h3">Solicitudes de reserva</h3>
        <div className="ap-reqs">
          {solicitudes.map((s, i) => (
            <Card key={i}>
              <CardBody>
                <div className="ap-req">
                  <Avatar name={s.n} size={42} />
                  <div className="ap-req__info">
                    <div className="ap-req__name">{s.n} <span className="ap-muted" style={{fontWeight:400}}><I.Star size={13} fill="currentColor"/> {s.rating}</span></div>
                    <div className="ap-muted">{s.car} · <span className="t-mono">{s.fechas}</span></div>
                  </div>
                  <div className="ap-req__actions">
                    <Button variant="secondary" size="sm">Rechazar</Button>
                    <Button size="sm">Aprobar</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section className="ap-block">
        <h3 className="ap-h3">Mis vehículos</h3>
        <div className="ap-fleet">
          {fleet.map((c) => {
            const review = !c.precioDia;
            return (
              <Card key={c.id} interactive>
                <div className="ap-fleet__img" style={{backgroundImage:`url(${c.foto})`}}>
                  <span className="ap-fleet__state">{review ? <Badge variant="warning">Docs en revisión</Badge> : <Badge variant="success" dot>Publicado</Badge>}</span>
                </div>
                <CardBody>
                  <div className="ap-fleet__row">
                    <div>
                      <div className="ap-fleet__title">{c.marca} {c.modelo}</div>
                      <div className="ap-muted">{c.tipo} · {c.ubicacion}</div>
                    </div>
                    <div className="ap-fleet__price t-mono">{review ? "—" : window.formatCOP(c.precioDia)}<small>/día</small></div>
                  </div>
                  <div className="ap-fleet__actions">
                    <Button variant="secondary" size="sm">Editar</Button>
                    <Button variant="ghost" size="sm" iconLeft={<I.Calendar size={15}/>}>Calendario</Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
window.OwnerDashboard = OwnerDashboard;
