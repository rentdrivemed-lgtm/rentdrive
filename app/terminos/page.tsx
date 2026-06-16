'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/contexts/LanguageContext';
import { IconArrowL, IconShield } from '@/components/Icons';

const content = {
  es: {
    title: 'Términos y Condiciones',
    updated: 'Última actualización: mayo 2024',
    intro: 'Al utilizar la plataforma DrivePass, aceptas los presentes términos y condiciones en su totalidad. Si no estás de acuerdo con alguno de ellos, por favor abstente de usar el servicio.',
    sections: [
      {
        title: '1. Descripción del servicio',
        body: 'DrivePass es una plataforma de intermediación que conecta propietarios de vehículos particulares con personas que desean alquilarlos en Medellín y el área metropolitana. DrivePass no es arrendador ni propietario de ningún vehículo listado en la plataforma.',
      },
      {
        title: '2. Requisitos del usuario alquilador',
        body: 'Para alquilar un vehículo debes: (a) ser mayor de 18 años; (b) poseer licencia de conducción vigente; (c) presentar documento de identidad válido; (d) tener una tarjeta de crédito o débito Visa o Mastercard a tu nombre. DrivePass se reserva el derecho de rechazar solicitudes que no cumplan estos requisitos.',
      },
      {
        title: '3. Requisitos del propietario',
        body: 'Para publicar un vehículo en DrivePass este debe: (a) ser modelo 2018 o más reciente; (b) contar con seguro todo riesgo vigente; (c) tener los documentos al día (SOAT, revisión técnico-mecánica); (d) contar con GPS activo. DrivePass asignará el precio de alquiler basado en el tipo de vehículo, año, condición y demanda.',
      },
      {
        title: '4. Seguro y responsabilidad',
        body: 'Todos los vehículos listados deben contar con póliza de seguro todo riesgo. El alquilador es responsable de cualquier daño que ocurra durante el período de alquiler no cubierto por la póliza. DrivePass no asume responsabilidad por accidentes, robos, daños a terceros o cualquier otro incidente durante el alquiler. Se recomienda al alquilador revisar minuciosamente el vehículo antes de tomarlo.',
      },
      {
        title: '5. Política de cancelación',
        body: 'Cancelaciones con más de 48 horas de anticipación: reembolso del 100%. Cancelaciones entre 24 y 48 horas: reembolso del 50%. Cancelaciones con menos de 24 horas o no presentaciones: sin reembolso. DrivePass se reserva el derecho de cancelar reservas por incumplimiento de los requisitos.',
      },
      {
        title: '6. Métodos de pago',
        body: 'DrivePass acepta pagos con tarjetas de crédito y débito Visa y Mastercard. Todos los pagos son procesados mediante pasarelas de pago seguras y encriptadas bajo estándares PCI-DSS. DrivePass no almacena datos de tarjetas en sus servidores.',
      },
      {
        title: '7. Servicio de traslado al aeropuerto',
        body: 'El servicio de recogida y traslado al Aeropuerto Internacional José María Córdova (Rionegro) y al Aeropuerto Olaya Herrera tiene un costo adicional que se informará al momento de la reserva. Este servicio está sujeto a disponibilidad.',
      },
      {
        title: '8. GPS y monitoreo',
        body: 'Todos los vehículos de la plataforma cuentan con sistema GPS activo. DrivePass utiliza esta información exclusivamente para garantizar la seguridad del vehículo, el cumplimiento de los términos de alquiler y la resolución de disputas. El monitoreo no incluye grabación de conversaciones.',
      },
      {
        title: '9. Privacidad y datos',
        body: 'DrivePass recopila la información mínima necesaria para prestar el servicio (nombre, correo, documento de identidad). Los datos no son vendidos a terceros. Los datos pueden ser compartidos con autoridades competentes ante requerimiento legal. Consulta nuestra Política de Privacidad para mayor detalle.',
      },
      {
        title: '10. Modificaciones',
        body: 'DrivePass se reserva el derecho de modificar estos términos en cualquier momento. Las modificaciones serán notificadas por correo electrónico con al menos 10 días de anticipación. El uso continuado del servicio implica la aceptación de los nuevos términos.',
      },
      {
        title: '11. Contacto',
        body: 'Para dudas o reclamaciones relacionadas con estos términos, escríbenos a: soporte@drivepass.co · Medellín, Colombia.',
      },
    ],
  },
  en: {
    title: 'Terms and Conditions',
    updated: 'Last updated: May 2024',
    intro: 'By using the DrivePass platform you fully accept these terms and conditions. If you disagree with any of them, please refrain from using the service.',
    sections: [
      {
        title: '1. Service description',
        body: 'DrivePass is an intermediation platform that connects private vehicle owners with people who want to rent them in Medellín and the metropolitan area. DrivePass is not the lessor or owner of any vehicle listed on the platform.',
      },
      {
        title: '2. Renter requirements',
        body: 'To rent a vehicle you must: (a) be 18 years of age or older; (b) hold a valid driver\'s license; (c) present a valid identity document; (d) have a Visa or Mastercard credit or debit card in your name. DrivePass reserves the right to reject requests that do not meet these requirements.',
      },
      {
        title: '3. Owner requirements',
        body: 'To list a vehicle on DrivePass it must: (a) be a 2018 model or newer; (b) have active comprehensive insurance; (c) have up-to-date documents (SOAT, technical-mechanical inspection); (d) have an active GPS. DrivePass will assign the rental price based on vehicle type, year, condition and demand.',
      },
      {
        title: '4. Insurance and liability',
        body: 'All listed vehicles must have a comprehensive insurance policy. The renter is responsible for any damage occurring during the rental period not covered by the policy. DrivePass assumes no responsibility for accidents, theft, third-party damage or any other incident during the rental.',
      },
      {
        title: '5. Cancellation policy',
        body: 'Cancellations more than 48 hours in advance: 100% refund. Cancellations between 24 and 48 hours: 50% refund. Cancellations less than 24 hours or no-shows: no refund. DrivePass reserves the right to cancel bookings for non-compliance with requirements.',
      },
      {
        title: '6. Payment methods',
        body: 'DrivePass accepts payments by Visa and Mastercard credit and debit cards. All payments are processed through secure, encrypted payment gateways under PCI-DSS standards. DrivePass does not store card data on its servers.',
      },
      {
        title: '7. Airport transfer service',
        body: 'The pickup and transfer service to José María Córdova International Airport (Rionegro) and Olaya Herrera Airport has an additional cost that will be informed at the time of booking. This service is subject to availability.',
      },
      {
        title: '8. GPS and monitoring',
        body: 'All vehicles on the platform have an active GPS system. DrivePass uses this information solely to ensure vehicle safety, compliance with rental terms and dispute resolution. Monitoring does not include recording of conversations.',
      },
      {
        title: '9. Privacy and data',
        body: 'DrivePass collects the minimum information necessary to provide the service (name, email, identity document). Data is not sold to third parties. Data may be shared with competent authorities upon legal request.',
      },
      {
        title: '10. Modifications',
        body: 'DrivePass reserves the right to modify these terms at any time. Changes will be notified by email at least 10 days in advance. Continued use of the service implies acceptance of the new terms.',
      },
      {
        title: '11. Contact',
        body: 'For questions or claims related to these terms, write to us at: soporte@drivepass.co · Medellín, Colombia.',
      },
    ],
  },
};

export default function TerminosPage() {
  const { lang, t } = useLang();
  const c = content[lang];
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/" className="inline-flex items-center gap-1.5 text-accent hover:text-accent-hover text-sm mb-6 font-medium transition">
        <IconArrowL size={14} /> {t.nav.home}
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center">
          <IconShield size={20} className="text-ink" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">{c.title}</h1>
          <p className="text-ink/40 text-xs">{c.updated}</p>
        </div>
      </div>

      <p className="text-ink/60 text-sm mb-8 leading-relaxed border-l-2 border-accent pl-4 mt-4">{c.intro}</p>

      <div className="space-y-3">
        {c.sections.map((s, i) => (
          <div key={i} className="bg-surface-2 rounded-2xl border border-border overflow-hidden shadow-sm">
            <button
              className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-surface transition"
              onClick={() => setActive(active === i ? null : i)}
            >
              <span className="font-semibold text-ink text-sm">{s.title}</span>
              <svg className={`w-4 h-4 text-ink/40 transition-transform flex-shrink-0 ${active === i ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
            {active === i && (
              <div className="px-5 pb-5 pt-1">
                <p className="text-ink/60 text-sm leading-relaxed">{s.body}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 bg-brand rounded-2xl p-6 text-center">
        <p className="text-white/70 text-sm">¿Tienes preguntas? Escríbenos a</p>
        <p className="text-accent font-bold mt-1">soporte@drivepass.co</p>
      </div>
    </div>
  );
}
