export const es = {
  nav: {
    home: 'Inicio', browse: 'Alquilar', rent: 'Para alquilar', owners: 'Para propietarios',
    requirements: 'Requisitos', earn: 'Gana con tu carro',
    alliance: 'DTravel', terms: 'Términos', buses: 'Buses', dashboard: 'Panel', history: 'Historial',
    messages: 'Mensajes', profile: 'Mi perfil',
    login: 'Iniciar sesión', register: 'Registrarse', logout: 'Cerrar sesión',
    role_admin: 'Administrador', role_owner: 'Propietario', role_user: 'Alquilador',
  },
  // ── Respaldo asegurador (Seguros SURA) ────────────────────────────────────
  // Estos textos se redactaron contra el clausulado que las partes firman
  // (`lib/contratos-plantillas.ts`, cláusulas sexta y séptima de la agencia y
  // cuarta y décima del arrendamiento). No prometen cobertura total: el aviso
  // de cierre enumera lo que la póliza NO cubre, igual que el contrato. Si se
  // cambia esta redacción, hay que volver a cotejarla con el contrato.
  //
  // `Seguros SURA`, `Seguros Generales Suramericana S.A.` y `DrivePass` son
  // nombres propios y no se traducen en ningún idioma.
  sura: {
    etiqueta: 'Respaldo asegurador',
    avisoTitulo: 'Lo que la póliza no cubre',
    franja: 'Cada alquiler sale amparado por una póliza de Seguros SURA que contrata DrivePass, declarada ante la aseguradora para alquiler a terceros.',
    franjaNota: 'Recibes la carátula y las condiciones de la póliza antes de firmar.',
    franjaLink: 'Ver qué cubre',
    usuario: {
      titulo: 'El seguro de tu alquiler lo respalda Seguros SURA',
      intro: 'DrivePass contrata la póliza con Seguros Generales Suramericana S.A. y figura en ella como tomador. No es un seguro particular estirado para el alquiler: la carátula declara el alquiler a terceros como destinación del riesgo, que es lo que permite que el amparo opere mientras tú conduces.',
      puntos: [
        'Quedas incorporado como asegurado en el amparo de responsabilidad civil extracontractual de la póliza.',
        'Al firmar recibes copia de la carátula y de las condiciones particulares: amparos, exclusiones, deducibles y límites territoriales.',
        'Los amparos y deducibles que aplican a tu alquiler quedan escritos en el otrosí que firmas, no en letra pequeña.',
        'La operación depende de que la póliza esté vigente: si el amparo se cae, DrivePass suspende el alquiler de ese vehículo.',
      ],
      aviso: 'Ninguna póliza de automóviles cubre todo, y la nuestra tampoco. Corren por tu cuenta el deducible y la franquicia, el faltante entre lo que indemniza la aseguradora y el valor real del daño, las multas y los comparendos, y los perjuicios de hechos que la aseguradora excluya u objete cuando la objeción venga de incumplir el contrato o las condiciones de la póliza. Así está escrito en la cláusula décima del contrato de arrendamiento que firmas.',
    },
    propietario: {
      titulo: 'Tu carro rueda amparado por Seguros SURA y la prima la paga DrivePass',
      intro: 'La póliza la contrata DrivePass con Seguros Generales Suramericana S.A. en calidad de tomador, y tú figuras como asegurado respecto de tu vehículo. Es un seguro por cuenta ajena: las obligaciones del tomador —empezando por pagar la prima— son nuestras; el derecho a la prestación asegurada es tuyo.',
      puntos: [
        'No tienes que aportar tu póliza ni pagar la prima: ese costo lo asume DrivePass y se entiende retribuido con la comisión pactada.',
        'Declaramos ante SURA el alquiler a terceros como destinación del riesgo. Sin esa declaración, una póliza particular deja por fuera cualquier pérdida ocurrida mientras el carro está alquilado.',
        'Te entregamos copia de la carátula y del clausulado, y de cada anexo o renovación dentro de los cinco días hábiles siguientes a su expedición.',
        'Si hay siniestro presentamos la reclamación en tu nombre con las actas, las fotos y los soportes; tú conservas la condición de asegurado y beneficiario.',
      ],
      aviso: 'La póliza tiene límites y conviene conocerlos antes de publicar: el deducible, la franquicia, el faltante por infraseguro y los hechos que el clausulado excluye quedan fuera del amparo. Te explicamos cuáles son y cómo los mitigamos —validación de identidad de cada arrendatario, depósito de garantía y pagaré a tu orden— antes de que publiques, por teléfono o en el punto de atención. También puedes contratar amparos adicionales por tu cuenta, y el contrato de agencia te lo deja por escrito con el detalle completo.',
    },
  },
  footer: {
    tagline: 'Alquiler de carros entre particulares',
    copy: `© ${new Date().getFullYear()} DrivePass. Todos los derechos reservados.`,
    // Contacto: SOLO las etiquetas se traducen. La dirección, el celular y el
    // usuario de Instagram son datos duros y viven en `lib/contacto.ts`.
    platform: 'Plataforma',
    payments: 'Pagos aceptados',
    contact: 'Contacto',
    point: 'Punto de atención',
    directions: 'Cómo llegar',
    call: 'Llamar',
    whatsapp: 'Escríbenos por WhatsApp',
    instagram: 'Síguenos en Instagram',
  },
};

export type Translations = typeof es;

export const en: Translations = {
  nav: {
    home: 'Home', browse: 'Rent now', rent: 'Rent a car', owners: 'For owners',
    requirements: 'Requirements', earn: 'Earn with your car',
    alliance: 'DTravel', terms: 'Terms', buses: 'Buses', dashboard: 'Dashboard', history: 'History',
    messages: 'Messages', profile: 'My profile',
    login: 'Sign in', register: 'Sign up', logout: 'Sign out',
    role_admin: 'Administrator', role_owner: 'Owner', role_user: 'Renter',
  },
  sura: {
    etiqueta: 'Insurance backing',
    avisoTitulo: 'What the policy does not cover',
    franja: 'Every rental goes out covered by a Seguros SURA policy taken out by DrivePass and declared to the insurer for rental to third parties.',
    franjaNota: 'You receive the policy schedule and conditions before signing.',
    franjaLink: 'See what it covers',
    usuario: {
      titulo: 'Your rental insurance is backed by Seguros SURA',
      intro: 'DrivePass takes out the policy with Seguros Generales Suramericana S.A. and is named on it as the policyholder. This is not a private policy stretched to fit a rental: the policy schedule declares rental to third parties as the declared use of the risk, which is what keeps the cover in force while you drive.',
      puntos: [
        'You are named as an insured party under the policy\'s third-party liability cover.',
        'When you sign you receive a copy of the policy schedule and particular conditions: covers, exclusions, deductibles and territorial limits.',
        'The covers and deductibles that apply to your rental are written into the addendum you sign, not buried in fine print.',
        'The operation depends on the policy being in force: if cover lapses, DrivePass suspends that vehicle\'s rental.',
      ],
      aviso: 'No car insurance policy covers everything, and neither does ours. You are responsible for the deductible and the franchise, the gap between what the insurer pays and the real value of the damage, traffic tickets and fines, and losses from events the insurer excludes or rejects when the rejection stems from a breach of the contract or of the policy conditions. It is written that way in clause ten of the rental agreement you sign.',
    },
    propietario: {
      titulo: 'Your car is covered by Seguros SURA and DrivePass pays the premium',
      intro: 'DrivePass takes out the policy with Seguros Generales Suramericana S.A. as the policyholder, and you are named as the insured party for your vehicle. It is insurance taken out on another\'s behalf: the policyholder\'s obligations — starting with paying the premium — are ours; the right to the insured benefit is yours.',
      puntos: [
        'You do not have to provide your own policy or pay the premium: DrivePass takes on that cost, offset by the agreed commission.',
        'We declare rental to third parties to SURA as the declared use of the risk. Without that declaration, a private policy leaves out any loss that occurs while the car is rented out.',
        'We give you a copy of the policy schedule and wording, and of every endorsement or renewal within five business days of its issue.',
        'If there is a claim we file it on your behalf with the handover records, photos and supporting evidence; you remain the insured party and the beneficiary.',
      ],
      aviso: 'The policy has limits and it is worth knowing them before you list: the deductible, the franchise, the shortfall caused by underinsurance and the events the policy wording excludes all fall outside the cover. We walk you through what they are and how we mitigate them — identity verification for every renter, a security deposit and a promissory note in your favour — before you list, by phone or at our service point. You may also take out additional cover yourself, and the agency agreement sets it all out in writing in full.',
    },
  },
  footer: {
    tagline: 'Peer-to-peer car rental',
    copy: `© ${new Date().getFullYear()} DrivePass. All rights reserved.`,
    platform: 'Platform',
    payments: 'Accepted payments',
    contact: 'Contact',
    point: 'Service point',
    directions: 'Get directions',
    call: 'Call',
    whatsapp: 'Message us on WhatsApp',
    instagram: 'Follow us on Instagram',
  },
};
