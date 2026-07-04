'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { playMessageSound } from '@/lib/sound';
import { IconArrowL, IconSend } from '@/components/Icons';

type Mensaje = {
  id: number;
  remitente_id: number;
  remitente_nombre: string;
  contenido: string;
  created_at: string;
};
type Conversacion = {
  id: number;
  propietario_id: number;
  usuario_id: number;
  propietario_nombre: string;
  usuario_nombre: string;
};
type User = { id: number; nombre: string; rol: string };

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [conv, setConv] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const userRef = useRef<User | null>(null);
  const convRef = useRef<Conversacion | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (!d.user) { router.push('/login'); return; }
        setUser(d.user);
        userRef.current = d.user;
      }).catch(() => router.push('/login'));
  }, [router]);

  useEffect(() => {
    fetch('/api/chat/conversaciones')
      .then(r => r.json())
      .then(d => {
        const c = d.conversaciones?.find((c: Conversacion) => c.id === Number(id));
        if (c) { setConv(c); convRef.current = c; }
      });

    fetch(`/api/chat/mensajes?conversacion_id=${id}&desde_id=0`)
      .then(r => r.json())
      .then(d => {
        if (d.mensajes?.length) {
          setMensajes(d.mensajes);
          const ultimo = d.mensajes[d.mensajes.length - 1].id;
          lastIdRef.current = ultimo;
          marcarLeido(ultimo);
        }
      });
  }, [id]);

  const marcarLeido = (ultimoId: number) => {
    fetch('/api/chat/leer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversacion_id: Number(id), ultimo_id: ultimoId }),
    });
  };

  useEffect(() => {
    const conectar = () => {
      const url = `/api/chat/stream?conversacion_id=${id}&desde_id=${lastIdRef.current}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const nuevos: Mensaje[] = JSON.parse(e.data);
          if (!nuevos.length) return;

          const ultimoId = nuevos[nuevos.length - 1].id;
          lastIdRef.current = ultimoId;

          setMensajes(prev => {
            const ids = new Set(prev.map(m => m.id));
            return [...prev, ...nuevos.filter(m => !ids.has(m.id))];
          });

          marcarLeido(ultimoId);

          const ajenos = nuevos.filter(m => m.remitente_id !== userRef.current?.id);
          if (ajenos.length) playMessageSound();

          if (ajenos.length && document.visibilityState === 'hidden') {
            const c = convRef.current;
            const otroNombre = c
              ? (userRef.current?.id === c.propietario_id ? c.usuario_nombre : c.propietario_nombre)
              : 'Alguien';

            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(`${otroNombre}`, {
                body: ajenos[ajenos.length - 1].contenido,
                icon: '/brand/logo-mark.svg',
                tag: `chat-${id}`,
              });
            }
          }
        } catch { /* heartbeat */ }
      };

      es.onerror = () => {
        es.close();
        setTimeout(conectar, 2000);
      };
    };

    conectar();
    return () => esRef.current?.close();
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    setErrorEnvio('');

    try {
      const res = await fetch('/api/chat/mensajes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversacion_id: Number(id), contenido: texto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.mensaje) { setErrorEnvio('No se pudo enviar el mensaje. Intenta de nuevo.'); return; }
      setMensajes(prev => {
        const ids = new Set(prev.map(m => m.id));
        return ids.has(data.mensaje.id) ? prev : [...prev, data.mensaje];
      });
      lastIdRef.current = data.mensaje.id;
      marcarLeido(data.mensaje.id);
      setTexto('');
    } catch {
      setErrorEnvio('Sin conexión — el mensaje no se envió.');
    } finally {
      setEnviando(false);
    }
  };

  const otroNombre = conv
    ? (user?.id === conv.propietario_id ? conv.usuario_nombre : conv.propietario_nombre)
    : '…';

  const formatHora = (ts: string) => {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-128px)] sm:h-[calc(100vh-112px)] max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-surface-2 border-b border-border px-4 py-3 flex items-center gap-3 shadow-sm">
        <Link href="/chat" aria-label="Volver a mensajes" className="p-1.5 rounded-lg text-ink/50 hover:text-ink hover:bg-brand-muted transition">
          <IconArrowL size={18} />
        </Link>
        <div className="w-9 h-9 rounded-full bg-brand-muted flex items-center justify-center text-ink font-bold text-sm flex-shrink-0">
          {otroNombre.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-semibold text-ink text-sm">{otroNombre}</p>
          <p className="text-xs text-success">En línea</p>
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-surface">
        {mensajes.length === 0 && (
          <p className="text-center text-ink/40 text-sm mt-10">
            Sé el primero en escribir
          </p>
        )}
        {mensajes.map(m => {
          const esPropio = user?.id === m.remitente_id;
          return (
            <div key={m.id} className={`flex ${esPropio ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] ${esPropio ? 'items-end' : 'items-start'} flex flex-col`}>
                {!esPropio && (
                  <span className="text-xs text-ink/50 mb-0.5 ml-1">{m.remitente_nombre}</span>
                )}
                <div className={`px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                  esPropio
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-surface-2 text-ink rounded-bl-sm border border-border'
                }`}>
                  {m.contenido}
                </div>
                <span className="text-[10px] text-ink/40 mt-0.5 mx-1">
                  {formatHora(m.created_at)}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {errorEnvio && (
        <p className="text-xs text-danger text-center bg-danger/10 border-t border-danger/25 py-1.5">{errorEnvio}</p>
      )}
      <form onSubmit={enviar} className="bg-surface-2 border-t border-border px-4 py-3 flex gap-2 items-center">
        <input
          type="text"
          placeholder="Escribe un mensaje..."
          className="flex-1 border border-border rounded-full px-4 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          disabled={enviando}
          autoFocus
        />
        <button
          type="submit"
          aria-label="Enviar mensaje"
          disabled={!texto.trim() || enviando}
          className="bg-accent hover:bg-accent-hover text-white rounded-full w-10 h-10 flex items-center justify-center transition disabled:opacity-50 flex-shrink-0"
        >
          <IconSend size={16} />
        </button>
      </form>
    </div>
  );
}
