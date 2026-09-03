'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { normalizarNivel, parsePermisosExtra, puede, NIVEL_LABEL, type AdminNivel, type PermisosExtra } from '@/lib/permisos';
import PanelHoy from '@/components/control/PanelHoy';
import TareasBoard from '@/components/control/TareasBoard';
import CalendarioBoard from '@/components/control/CalendarioBoard';
import DocumentosBoard from '@/components/control/DocumentosBoard';
import TablerosBoard from '@/components/control/TablerosBoard';
import OperacionesPanel from '@/components/OperacionesPanel';

type Notif = { id: number; tipo: string; titulo: string; mensaje: string; leida: number; created_at: string };
type Seccion = 'panel' | 'operaciones' | 'tareas' | 'calendario' | 'documentos' | 'tableros';

const NAV: { key: Seccion; label: string; listo: boolean }[] = [
  { key: 'panel', label: 'Panel de hoy', listo: true },
  { key: 'operaciones', label: 'Operaciones', listo: true },
  { key: 'tareas', label: 'Tareas', listo: true },
  { key: 'calendario', label: 'Calendario', listo: true },
  { key: 'documentos', label: 'Documentos', listo: true },
  { key: 'tableros', label: 'Tableros', listo: true },
];

// useSearchParams exige un límite <Suspense> alrededor del componente que lo usa (mismo
// patrón que ya sigue app/pago/page.tsx) — se usa para preseleccionar sección/tablero
// cuando se llega desde una notificación clicable del Navbar (destinoDeNotificacion).
export default function ControlPage() {
  return (
    <Suspense fallback={null}>
      <ControlApp />
    </Suspense>
  );
}

function ControlApp() {
  const [nivel, setNivel] = useState<AdminNivel>('secretaria');
  const [permisos, setPermisos] = useState<PermisosExtra>({});
  const [nombre, setNombre] = useState('');
  const [seccion, setSeccion] = useState<Seccion>('panel');
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const lastNotifId = useRef<number | null>(null);
  const toastSeq = useRef(0);
  const searchParams = useSearchParams();

  // Preselección de sección al llegar desde una notificación clicable del Navbar
  // (?tab=<clave>, ver destinoDeNotificacion en components/Navbar.tsx). Solo una vez.
  const urlTabAplicado = useRef(false);
  useEffect(() => {
    if (urlTabAplicado.current) return;
    urlTabAplicado.current = true;
    const tabParam = searchParams.get('tab') as Seccion | null;
    if (tabParam && NAV.some(n => n.key === tabParam)) setSeccion(tabParam);
  }, [searchParams]);

  const tableroFocusId = (() => {
    const raw = searchParams.get('tablero');
    return raw ? Number(raw) : null;
  })();

  const pushToast = useCallback((text: string) => {
    const id = ++toastSeq.current;
    setToasts(t => [...t, { id, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);

  // Perfil / nivel
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d?.user) {
          setNivel(normalizarNivel(d.user.admin_nivel));
          setPermisos(parsePermisosExtra(d.user.permisos_extra));
          setNombre(d.user.nombre || '');
        }
      })
      .catch(() => {});
  }, []);

  // Campana: sondeo cada 12s (mismo patrón simple que el resto de la app).
  const cargarNotifs = useCallback(async () => {
    try {
      const r = await fetch('/api/notificaciones', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      const lista: Notif[] = d.notificaciones || [];
      const maxId = lista.length ? Math.max(...lista.map(n => n.id)) : 0;
      if (lastNotifId.current !== null && maxId > lastNotifId.current) {
        // Avisar de lo nuevo desde la última revisión.
        lista.filter(n => n.id > (lastNotifId.current || 0)).reverse().forEach(n => pushToast(`🔔 ${n.titulo}: ${n.mensaje}`));
      }
      if (lista.length) lastNotifId.current = maxId;
      else if (lastNotifId.current === null) lastNotifId.current = 0;
      setNotifs(lista);
    } catch { /* reintenta en el próximo tick */ }
  }, [pushToast]);

  useEffect(() => {
    cargarNotifs();
    const t = setInterval(cargarNotifs, 12000);
    return () => clearInterval(t);
  }, [cargarNotifs]);

  // Los módulos visibles salen del permiso efectivo (nivel + excepciones por empleado),
  // igual que las pestañas del panel admin. Las APIs de /api/control/* ya devuelven 403
  // sin el área; sin este filtro el menú mostraba módulos que reventaban al abrirlos.
  const navVisible = useMemo(() => NAV.filter(n => puede(nivel, n.key, permisos)), [nivel, permisos]);

  // Sección efectiva DERIVADA (no un efecto que reescriba el estado): si el módulo
  // abierto no está permitido, se cae al primero disponible. Así, cuando llegan los
  // permisos reales desde /api/auth/me, la vista se corrige sola sin render intermedio.
  const seccionActiva: Seccion | null =
    navVisible.some(n => n.key === seccion) ? seccion : (navVisible[0]?.key ?? null);

  const noLeidas = notifs.filter(n => !n.leida).length;
  const marcarLeidas = async () => {
    if (!noLeidas) return;
    try { await fetch('/api/notificaciones', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); }
    catch { /* */ }
    setNotifs(ns => ns.map(n => ({ ...n, leida: 1 })));
  };

  const hoy = new Date().toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div className="brand-name">DrivePass · Control interno</div>
        </div>
        <div className="topbar-right">
          <span className="mono" style={{ textTransform: 'capitalize' }}>{hoy}</span>
          <div className="bell-wrap">
            <button className="bell-btn" onClick={() => { setBellOpen(o => !o); if (!bellOpen) marcarLeidas(); }} aria-label="Notificaciones">
              🔔{noLeidas > 0 && <span className="bell-badge">{noLeidas}</span>}
            </button>
            {bellOpen && (
              <div className="bell-panel">
                <div className="bell-head"><span>Notificaciones</span>{noLeidas > 0 && <button onClick={marcarLeidas}>Marcar leídas</button>}</div>
                {notifs.length === 0 ? (
                  <div className="notif-empty">Sin notificaciones</div>
                ) : notifs.slice(0, 30).map(n => (
                  <div key={n.id} className={`notif-item ${n.leida ? '' : 'unread'}`}>
                    <div className="notif-title">{n.titulo}</div>
                    <div>{n.mensaje}</div>
                    <div className="notif-time">{formatoFecha(n.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="role-pill">{nombre || 'Equipo'} · {NIVEL_LABEL[nivel]}</div>
        </div>
      </div>

      {/* Shell */}
      <div className="shell">
        <nav className="sidebar">
          {navVisible.map(n => (
            <button key={n.key} className={`nav-item ${seccionActiva === n.key ? 'active' : ''}`} onClick={() => setSeccion(n.key)}>
              <span className="nav-dot" />{n.label}{!n.listo && <span style={{ fontSize: 9, marginLeft: 'auto', opacity: .6 }}>pronto</span>}
            </button>
          ))}
        </nav>

        <main className="main">
          {seccionActiva === 'tareas' && <TareasBoard nivel={nivel} onEvento={cargarNotifs} pushToast={pushToast} />}
          {seccionActiva === 'calendario' && <CalendarioBoard nivel={nivel} onEvento={cargarNotifs} pushToast={pushToast} />}
          {seccionActiva === 'documentos' && <DocumentosBoard nivel={nivel} onEvento={cargarNotifs} pushToast={pushToast} />}
          {seccionActiva === 'panel' && <PanelHoy />}
          {seccionActiva === 'operaciones' && (
            <>
              <div className="section-head"><div><div className="section-title">Operaciones</div><div className="section-sub">Servicios asignados a mensajeros · checklist, fotos e inspección</div></div></div>
              <div className="op-embed"><OperacionesPanel /></div>
            </>
          )}
          {seccionActiva === 'tableros' && <TablerosBoard pushToast={pushToast} onEvento={cargarNotifs} focusId={tableroFocusId} />}
          {navVisible.length === 0 && (
            <div className="section-head"><div>
              <div className="section-title">Sin módulos asignados</div>
              <div className="section-sub">Tu cuenta no tiene ninguna sección del panel de control habilitada. Pídele acceso al administrador principal.</div>
            </div></div>
          )}
        </main>
      </div>

      {/* Toasts */}
      <div className="dpc-toast-stack">
        {toasts.map(t => <div key={t.id} className="dpc-toast">{t.text}</div>)}
      </div>
    </>
  );
}

function formatoFecha(ts: string) {
  const d = new Date(String(ts).replace(' ', 'T'));
  return isNaN(d.getTime()) ? ts : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
