// DrivePass app — Usuario dashboard.
function UserDashboard({ favs, toggleFav }) {
  const { PageHeader, StatCard, Card, CardBody, Button, Badge, Avatar, Tabs, VehiculoCard, EmptyState } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [tab, setTab] = React.useState("conf");
  const cars = window.DP_CARS;
  const next = cars[0];

  const reservas = [
    { car: cars[0], fechas: "12 — 16 jun", total: 920000, estado: "Confirmada", tone: "success", tab: "conf" },
    { car: cars[1], fechas: "24 — 26 jun", total: 240000, estado: "Pendiente", tone: "info", tab: "pend" },
    { car: cars[6], fechas: "2 — 5 may", total: 420000, estado: "Completada", tone: "neutral", tab: "comp" },
  ];
  const shown = reservas.filter((r) => tab === "all" || r.tab === tab);

  return (
    <div className="ap-page">
      <PageHeader title="Hola, Daniela" subtitle="Tienes 1 viaje próximo. ¡Prepárate para conducir!" actions={<Button iconLeft={<I.Search size={16}/>}>Explorar carros</Button>} />

      <div className="ap-stats">
        <StatCard label="Reservas activas" icon={<I.Calendar size={16}/>} value="2" />
        <StatCard label="Próximo viaje" icon={<I.Clock size={16}/>} value="6 días" delta="12 jun" />
        <StatCard label="Carros guardados" icon={<I.Heart size={16}/>} value={String(favs.size)} />
      </div>

      <section className="ap-block">
        <h3 className="ap-h3">Próxima reserva</h3>
        <Card>
          <div className="ap-next">
            <div className="ap-next__img" style={{ backgroundImage: `url(${next.foto})` }} />
            <div className="ap-next__body">
              <div className="ap-next__top">
                <div>
                  <div className="ap-next__title">{next.marca} {next.modelo} · {next.anio}</div>
                  <div className="ap-muted"><I.Calendar size={14}/> 12 — 16 jun · <I.Pin size={14}/> {next.ubicacion}</div>
                </div>
                <Badge variant="success" dot>Confirmada</Badge>
              </div>
              <div className="ap-next__owner">
                <Avatar name="Andrés Mejía" verified size={36} />
                <span className="ap-muted">Andrés Mejía · Propietario verificado</span>
              </div>
              <div className="ap-next__actions">
                <Button variant="secondary" size="sm">Ver detalle</Button>
                <Button variant="secondary" size="sm" iconLeft={<I.Chat size={15}/>}>Chat</Button>
                <Button variant="ghost" size="sm">Cancelar</Button>
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section className="ap-block">
        <h3 className="ap-h3">Mis reservas</h3>
        <Tabs value={tab} onChange={setTab} tabs={[{id:"conf",label:"Confirmadas"},{id:"pend",label:"Pendientes"},{id:"comp",label:"Completadas"},{id:"all",label:"Todas"}]} />
        <div className="ap-table">
          <div className="ap-table__head">
            <span>Vehículo</span><span>Fechas</span><span>Total</span><span>Estado</span>
          </div>
          {shown.length === 0 ? (
            <EmptyState icon={<I.Calendar size={28}/>} title="Sin reservas en este estado" description="Cuando reserves un carro aparecerá aquí." />
          ) : shown.map((r, i) => (
            <div className="ap-row" key={i}>
              <span className="ap-row__veh"><span className="ap-row__thumb" style={{backgroundImage:`url(${r.car.foto})`}}/>{r.car.marca} {r.car.modelo}</span>
              <span className="t-mono ap-muted">{r.fechas}</span>
              <span className="t-mono">{window.formatCOP(r.total)}</span>
              <span><Badge variant={r.tone} dot={r.tone!=="neutral"}>{r.estado}</Badge></span>
            </div>
          ))}
        </div>
      </section>

      <section className="ap-block">
        <h3 className="ap-h3">Guardados</h3>
        <div className="ap-grid">
          {cars.filter((c) => favs.has(c.id)).slice(0,3).map((c) => (
            <VehiculoCard key={c.id} vehiculo={c} favorite onFavorite={() => toggleFav(c.id)} />
          ))}
          {favs.size === 0 && <Card><EmptyState icon={<I.Heart size={28}/>} title="Nada guardado aún" description="Guarda tus carros favoritos para encontrarlos rápido." action={<Button>Explorar carros</Button>} /></Card>}
        </div>
      </section>
    </div>
  );
}
window.UserDashboard = UserDashboard;
