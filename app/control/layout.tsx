import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Oswald, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { getCurrentUser } from '@/lib/auth';
import './control.css';

const oswald = Oswald({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-oswald' });
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Panel de Control · DrivePass',
  robots: { index: false, follow: false },
};

export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  // Solo miembros del equipo (cuentas admin). Los demás van al login.
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    redirect('/login?next=/control');
  }
  return (
    <div className={`dpc ${oswald.variable} ${plexSans.variable} ${plexMono.variable}`}>
      {children}
    </div>
  );
}
