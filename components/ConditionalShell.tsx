'use client';
import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import BottomNav from '@/components/BottomNav';
import type { ReactNode } from 'react';

const RUTAS_SIN_SHELL = ['/acceso-drivepass', '/control'];

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
