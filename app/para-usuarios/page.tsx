'use client';
import Link from 'next/link';
import { useLang } from '@/contexts/LanguageContext';
import { IconCar, IconShield, IconRoute, IconKey, IconCalendar, IconCheck, IconArrowR, IconPlane, IconCreditCard, IconUsers } from '@/components/Icons';
import { BloqueSura } from '@/components/SelloSura';

const T = {
  es: {
    badge: 'Para alquiladores',
    title: 'Alquila con confianza en Medellín',
    sub: 'Vehículos verificados, póliza de Seguros SURA, GPS satelital y atención personalizada. Todo en un solo lugar.',
    ctaSearch: 'Buscar vehículos ahora',
    ctaOwner: '¿Eres propietario?',
    benTitle: '¿Qué incluye cada alquiler?',
    bens: [
      { icon: 'car',    t: 'Flota 2018 en adelante',   d: 'Solo manejamos vehículos modelo 2018 o más recientes, en perfectas condiciones mecánicas y estéticas.' },
      { icon: 'shield', t: 'Póliza de Seguros SURA',    d: 'El vehículo se entrega amparado por una póliza que DrivePass contrata con Seguros Generales Suramericana S.A.' },
      { icon: 'gps',    t: 'GPS y monitoreo satelital', d: 'Sistema de rastreo en tiempo real en todos los vehículos de la flota.' },
      { icon: 'plane',  t: 'Servicio aeropuerto',       d: 'Recogida en tu ubicación y traslado al Aeropuerto J.M. Córdova u Olaya Herrera con costo adicional.' },
      { icon: 'pay',    t: 'Pago seguro: Visa y MC',    d: 'Aceptamos Visa y Mastercard. Todos los pagos son procesados de forma encriptada.' },
      { icon: 'p2p',    t: 'Trato directo',             d: 'Nos comunicamos directamente contigo. Sin burocracia, sin filas, sin sorpresas.' },
    ],
    howTitle: '¿Cómo alquilar?',
    howSub: 'En 3 simples pasos tienes tu vehículo',
    steps: [
      { n: '01', t: 'Busca y filtra',      d: 'Ingresa tus fechas, selecciona el sector de Medellín y el tipo de vehículo que necesitas. Filtra por precio máximo por día.' },
      { n: '02', t: 'Reserva al instante', d: 'Confirma tu reserva de forma segura. Paga con Visa o Mastercard. Recibirás confirmación inmediata por correo.' },
      { n: '03', t: 'Recoge y disfruta',   d: 'Recoge el vehículo en la ubicación acordada. GPS y póliza de Seguros SURA vigentes desde el primer kilómetro.' },
    ],
    reqTitle: 'Requisitos para alquilar',
    reqs: [
      'Ser mayor de 18 años',
      'Licencia de conducción vigente',
      'Documento de identidad válido',
      'Tarjeta Visa o Mastercard a tu nombre',
      'Sin multas de tránsito pendientes',
    ],
    airportTitle: 'Servicio de traslado al aeropuerto',
    airportDesc: 'Ofrecemos recogida en tu ubicación y traslado al Aeropuerto Internacional José María Córdova (Rionegro) y al Aeropuerto Olaya Herrera. Servicio disponible con costo adicional. Solicítalo al momento de reservar tu vehículo.',
    airports: ['✈ Aeropuerto José María Córdova — Rionegro', '✈ Aeropuerto Olaya Herrera — Medellín'],
    payTitle: 'Métodos de pago aceptados',
    paySub: 'Pagos 100% seguros y encriptados bajo estándares internacionales',
    faqTitle: 'Preguntas frecuentes',
    faqs: [
      { q: '¿Cuánto tiempo de anticipación debo reservar?', a: 'Puedes reservar con cualquier antelación, incluso el mismo día si hay disponibilidad.' },
      { q: '¿Qué pasa si necesito extender el alquiler?', a: 'Contacta al propietario o a nuestro equipo de soporte. Las extensiones están sujetas a disponibilidad.' },
      { q: '¿Puedo cancelar mi reserva?', a: 'Sí. Con más de 48 horas de anticipación recibes reembolso total. Entre 24-48 horas, reembolso parcial del 50%. Menos de 24 horas, sin reembolso.' },
      { q: '¿Están cubiertos los daños durante el alquiler?', a: 'El vehículo va amparado por una póliza de Seguros SURA y tú quedas incorporado al amparo de responsabilidad civil extracontractual. No es cobertura total: el deducible, la franquicia y el faltante frente al valor real del daño corren por tu cuenta, igual que en cualquier alquiler. Revisa el estado del vehículo al recibirlo, documenta cualquier daño previo y pide la carátula de la póliza antes de firmar.' },
      { q: '¿Puedo llevar el vehículo fuera de Medellín?', a: 'Depende del propietario. Consulta con él directamente antes de hacer la reserva.' },
    ],
    ctaTitle: '¿Listo para reservar?',
    ctaSub: 'Encuentra tu vehículo ideal ahora mismo',
    ctaBtn: 'Ver vehículos disponibles',
  },
  en: {
    badge: 'For renters',
    title: 'Rent with confidence in Medellín',
    sub: 'Verified vehicles, a Seguros SURA policy, satellite GPS and personalized service. All in one place.',
    ctaSearch: 'Search vehicles now',
    ctaOwner: 'Are you an owner?',
    benTitle: 'What is included in every rental?',
    bens: [
      { icon: 'car',    t: '2018+ Fleet',                  d: 'We only handle 2018 or newer model vehicles in perfect mechanical and aesthetic condition.' },
      { icon: 'shield', t: 'Seguros SURA policy',            d: 'The vehicle is handed over covered by a policy DrivePass takes out with Seguros Generales Suramericana S.A.' },
      { icon: 'gps',    t: 'GPS & satellite monitoring',    d: 'Real-time tracking system on all fleet vehicles.' },
      { icon: 'plane',  t: 'Airport service',               d: 'Pickup at your location and transfer to J.M. Córdova or Olaya Herrera Airport at additional cost.' },
      { icon: 'pay',    t: 'Secure payment: Visa & MC',     d: 'We accept Visa and Mastercard. All payments are processed with encryption.' },
      { icon: 'p2p',    t: 'Direct contact',                d: 'We communicate directly with you. No bureaucracy, no queues, no surprises.' },
    ],
    howTitle: 'How to rent?',
    howSub: '3 simple steps to get your vehicle',
    steps: [
      { n: '01', t: 'Search & filter',    d: 'Enter your dates, select the Medellín area and the type of vehicle you need. Filter by maximum daily price.' },
      { n: '02', t: 'Book instantly',     d: 'Confirm your booking securely. Pay with Visa or Mastercard. You will receive immediate confirmation by email.' },
      { n: '03', t: 'Pick up & enjoy',    d: 'Pick up the vehicle at the agreed location. GPS and the Seguros SURA policy are in force from the first kilometer.' },
    ],
    reqTitle: 'Requirements to rent',
    reqs: [
      'Be 18 years of age or older',
      'Valid driver\'s license',
      'Valid identity document',
      'Visa or Mastercard card in your name',
      'No pending traffic fines',
    ],
    airportTitle: 'Airport transfer service',
    airportDesc: 'We offer pickup at your location and transfer to José María Córdova International Airport (Rionegro) and Olaya Herrera Airport. Service available at additional cost. Request it when booking your vehicle.',
    airports: ['✈ José María Córdova Airport — Rionegro', '✈ Olaya Herrera Airport — Medellín'],
    payTitle: 'Accepted payment methods',
    paySub: '100% secure and encrypted payments under international standards',
    faqTitle: 'Frequently asked questions',
    faqs: [
      { q: 'How far in advance do I need to book?', a: 'You can book at any time, even the same day if available.' },
      { q: 'What if I need to extend the rental?', a: 'Contact the owner or our support team. Extensions are subject to availability.' },
      { q: 'Can I cancel my booking?', a: 'Yes. More than 48 hours in advance gets a full refund. Between 24-48 hours, 50% partial refund. Less than 24 hours, no refund.' },
      { q: 'Are damages during rental covered?', a: 'The vehicle is covered by a Seguros SURA policy and you are named under its third-party liability cover. It is not total coverage: the deductible, the franchise and the gap against the real value of the damage are on you, as in any rental. Check the vehicle condition when you receive it, document any prior damage and ask for the policy schedule before signing.' },
      { q: 'Can I take the vehicle outside Medellín?', a: 'It depends on the owner. Check with them directly before making the booking.' },
    ],
    ctaTitle: 'Ready to book?',
    ctaSub: 'Find your ideal vehicle right now',
    ctaBtn: 'View available vehicles',
  },
};

const iconMap = {
  car: <IconCar size={22} className="text-accent"/>,
  shield: <IconShield size={22} className="text-accent"/>,
  gps: <IconRoute size={22} className="text-accent"/>,
  plane: <IconPlane size={22} className="text-accent"/>,
  pay: <IconCreditCard size={22} className="text-accent"/>,
  p2p: <IconKey size={22} className="text-accent"/>,
};

export default function ParaUsuariosPage() {
  const { lang } = useLang();
  const c = T[lang];

  return (
    <div>
      {/* HERO */}
      <section className="bg-brand relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-accent translate-x-1/3 -translate-y-1/3"/>
          <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-surface-2 -translate-x-1/4 translate-y-1/3"/>
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-16 sm:py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-full px-4 py-1.5 mb-6">
            <IconUsers size={14} className="text-accent"/>
            <span className="text-accent text-xs font-semibold tracking-wide">{c.badge}</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">{c.title}</h1>
          <p className="text-white/60 text-lg mb-8 max-w-2xl mx-auto">{c.sub}</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/#vehiculos"
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-6 py-3 rounded-xl transition shadow-lg shadow-accent/30">
              {c.ctaSearch} <IconArrowR size={16}/>
            </Link>
            <Link href="/propietarios-info"
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-medium px-6 py-3 rounded-xl border border-white/20 transition text-sm">
              {c.ctaOwner}
            </Link>
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="max-w-6xl mx-auto px-6 py-14">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-ink">{c.benTitle}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {c.bens.map((b, i) => (
            <div key={i} className="bg-surface-2 rounded-2xl border border-border p-5 shadow-sm hover:shadow-md transition">
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center mb-3">
                {iconMap[b.icon as keyof typeof iconMap]}
              </div>
              <h3 className="font-bold text-ink mb-1 text-sm">{b.t}</h3>
              <p className="text-ink/50 text-xs leading-relaxed">{b.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* RESPALDO ASEGURADOR — destino del enlace «Ver qué cubre» de la portada (#seguro) */}
      <BloqueSura perfil="usuario" />

      {/* HOW IT WORKS */}
      <section className="bg-brand-muted py-14">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-ink">{c.howTitle}</h2>
            <p className="text-ink/50 mt-1">{c.howSub}</p>
          </div>
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

      {/* REQUIREMENTS + AIRPORT (side by side) */}
      <section className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-2 gap-8">
        {/* Requirements */}
        <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-xl bg-brand-muted flex items-center justify-center">
              <IconCalendar size={18} className="text-ink"/>
            </div>
            <h2 className="font-bold text-ink">{c.reqTitle}</h2>
          </div>
          <ul className="space-y-2.5">
            {c.reqs.map((r, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm text-ink/70">
                <IconCheck size={15} className="text-success flex-shrink-0"/> {r}
              </li>
            ))}
          </ul>
        </div>

        {/* Airport */}
        <div className="bg-brand rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <IconPlane size={18} className="text-accent"/>
            </div>
            <h2 className="font-bold">{c.airportTitle}</h2>
          </div>
          <p className="text-white/60 text-sm leading-relaxed mb-4">{c.airportDesc}</p>
          <div className="space-y-2">
            {c.airports.map((a, i) => (
              <div key={i} className="bg-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white/80">{a}</div>
            ))}
          </div>
        </div>
      </section>

      {/* PAYMENTS */}
      <section className="bg-surface py-10 border-y border-border">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="font-bold text-ink mb-1">{c.payTitle}</h2>
          <p className="text-ink/50 text-sm mb-6">{c.paySub}</p>
          <div className="flex justify-center gap-4">
            <div className="bg-surface-2 border border-border rounded-2xl px-8 py-4 shadow-sm flex items-center justify-center">
              <svg viewBox="0 0 80 28" width="80" height="28">
                <rect width="80" height="28" rx="4" fill="#1A1F71"/>
                <text x="40" y="20" textAnchor="middle" fill="white" fontSize="16" fontStyle="italic" fontWeight="800" fontFamily="serif">VISA</text>
              </svg>
            </div>
            <div className="bg-surface-2 border border-border rounded-2xl px-8 py-4 shadow-sm flex items-center justify-center gap-2">
              <svg viewBox="0 0 54 34" width="54" height="34">
                <circle cx="19" cy="17" r="14" fill="#EB001B"/>
                <circle cx="35" cy="17" r="14" fill="#F79E1B"/>
                <path d="M27 5.5A14 14 0 0 1 35 17 14 14 0 0 1 27 28.5A14 14 0 0 1 19 17 14 14 0 0 1 27 5.5z" fill="#FF5F00"/>
              </svg>
              <span className="text-xs font-bold text-ink/70">mastercard</span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-14">
        <h2 className="text-2xl font-bold text-ink mb-8 text-center">{c.faqTitle}</h2>
        <div className="space-y-3">
          {c.faqs.map((f, i) => (
            <details key={i} className="bg-surface-2 rounded-2xl border border-border shadow-sm group">
              <summary className="px-5 py-4 font-semibold text-ink text-sm cursor-pointer list-none flex items-center justify-between gap-4">
                {f.q}
                <svg className="w-4 h-4 text-ink/40 group-open:rotate-180 transition-transform flex-shrink-0"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
              </summary>
              <div className="px-5 pb-4"><p className="text-ink/60 text-sm leading-relaxed">{f.a}</p></div>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-accent mx-6 mb-10 rounded-3xl overflow-hidden">
        <div className="max-w-3xl mx-auto px-8 py-12 text-center">
          <h3 className="text-2xl font-bold text-white mb-2">{c.ctaTitle}</h3>
          <p className="text-white/70 mb-6">{c.ctaSub}</p>
          <Link href="/#vehiculos"
            className="inline-flex items-center gap-2 bg-surface-2 text-accent font-bold px-8 py-3.5 rounded-xl transition hover:bg-white/90 shadow-lg">
            {c.ctaBtn} <IconArrowR size={16}/>
          </Link>
        </div>
      </section>
    </div>
  );
}
