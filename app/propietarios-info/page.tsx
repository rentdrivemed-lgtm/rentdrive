'use client';
import React from 'react';
import Link from 'next/link';
import { useLang } from '@/contexts/LanguageContext';
import { IconCar, IconShield, IconRoute, IconKey, IconCalendar, IconCheck, IconArrowR, IconCoin, IconPhoto, IconUsers } from '@/components/Icons';

const T = {
  es: {
    badge: 'Para propietarios',
    title: 'Tu carro trabaja, tú decides',
    sub: 'Genera ingresos adicionales publicando tu vehículo en DrivePass. Nosotros gestionamos los alquileres, tú defines cuándo está disponible.',
    ctaRegister: 'Registrarme como propietario',
    ctaRent: 'Prefiero alquilar',
    earningsTitle: '¿Cuánto puedes ganar?',
    earningsDesc: 'Simula tu caso con una calculadora que usa los mismos costos que manejamos internamente: SOAT, impuesto vehicular, seguro, mantenimiento, GPS y depreciación.',
    calcBtn: 'Calculadora de ganancias según tu vehículo',
    stats: [
      { v: '2018+', l: 'Año mínimo del vehículo' },
      { v: '7 fotos', l: 'Requeridas para publicar' },
      { v: '100%', l: 'GPS y seguro todo riesgo' },
      { v: '<10 min', l: 'Tiempo de registro' },
    ],
    howTitle: '¿Cómo funciona?',
    howSub: 'Publicar tu vehículo es sencillo y rápido',
    steps: [
      { n: '01', t: 'Regístrate', d: 'Crea tu cuenta como propietario. Solo necesitas tu correo y datos básicos.' },
      { n: '02', t: 'Publica tu vehículo', d: 'Sube las 7 fotos requeridas (laterales, frente, trasera, cojinería, baúl y tablero) y llena los datos del vehículo.' },
      { n: '03', t: 'Marca tu disponibilidad', d: 'Usa el calendario para indicar los días en que tu vehículo estará disponible para alquilar.' },
      { n: '04', t: 'DrivePass asigna el precio', d: 'Nuestro equipo revisará tu vehículo y asignará un precio competitivo. Recibirás notificación cuando esté activo.' },
    ],
    reqTitle: 'Requisitos del vehículo',
    reqs: [
      'Modelo 2018 o más reciente',
      'Seguro todo riesgo vigente',
      'SOAT y revisión técnico-mecánica al día',
      'GPS activo o disponibilidad para instalarlo',
      'Buen estado mecánico y estético',
      'Tarjeta de propiedad a tu nombre',
    ],
    benefitsTitle: '¿Qué hace DrivePass por ti?',
    benefits: [
      { icon: 'users', t: 'Verificamos a los alquiladores', d: 'Solo usuarios verificados con licencia e identidad validada pueden reservar tu vehículo.' },
      { icon: 'pay',   t: 'Gestionamos los pagos',         d: 'Recibimos los pagos con Visa y Mastercard y te transferimos tu parte de forma segura.' },
      { icon: 'shield',t: 'Monitoreamos con GPS',           d: 'El sistema GPS activo nos permite hacer seguimiento del vehículo en todo momento.' },
      { icon: 'price', t: 'Fijamos el precio óptimo',      d: 'Nuestro equipo define precios competitivos para maximizar tus ingresos.' },
    ],
    photosTitle: 'Las 7 fotos requeridas',
    photos: ['Lado izquierdo', 'Lado derecho', 'Frente', 'Parte trasera', 'Cojinería', 'Baúl', 'Tablero'],
    ctaTitle: '¿Listo para empezar?',
    ctaSub: 'Registra tu vehículo hoy y empieza a generar ingresos',
    ctaBtn: 'Publicar mi vehículo',
  },
  en: {
    badge: 'For owners',
    title: 'Your car works, you decide',
    sub: 'Generate additional income by listing your vehicle on DrivePass. We manage the rentals, you decide when it\'s available.',
    ctaRegister: 'Register as an owner',
    ctaRent: 'I prefer to rent',
    earningsTitle: 'How much can you earn?',
    earningsDesc: 'Simulate your own case with a calculator that uses the same costs we track internally: SOAT, vehicle tax, insurance, maintenance, GPS and depreciation.',
    calcBtn: 'Profit calculator for your vehicle',
    stats: [
      { v: '2018+', l: 'Minimum vehicle year' },
      { v: '7 photos', l: 'Required to publish' },
      { v: '100%', l: 'GPS and comprehensive insurance' },
      { v: '<10 min', l: 'Registration time' },
    ],
    howTitle: 'How does it work?',
    howSub: 'Listing your vehicle is simple and fast',
    steps: [
      { n: '01', t: 'Sign up', d: 'Create your owner account. You only need your email and basic information.' },
      { n: '02', t: 'List your vehicle', d: 'Upload the 7 required photos (sides, front, rear, upholstery, trunk and dashboard) and fill in the vehicle details.' },
      { n: '03', t: 'Set your availability', d: 'Use the calendar to indicate the days your vehicle will be available to rent.' },
      { n: '04', t: 'DrivePass sets the price', d: 'Our team will review your vehicle and assign a competitive price. You\'ll be notified when it\'s active.' },
    ],
    reqTitle: 'Vehicle requirements',
    reqs: [
      '2018 model or newer',
      'Active comprehensive insurance',
      'Up-to-date SOAT and technical-mechanical inspection',
      'Active GPS or availability to install one',
      'Good mechanical and aesthetic condition',
      'Vehicle registration in your name',
    ],
    benefitsTitle: 'What does DrivePass do for you?',
    benefits: [
      { icon: 'users',  t: 'We verify renters',        d: 'Only verified users with validated license and identity can book your vehicle.' },
      { icon: 'pay',    t: 'We manage payments',        d: 'We receive payments with Visa and Mastercard and transfer your share safely.' },
      { icon: 'shield', t: 'GPS monitoring',            d: 'The active GPS system allows us to track the vehicle at all times.' },
      { icon: 'price',  t: 'We set the optimal price',  d: 'Our team defines competitive prices to maximize your income.' },
    ],
    photosTitle: 'The 7 required photos',
    photos: ['Left side', 'Right side', 'Front', 'Rear', 'Upholstery', 'Trunk', 'Dashboard'],
    ctaTitle: 'Ready to start?',
    ctaSub: 'Register your vehicle today and start earning income',
    ctaBtn: 'List my vehicle',
  },
};

const benIcon: Record<string, React.ReactElement> = {
  users:  <IconUsers size={20} className="text-accent"/>,
  pay:    <IconCoin size={20} className="text-accent"/>,
  shield: <IconShield size={20} className="text-accent"/>,
  price:  <IconKey size={20} className="text-accent"/>,
};

export default function PropietariosInfoPage() {
  const { lang } = useLang();
  const c = T[lang];

  return (
    <div>
      {/* HERO */}
      <section className="bg-brand relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-accent translate-x-1/3 -translate-y-1/3"/>
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-16 sm:py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-full px-4 py-1.5 mb-6">
            <IconCar size={14} className="text-accent"/>
            <span className="text-accent text-xs font-semibold tracking-wide">{c.badge}</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">{c.title}</h1>
          <p className="text-white/60 text-lg mb-8 max-w-2xl mx-auto">{c.sub}</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/registro?rol=propietario"
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-6 py-3 rounded-xl transition shadow-lg shadow-accent/30">
              {c.ctaRegister} <IconArrowR size={16}/>
            </Link>
            <Link href="/para-usuarios"
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-medium px-6 py-3 rounded-xl border border-white/20 transition text-sm">
              {c.ctaRent}
            </Link>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="max-w-4xl mx-auto px-6 -mt-6 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {c.stats.map((s, i) => (
            <div key={i} className="bg-surface-2 rounded-2xl border border-border shadow-sm p-4 text-center">
              <p className="text-2xl font-black text-accent">{s.v}</p>
              <p className="text-xs text-ink/50 mt-0.5 leading-tight">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CALCULADORA DE RENTABILIDAD — banner llamativo */}
      <section className="max-w-4xl mx-auto px-6 pt-14">
        <div className="relative overflow-hidden rounded-3xl p-6 sm:p-10 text-center"
          style={{ background: 'var(--gradient-accent)' }}>
          <div className="absolute -top-10 -right-10 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-14 -left-10 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
              <IconCoin size={30} className="text-white" />
            </div>
            <h2 className="font-black text-white text-2xl sm:text-3xl leading-tight mb-2">{c.earningsTitle}</h2>
            <p className="text-white/85 text-sm sm:text-base max-w-xl mx-auto mb-6">{c.earningsDesc}</p>
            <Link href="/calculadora-propietarios"
              className="glow-accent inline-flex items-center gap-2.5 bg-white text-accent font-black text-base sm:text-lg px-8 py-4 rounded-2xl transition hover:-translate-y-0.5 hover:shadow-2xl">
              <IconCoin size={20} /> {c.calcBtn} <IconArrowR size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-ink">{c.howTitle}</h2>
          <p className="text-ink/50 mt-1">{c.howSub}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {c.steps.map((s, i) => (
            <div key={i} className="relative bg-surface-2 rounded-2xl border border-border p-5 shadow-sm">
              <div className="text-5xl font-black text-accent/15 leading-none mb-3">{s.n}</div>
              <h3 className="font-bold text-ink mb-1.5 text-sm">{s.t}</h3>
              <p className="text-ink/50 text-xs leading-relaxed">{s.d}</p>
              {i < c.steps.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -right-3 w-6 h-px bg-border z-10"/>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* REQUIREMENTS + BENEFITS */}
      <section className="bg-brand-muted py-14">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-8">
          {/* Requirements */}
          <div className="bg-surface-2 rounded-2xl p-6 border border-border shadow-sm">
            <h2 className="font-bold text-ink mb-4 flex items-center gap-2">
              <IconCar size={16} className="text-accent"/> {c.reqTitle}
            </h2>
            <ul className="space-y-2.5">
              {c.reqs.map((r, i) => (
                <li key={i} className="flex items-center gap-2.5 text-sm text-ink/70">
                  <IconCheck size={15} className="text-success flex-shrink-0"/> {r}
                </li>
              ))}
            </ul>
          </div>

          {/* Benefits */}
          <div>
            <h2 className="font-bold text-ink mb-4">{c.benefitsTitle}</h2>
            <div className="space-y-3">
              {c.benefits.map((b, i) => (
                <div key={i} className="bg-surface-2 rounded-xl border border-border p-4 shadow-sm flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-accent-light flex items-center justify-center flex-shrink-0">
                    {benIcon[b.icon]}
                  </div>
                  <div>
                    <p className="font-semibold text-ink text-sm">{b.t}</p>
                    <p className="text-ink/50 text-xs mt-0.5 leading-relaxed">{b.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 7 PHOTOS */}
      <section className="max-w-4xl mx-auto px-6 py-14">
        <div className="text-center mb-8">
          <h2 className="text-xl font-bold text-ink flex items-center justify-center gap-2">
            <IconPhoto size={18} className="text-accent"/> {c.photosTitle}
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {c.photos.map((p, i) => (
            <div key={i} className="bg-surface-2 rounded-xl border-2 border-dashed border-border p-3 text-center">
              <div className="w-8 h-8 rounded-lg bg-brand-muted flex items-center justify-center mx-auto mb-2">
                <span className="text-accent font-bold text-xs">{i + 1}</span>
              </div>
              <p className="text-[10px] text-ink/60 font-medium leading-tight">{p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand mx-6 mb-10 rounded-3xl overflow-hidden">
        <div className="max-w-3xl mx-auto px-8 py-12 text-center">
          <h3 className="text-2xl font-bold text-white mb-2">{c.ctaTitle}</h3>
          <p className="text-white/60 mb-6">{c.ctaSub}</p>
          <Link href="/registro?rol=propietario"
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-8 py-3.5 rounded-xl transition shadow-lg shadow-accent/30">
            <IconKey size={18}/> {c.ctaBtn}
          </Link>
        </div>
      </section>
    </div>
  );
}
