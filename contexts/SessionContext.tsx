'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { playMessageSound, isMuted } from '@/lib/sound';
import type { ReactNode } from 'react';
type User = { id: number; nombre: string; correo: string; rol: string };
type SessionCtx = { user: User | null; setUser: (u: User | null) => void; noLeidos: number; setNoLeidos: (n: number) => void; noNotifs: number; setNoNotifs: (n: number) => void; refetch: () => void; };
const Ctx = createContext<SessionCtx>({ user: null, setUser: () => {}, noLeidos: 0, setNoLeidos: () => {}, noNotifs: 0, setNoNotifs: () => {}, refetch: () => {} });

const POLL_MS = 30_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [noLeidos, setNoLeidos] = useState(0);
  const [noNotifs, setNoNotifs] = useState(0);
  const pathname = usePathname();
  const prevNoLeidos = useRef(0);

  const refetch = useCallback(() => { fetch('/api/auth/me').then(r => r.json()).then(d => setUser(d.user ?? null)).catch(() => setUser(null)); }, []);
  useEffect(() => { refetch(); }, [pathname, refetch]);

  useEffect(() => {
    if (!user) { setNoLeidos(0); setNoNotifs(0); prevNoLeidos.current = 0; return; }

    const cargarNoLeidos = () => {
      fetch('/api/chat/no-leidos').then(r => r.json()).then(d => {
        const total = Number(d?.total ?? 0);
        if (total > prevNoLeidos.current && !isMuted()) playMessageSound();
        prevNoLeidos.current = total;
        setNoLeidos(total);
      }).catch(() => {});
    };
    const cargarNoNotifs = () => {
      if (user.rol !== 'admin' && user.rol !== 'propietario') return;
      fetch('/api/notificaciones?count=1').then(r => r.json()).then(d => setNoNotifs(Number(d?.total ?? 0))).catch(() => {});
    };

    cargarNoLeidos();
    cargarNoNotifs();
    const id = setInterval(() => { cargarNoLeidos(); cargarNoNotifs(); }, POLL_MS);
    return () => clearInterval(id);
  }, [user]);

  return (<Ctx.Provider value={{ user, setUser, noLeidos, setNoLeidos, noNotifs, setNoNotifs, refetch }}>{children}</Ctx.Provider>);
}
export const useSession = () => useContext(Ctx);
