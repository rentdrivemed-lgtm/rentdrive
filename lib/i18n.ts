export const es = {
  nav: {
    home: 'Inicio', browse: 'Alquilar', rent: 'Para alquilar', owners: 'Para propietarios',
    requirements: 'Requisitos',
    alliance: 'DTravel', terms: 'Términos', dashboard: 'Panel', history: 'Historial',
    messages: 'Mensajes', profile: 'Mi perfil',
    login: 'Iniciar sesión', register: 'Registrarse', logout: 'Cerrar sesión',
    role_admin: 'Administrador', role_owner: 'Propietario', role_user: 'Alquilador',
  },
  footer: {
    tagline: 'Alquiler de carros entre particulares',
    copy: `© ${new Date().getFullYear()} DrivePass. Todos los derechos reservados.`,
  },
};

export type Translations = typeof es;

export const en: Translations = {
  nav: {
    home: 'Home', browse: 'Rent now', rent: 'Rent a car', owners: 'For owners',
    requirements: 'Requirements',
    alliance: 'DTravel', terms: 'Terms', dashboard: 'Dashboard', history: 'History',
    messages: 'Messages', profile: 'My profile',
    login: 'Sign in', register: 'Sign up', logout: 'Sign out',
    role_admin: 'Administrator', role_owner: 'Owner', role_user: 'Renter',
  },
  footer: {
    tagline: 'Peer-to-peer car rental',
    copy: `© ${new Date().getFullYear()} DrivePass. All rights reserved.`,
  },
};
