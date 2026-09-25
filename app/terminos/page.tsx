'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/contexts/LanguageContext';
import { IconArrowL, IconShield } from '@/components/Icons';
import { CONTACTO_CORREO } from '@/lib/contacto';

const content = {
  es: {
    title: 'Términos y Condiciones',
    updated: 'Última actualización: 25 de septiembre de 2026',
    intro: 'Al utilizar la plataforma DrivePass, aceptas los presentes términos y condiciones en su totalidad. Si no estás de acuerdo con alguno de ellos, por favor abstente de usar el servicio.',
    sections: [
      {
        title: '1. Quiénes somos y qué hacemos',
        body: 'DRIVEPASS COL S.A.S., NIT 902.088.011-1, con domicilio en Medellín (Antioquia), administra y promueve el arrendamiento de vehículos de particulares. No somos dueños de los carros: los propietarios nos encargan su administración mediante un contrato de agencia comercial, y nosotros celebramos el arrendamiento con usted en nombre de ellos. También prestamos transporte de grupos de 12 a 42 pasajeros, con conductor.',
      },
      {
        title: '2. Qué necesita para alquilar',
        body: 'Ser mayor de 18 años, tener licencia de conducción vigente y de la categoría que corresponda al vehículo, y presentar su documento de identidad. Verificamos la licencia en el RUNT y en el SIMIT antes de cada entrega. Puede pagar con tarjeta, en efectivo o por transferencia: la tarjeta no es obligatoria. Podemos rechazar una solicitud que no cumpla estos requisitos.',
      },
      {
        title: '3. Quién puede conducir',
        body: 'Solo usted, salvo que registremos por escrito conductores autorizados adicionales, que deben cumplir los mismos requisitos. Que conduzca alguien no autorizado incumple el contrato y, sobre todo, puede dejar el siniestro sin cobertura de la póliza.',
      },
      {
        title: '4. Duración mínima, tarifas y descuentos',
        body: 'El alquiler mínimo por la web es de 2 noches. Si necesita un solo día, podemos autorizarlo caso por caso: escríbanos. Desde 29 días de alquiler se aplica un 15 % de descuento sobre la tarifa. Los días en que el vehículo no puede circular por pico y placa no se le cobran.',
      },
      {
        title: '5. Dónde recoge y dónde entrega',
        body: 'En nuestro punto de atención de San Joaquín (Calle 42A #68A-10) no hay costo de traslado. Llevarlo o recogerlo en otro lugar tiene un recargo que verá antes de pagar, y que se cobra por cada tramo: si pide entrega y devolución fuera del punto, se cobran las dos. Va desde $35.000 en Medellín y Envigado hasta $150.000 en el aeropuerto José María Córdova. Si no elige lugar, le proponemos el punto de atención antes de confirmar.',
      },
      {
        title: '6. Depósito de garantía',
        body: 'Al suscribir el contrato se entrega un depósito de garantía de $2.000.000. No es parte del canon, no genera intereses y no es una multa. Lo conservamos durante los ocho (8) días hábiles siguientes a la devolución del vehículo, y dentro de ese plazo podemos descontar de él comparendos, fotomultas, peajes, combustible faltante, deducibles, daños no cubiertos por la póliza, lavado, grúa o inmovilización. Vencido el plazo le devolvemos el saldo con el detalle de lo descontado. Si lo que queda a su cargo supera el depósito, deberá pagar la diferencia dentro de los cinco (5) días hábiles siguientes a que se lo solicitemos.',
      },
      {
        title: '7. Pagaré y carta de instrucciones',
        body: 'Al alquilar firma un pagaré en blanco con su carta de instrucciones. Es la garantía de lo que quede pendiente y NO se usa si devuelve el carro sin novedades ni deudas. Solo puede diligenciarse por sumas realmente causadas y no pagadas —daños, multas, peajes, combustible— y hasta tres (3) años después de terminado el contrato. Le avisaremos antes de hacerlo, con el detalle de lo que se cobra. El incumplimiento puede reportarse a centrales de riesgo.',
      },
      {
        title: '8. Sus obligaciones con el vehículo',
        body: 'Usarlo solo para uso particular. Queda prohibido destinarlo a transporte público o remunerado de personas o cosas, a plataformas de transporte, a enseñanza automovilística, a competencias, a remolcar otros vehículos y a circular fuera de vías aptas. No puede subarrendarlo, cederlo ni sacarlo del país sin autorización escrita. Debe guardarlo en parqueadero cerrado por la noche, respetar las normas de tránsito y no conducir bajo efectos del alcohol o de sustancias psicoactivas. Estos usos, además de incumplir el contrato, dejan el siniestro sin cobertura.',
      },
      {
        title: '9. Si hay un accidente, un daño o un hurto',
        body: 'Avísenos dentro de las dos (2) horas siguientes por el canal que le indiquemos. En un accidente: permanezca en el lugar hasta que llegue la autoridad, procure el croquis, no reconozca responsabilidad ni haga acuerdos con terceros, y no abandone el vehículo. Si el carro es hurtado, ponga la denuncia de inmediato y entréguenos copia dentro de las 24 horas.',
      },
      {
        title: '10. Multas, peajes y combustible',
        body: 'Los comparendos, fotomultas, peajes, parqueaderos, lavado y el combustible corren por su cuenta, y siguen siendo suyos aunque lleguen después de devolver el carro. Debe devolverlo con el mismo nivel de combustible con que lo recibió. Como arrendatario identificado, la sanción de tránsito se traslada a usted.',
      },
      {
        title: '11. Entrega y devolución del vehículo',
        body: 'En cada entrega y en cada devolución levantamos un acta con fotografías, el inventario de estado del vehículo (18 ítems), el kilometraje y el nivel de combustible. Usted puede revisarla y confirmarla desde su celular. Esas actas son el patrón de comparación para establecer qué daños son imputables a usted. Firmar el acta de devolución NO es un paz y salvo: no lo libera de daños ocultos ni de multas que se notifiquen después.',
      },
      {
        title: '12. El seguro',
        body: 'El vehículo circula amparado por una póliza expedida por la aseguradora, en la que DrivePass figura como tomador y el propietario como asegurado. Usted queda incorporado como asegurado en el amparo de responsabilidad civil extracontractual. La póliza tiene deducibles, franquicias y exclusiones: lo que ella no cubra queda a su cargo en los términos del contrato. Puede pedirnos copia de la carátula y del clausulado antes de alquilar; le recomendamos leerlos.',
      },
      {
        title: '13. Cancelaciones',
        body: 'Si cancela con 48 horas o más de anticipación a la hora de entrega, le devolvemos el 100 %. Si cancela dentro de las 48 horas previas, le devolvemos el 50 %. Si no se presenta ni avisa, pasadas tres (3) horas de la hora acordada se cobra el total. Estos plazos son los mismos que fija su contrato de arrendamiento.',
      },
      {
        title: '14. Si el vehículo falla sin culpa suya',
        body: 'No le cobramos los días que no pudo usarlo. Le ofrecemos un vehículo de reemplazo de características similares o, si prefiere, le reembolsamos la parte proporcional dentro de los cinco (5) días hábiles siguientes.',
      },
      {
        title: '15. Sus datos personales',
        body: 'Al crear la cuenta usted firma una autorización de tratamiento de datos (Ley 1581 de 2012). Recogemos datos de identificación y contacto, imágenes de su documento de identidad y su licencia, datos de pago y datos de la operación, incluidas las fotografías de entrega y devolución. Las imágenes de sus documentos son datos sensibles y por eso las autoriza por separado: sin esa autorización no podemos verificar su identidad y, por tanto, no podemos prestarle el servicio. Puede conocer, actualizar, rectificar y suprimir sus datos y revocar la autorización escribiendo a notificaciones@drivepasscol.com. Atendemos consultas en 10 días hábiles y reclamos en 15, prorrogables por 8.',
      },
      {
        title: '16. Nuestra responsabilidad',
        body: 'DrivePass responde por el cumplimiento de sus obligaciones como agente y por lo que la ley le imponga, incluido el Estatuto del Consumidor (Ley 1480 de 2011). No se excluye ni se limita nuestra responsabilidad por dolo ni por culpa grave. Lo que sí le corresponde a usted son las consecuencias del uso que dé al vehículo durante el alquiler, en los términos de su contrato.',
      },
      {
        title: '17. Reclamos, notificaciones y ley aplicable',
        body: 'Atendemos peticiones, quejas y reclamos dentro de los quince (15) días hábiles siguientes, por el correo que figura abajo. Las comunicaciones entre las partes se entienden válidas por correo electrónico a las direcciones registradas. Estos términos y los contratos se rigen por la ley colombiana, y las controversias se someten a los jueces de Medellín, sin perjuicio de acudir a la Superintendencia de Industria y Comercio.',
      },
    ],
  },
  en: {
    title: 'Terms and Conditions',
    updated: 'Last updated: 25 September 2026',
    intro: 'By using the DrivePass platform you fully accept these terms and conditions. If you disagree with any of them, please refrain from using the service.',
    sections: [
      {
        title: '1. Who we are and what we do',
        body: 'DRIVEPASS COL S.A.S., tax ID 902.088.011-1, based in Medellín (Antioquia), manages and promotes the rental of privately owned vehicles. We do not own the cars: owners entrust their management to us through a commercial agency agreement, and we enter into the rental contract with you on their behalf. We also provide group transport for 12 to 42 passengers, with a driver.',
      },
      {
        title: '2. What you need in order to rent',
        body: 'Be 18 or older, hold a valid driving licence of the category matching the vehicle, and present your ID. We check the licence against the RUNT and SIMIT registries before every handover. You may pay by card, in cash or by bank transfer: a card is not required. We may decline a request that does not meet these requirements.',
      },
      {
        title: '3. Who may drive',
        body: 'Only you, unless we register additional authorised drivers in writing, who must meet the same requirements. Letting an unauthorised person drive breaches the contract and, more importantly, may leave an accident outside the insurance cover.',
      },
      {
        title: '4. Minimum duration, rates and discounts',
        body: 'The minimum rental through the website is 2 nights. If you need a single day, we can authorise it case by case: write to us. From 29 days onward a 15% discount applies to the rate. Days on which the vehicle cannot circulate due to the "pico y placa" restriction are not charged to you.',
      },
      {
        title: '5. Pick-up and drop-off',
        body: 'There is no transfer fee at our San Joaquín service point (Calle 42A #68A-10). Any other location carries a surcharge, shown to you before payment, and charged per leg: if you request delivery and collection away from the service point, both are charged. It ranges from COP 35,000 in Medellín and Envigado to COP 150,000 at José María Córdova airport. If you choose no location, we propose the service point before confirming.',
      },
      {
        title: '6. Security deposit',
        body: 'On signing the contract a security deposit of COP 2,000,000 is provided. It is not part of the rental price, earns no interest and is not a penalty. We hold it for eight (8) business days after the vehicle is returned, and within that period we may deduct traffic tickets, camera fines, tolls, missing fuel, deductibles, damage not covered by the policy, cleaning, towing or impoundment. Once the period ends we return the balance with a breakdown of what was deducted. If the amounts owed exceed the deposit, you must pay the difference within five (5) business days of our request.',
      },
      {
        title: '7. Promissory note and instruction letter',
        body: 'When you rent, you sign a blank promissory note with its instruction letter. It is the guarantee for anything left outstanding and is NOT used if you return the car with no issues and no debts. It may only be completed for amounts actually incurred and unpaid — damage, fines, tolls, fuel — and up to three (3) years after the contract ends. We will notify you before doing so, with a breakdown. Default may be reported to credit bureaus.',
      },
      {
        title: '8. Your obligations regarding the vehicle',
        body: 'Use it for private purposes only. It may not be used for public or paid transport of people or goods, ride-hailing platforms, driving instruction, racing, towing other vehicles, or off suitable roads. You may not sublet it, assign it or take it out of the country without written authorisation. Park it in a closed lot overnight, obey traffic rules, and do not drive under the influence of alcohol or psychoactive substances. Besides breaching the contract, these uses leave an accident outside the insurance cover.',
      },
      {
        title: '9. In case of accident, damage or theft',
        body: 'Notify us within two (2) hours through the channel we indicate. In an accident: stay at the scene until the authorities arrive, obtain the police report, do not admit liability or settle with third parties, and do not abandon the vehicle. If the car is stolen, file a police report immediately and give us a copy within 24 hours.',
      },
      {
        title: '10. Fines, tolls and fuel',
        body: 'Traffic tickets, camera fines, tolls, parking, cleaning and fuel are your responsibility, and remain yours even if they arrive after you return the car. You must return it with the same fuel level you received it with. As the identified renter, traffic penalties are transferred to you.',
      },
      {
        title: '11. Handover and return',
        body: 'At every handover and return we draw up a record with photographs, the vehicle condition inventory (18 items), the odometer reading and the fuel level. You can review and confirm it from your phone. Those records are the basis for comparison to establish which damage is attributable to you. Signing the return record is NOT a full release: it does not clear you of hidden damage or of fines notified later.',
      },
      {
        title: '12. Insurance',
        body: 'The vehicle is covered by a policy issued by the insurer, in which DrivePass is the policyholder and the owner is the insured party. You are included as an insured party under third-party liability cover. The policy has deductibles, excesses and exclusions: whatever it does not cover is your responsibility under the terms of the contract. You may ask us for a copy of the policy summary and conditions before renting; we recommend reading them.',
      },
      {
        title: '13. Cancellations',
        body: 'If you cancel 48 hours or more before the handover time, we refund 100%. If you cancel within the 48 hours before, we refund 50%. If you neither show up nor notify us, three (3) hours after the agreed time the full amount is charged. These deadlines are the same ones set out in your rental contract.',
      },
      {
        title: '14. If the vehicle fails through no fault of yours',
        body: 'We do not charge you for the days you could not use it. We offer a replacement vehicle of similar characteristics or, if you prefer, refund the proportional amount within five (5) business days.',
      },
      {
        title: '15. Your personal data',
        body: 'When creating your account you sign a data processing authorisation (Colombian Law 1581 of 2012). We collect identification and contact details, images of your ID and driving licence, payment data and operational data, including handover and return photographs. Images of your documents are sensitive data and you therefore authorise them separately: without that authorisation we cannot verify your identity and so cannot provide the service. You may access, update, rectify and delete your data and revoke the authorisation by writing to notificaciones@drivepasscol.com. We answer enquiries within 10 business days and complaints within 15, extendable by 8.',
      },
      {
        title: '16. Our liability',
        body: 'DrivePass is liable for performing its obligations as agent and for whatever the law imposes, including the Colombian Consumer Statute (Law 1480 of 2011). Our liability for wilful misconduct or gross negligence is neither excluded nor limited. What is yours are the consequences of the use you make of the vehicle during the rental, under the terms of your contract.',
      },
      {
        title: '17. Complaints, notices and governing law',
        body: 'We handle requests, queries and complaints within fifteen (15) business days, through the email below. Communications between the parties are valid by email to the registered addresses. These terms and the contracts are governed by Colombian law, and disputes are submitted to the courts of Medellín, without prejudice to recourse to the Superintendency of Industry and Commerce.',
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
          <p className="text-ink/50 text-xs">{c.updated}</p>
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
              <svg className={`w-4 h-4 text-ink/50 transition-transform flex-shrink-0 ${active === i ? 'rotate-180' : ''}`}
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
        <p className="text-accent font-bold mt-1">{CONTACTO_CORREO}</p>
        <p className="text-white/50 text-xs mt-3">
          Para asuntos de datos personales (habeas data): notificaciones@drivepasscol.com
        </p>
      </div>
    </div>
  );
}
