import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Panel · DrivePass',
  robots: { index: false, follow: false },
};

// Solo miembros del equipo (cuentas admin). Mismo guardado que /control: el gating
// fino por área lo hace cada API con `guardArea`; esto solo cierra la puerta de la
// superficie completa. La marca y los colores son los de la app (app/globals.css):
// este panel NO trae paleta propia — ese era justamente uno de los hallazgos.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    redirect('/login?next=/panel');
  }
  return <div className="flex-1 flex flex-col bg-bg">{children}</div>;
}
