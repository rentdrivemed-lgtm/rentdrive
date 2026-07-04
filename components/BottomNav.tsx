'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconHome, IconCar, IconDashboard, IconChat, IconHistory, IconKey, IconUser } from '@/components/Icons';
import { useSession } from '@/contexts/SessionContext';

export default function BottomNav() {
  const pathname = usePathname();
  const { user, noLeidos } = useSession();

  const dashHref =
    user?.rol === 'admin' ? '/dashboard/admin' :
    user?.rol === 'propietario' ? '/dashboard/propietario' : '/dashboard/usuario';

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href;
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const cls = (active: boolean) =>
    `flex flex-col items-center gap-0.5 py-2.5 flex-1 min-w-0 transition-colors select-none ${
      active ? 'text-accent' : 'text-ink/50 active:text-ink/70'
    }`;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-2 border-t border-border flex items-stretch shadow-[0_-1px_16px_rgba(27,51,86,0.10)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <Link href="/" className={cls(isActive('/'))}>
        <IconHome size={21} />
        <span className="text-[10px] font-semibold leading-none">Inicio</span>
      </Link>

      {user ? (
        <>
          <Link href={dashHref} className={cls(isActive('/dashboard'))}>
            <IconDashboard size={21} />
            <span className="text-[10px] font-semibold leading-none">Panel</span>
          </Link>

          <Link href="/chat" className={cls(isActive('/chat'))}>
            <div className="relative">
              <IconChat size={21} />
              {noLeidos > 0 && (
                <span className="absolute -top-1 -right-2 bg-accent text-white text-[8px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5 leading-none">
                  {noLeidos > 9 ? '9+' : noLeidos}
                </span>
              )}
            </div>
            <span className="text-[10px] font-semibold leading-none">Chat</span>
          </Link>

          <Link href="/historial" className={cls(isActive('/historial'))}>
            <IconHistory size={21} />
            <span className="text-[10px] font-semibold leading-none">Historial</span>
          </Link>
        </>
      ) : (
        <>
          <Link href="/para-usuarios" className={cls(isActive('/para-usuarios'))}>
            <IconCar size={21} />
            <span className="text-[10px] font-semibold leading-none">Requisitos</span>
          </Link>

          <Link href="/propietarios-info" className={cls(isActive('/propietarios-info'))}>
            <IconKey size={21} />
            <span className="text-[10px] font-semibold leading-none">Publicar</span>
          </Link>

          <Link href="/login" className={cls(isActive('/login') || isActive('/registro'))}>
            <IconUser size={21} />
            <span className="text-[10px] font-semibold leading-none">Acceder</span>
          </Link>
        </>
      )}
    </nav>
  );
}
