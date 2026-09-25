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
import {
  CONTACTO_DIRECCION, CONTACTO_BARRIO, CONTACTO_CIUDAD, CONTACTO_DEPARTAMENTO,
  CONTACTO_DIRECCION_COMPLETA, CONTACTO_TELEFONO_VISIBLE, CONTACTO_TEL_HREF,
  CONTACTO_WHATSAPP_URL, CONTACTO_INSTAGRAM_URL, CONTACTO_INSTAGRAM_USUARIO,
  CONTACTO_GOOGLE_MAPS_URL, CONTACTO_WAZE_URL,
} from '@/lib/contacto';

export const metadata: Metadata = {
  title: 'Contacto — DrivePass',
  description: `Alquiler de carros y transporte de grupos en ${CONTACTO_CIUDAD}. WhatsApp, dirección y redes.`,
};

const SITIO = 'https://www.drivepasscol.com';

type Enlace = {
  href: string;
  titulo: string;
  detalle: string;
  emoji: string;
  /** El principal va destacado: es el que usa casi todo el mundo. */
  principal?: boolean;
  externo?: boolean;
};

const ENLACES: Enlace[] = [
  {
    href: CONTACTO_WHATSAPP_URL, titulo: 'Escríbenos por WhatsApp',
    detalle: CONTACTO_TELEFONO_VISIBLE, emoji: '💬', principal: true, externo: true,
  },
  { href: CONTACTO_TEL_HREF, titulo: 'Llamar', detalle: CONTACTO_TELEFONO_VISIBLE, emoji: '📞' },
  { href: SITIO, titulo: 'Ver los carros disponibles', detalle: 'drivepasscol.com', emoji: '🚗', externo: true },
  { href: `${SITIO}/buses`, titulo: 'Transporte de grupos', detalle: 'De 12 a 42 pasajeros, con conductor', emoji: '🚌', externo: true },
  { href: CONTACTO_INSTAGRAM_URL, titulo: 'Instagram', detalle: `@${CONTACTO_INSTAGRAM_USUARIO}`, emoji: '📸', externo: true },
  { href: CONTACTO_GOOGLE_MAPS_URL, titulo: 'Cómo llegar', detalle: `${CONTACTO_DIRECCION}, ${CONTACTO_BARRIO}`, emoji: '📍', externo: true },
  { href: CONTACTO_WAZE_URL, titulo: 'Abrir en Waze', detalle: CONTACTO_CIUDAD, emoji: '🧭', externo: true },
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

      <nav className="mt-7 space-y-2.5" aria-label="Formas de contacto">
        {ENLACES.map(e => (
          <a
            key={e.href}
            href={e.href}
            {...(e.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 transition ${
              e.principal
                ? 'bg-accent border-accent text-white hover:opacity-90'
                : 'bg-surface border-border text-ink hover:bg-ink/5'
            }`}
          >
            <span className="text-xl shrink-0" aria-hidden="true">{e.emoji}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{e.titulo}</span>
              <span className={`block text-xs mt-0.5 ${e.principal ? 'text-white/80' : 'text-ink/50'}`}>
                {e.detalle}
              </span>
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
