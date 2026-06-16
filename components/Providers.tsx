'use client';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { SessionProvider } from '@/contexts/SessionContext';
import type { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <SessionProvider>{children}</SessionProvider>
    </LanguageProvider>
  );
}
