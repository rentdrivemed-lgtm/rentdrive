'use client';
// ── La campana del panel unificado ──────────────────────────────────────────
//
// Hasta ahora la campana de notificaciones existía SOLO en /control (sondeo cada
// 12 s). El panel donde se aprueban las reservas no tenía ninguna: quien decide si
// entra la plata no se enteraba de nada a menos que se acordara de ir a mirar.
// Este componente la trae al panel nuevo con el mismo endpoint y el mismo ritmo,
// para que las dos superficies muestren exactamente lo mismo mientras convivan.
//
// No cambia nada del lado del servidor: GET /api/notificaciones lista las del
// usuario y PUT las marca leídas (todas, o las que se le pasen por `ids`).
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBell } from '@/components/Icons';

type Notif = { id: number; tipo: string; titulo: string; mensaje: string; leida: number; created_at: string };

const INTERVALO_MS = 12_000;

function formatoFecha(ts: string) {
  const d = new Date(String(ts).replace(' ', 'T'));
  return isNaN(d.getTime()) ? ts : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function CampanaPanel() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [avisos, setAvisos] = useState<{ id: number; texto: string }[]>([]);
  // Mayor id visto: sirve para avisar SOLO de lo que llegó desde la última vuelta.
  // `null` = primera carga (no se avisa de lo que ya estaba cuando se abrió la página).
  const ultimoId = useRef<number | null>(null);
  const secuencia = useRef(0);

  const empujarAviso = useCallback((texto: string) => {
    const id = ++secuencia.current;
    setAvisos(a => [...a, { id, texto }]);
    setTimeout(() => setAvisos(a => a.filter(x => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    let vivo = true;
    const cargar = () => {
      fetch('/api/notificaciones', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((d: { notificaciones?: Notif[] } | null) => {
          if (!vivo || !d) return;
          const lista = d.notificaciones || [];
          const maxId = lista.length ? Math.max(...lista.map(n => n.id)) : 0;
          if (ultimoId.current !== null && maxId > ultimoId.current) {
            const desde = ultimoId.current;
            lista.filter(n => n.id > desde).reverse().forEach(n => empujarAviso(`${n.titulo}: ${n.mensaje}`));
          }
          ultimoId.current = lista.length ? maxId : (ultimoId.current ?? 0);
          setNotifs(lista);
        })
        .catch(() => { /* reintenta en el próximo tick */ });
    };
    cargar();
    const t = setInterval(cargar, INTERVALO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [empujarAviso]);

  const noLeidas = notifs.filter(n => !n.leida).length;

  const marcarLeidas = useCallback(() => {
    if (!noLeidas) return;
    fetch('/api/notificaciones', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => { /* la próxima vuelta del sondeo lo corrige */ });
    setNotifs(ns => ns.map(n => ({ ...n, leida: 1 })));
  }, [noLeidas]);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => { const siguiente = !abierta; setAbierta(siguiente); if (siguiente) marcarLeidas(); }}
          aria-label={noLeidas ? `Notificaciones (${noLeidas} sin leer)` : 'Notificaciones'}
          aria-expanded={abierta}
          className="relative grid place-items-center w-9 h-9 rounded-xl border border-border text-ink/70 hover:text-ink hover:bg-surface-2 transition">
          <IconBell size={18} />
          {noLeidas > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-accent text-white text-[10px] font-bold">
              {noLeidas > 99 ? '99+' : noLeidas}
            </span>
          )}
        </button>

        {abierta && (
          <>
            {/* Capa para cerrar tocando fuera (también en celular). */}
            <button type="button" aria-label="Cerrar notificaciones" onClick={() => setAbierta(false)} className="fixed inset-0 z-40 cursor-default" />
            <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-surface-2 shadow-[var(--shadow-float)]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-surface-2">
                <span className="text-xs font-bold uppercase tracking-wider text-ink/60">Notificaciones</span>
                {noLeidas > 0 && (
                  <button type="button" onClick={marcarLeidas} className="text-[11px] text-accent hover:underline">Marcar leídas</button>
                )}
              </div>
              {notifs.length === 0 ? (
                <p className="px-4 py-6 text-xs text-ink/50 text-center">Sin notificaciones</p>
              ) : notifs.slice(0, 30).map(n => (
                <div key={n.id} className={`px-4 py-3 border-b border-border/60 last:border-0 ${n.leida ? '' : 'bg-surface-3/40'}`}>
                  <p className="text-xs font-bold text-ink">{n.titulo}</p>
                  <p className="text-xs text-ink/70 mt-0.5">{n.mensaje}</p>
                  <p className="text-[10px] text-ink/40 mt-1 font-mono">{formatoFecha(n.created_at)}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Avisos emergentes de lo que llegó mientras la página estaba abierta. */}
      <div className="fixed z-[60] bottom-24 md:bottom-6 right-4 flex flex-col gap-2 pointer-events-none">
        {avisos.map(a => (
          <div key={a.id} className="max-w-xs rounded-xl border border-accent/40 bg-surface-2 px-3 py-2 text-xs text-ink shadow-[var(--shadow-float)]">
            {a.texto}
          </div>
        ))}
      </div>
    </>
  );
}
