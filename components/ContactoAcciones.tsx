'use client';
// La parte viva de la tarjeta de contacto: qué necesitas, compartir y el QR en pantalla.
//
// EL COMPOSITOR DE WHATSAPP es lo que de verdad hace trabajo. Casi todo el mundo abre
// WhatsApp y escribe «hola», y a partir de ahí hay que preguntarle todo. Aquí elige en
// qué anda —alquilar, mover un grupo, poner su carro a rentar— y el mensaje sale ya
// escrito. El cliente ahorra el trago de redactar y al otro lado llega una consulta que
// ya dice algo, no un saludo suelto.
//
// Cuando elige TRANSPORTE DE GRUPO se le pregunta cuántas personas, igual que en la
// portada: es el dato sin el cual la conversación no arranca, y preguntarlo aquí evita
// el ida y vuelta.
//
// COMPARTIR y MOSTRAR EL QR existen por cómo se usa esto de verdad: alguien que ya es
// cliente quiere pasarle DrivePass a un amigo, o enseñarle la pantalla para que la
// escanee. Sin eso tendría que copiar la URL a mano.
import { useState, type ReactNode } from 'react';
import { IconWhatsapp, IconCar, IconBus, IconKey, IconChat } from '@/components/Icons';

type Props = {
  whatsappUrl: string;
  /** URL pública de esta misma tarjeta, para compartir y para el QR. */
  urlTarjeta: string;
};

type Intencion = {
  clave: string;
  etiqueta: string;
  icono: ReactNode;
  /** `null` cuando hace falta preguntar algo más antes de componer el mensaje. */
  mensaje: string | null;
};

const INTENCIONES: Intencion[] = [
  { clave: 'carro', etiqueta: 'Alquilar un carro', icono: <IconCar size={17} />,
    mensaje: 'Hola, quiero alquilar un carro. ¿Me ayudan con la disponibilidad?' },
  { clave: 'grupo', etiqueta: 'Mover un grupo', icono: <IconBus size={17} />, mensaje: null },
  { clave: 'propietario', etiqueta: 'Poner mi carro a rentar', icono: <IconKey size={17} />,
    mensaje: 'Hola, tengo un carro y me interesa ponerlo a rentar con ustedes. ¿Cómo funciona?' },
  { clave: 'otra', etiqueta: 'Otra cosa', icono: <IconChat size={17} />,
    mensaje: 'Hola, quiero hacerles una consulta.' },
];

export default function ContactoAcciones({ whatsappUrl, urlTarjeta }: Props) {
  const [intencion, setIntencion] = useState<Intencion | null>(null);
  const [pasajeros, setPasajeros] = useState('');
  const [qrVisible, setQrVisible] = useState(false);
  const [aviso, setAviso] = useState('');

  const n = Number(pasajeros);
  const grupoListo = intencion?.clave === 'grupo' && Number.isInteger(n) && n > 0;

  const mensaje = intencion?.clave === 'grupo'
    ? (grupoListo
        ? `Hola, necesito transporte para ${n} ${n === 1 ? 'persona' : 'personas'}. ¿Me pasan una cotización?`
        : null)
    : intencion?.mensaje ?? null;

  // Sin intención elegida se abre WhatsApp en blanco, que es lo que pasaba antes: el
  // compositor AÑADE, nunca estorba a quien solo quiere escribir.
  const href = mensaje ? `${whatsappUrl}?text=${encodeURIComponent(mensaje)}` : whatsappUrl;

  const compartir = async () => {
    setAviso('');
    const datos = {
      title: 'DrivePass',
      text: 'Alquiler de carros sin conductor y transporte de grupos en Medellín.',
      url: urlTarjeta,
    };
    // `share` no existe en escritorio ni en navegadores viejos: ahí se copia el enlace,
    // que resuelve lo mismo sin dejar a nadie sin salida.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share(datos); return; } catch { /* lo cerró: no es un error */ }
    }
    try {
      await navigator.clipboard.writeText(urlTarjeta);
      setAviso('Enlace copiado');
    } catch {
      setAviso('Copia el enlace de la barra de direcciones');
    }
  };

  return (
    <div className="mt-7">
      <p className="text-[11px] font-semibold text-ink/60 uppercase tracking-wide mb-2">
        ¿En qué te ayudamos?
      </p>

      <div className="grid grid-cols-2 gap-2">
        {INTENCIONES.map(i => {
          const activa = intencion?.clave === i.clave;
          return (
            <button
              key={i.clave} type="button"
              aria-pressed={activa}
              onClick={() => { setIntencion(activa ? null : i); setPasajeros(''); }}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                activa
                  ? 'bg-accent-light border-accent text-ink'
                  : 'bg-surface border-border text-ink/70 hover:bg-ink/5'
              }`}
            >
              <span className={`shrink-0 ${activa ? 'text-accent' : 'text-ink/45'}`}>{i.icono}</span>
              <span className="text-xs font-semibold leading-tight">{i.etiqueta}</span>
            </button>
          );
        })}
      </div>

      {/* El dato sin el cual una cotización de grupo no arranca. */}
      {intencion?.clave === 'grupo' && (
        <div className="mt-2.5">
          <label htmlFor="contacto-pasajeros" className="block text-[11px] text-ink/60 mb-1">
            ¿Cuántas personas van?
          </label>
          <input
            id="contacto-pasajeros"
            type="number" inputMode="numeric" min={1} max={999}
            placeholder="Ej: 25"
            className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface"
            value={pasajeros}
            onChange={e => setPasajeros(e.target.value)}
          />
        </div>
      )}

      {/* Se muestra el mensaje ANTES de abrir WhatsApp: nadie debería mandar en su
          nombre un texto que no ha leído. */}
      {mensaje && (
        <p className="mt-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-ink/70 italic">
          «{mensaje}»
        </p>
      )}

      <a
        href={href}
        target="_blank" rel="noopener noreferrer"
        className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3.5 text-sm font-bold text-white hover:opacity-90 transition"
      >
        <IconWhatsapp size={18} />
        {mensaje ? 'Abrir WhatsApp con este mensaje' : 'Escríbenos por WhatsApp'}
      </a>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button" onClick={compartir}
          className="rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-ink/70 hover:bg-ink/5 transition"
        >
          Compartir DrivePass
        </button>
        <button
          type="button"
          aria-expanded={qrVisible}
          onClick={() => setQrVisible(v => !v)}
          className="rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-ink/70 hover:bg-ink/5 transition"
        >
          {qrVisible ? 'Ocultar QR' : 'Mostrar QR'}
        </button>
      </div>

      {aviso && <p className="mt-2 text-center text-[11px] text-ink/55" role="status">{aviso}</p>}

      {/* Para enseñarle la pantalla a alguien y que la escanee. Fondo blanco siempre:
          el tema de la aplicación es oscuro y un QR oscuro sobre oscuro no lo lee
          ningún lector. */}
      {qrVisible && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/qr-contacto.svg" alt="Código QR con el contacto de DrivePass" className="w-44 h-44" />
          <p className="text-[11px] text-[#0A1422]/60">Apúntale con la cámara</p>
        </div>
      )}
    </div>
  );
}
