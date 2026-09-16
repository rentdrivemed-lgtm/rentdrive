'use client';
import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import BottomNav from '@/components/BottomNav';
import type { ReactNode } from 'react';

// `/panel` (panel unificado del equipo) se suma a la lista por el mismo motivo que
// `/control`: trae su propia barra superior, su propia barra lateral y su propia
// barra inferior de celular, así que la navegación pública (Navbar/Footer/BottomNav)
// sobraría y además chocaría con la barra inferior del panel. No cambia nada para
// las rutas que ya estaban.
const RUTAS_SIN_SHELL = ['/acceso-drivepass', '/control', '/panel'];

export default function ConditionalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const sinShell = RUTAS_SIN_SHELL.some(r => pathname.startsWith(r));

  if (sinShell) {
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <BottomNav />
    </>
  );
}
