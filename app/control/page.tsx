'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizarNivel, NIVEL_LABEL, type AdminNivel } from '@/lib/permisos';
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

export default function ControlApp() {
  const [nivel, setNivel] = useState<AdminNivel>('secretaria');
  const [nombre, setNombre] = useState('');
  const [seccion, setSeccion] = useState<Seccion>('panel');
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const lastNotifId = useRef<number | null>(null);
  const toastSeq = useRef(0);

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
          {NAV.map(n => (
            <button key={n.key} className={`nav-item ${seccion === n.key ? 'active' : ''}`} onClick={() => setSeccion(n.key)}>
              <span className="nav-dot" />{n.label}{!n.listo && <span style={{ fontSize: 9, marginLeft: 'auto', opacity: .6 }}>pronto</span>}
            </button>
          ))}
        </nav>

        <main className="main">
          {seccion === 'tareas' && <TareasBoard nivel={nivel} onEvento={cargarNotifs} pushToast={pushToast} />}
          {seccion === 'calendario' && <CalendarioBoard nivel={nivel} onEvento={cargarNotifs} pushToast={pushToast} />}
          {seccion === 'documentos' && <DocumentosBoard nivel={nivel} onEvento={cargarNotifs} pushToast={pushToast} />}
          {seccion === 'panel' && <PanelHoy />}
          {seccion === 'operaciones' && (
            <>
              <div className="section-head"><div><div className="section-title">Operaciones</div><div className="section-sub">Servicios asignados a mensajeros · checklist, fotos e inspección</div></div></div>
              <div className="op-embed"><OperacionesPanel /></div>
            </>
          )}
          {seccion === 'tableros' && <TablerosBoard pushToast={pushToast} onEvento={cargarNotifs} />}
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
