'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconArrowL, IconSend } from '@/components/Icons';
import { CONTACTO_TELEFONO_VISIBLE, CONTACTO_WHATSAPP_URL } from '@/lib/contacto';

type Mensaje = { id: number; remitente_tipo: 'solicitante' | 'admin' | 'ia'; contenido: string; created_at: string };
type Conversacion = { id: number; estado: string };
type User = { id: number; nombre: string; rol: string };

const POLL_MS = 8000;

export default function SoportePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [conv, setConv] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [errorEnvio, setErrorEnvio] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const cargar = async () => {
    setErrorCarga('');
    try {
      const res = await fetch('/api/soporte', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorCarga('No pudimos cargar tu conversación de soporte.'); return; }
      setConv(d.conversacion);
      setMensajes(d.mensajes || []);
    } catch {
      setErrorCarga('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user) { router.push('/login'); return; }
      setUser(d.user);
    }).catch(() => router.push('/login'));
    cargar();
    const id = setInterval(cargar, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    setErrorEnvio('');
    const contenido = texto;
    setTexto('');

    try {
      const res = await fetch('/api/soporte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: contenido }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorEnvio(data.error || 'No se pudo enviar el mensaje.'); setTexto(contenido); return; }
      await cargar();
    } catch {
      setErrorEnvio('Sin conexión — el mensaje no se envió.');
      setTexto(contenido);
    } finally {
      setEnviando(false);
    }
  };

  const formatHora = (ts: string) => {
    const d = new Date(ts.replace(' ', 'T'));
    return isNaN(d.getTime()) ? ts : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  if (cargando) return <div className="text-center py-20 text-ink/50">Cargando...</div>;
  if (errorCarga) return (
    <div className="text-center py-20">
      <p className="text-ink/60 mb-4">{errorCarga}</p>
      <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100dvh-128px)] sm:h-[calc(100vh-112px)] max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-surface-2 border-b border-border px-4 py-3 flex items-center gap-3 shadow-sm">
        <Link href={user?.rol === 'propietario' ? '/dashboard/propietario' : '/dashboard/usuario'} aria-label="Volver"
          className="p-1.5 rounded-lg text-ink/50 hover:text-ink hover:bg-brand-muted transition">
          <IconArrowL size={18} />
        </Link>
        <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
          🤖
        </div>
        <div>
          <p className="font-semibold text-ink text-sm">Soporte DrivePass</p>
          <p className="text-xs text-ink/50">
            {conv?.estado === 'escalada' ? '👤 Un administrador está revisando tu mensaje' : 'Asistente automático'}
          </p>
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-surface">
        {mensajes.length === 0 && (
          <div className="text-center mt-10 space-y-2">
            <p className="text-ink/40 text-sm">
              Escríbenos tu duda — te respondemos al instante.
            </p>
            {/* El chat ocupa toda la pantalla, así que el pie de página con los
                datos de contacto queda debajo del pliegue y nadie lo ve. Aquí va
                la salida a WhatsApp, que es por donde escribe la mayoría. */}
            <p className="text-ink/40 text-xs">
              ¿Prefieres WhatsApp?{' '}
              <a href={CONTACTO_WHATSAPP_URL} target="_blank" rel="noopener noreferrer"
                className="text-accent font-semibold hover:underline">{CONTACTO_TELEFONO_VISIBLE}</a>
            </p>
          </div>
        )}
        {mensajes.map(m => {
          const esPropio = m.remitente_tipo === 'solicitante';
          const etiqueta = m.remitente_tipo === 'ia' ? 'Asistente DrivePass 🤖' : m.remitente_tipo === 'admin' ? 'Administrador DrivePass' : null;
          return (
            <div key={m.id} className={`flex ${esPropio ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] ${esPropio ? 'items-end' : 'items-start'} flex flex-col`}>
                {etiqueta && <span className="text-xs text-ink/50 mb-0.5 ml-1">{etiqueta}</span>}
                <div className={`px-4 py-2.5 rounded-2xl text-sm shadow-sm whitespace-pre-wrap ${
                  esPropio ? 'bg-accent text-white rounded-br-sm' : 'bg-surface-2 text-ink rounded-bl-sm border border-border'
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

      {/* Input */}
      {errorEnvio && (
        <p className="text-xs text-danger text-center bg-danger/10 border-t border-danger/25 py-1.5">{errorEnvio}</p>
      )}
      <form onSubmit={enviar} className="bg-surface-2 border-t border-border px-4 py-3 flex gap-2 items-center">
        <input
          type="text"
          placeholder="Escribe tu duda..."
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
