// DrivePass app — authenticated shell (sidebar + bottom nav + role switch).
function AppShell() {
  const { BottomNav, Avatar, Button } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [role, setRole] = React.useState("usuario"); // usuario | propietario
  const [view, setView] = React.useState("inicio");
  const [favs, setFavs] = React.useState(() => new Set([1, 3, 6]));
  const toggleFav = (id) => setFavs((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  React.useEffect(() => { setView("inicio"); }, [role]);

  const navUsuario = [
    { id: "inicio", label: "Inicio", icon: <I.Grid/> },
    { id: "reservas", label: "Reservas", icon: <I.Calendar/> },
    { id: "chat", label: "Chat", icon: <I.Chat/>, badge: 2 },
    { id: "perfil", label: "Perfil", icon: <I.User/> },
  ];
  const navProp = [
    { id: "inicio", label: "Mis carros", icon: <I.Car/> },
    { id: "reservas", label: "Reservas", icon: <I.Calendar/> },
    { id: "chat", label: "Chat", icon: <I.Chat/>, badge: 2 },
    { id: "perfil", label: "Perfil", icon: <I.User/> },
  ];
  const nav = role === "usuario" ? navUsuario : navProp;

  const renderView = () => {
    if (view === "chat") return <Chat/>;
    if (role === "usuario") return <UserDashboard favs={favs} toggleFav={toggleFav} />;
    return <OwnerDashboard/>;
  };

  return (
    <div className="ap-shell">
      <aside className="ap-side">
        <a className="ap-side__brand" href="#"><img src="../../assets/logo-wordmark.svg" width="150" height="41" alt="DrivePass" /></a>

        <div className="ap-roleswitch">
          <button className={role==="usuario"?"on":""} onClick={() => setRole("usuario")}>Usuario</button>
          <button className={role==="propietario"?"on":""} onClick={() => setRole("propietario")}>Propietario</button>
        </div>

        <nav className="ap-nav">
          {nav.map((it) => (
            <button key={it.id} className={["ap-navitem", view===it.id?"ap-navitem--active":""].join(" ")} onClick={() => setView(it.id)}>
              <span className="ap-navitem__ic">{it.icon}</span>
              <span>{it.label}</span>
              {it.badge > 0 && <span className="ap-navitem__badge">{it.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="ap-side__user">
          <Avatar name={role==="usuario"?"Daniela Ríos":"Andrés Mejía"} verified size={40} />
          <div className="ap-side__uinfo">
            <div className="ap-side__uname">{role==="usuario"?"Daniela Ríos":"Andrés Mejía"}</div>
            <div className="ap-muted" style={{fontSize:12}}>{role==="usuario"?"Conductora":"Propietario"}</div>
          </div>
          <button className="dp-iconbtn dp-iconbtn--ghost dp-iconbtn--sm" aria-label="Salir"><I.Logout size={18}/></button>
        </div>
      </aside>

      <main className="ap-main">{renderView()}</main>

      <div className="ap-bottomnav">
        <BottomNav value={view} onChange={setView} items={nav} />
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<AppShell/>);
