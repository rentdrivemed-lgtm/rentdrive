export const es = {
  nav: {
    home: 'Inicio', browse: 'Alquilar', rent: 'Para alquilar', owners: 'Para propietarios',
    requirements: 'Requisitos', earn: 'Gana con tu carro',
    alliance: 'DTravel', terms: 'Términos', buses: 'Buses', dashboard: 'Panel', history: 'Historial',
    messages: 'Mensajes', profile: 'Mi perfil',
    login: 'Iniciar sesión', register: 'Registrarse', logout: 'Cerrar sesión',
    role_admin: 'Administrador', role_owner: 'Propietario', role_user: 'Alquilador',
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
