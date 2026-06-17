'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { playMessageSound, isMuted } from '@/lib/sound';
import type { ReactNode } from 'react';
type User = { id: number; nombre: string; correo: string; rol: string };
type SessionCtx = { user: User | null; setUser: (u: User | null) => void; noLeidos: number; setNoLeidos: (n: number) => void; noNotifs: number; setNoNotifs: (n: number) => void; refetch: () => void; };
const Ctx = createContext<SessionCtx>({ user: null, setUser: () => {}, noLeidos: 0, setNoLeidos: () => {}, noNotifs: 0, setNoNotifs: () => {}, refetch: () => {} });
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [noLeidos, setNoLeidos] = useState(0);
  const [noNotifs, setNoNotifs] = useState(0);
  const pathname = usePathname();
  const prevNoLeidos = useRef(0);
  const refetch = useCallback(() => { fetch('/api/auth/me').then(r => r.json()).then(d => setUser(d.user ?? null)).catch(() => setUser(null)); }, []);
  useEffect(() => { refetch(); }, [pathname, refetch]);
  void noLeidos; void setNoLeidos; void noNotifs; void setNoNotifs; void prevNoLeidos; void playMessageSound; void isMuted;
  return (<Ctx.Provider value={{ user, setUser, noLeidos: 0, setNoLeidos, noNotifs: 0, setNoNotifs, refetch }}>{children}</Ctx.Provider>);
}
export const useSession = () => useContext(Ctx);