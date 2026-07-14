// DrivePass marketing — app shell + router.
function MarketingApp() {
  const { Navbar, Button, Avatar } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [view, setView] = React.useState("home"); // home | catalog | detail
  const [car, setCar] = React.useState(null);
  const [initialType, setInitialType] = React.useState(null);
  const [favs, setFavs] = React.useState(() => new Set([3]));
  const [solid, setSolid] = React.useState(false);
  const scroller = React.useRef(null);

  const toggleFav = (id) => setFavs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openCatalog = (type) => { setInitialType(typeof type === "string" ? type : null); setView("catalog"); scrollTop(); };
  const openCar = (c) => { if (c && c.id) { setCar(c); setView("detail"); } else { setView("catalog"); } scrollTop(); };
  const goHome = () => { setView("home"); scrollTop(); };
  const scrollTop = () => { if (scroller.current) scroller.current.scrollTop = 0; };

  React.useEffect(() => {
    const el = scroller.current; if (!el) return;
    const onScroll = () => setSolid(el.scrollTop > 24);
    el.addEventListener("scroll", onScroll); return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const navLinks = [
    { label: "Explorar", href: "#explorar" },
    { label: "Para propietarios", href: "#prop" },
    { label: "Cómo funciona", href: "#como" },
  ];

  return (
    <div className="mk-app" ref={scroller}>
      <div onClick={(e) => { const a = e.target.closest("a.dp-navbar__brand"); if (a) { e.preventDefault(); goHome(); } }}>
        <Navbar
          solid={solid || view !== "home"}
          links={navLinks}
          activeHref={view === "catalog" ? "#explorar" : undefined}
          right={<><Button variant="ghost" size="sm">Iniciar sesión</Button><Button size="sm">Registrarse</Button></>}
        />
      </div>

      {view === "home" && (
        <main>
          <window.Hero onSearch={() => openCatalog()} />
          <Categories onPick={openCatalog} />
          <Featured cars={window.DP_CARS} onOpen={openCar} favs={favs} toggleFav={toggleFav} />
          <HowItWorks />
          <DualAudience />
          <Trust />
          <Testimonials />
          <FinalCTA onSearch={() => openCatalog()} />
          <Footer />
        </main>
      )}

      {view === "catalog" && (
        <main className="mk-page">
          <Catalog cars={window.DP_CARS} onOpen={openCar} favs={favs} toggleFav={toggleFav} initialType={initialType} />
          <Footer />
        </main>
      )}

      {view === "detail" && (
        <main className="mk-page">
          <VehicleDetail car={car} onBack={() => openCatalog()} fav={favs.has(car && car.id)} toggleFav={() => car && toggleFav(car.id)} />
          <Footer />
        </main>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<MarketingApp/>);
