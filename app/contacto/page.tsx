// Tarjeta de contacto de la empresa: es a donde lleva el QR.
//
// POR QUÉ EL QR APUNTA AQUÍ Y NO LLEVA LOS DATOS DENTRO. Un QR con una vCard incrustada
// guarda el contacto sin internet, pero queda congelado: el día que cambie el celular o
// se abra una cuenta de TikTok, todos los QR impresos —calcomanías en los carros,
// tarjetas, el vidrio de la oficina— quedan mintiendo y hay que reimprimirlos. Apuntando
// a una URL corta, el QR impreso no caduca nunca y esta página se actualiza sola.
//
// Quien igual quiera el contacto en su agenda tiene el botón «Guardar contacto», que le
// descarga la vCard. Así se tienen las dos cosas sin el inconveniente de ninguna.
//
// Los datos salen TODOS de lib/contacto.ts, que es de donde los toman el pie de página,
// los correos y el marcado para buscadores. No hay ni un teléfono escrito a mano aquí:
// si se cambia allá, esta tarjeta cambia con él.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  CONTACTO_DIRECCION, CONTACTO_BARRIO, CONTACTO_CIUDAD, CONTACTO_DEPARTAMENTO,
  CONTACTO_DIRECCION_COMPLETA, CONTACTO_TELEFONO_VISIBLE, CONTACTO_TEL_HREF,
  CONTACTO_WHATSAPP_URL, CONTACTO_INSTAGRAM_URL, CONTACTO_INSTAGRAM_USUARIO,
  CONTACTO_CORREO, CONTACTO_CORREO_HREF,
  CONTACTO_GOOGLE_MAPS_URL, CONTACTO_WAZE_URL,
} from '@/lib/contacto';
import ContactoAcciones from '@/components/ContactoAcciones';
import {
  IconPhone, IconMail, IconCar, IconBus, IconInstagram, IconMaps, IconWaze,
} from '@/components/Icons';

export const metadata: Metadata = {
  title: 'Contacto — DrivePass',
  description: `Alquiler de carros y transporte de grupos en ${CONTACTO_CIUDAD}. WhatsApp, dirección y redes.`,
};

const SITIO = 'https://www.drivepasscol.com';

type Enlace = {
  href: string;
  titulo: string;
  detalle: string;
  /** Logo real de la marca, o icono de línea de la casa. Nunca un emoji: el emoji lo
   *  dibuja cada sistema a su manera y en Android el de WhatsApp ni siquiera existe. */
  icono: ReactNode;
  externo?: boolean;
};

// WhatsApp NO está en esta lista: lo lleva `ContactoAcciones`, que además compone el
// mensaje. Un segundo botón suelto de WhatsApp competiría con aquel y la gente tocaría
// el que no compone nada.
const ENLACES: Enlace[] = [
  { href: CONTACTO_TEL_HREF, titulo: 'Llamar', detalle: CONTACTO_TELEFONO_VISIBLE,
    icono: <IconPhone size={20} /> },
  { href: SITIO, titulo: 'Ver los carros disponibles', detalle: 'drivepasscol.com',
    icono: <IconCar size={20} />, externo: true },
  { href: `${SITIO}/buses`, titulo: 'Transporte de grupos', detalle: 'De 12 a 42 pasajeros, con conductor',
    icono: <IconBus size={20} />, externo: true },
  { href: CONTACTO_INSTAGRAM_URL, titulo: 'Instagram', detalle: `@${CONTACTO_INSTAGRAM_USUARIO}`,
    icono: <IconInstagram size={19} />, externo: true },
  { href: CONTACTO_CORREO_HREF, titulo: 'Escríbenos un correo', detalle: CONTACTO_CORREO,
    icono: <IconMail size={20} /> },
  { href: CONTACTO_GOOGLE_MAPS_URL, titulo: 'Cómo llegar', detalle: `${CONTACTO_DIRECCION}, ${CONTACTO_BARRIO}`,
    icono: <IconMaps size={19} />, externo: true },
  { href: CONTACTO_WAZE_URL, titulo: 'Abrir en Waze', detalle: CONTACTO_CIUDAD,
    icono: <IconWaze size={19} />, externo: true },
];

export default function ContactoPage() {
  return (
    <main className="max-w-md mx-auto px-4 py-8 sm:py-12">
      <header className="text-center">
        <h1 className="text-2xl font-bold text-ink">DrivePass</h1>
        <p className="text-sm text-ink-soft mt-1">
          Alquiler de carros sin conductor y transporte de grupos
        </p>
        <p className="text-xs text-ink/45 mt-1">
          {CONTACTO_CIUDAD}, {CONTACTO_DEPARTAMENTO}
        </p>
      </header>

      <ContactoAcciones whatsappUrl={CONTACTO_WHATSAPP_URL} urlTarjeta={`${SITIO}/contacto`} />

      <nav className="mt-6 space-y-2.5" aria-label="Formas de contacto">
        {ENLACES.map(e => (
          <a
            key={e.href}
            href={e.href}
            {...(e.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-ink hover:bg-ink/5 transition"
          >
            <span className="w-9 h-9 rounded-xl bg-accent-light flex items-center justify-center shrink-0 text-accent">
              {e.icono}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{e.titulo}</span>
              <span className="block text-xs mt-0.5 text-ink/50">{e.detalle}</span>
            </span>
          </a>
        ))}
      </nav>

      {/* La vCard, para quien prefiera tenernos en su agenda. Se genera en el servidor
          (/api/contacto/vcard) y no aquí: así el archivo es idéntico venga de donde
          venga, y el teléfono lo abre como contacto en vez de como descarga suelta. */}
      <a
        href="/api/contacto/vcard"
        className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-border-strong px-4 py-3 text-sm font-semibold text-ink/80 hover:bg-ink/5 transition"
      >
        Guardar contacto en el celular
      </a>

      <address className="not-italic text-center text-xs text-ink/45 mt-7 leading-relaxed">
        {CONTACTO_DIRECCION_COMPLETA}
      </address>
    </main>
  );
}
