'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconChat } from '@/components/Icons';

type Conversacion = {
  id: number;
  propietario_id: number;
  usuario_id: number;
  propietario_nombre: string;
  usuario_nombre: string;
  ultimo_mensaje: string | null;
  ultimo_at: string | null;
  no_leidos: number;
};
type User = { id: number; nombre: string; rol: string };

export default function ChatListPage() {
  const [user, setUser] = useState<User | null>(null);
  const [convs, setConvs] = useState<Conversacion[]>([]);
  const [error, setError] = useState('');
  const router = useRouter();

  const cargarConversaciones = () => {
    setError('');
    fetch('/api/chat/conversaciones').then(r => r.json()).then(d => setConvs(d.conversaciones || []))
      .catch(() => setError('No pudimos cargar tus conversaciones. Revisa tu conexión.'));
  };

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user) { router.push('/login'); return; }
      setUser(d.user);
    }).catch(() => router.push('/login'));
    cargarConversaciones();
  }, [router]);

  const formatFecha = (ts: string | null) => {
    if (!ts) return '';
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center">
          <IconChat size={20} className="text-ink" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink">Mensajes</h1>
          <p className="text-ink/50 text-xs">{convs.length} conversación{convs.length !== 1 ? 'es' : ''}</p>
        </div>
      </div>

      {error ? (
        <div className="text-center py-20 bg-surface-2 rounded-2xl border border-border">
          <p className="text-ink/60 mb-4">{error}</p>
          <button onClick={cargarConversaciones} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
        </div>
      ) : convs.length === 0 ? (
        <div className="text-center py-20 bg-surface-2 rounded-2xl border border-border">
          <IconChat size={48} className="text-ink/20 mx-auto mb-4" />
          <p className="text-ink/50 font-medium">No tienes conversaciones aún.</p>
          {user?.rol === 'usuario' && (
            <p className="text-sm text-ink/40 mt-1">Busca un vehículo y contacta al propietario.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {convs.map(c => {
            const otroNombre = user?.id === c.propietario_id ? c.usuario_nombre : c.propietario_nombre;
            const noLeidos = c.no_leidos ?? 0;
            return (
              <Link key={c.id} href={`/chat/${c.id}`}
                className={`flex items-center gap-3 rounded-2xl p-4 shadow-sm hover:shadow-md transition border
                  ${noLeidos > 0 ? 'bg-accent-light border-accent/20' : 'bg-surface-2 border-border'}`}
              >
                <div className="relative flex-shrink-0">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm
                    ${noLeidos > 0 ? 'bg-accent text-white' : 'bg-brand-muted text-ink'}`}>
                    {otroNombre.charAt(0).toUpperCase()}
                  </div>
                  {noLeidos > 0 && (
                    <span className="absolute -top-1 -right-1 bg-danger/100 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">
                      {noLeidos > 9 ? '9+' : noLeidos}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className={`text-sm truncate ${noLeidos > 0 ? 'font-bold text-ink' : 'font-semibold text-ink/80'}`}>
                      {otroNombre}
                    </p>
                    <span className="text-xs text-ink/40 flex-shrink-0 ml-2">{formatFecha(c.ultimo_at)}</span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${noLeidos > 0 ? 'text-ink/70 font-medium' : 'text-ink/50'}`}>
                    {c.ultimo_mensaje || 'Sin mensajes aún'}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
