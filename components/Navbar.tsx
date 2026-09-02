'use client';
import Link from 'next/link';
import { LogoMark, LogoWordmark } from '@/components/Logo';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isMuted, setMuted } from '@/lib/sound';
import { useLang } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionContext';
import {
  IconDashboard, IconChat, IconHistory, IconLogout,
  IconBell, IconBellOff, IconMenu, IconX, IconUser, IconGlobe, IconInbox,
  IconHome, IconCar, IconBuilding, IconCoin,
} from '@/components/Icons';

type Notif = {
  id: number; tipo: string; titulo: string; mensaje: string;
  referencia_id?: number; referencia_tipo?: string;
  leida: number; created_at: string;
};

const rolBadge: Record<string, string> = {
  admin:       'bg-accent/15 text-accent',
  propietario: 'bg-white/10 text-ink-soft',
  usuario:     'bg-white/10 text-ink-soft',
};

function tipoIcono(tipo: string) {
  if (tipo === 'documentos_subidos') return '📄';
  if (tipo === 'documento_aprobado') return '✅';
  if (tipo === 'documento_denegado') return '❌';
  if (tipo === 'reserva_nueva') return '🚗';
  return '🔔';
}

function relTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

export default function Navbar() {
  const { user, setUser, noLeidos, noNotifs, setNoNotifs } = useSession();
  const [muted, setMutedState] = useState(false);
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifList, setNotifList] = useState<Notif[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const reqMenuRef = useRef<HTMLDivElement>(null);
  const { lang, setLang, t } = useLang();

  const rolLabel: Record<string, string> = {
    admin: t.nav.role_admin, propietario: t.nav.role_owner, usuario: t.nav.role_user,
  };

  useEffect(() => {
    setMutedState(isMuted());
    const handler = (e: Event) => setMutedState((e as CustomEvent<boolean>).detail);
    window.addEventListener('rentdrive:mute', handler);
    return () => window.removeEventListener('rentdrive:mute', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (reqMenuRef.current && !reqMenuRef.current.contains(e.target as Node)) setReqOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleMute = () => { const n = !muted; setMuted(n); setMutedState(n); };

  useEffect(() => {
    setOpen(false);
    setUserMenu(false);
    setNotifOpen(false);
    setReqOpen(false);
  }, [pathname]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setUserMenu(false);
    router.push('/');
  };

  const openNotifs = async () => {
    if (notifOpen) { setNotifOpen(false); return; }
    setNotifOpen(true);
    setLoadingNotifs(true);
    const data = await fetch('/api/notificaciones').then(r => r.json()).catch(() => ({ notificaciones: [] }));
    setNotifList(data.notificaciones || []);
    setLoadingNotifs(false);
    // Mark all as read
    if (noNotifs > 0) {
      fetch('/api/notificaciones', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      setNoNotifs(0);
    }
  };

  const dashHref =
    user?.rol === 'admin' ? '/dashboard/admin' :
    user?.rol === 'propietario' ? '/dashboard/propietario' : '/dashboard/usuario';

  const requisitosLinks = [
    { href: '/para-usuarios', label: t.nav.rent, icon: <IconCar size={20} /> },
    { href: '/propietarios-info', label: t.nav.owners, icon: <IconBuilding size={20} /> },
  ];

  const publicLinks = [
    { href: '/buses', label: t.nav.buses },
    { href: '/terminos', label: t.nav.terms },
  ];

  const authLinks = user ? [
    { href: dashHref, label: t.nav.dashboard, icon: <IconDashboard size={16}/> },
    { href: '/historial', label: t.nav.history, icon: <IconHistory size={16}/> },
  ] : [];

  const showNotifBell = user && ['admin', 'propietario'].includes(user.rol);

  return (
    <>
      <nav className="bg-brand shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">

          {/* Logo — wordmark completo (mark + DrivePass + "RENT A CAR") en desktop, solo mark en móvil */}
          <Link href="/" className="flex items-center flex-shrink-0" aria-label="DrivePass — inicio">
            <LogoWordmark height={42} className="hidden sm:block" />
            <LogoMark size={42} className="sm:hidden" />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1 flex-1 justify-end">
            {/* Alquilar — entrada explícita al inicio/vitrina, para quien no asocia el logo con "inicio" */}
            <Link href="/"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition
                ${pathname === '/' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}>
              <IconHome size={16} /> {t.nav.browse}
            </Link>

            {/* Requisitos — dropdown con los dos botones grandes */}
            <div className="relative" ref={reqMenuRef}>
              <button onClick={() => setReqOpen(o => !o)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition
                  ${reqOpen || requisitosLinks.some(l => pathname === l.href) ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}>
                {t.nav.requirements}
                <svg className={`w-3.5 h-3.5 transition-transform ${reqOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
              </button>

              {reqOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-surface-2 rounded-2xl shadow-xl border border-border p-3 z-50 grid grid-cols-1 gap-2">
                  {requisitosLinks.map(l => (
                    <Link key={l.href} href={l.href} onClick={() => setReqOpen(false)}
                      className="flex items-center gap-3 px-4 py-4 rounded-xl border border-border bg-surface hover:border-accent hover:bg-accent-light transition group">
                      <span className="w-10 h-10 rounded-xl bg-accent-light group-hover:bg-accent/20 text-accent flex items-center justify-center flex-shrink-0">
                        {l.icon}
                      </span>
                      <span className="font-bold text-ink text-sm">{l.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Gana con tu carro — CTA propio para propietarios, con tratamiento de acento */}
            <Link href="/calculadora-propietarios"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition
                ${pathname === '/calculadora-propietarios'
                  ? 'bg-accent/20 border-accent/50 text-white'
                  : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:text-accent-hover'}`}>
              <IconCoin size={16} /> {t.nav.earn}
            </Link>

            {publicLinks.map(l => (
              <Link key={l.href} href={l.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition
                  ${pathname === l.href ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}>
                {l.label}
              </Link>
            ))}

            {authLinks.map(l => (
              <Link key={l.href} href={l.href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition
                  ${pathname.startsWith(l.href) ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}>
                {l.icon}{l.label}
              </Link>
            ))}

            {user && (
              <Link href="/chat"
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition
                  ${pathname.startsWith('/chat') ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}>
                <IconChat size={16}/> {t.nav.messages}
                {noLeidos > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-accent text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                    {noLeidos > 99 ? '99+' : noLeidos}
                  </span>
                )}
              </Link>
            )}

            {/* Notification bell — admin & propietario */}
            {showNotifBell && (
              <div className="relative ml-1" ref={notifRef}>
                <button onClick={openNotifs} title="Notificaciones"
                  className="relative p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition">
                  <IconInbox size={17}/>
                  {noNotifs > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-danger/100 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {noNotifs > 99 ? '99+' : noNotifs}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-surface-2 rounded-2xl shadow-xl border border-border overflow-hidden z-50">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
                      <p className="font-bold text-ink text-sm flex items-center gap-2">
                        <IconInbox size={14} className="text-accent"/> Notificaciones
                      </p>
                      {notifList.some(n => !n.leida) && (
                        <button
                          onClick={() => {
                            fetch('/api/notificaciones', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                            setNotifList(l => l.map(n => ({ ...n, leida: 1 })));
                            setNoNotifs(0);
                          }}
                          className="text-[11px] text-accent hover:text-accent-hover font-medium">
                          Marcar todo leído
                        </button>
                      )}
                    </div>
                    <div className="max-h-[360px] overflow-y-auto divide-y divide-border/50">
                      {loadingNotifs ? (
                        <p className="text-center text-ink/50 py-10 text-sm">Cargando…</p>
                      ) : notifList.length === 0 ? (
                        <p className="text-center text-ink/50 py-10 text-sm">Sin notificaciones</p>
                      ) : notifList.map(n => (
                        <div key={n.id} className={`px-4 py-3 transition ${!n.leida ? 'bg-accent/5' : 'hover:bg-surface'}`}>
                          <div className="flex items-start gap-2.5">
                            <span className="text-base flex-shrink-0 mt-0.5 leading-none">{tipoIcono(n.tipo)}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-ink leading-snug">{n.titulo}</p>
                              <p className="text-xs text-ink/60 mt-0.5 leading-snug break-words">{n.mensaje}</p>
                              <p className="text-[10px] text-ink/40 mt-1">{relTime(n.created_at)}</p>
                            </div>
                            {!n.leida && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-1.5"/>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {user && (
              <button onClick={toggleMute} title={muted ? 'Activar notificaciones' : 'Silenciar'}
                className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition ml-1">
                {muted ? <IconBellOff size={17}/> : <IconBell size={17}/>}
              </button>
            )}

            {/* Language toggle */}
            <button
              onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition ml-1"
              title={lang === 'es' ? 'Switch to English' : 'Cambiar a Español'}
            >
              <IconGlobe size={15}/>
              <span className="font-bold">{lang === 'es' ? 'EN' : 'ES'}</span>
            </button>

            {user ? (
              <div className="relative ml-2" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenu(o => !o)}
                  className="flex items-center gap-2 pl-3 border-l border-white/20 hover:opacity-90 transition"
                >
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                    {user.nombre[0].toUpperCase()}
                  </div>
                  <div className="text-left hidden lg:block">
                    <p className="text-white text-xs font-semibold leading-none">{user.nombre}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${rolBadge[user.rol]}`}>
                      {rolLabel[user.rol]}
                    </span>
                  </div>
                  <svg className={`w-3.5 h-3.5 text-white/50 transition-transform ${userMenu ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>

                {userMenu && (
                  <div className="absolute right-0 top-full mt-2 w-52 bg-surface-2 rounded-2xl shadow-xl border border-border py-2 z-50">
                    <div className="px-4 py-2.5 border-b border-border mb-1">
                      <p className="text-ink font-bold text-sm leading-none">{user.nombre}</p>
                      <p className="text-ink/50 text-xs mt-0.5">{user.correo}</p>
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-1 ${rolBadge[user.rol]}`}>
                        {rolLabel[user.rol]}
                      </span>
                    </div>
                    <Link href={dashHref} onClick={() => setUserMenu(false)}
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink hover:bg-surface transition">
                      <IconDashboard size={15} className="text-ink/50" /> {t.nav.profile}
                    </Link>
                    <Link href="/historial" onClick={() => setUserMenu(false)}
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink hover:bg-surface transition">
                      <IconHistory size={15} className="text-ink/50" /> {t.nav.history}
                    </Link>
                    <Link href="/chat" onClick={() => setUserMenu(false)}
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink hover:bg-surface transition">
                      <IconChat size={15} className="text-ink/50" />
                      <span>{t.nav.messages}</span>
                      {noLeidos > 0 && (
                        <span className="ml-auto bg-accent text-white text-[9px] font-bold rounded-full px-1.5 py-0.5">
                          {noLeidos}
                        </span>
                      )}
                    </Link>
                    <div className="border-t border-border mt-1 pt-1">
                      <button onClick={logout}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-danger hover:bg-danger/10 transition">
                        <IconLogout size={15} /> {t.nav.logout}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 ml-2">
                <Link href="/login"
                  className="text-white/80 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-white/10 transition">
                  {t.nav.login}
                </Link>
                <Link href="/registro"
                  className="bg-accent hover:bg-accent-hover text-white text-sm font-semibold px-4 py-2 rounded-lg transition shadow-md">
                  {t.nav.register}
                </Link>
              </div>
            )}
          </div>

          {/* Mobile toggle */}
          <button onClick={() => setOpen(o => !o)} aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open}
            className="md:hidden text-white/80 hover:text-white p-2">
            {open ? <IconX size={22}/> : <IconMenu size={22}/>}
          </button>
        </div>

        {/* Mobile menu */}
        {open && (
          <div className="md:hidden border-t border-white/10 bg-brand-hover pb-4 px-4">
            {user && (
              <div className="flex items-center gap-3 py-4 border-b border-white/10 mb-3">
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">
                  {user.nombre[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{user.nombre}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${rolBadge[user.rol]}`}>
                    {rolLabel[user.rol]}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Link href="/"
                className="flex items-center gap-2 text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm font-bold transition bg-white/10">
                <IconHome size={16}/> {t.nav.browse}
              </Link>

              {/* Gana con tu carro — CTA propio para propietarios, destacado con acento */}
              <Link href="/calculadora-propietarios"
                className="flex items-center gap-3 border border-accent/40 bg-accent/10 hover:bg-accent/20 px-4 py-3.5 rounded-xl text-sm font-bold text-accent transition mt-1">
                <span className="w-9 h-9 rounded-lg bg-accent/20 text-accent flex items-center justify-center flex-shrink-0"><IconCoin size={20} /></span>
                {t.nav.earn}
              </Link>

              <p className="text-white/40 text-[11px] font-bold uppercase tracking-wide px-3 pt-3 pb-1">{t.nav.requirements}</p>
              {requisitosLinks.map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center gap-3 bg-white/5 border border-white/10 hover:bg-white/10 px-4 py-3.5 rounded-xl text-sm font-semibold text-white transition mb-1">
                  <span className="w-9 h-9 rounded-lg bg-accent/20 text-accent flex items-center justify-center flex-shrink-0">{l.icon}</span>
                  {l.label}
                </Link>
              ))}

              <div className="border-t border-white/10 my-2"/>

              {publicLinks.map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm font-medium transition">
                  {l.label}
                </Link>
              ))}

              {user && (
                <>
                  <div className="border-t border-white/10 my-2"/>
                  <Link href={dashHref}
                    className="flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm font-medium transition">
                    <IconUser size={16}/> {t.nav.profile}
                  </Link>
                  {authLinks.filter(l => l.href !== dashHref).map(l => (
                    <Link key={l.href} href={l.href}
                      className="flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm font-medium transition">
                      {l.icon}{l.label}
                    </Link>
                  ))}
                  <Link href="/chat" className="flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm font-medium transition">
                    <IconChat size={16}/> {t.nav.messages}
                    {noLeidos > 0 && <span className="ml-auto bg-accent text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{noLeidos}</span>}
                  </Link>
                  {showNotifBell && (
                    <button onClick={openNotifs}
                      className="w-full flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm transition">
                      <IconInbox size={16}/> Notificaciones
                      {noNotifs > 0 && <span className="ml-auto bg-danger/100 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{noNotifs}</span>}
                    </button>
                  )}
                </>
              )}

              <button
                onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
                className="w-full flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm transition">
                <IconGlobe size={16}/>
                {lang === 'es' ? 'Switch to English' : 'Cambiar a Español'}
              </button>

              {user ? (
                <>
                  <button onClick={toggleMute}
                    className="w-full flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm transition">
                    {muted ? <IconBellOff size={16}/> : <IconBell size={16}/>}
                    {muted ? 'Notificaciones silenciadas' : 'Notificaciones activas'}
                  </button>
                  <button onClick={logout}
                    className="w-full flex items-center gap-2 text-danger hover:bg-white/10 px-3 py-2.5 rounded-lg text-sm font-semibold transition">
                    <IconLogout size={16}/> {t.nav.logout}
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2 pt-2">
                  <Link href="/login" className="text-center text-white/80 border border-white/20 py-2 rounded-lg text-sm hover:bg-white/10 transition">{t.nav.login}</Link>
                  <Link href="/registro" className="text-center bg-accent text-white font-semibold py-2 rounded-lg text-sm hover:bg-accent-hover transition">{t.nav.register}</Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
