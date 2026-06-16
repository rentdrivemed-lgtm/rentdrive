'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { playMessageSound, isMuted } from '@/lib/sound';
import type { ReactNode } from 'react';

type User = { id: number; nombre: string; correo: string; rol: string };

type SessionCtx = {
  user: User | null;
  setUser: (u: User | null) => void;
  noLeidos: number;
  setNoLeidos: (n: number) => void;
  noNotifs: number;
  setNoNotifs: (n: number) => void;
  refetch: () => void;
};

const Ctx = createContext<SessionCtx>({
  user: null, setUser: () => {}, noLeidos: 0, setNoLeidos: () => {},
  noNotifs: 0, setNoNotifs: () => {}, refetch: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [noLeidos, setNoLeidos] = useState(0);
  const [noNotifs, setNoNotifs] = useState(0);
  const pathname = usePathname();
  const prevNoLeidos = useRef(0);

  const refetch = useCallback(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => { refetch(); }, [pathname, refetch]);

  // Poll unread chat messages
  useEffect(() => {
    if (!user) { setNoLeidos(0); prevNoLeidos.current = 0; return; }
    const poll = () => {
      fetch('/api/chat/no-leidos').then(r => r.json()).then(d => {
        const nuevo = d.total ?? 0;
        if (nuevo > prevNoLeidos.current && !pathname.startsWith('/chat')) {
          playMessageSound();
          if (!isMuted() && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('DrivePass — Nuevo mensaje', { body: 'Tienes mensajes sin leer', icon: '/brand/logo-dark.png' });
          }
        }
        prevNoLeidos.current = nuevo;
        setNoLeidos(nuevo);
      }).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [user, pathname]);

  useEffect(() => {
    if (pathname.startsWith('/chat')) { setNoLeidos(0); prevNoLeidos.current = 0; }
  }, [pathname]);

  // Poll unread notifications (admin + propietario)
  useEffect(() => {
    if (!user || !['admin', 'propietario'].includes(user.rol)) { setNoNotifs(0); return; }
    const poll = () => {
      fetch('/api/notificaciones?count=1').then(r => r.json()).then(d => setNoNotifs(d.total ?? 0)).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (user && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [user]);

  return (
    <Ctx.Provider value={{ user, setUser, noLeidos, setNoLeidos, noNotifs, setNoNotifs, refetch }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
