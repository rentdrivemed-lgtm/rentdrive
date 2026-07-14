// DrivePass app — Chat (messenger between user and owner).
function Chat() {
  const { Avatar, Badge } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const convos = [
    { id: 1, n: "Andrés Mejía", car: "Mazda CX-5", last: "Perfecto, nos vemos el miércoles 👍", time: "10:42", unread: 0, ver: true },
    { id: 2, n: "Laura Gómez", car: "Toyota Corolla", last: "¿El carro tiene silla para bebé?", time: "9:15", unread: 2, ver: true },
    { id: 3, n: "Soporte DrivePass", car: "", last: "Tu documento fue aprobado.", time: "Ayer", unread: 0, ver: false },
  ];
  const [active, setActive] = React.useState(1);
  const [draft, setDraft] = React.useState("");
  const [msgs, setMsgs] = React.useState([
    { me: false, t: "Hola Daniela, gracias por reservar el CX-5.", time: "10:30" },
    { me: true, t: "¡Hola Andrés! ¿Dónde recojo el carro?", time: "10:35" },
    { me: false, t: "En el Parque de El Poblado, a las 9am. Te paso la ubicación exacta.", time: "10:38" },
    { me: true, t: "Listo, ahí estaré. Gracias!", time: "10:40" },
    { me: false, t: "Perfecto, nos vemos el miércoles 👍", time: "10:42" },
  ]);
  const a = convos.find((c) => c.id === active);
  const endRef = React.useRef(null);
  React.useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, [msgs, active]);

  const send = () => {
    if (!draft.trim()) return;
    setMsgs((m) => [...m, { me: true, t: draft, time: "10:45" }]);
    setDraft("");
  };

  return (
    <div className="ch-wrap">
      <aside className="ch-list">
        <div className="ch-search"><I.Search size={16}/><input placeholder="Buscar conversación" /></div>
        {convos.map((c) => (
          <button key={c.id} className={["ch-conv", c.id === active ? "ch-conv--active" : ""].join(" ")} onClick={() => setActive(c.id)}>
            <Avatar name={c.n} verified={c.ver} size={44} />
            <div className="ch-conv__body">
              <div className="ch-conv__top"><span className="ch-conv__name">{c.n}</span><span className="ch-conv__time">{c.time}</span></div>
              <div className="ch-conv__bottom">
                <span className="ch-conv__last">{c.last}</span>
                {c.unread > 0 && <span className="ch-unread">{c.unread}</span>}
              </div>
              {c.car && <span className="ch-conv__car">{c.car}</span>}
            </div>
          </button>
        ))}
      </aside>

      <section className="ch-thread">
        <header className="ch-thead">
          <Avatar name={a.n} verified={a.ver} size={40} />
          <div>
            <div className="ch-conv__name">{a.n}</div>
            {a.car && <div className="ap-muted" style={{fontSize:13}}>Sobre: {a.car}</div>}
          </div>
        </header>
        <div className="ch-msgs" ref={endRef}>
          <div className="ch-daysep"><span>Hoy</span></div>
          {msgs.map((m, i) => (
            <div key={i} className={["ch-msg", m.me ? "ch-msg--me" : ""].join(" ")}>
              <div className="ch-bubble">{m.t}<span className="ch-msg__time">{m.time}{m.me && <I.Check size={13}/>}</span></div>
            </div>
          ))}
        </div>
        <div className="ch-composer">
          <button className="dp-iconbtn dp-iconbtn--ghost" aria-label="Adjuntar"><I.Camera size={20}/></button>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Escribe un mensaje…" />
          <button className="ch-send" aria-label="Enviar" onClick={send}><I.Send size={18}/></button>
        </div>
      </section>
    </div>
  );
}
window.Chat = Chat;
