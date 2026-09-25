'use client';
import Link from 'next/link';
import { LogoWordmark } from '@/components/Logo';
import { IconPin, IconPhone, IconMail, IconWhatsapp, IconInstagram, IconMaps, IconWaze } from '@/components/Icons';
import { useLang } from '@/contexts/LanguageContext';
import {
  CONTACTO_BARRIO,
  CONTACTO_CORREO,
  CONTACTO_CORREO_HREF,
  CONTACTO_CIUDAD,
  CONTACTO_DIRECCION,
  CONTACTO_GOOGLE_MAPS_URL,
  CONTACTO_INSTAGRAM_URL,
  CONTACTO_INSTAGRAM_USUARIO,
  CONTACTO_TEL_HREF,
  CONTACTO_TELEFONO_VISIBLE,
  CONTACTO_WAZE_URL,
  CONTACTO_WHATSAPP_URL,
} from '@/lib/contacto';

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="bg-brand text-white/60 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center sm:text-left">
        {/* Brand */}
        <div className="flex flex-col items-center sm:items-start gap-2.5">
          <LogoWordmark height={42} />
          <p className="text-white/40 text-xs max-w-[30ch]">{t.footer.tagline}</p>
        </div>

        {/* Links */}
        <div>
          <p className="text-white/80 font-semibold text-sm mb-3">{t.footer.platform}</p>
          <div className="space-y-1.5 text-sm">
            <Link href="/para-usuarios" className="block hover:text-white transition">{t.nav.rent}</Link>
            <Link href="/propietarios-info" className="block hover:text-white transition">{t.nav.owners}</Link>
            <Link href="/terminos" className="block hover:text-white transition">{t.nav.terms}</Link>
          </div>
        </div>

        {/* Contacto */}
        <div>
          <p className="text-white/80 font-semibold text-sm mb-3">{t.footer.contact}</p>
          {/* <address> es el elemento semántico para los datos de contacto del
              negocio: ayuda a lectores de pantalla y a los buscadores. */}
          <address className="not-italic text-sm space-y-3">
            <div className="flex gap-2 justify-center sm:justify-start">
              {/* En el celular la columna va centrada y el pin a un costado de un
                  bloque de 3 líneas se ve descolgado: solo aparece de sm en adelante,
                  donde el texto se alinea a la izquierda y el icono sí ancla. */}
              <IconPin size={15} className="hidden sm:block mt-0.5 shrink-0 text-white/35" />
              <div>
                <span className="block text-white/40 text-xs">{t.footer.point}</span>
                <span className="block text-white/75">{CONTACTO_DIRECCION}</span>
                <span className="block text-white/40 text-xs">{CONTACTO_BARRIO}, {CONTACTO_CIUDAD}</span>
                <span className="block text-white/40 text-xs mt-1.5">
                  {t.footer.directions}:{' '}
                  <a href={CONTACTO_GOOGLE_MAPS_URL} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-white/70 hover:text-white underline underline-offset-2 transition">
                    <IconMaps size={11} className="shrink-0" />Google Maps</a>
                  {' · '}
                  <a href={CONTACTO_WAZE_URL} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-white/70 hover:text-white underline underline-offset-2 transition">
                    <IconWaze size={11} className="shrink-0" />Waze</a>
                </span>
              </div>
            </div>
            {/* `block py-0.5`: en el celular cada enlace ocupa el ancho de la
                columna y algo más de alto, para que se pueda tocar sin apuntar. */}
            {/* Con el logo de cada canal, no con el nombre suelto: en un pie de página
                nadie LEE, barre con la vista, y el logotipo de WhatsApp o de Instagram
                se reconoce antes que su palabra. Los iconos van `aria-hidden` porque
                el texto de al lado ya nombra el canal — anunciarlo dos veces a un
                lector de pantalla sería peor, no mejor. */}
            <div className="space-y-1">
              <a href={CONTACTO_TEL_HREF} aria-label={`${t.footer.call} ${CONTACTO_TELEFONO_VISIBLE}`}
                className="flex items-center gap-2 py-0.5 justify-center sm:justify-start hover:text-white transition">
                <IconPhone size={15} className="shrink-0 text-white/35" />
                {CONTACTO_TELEFONO_VISIBLE}
              </a>
              <a href={CONTACTO_WHATSAPP_URL} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 py-0.5 justify-center sm:justify-start hover:text-white transition">
                <IconWhatsapp size={15} className="shrink-0 text-white/35" />
                {t.footer.whatsapp}
              </a>
              <a href={CONTACTO_INSTAGRAM_URL} target="_blank" rel="noopener noreferrer"
                aria-label={`${t.footer.instagram} (@${CONTACTO_INSTAGRAM_USUARIO})`}
                className="flex items-center gap-2 py-0.5 justify-center sm:justify-start hover:text-white transition">
                <IconInstagram size={15} className="shrink-0 text-white/35" />
                @{CONTACTO_INSTAGRAM_USUARIO}
              </a>
              <a href={CONTACTO_CORREO_HREF}
                className="flex items-center gap-2 py-0.5 justify-center sm:justify-start hover:text-white transition">
                <IconMail size={15} className="shrink-0 text-white/35" />
                {CONTACTO_CORREO}
              </a>
            </div>
          </address>
        </div>

        {/* Legal + payments */}
        <div>
          <p className="text-white/80 font-semibold text-sm mb-3">{t.footer.payments}</p>
          <div className="flex gap-2 mb-4 justify-center sm:justify-start">
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
