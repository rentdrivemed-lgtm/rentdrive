'use client';
import Link from 'next/link';
import { useLang } from '@/contexts/LanguageContext';
import {
  IconCar, IconShield, IconRoute, IconArrowR, IconPlane,
  IconCompass, IconPin, IconCheck, IconStar, IconChat,
} from '@/components/Icons';

/** WhatsApp del aliado DTravel SAS (tours en Antioquia). */
const WA_DTRAVEL = 'https://wa.me/573216737988';

const T = {
  es: {
    alliance: 'Alianza',
    title: 'Recorre Antioquia a tu ritmo',
    sub: 'Alquiler de carros verificados de DrivePass + las experiencias de DTravel. Tú eliges el destino; nosotros, cómo llegar con total libertad.',
    ctaCar: 'Reservar mi carro',
    ctaTour: 'Hablar con DTravel',
    introTitle: 'Una experiencia, dos expertos',
    intros: [
      { icon: 'compass', t: 'DTravel diseña tu viaje', d: 'Tour operador antioqueño especializado en experiencias auténticas: Guatapé, Comuna 13, Santa Fe, Jardín y más.' },
      { icon: 'car',     t: 'DrivePass te mueve',       d: 'Carros modelo 2018+, seguro todo riesgo, GPS satelital y servicio aeropuerto. Conduces tú, a tu ritmo.' },
      { icon: 'star',    t: 'Mejor juntos',             d: 'El carro propio multiplica el valor del viaje: paras donde quieras, sin horarios ni grupos.' },
    ],
    routesTitle: 'Rutas de autoconducción por Antioquia',
    routesSub: 'Destinos curados por DTravel, perfectos para recorrer en tu propio carro.',
    routes: [
      { t: 'Guatapé y el Peñol',     d: 'Casas decoradas, la Piedra y el embalse.', km: '~2 h desde Medellín', tag: 'Oriente' },
      { t: 'Santa Fe de Antioquia',  d: 'Ciudad colonial, calles de adoquín y clima cálido.', km: '~1.5 h', tag: 'Occidente' },
      { t: 'Jardín',                 d: 'Pueblo cafetero, plaza vibrante y senderismo.', km: '~3 h', tag: 'Suroeste' },
      { t: 'Hacienda Nápoles',       d: 'Parque temático, zoológico y parques acuáticos.', km: '~3 h', tag: 'Magdalena' },
      { t: 'Santa Elena',            d: 'Tradición silletera y miradores de Medellín.', km: '~45 min', tag: 'Cerca' },
      { t: 'Comuna 13',              d: 'Arte urbano, escaleras eléctricas y resiliencia.', km: 'En Medellín', tag: 'Ciudad' },
    ],
    whyTitle: 'Todo lo que incluye tu carro',
    whys: [
      { icon: 'shield', t: 'Seguro todo riesgo',  d: 'Cada vehículo con póliza activa. Viajas tranquilo.' },
      { icon: 'gps',    t: 'GPS satelital',        d: 'Rastreo en tiempo real en toda la flota.' },
      { icon: 'plane',  t: 'Servicio aeropuerto',  d: 'Recogida y traslado a J.M. Córdova u Olaya Herrera.' },
      { icon: 'car',    t: 'Flota 2018 en adelante', d: 'Vehículos recientes, impecables mecánica y estética.' },
    ],
    howTitle: '¿Cómo funciona?',
    steps: [
      { n: '01', t: 'Elige tu experiencia', d: 'DTravel te asesora el destino y la ruta ideal según tus días en Antioquia.' },
      { n: '02', t: 'Reserva tu carro',     d: 'En DrivePass eliges fechas y vehículo. Pago seguro con Visa o Mastercard y confirmación inmediata.' },
      { n: '03', t: 'Recorre a tu ritmo',   d: 'Recoge el carro, sigue la ruta y para donde quieras. Sin horarios ni grupos.' },
    ],
    quote: '"Tus clientes ya están en Antioquia. Con DrivePass se mueven a su ritmo en un carro verificado con seguro y GPS."',
    ctaTitle: '¿Listo para tu viaje por Antioquia?',
    ctaSub: 'Reserva tu carro con DrivePass o coordina tu tour con DTravel. La combinación perfecta.',
    badge1: 'Carros verificados',
    badge2: 'Seguro + GPS',
    badge3: 'Aliado oficial DTravel',
  },
  en: {
    alliance: 'Alliance',
    title: 'Explore Antioquia at your own pace',
    sub: "DrivePass verified car rentals + DTravel's experiences. You choose the destination; we handle how you get there, with total freedom.",
    ctaCar: 'Book my car',
    ctaTour: 'Chat with DTravel',
    introTitle: 'One trip, two experts',
    intros: [
      { icon: 'compass', t: 'DTravel designs your trip', d: 'Antioquia tour operator specialized in authentic experiences: Guatapé, Comuna 13, Santa Fe, Jardín and more.' },
      { icon: 'car',     t: 'DrivePass moves you',        d: '2018+ vehicles, full coverage insurance, satellite GPS and airport service. You drive, at your own pace.' },
      { icon: 'star',    t: 'Better together',            d: 'Your own car multiplies the value of the trip: stop wherever you want, no schedules or groups.' },
    ],
    routesTitle: 'Self-drive routes across Antioquia',
    routesSub: 'Destinations curated by DTravel, perfect to explore in your own car.',
    routes: [
      { t: 'Guatapé & El Peñol',     d: 'Decorated houses, the Rock and the reservoir.', km: '~2 h from Medellín', tag: 'East' },
      { t: 'Santa Fe de Antioquia',  d: 'Colonial town, cobbled streets and warm weather.', km: '~1.5 h', tag: 'West' },
      { t: 'Jardín',                 d: 'Coffee town, vibrant square and hiking.', km: '~3 h', tag: 'Southwest' },
      { t: 'Hacienda Nápoles',       d: 'Theme park, zoo and water parks.', km: '~3 h', tag: 'Magdalena' },
      { t: 'Santa Elena',            d: 'Silletero tradition and Medellín viewpoints.', km: '~45 min', tag: 'Nearby' },
      { t: 'Comuna 13',              d: 'Urban art, escalators and resilience.', km: 'In Medellín', tag: 'City' },
    ],
    whyTitle: 'Everything your car includes',
    whys: [
      { icon: 'shield', t: 'Full coverage insurance', d: 'Every vehicle with active policy. Travel with peace of mind.' },
      { icon: 'gps',    t: 'Satellite GPS',           d: 'Real-time tracking across the fleet.' },
      { icon: 'plane',  t: 'Airport service',         d: 'Pickup and transfer to J.M. Córdova or Olaya Herrera.' },
      { icon: 'car',    t: '2018+ fleet',             d: 'Recent vehicles, spotless mechanics and looks.' },
    ],
    howTitle: 'How does it work?',
    steps: [
      { n: '01', t: 'Choose your experience', d: 'DTravel advises the ideal destination and route for your days in Antioquia.' },
      { n: '02', t: 'Book your car',          d: 'On DrivePass pick dates and vehicle. Secure payment with Visa or Mastercard and instant confirmation.' },
      { n: '03', t: 'Drive at your pace',     d: 'Pick up the car, follow the route and stop wherever you want. No schedules or groups.' },
    ],
    quote: '"Your clients are already in Antioquia. With DrivePass they move at their own pace in a verified car with insurance and GPS."',
    ctaTitle: 'Ready for your Antioquia trip?',
    ctaSub: 'Book your car with DrivePass or coordinate your tour with DTravel. The perfect combination.',
    badge1: 'Verified cars',
    badge2: 'Insurance + GPS',
    badge3: 'Official DTravel partner',
  },
};

const introIcon = {
  compass: <IconCompass size={22} className="text-accent" />,
  car: <IconCar size={22} className="text-accent" />,
  star: <IconStar size={22} className="text-accent" />,
};

const whyIcon = {
  shield: <IconShield size={20} className="text-accent" />,
  gps: <IconRoute size={20} className="text-accent" />,
  plane: <IconPlane size={20} className="text-accent" />,
  car: <IconCar size={20} className="text-accent" />,
};

export default function AlianzaDtravelPage() {
  const { lang } = useLang();
  const c = T[lang];

  return (
    <div>
      {/* ── HERO ── */}
      <section className="bg-brand relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-[28rem] h-[28rem] rounded-full bg-accent translate-x-1/3 -translate-y-1/3 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-brand-light -translate-x-1/4 translate-y-1/3 blur-2xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-16 sm:py-24 text-center">
          {/* Co-marca */}
          <div className="inline-flex items-center gap-3 bg-white/5 border border-white/15 rounded-full pl-3 pr-4 py-1.5 mb-7">
            <span className="text-white font-extrabold text-sm tracking-tight">DrivePass</span>
            <span className="text-accent font-bold text-base leading-none">×</span>
            <span className="text-white/90 font-bold text-sm tracking-tight">DTravel</span>
            <span className="ml-1 text-accent text-[10px] font-semibold uppercase tracking-wider bg-accent/15 border border-accent/30 rounded-full px-2 py-0.5">
              {c.alliance}
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">{c.title}</h1>
          <p className="text-white/60 text-lg mb-8 max-w-2xl mx-auto">{c.sub}</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/#vehiculos"
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-6 py-3 rounded-xl transition shadow-lg shadow-accent/30">
              <IconCar size={17} /> {c.ctaCar} <IconArrowR size={16} />
            </Link>
            <a href={WA_DTRAVEL} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-medium px-6 py-3 rounded-xl border border-white/20 transition text-sm">
              <IconChat size={16} /> {c.ctaTour}
            </a>
          </div>
          {/* Trust badges */}
          <div className="flex flex-wrap gap-2.5 justify-center mt-8">
            {[c.badge1, c.badge2, c.badge3].map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-xs text-white/70">
                <IconCheck size={13} className="text-success" /> {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── INTRO: dos expertos ── */}
      <section className="max-w-6xl mx-auto px-6 py-14">
        <h2 className="text-2xl font-bold text-ink text-center mb-10">{c.introTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {c.intros.map((b, i) => (
            <div key={i} className="bg-surface-2 rounded-2xl border border-border p-6 shadow-sm hover:shadow-md transition">
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center mb-3">
                {introIcon[b.icon as keyof typeof introIcon]}
              </div>
              <h3 className="font-bold text-ink mb-1.5">{b.t}</h3>
              <p className="text-ink/50 text-sm leading-relaxed">{b.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── RUTAS ── */}
      <section className="bg-brand-muted py-14">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-ink">{c.routesTitle}</h2>
            <p className="text-ink/50 mt-1 max-w-2xl mx-auto">{c.routesSub}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {c.routes.map((r, i) => (
              <div key={i} className="group bg-surface-2 rounded-2xl border border-border p-5 shadow-sm hover:border-accent/40 transition">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center">
                    <IconPin size={18} className="text-accent" />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-accent bg-accent-light rounded-full px-2.5 py-1">{r.tag}</span>
                </div>
                <h3 className="font-bold text-ink mb-1">{r.t}</h3>
                <p className="text-ink/50 text-sm leading-relaxed mb-3">{r.d}</p>
                <div className="flex items-center gap-1.5 text-xs text-ink-soft font-medium">
                  <IconRoute size={13} className="text-ink-muted" /> {r.km}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BENEFICIOS DEL CARRO ── */}
      <section className="max-w-6xl mx-auto px-6 py-14">
        <h2 className="text-2xl font-bold text-ink text-center mb-10">{c.whyTitle}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {c.whys.map((b, i) => (
            <div key={i} className="bg-surface-2 rounded-2xl border border-border p-5 shadow-sm text-center">
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center mb-3 mx-auto">
                {whyIcon[b.icon as keyof typeof whyIcon]}
              </div>
              <h3 className="font-bold text-ink mb-1 text-sm">{b.t}</h3>
              <p className="text-ink/50 text-xs leading-relaxed">{b.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CÓMO FUNCIONA ── */}
      <section className="bg-surface py-14 border-y border-border">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-ink text-center mb-10">{c.howTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {c.steps.map((s, i) => (
              <div key={i} className="bg-surface-2 rounded-2xl p-6 shadow-sm border border-border text-center">
                <div className="text-4xl font-black text-accent/20 mb-3">{s.n}</div>
                <h3 className="font-bold text-ink mb-2">{s.t}</h3>
                <p className="text-ink/50 text-sm leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── QUOTE ── */}
      <section className="max-w-3xl mx-auto px-6 py-14 text-center">
        <IconStar size={28} className="text-accent mx-auto mb-4" />
        <p className="text-xl sm:text-2xl font-semibold text-ink leading-relaxed">{c.quote}</p>
        <p className="text-ink-muted text-sm mt-4">DrivePass × DTravel</p>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="bg-accent mx-6 mb-10 rounded-3xl overflow-hidden">
        <div className="max-w-3xl mx-auto px-8 py-12 text-center">
          <h3 className="text-2xl font-bold text-white mb-2">{c.ctaTitle}</h3>
          <p className="text-white/80 mb-7 max-w-xl mx-auto">{c.ctaSub}</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/#vehiculos"
              className="inline-flex items-center gap-2 bg-surface-2 text-accent font-bold px-7 py-3.5 rounded-xl transition hover:bg-white/90 shadow-lg">
              <IconCar size={17} /> {c.ctaCar} <IconArrowR size={16} />
            </Link>
            <a href={WA_DTRAVEL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white font-semibold px-7 py-3.5 rounded-xl border border-white/30 transition">
              <IconChat size={16} /> {c.ctaTour}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
