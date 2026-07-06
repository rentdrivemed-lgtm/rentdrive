'use client';
import { useEffect, useRef, useState } from 'react';
import { IconSend, IconCheck } from '@/components/Icons';

type ConversacionFila = {
  id: number; solicitante_id: number; solicitante_nombre: string; solicitante_correo: string;
  solicitante_rol: string; estado: string; motivo_escalada: string;
  ultimo_mensaje: string | null; ultimo_at: string | null;
};
type Mensaje = { id: number; remitente_tipo: 'solicitante' | 'admin' | 'ia'; contenido: string; created_at: string };

const ESTADO_BADGE: Record<string, string> = {
  escalada: 'bg-danger/15 text-danger border-danger/25',
  ia: 'bg-brand-muted text-ink/70 border-border',
  resuelta: 'bg-success/15 text-success border-success/30',
};
const ESTADO_LABEL: Record<string, string> = { escalada: '🆘 Necesita intervención', ia: '🤖 Asistente', resuelta: '✅ Resuelta' };

export default function SoportePanel() {
  const [conversaciones, setConversaciones] = useState<ConversacionFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const cargarLista = async () => {
    setError('');
    try {
      const res = await fetch('/api/soporte', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar las conversaciones de soporte.'); return; }
      setConversaciones(d.conversaciones || []);
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargarLista(); const id = setInterval(cargarLista, 15000); return () => clearInterval(id); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensajes]);

  const abrir = async (id: number) => {
    setSeleccionada(id);
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/soporte/${id}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setMensajes(d.mensajes || []);
    } catch { /* el usuario puede reintentar abriendo de nuevo */ }
    finally { setCargandoDetalle(false); }
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim() || !seleccionada || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/soporte/${seleccionada}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: texto }),
      });
      if (res.ok) { setTexto(''); await abrir(seleccionada); await cargarLista(); }
    } catch { /* el usuario puede reintentar el envío */ }
    finally { setEnviando(false); }
  };

  const marcarResuelta = async () => {
    if (!seleccionada) return;
    setMarcando(true);
    try {
      const res = await fetch(`/api/soporte/${seleccionada}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'resuelta' }),
      });
      if (res.ok) await cargarLista();
    } catch { /* el usuario puede reintentar el clic */ }
    finally { setMarcando(false); }
  };

  const conv = conversaciones.find(c => c.id === seleccionada);
  const formatHora = (ts: string) => {
    const d = new Date(ts.replace(' ', 'T'));
    return isNaN(d.getTime()) ? ts : d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-ink text-lg flex items-center gap-2">💬 Soporte</h2>
        <p className="text-sm text-ink/50">Conversaciones de propietarios y clientes con el asistente automático.</p>
      </div>

      {error ? (
        <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
          <p className="text-danger mb-4">{error}</p>
          <button onClick={cargarLista} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
        </div>
      ) : cargando ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="bg-surface-2 rounded-xl border border-border h-16 animate-pulse" />)}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          {/* Lista */}
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {conversaciones.length === 0 ? (
              <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
                <p className="text-ink/40 text-sm">Todavía no hay conversaciones de soporte.</p>
              </div>
            ) : conversaciones.map(c => (
              <button key={c.id} onClick={() => abrir(c.id)}
                className={`w-full text-left bg-surface-2 rounded-xl border p-3 transition ${
                  seleccionada === c.id ? 'border-accent' : 'border-border hover:border-accent/40'
                }`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-ink truncate">{c.solicitante_nombre}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${ESTADO_BADGE[c.estado] || ''}`}>
                    {ESTADO_LABEL[c.estado] || c.estado}
                  </span>
                </div>
                <p className="text-[11px] text-ink/50 capitalize">{c.solicitante_rol}</p>
                {c.ultimo_mensaje && <p className="text-xs text-ink/50 truncate mt-1">{c.ultimo_mensaje}</p>}
              </button>
            ))}
          </div>

          {/* Detalle */}
          <div className="bg-surface-2 rounded-2xl border border-border flex flex-col min-h-[400px]">
            {!seleccionada ? (
              <div className="flex-1 flex items-center justify-center text-ink/40 text-sm">Selecciona una conversación</div>
            ) : (
              <>
                <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-semibold text-ink text-sm">{conv?.solicitante_nombre}</p>
                    <p className="text-xs text-ink/50">{conv?.solicitante_correo}</p>
                    {conv?.motivo_escalada && <p className="text-xs text-danger mt-0.5">Motivo: {conv.motivo_escalada}</p>}
                  </div>
                  {conv?.estado !== 'resuelta' && (
                    <button onClick={marcarResuelta} disabled={marcando}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-success hover:bg-success/80 text-white px-3 py-1.5 rounded-xl transition disabled:opacity-60">
                      <IconCheck size={12} /> {marcando ? 'Marcando…' : 'Marcar resuelta'}
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {cargandoDetalle ? (
                    <p className="text-center text-ink/40 text-sm mt-6">Cargando…</p>
                  ) : mensajes.map(m => {
                    const esSolicitante = m.remitente_tipo === 'solicitante';
                    const etiqueta = m.remitente_tipo === 'ia' ? 'Asistente 🤖' : m.remitente_tipo === 'admin' ? 'Tú (admin)' : null;
                    return (
                      <div key={m.id} className={`flex ${esSolicitante ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[75%] flex flex-col ${esSolicitante ? 'items-start' : 'items-end'}`}>
                          {etiqueta && <span className="text-[11px] text-ink/50 mb-0.5 mx-1">{etiqueta}</span>}
                          <div className={`px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                            esSolicitante ? 'bg-surface text-ink border border-border rounded-bl-sm' : 'bg-accent text-white rounded-br-sm'
                          }`}>
                            {m.contenido}
                          </div>
                          <span className="text-[10px] text-ink/40 mt-0.5 mx-1">{formatHora(m.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
                <form onSubmit={enviar} className="border-t border-border px-4 py-3 flex gap-2">
                  <input value={texto} onChange={e => setTexto(e.target.value)} disabled={enviando}
                    placeholder="Responder como administrador…"
                    className="flex-1 border border-border rounded-full px-4 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                  <button type="submit" aria-label="Enviar" disabled={!texto.trim() || enviando}
                    className="bg-accent hover:bg-accent-hover text-white rounded-full w-10 h-10 flex items-center justify-center transition disabled:opacity-50 flex-shrink-0">
                    <IconSend size={16} />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
