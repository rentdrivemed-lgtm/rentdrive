'use client';
import Link from 'next/link';
import { LogoWordmark } from '@/components/Logo';
import { useLang } from '@/contexts/LanguageContext';

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="hidden md:block bg-brand text-white/60 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
        {/* Brand */}
        <div className="flex flex-col items-start gap-2.5">
          <LogoWordmark height={42} />
          <p className="text-white/40 text-xs max-w-[30ch]">{t.footer.tagline}</p>
        </div>

        {/* Links */}
        <div>
          <p className="text-white/80 font-semibold text-sm mb-3">Plataforma</p>
          <div className="space-y-1.5 text-sm">
            <Link href="/para-usuarios" className="block hover:text-white transition">{t.nav.rent}</Link>
            <Link href="/propietarios-info" className="block hover:text-white transition">{t.nav.owners}</Link>
            <Link href="/terminos" className="block hover:text-white transition">{t.nav.terms}</Link>
          </div>
        </div>

        {/* Legal + payments */}
        <div>
          <p className="text-white/80 font-semibold text-sm mb-3">Pagos aceptados</p>
          <div className="flex gap-2 mb-4">
            {/* Visa */}
            <div className="bg-surface-2 rounded-lg px-3 py-1.5 flex items-center justify-center" style={{minWidth: 54}}>
              <svg viewBox="0 0 54 20" width="54" height="20">
                <rect width="54" height="20" rx="3" fill="#1A1F71"/>
                <text x="27" y="15" textAnchor="middle" fill="white" fontSize="12" fontStyle="italic" fontWeight="800" fontFamily="serif">VISA</text>
              </svg>
            </div>
            {/* Mastercard */}
            <div className="bg-surface-2 rounded-lg px-2 py-1.5 flex items-center gap-1">
              <svg viewBox="0 0 38 24" width="38" height="24">
                <circle cx="14" cy="12" r="10" fill="#EB001B"/>
                <circle cx="24" cy="12" r="10" fill="#F79E1B"/>
                <path d="M19 4.8A10 10 0 0 1 24 12 10 10 0 0 1 19 19.2 10 10 0 0 1 14 12 10 10 0 0 1 19 4.8z" fill="#FF5F00"/>
              </svg>
            </div>
          </div>
          <p className="text-xs">{t.footer.copy}</p>
        </div>
      </div>
    </footer>
  );
}
