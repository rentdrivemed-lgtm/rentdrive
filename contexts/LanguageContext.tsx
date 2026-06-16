'use client';
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { es, en, type Translations } from '@/lib/i18n';

export type Lang = 'es' | 'en';

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; t: Translations; }

const LanguageContext = createContext<LangCtx>({ lang: 'es', setLang: () => {}, t: es });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('es');

  useEffect(() => {
    const saved = localStorage.getItem('drivepass_lang') as Lang | null;
    if (saved === 'en' || saved === 'es') setLangState(saved);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('drivepass_lang', l);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: lang === 'en' ? en : es }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);
