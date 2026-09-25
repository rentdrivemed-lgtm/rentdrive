type IconProps = { size?: number; className?: string; };
const d = (size = 22, className = '') => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className });

export const IconKey       = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="7.5" cy="7.5" r="4.5"/><line x1="10.5" y1="10.5" x2="21" y2="21"/><line x1="15.5" y1="15.5" x2="18" y2="13"/><line x1="18" y1="18" x2="20.5" y2="15.5"/></svg>;
export const IconCar       = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M5 17H3a2 2 0 01-2-2v-4l2.34-5.85A2 2 0 015.2 4h13.6a2 2 0 011.86 1.15L23 11v4a2 2 0 01-2 2h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/><path d="M1 11h22"/></svg>;
export const IconCalendar  = ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/></svg>;
export const IconUser      = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>;
export const IconChat      = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="13" x2="13" y2="13"/></svg>;
export const IconBell      = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;
export const IconBellOff   = ({ size, className }: IconProps) => <svg {...d(size, className)}><line x1="1" y1="1" x2="23" y2="23"/><path d="M17.47 17.47H3s3-2 3-9c0-1.03.1-2.04.3-3M10.05 4.1a6 6 0 0110 5.9 27.23 27.23 0 01-.07.7M13.73 21a2 2 0 01-3.46 0"/></svg>;
export const IconSearch    = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
export const IconFilter    = ({ size, className }: IconProps) => <svg {...d(size, className)}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
export const IconPin       = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
export const IconStar      = ({ size, className }: IconProps) => <svg {...d(size, className)}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
export const IconCheck     = ({ size, className }: IconProps) => <svg {...d(size, className)}><polyline points="20 6 9 17 4 12"/></svg>;
export const IconX         = ({ size, className }: IconProps) => <svg {...d(size, className)}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
export const IconArrowL    = ({ size, className }: IconProps) => <svg {...d(size, className)}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
export const IconArrowR    = ({ size, className }: IconProps) => <svg {...d(size, className)}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
export const IconDashboard = ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
export const IconHistory   = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>;
export const IconExport    = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
export const IconUpload    = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
export const IconPhoto     = ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
export const IconLogout    = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
export const IconCompass   = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" stroke="none" opacity="0.5"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>;
export const IconShield    = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
export const IconCoin      = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a3 3 0 00-5 2.24c0 3.27 5 5.26 5 5.26s-5 2-5 5.26"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="18" x2="12" y2="20"/></svg>;
export const IconRoute     = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="5" cy="6" r="2"/><path d="M5 8v7"/><circle cx="5" cy="18" r="2"/><path d="M19 4h-8a2 2 0 000 4h6a2 2 0 010 4H5"/></svg>;
export const IconMenu      = ({ size, className }: IconProps) => <svg {...d(size, className)}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
export const IconSend      = ({ size, className }: IconProps) => <svg {...d(size, className)}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
export const IconClock     = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>;
export const IconGlobe     = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="3.5" ry="9"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>;
export const IconPlane     = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>;
export const IconCreditCard= ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>;
export const IconBuilding  = ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="3" y="2" width="18" height="20" rx="1"/><line x1="9" y1="22" x2="9" y2="12"/><line x1="15" y1="22" x2="15" y2="12"/><rect x="9" y="12" width="6" height="10"/><line x1="9" y1="7" x2="9" y2="7" strokeWidth="3" strokeLinecap="round"/><line x1="15" y1="7" x2="15" y2="7" strokeWidth="3" strokeLinecap="round"/><line x1="12" y1="7" x2="12" y2="7" strokeWidth="3" strokeLinecap="round"/></svg>;
export const IconUsers     = ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75"/><path d="M21 21v-2a4 4 0 00-3-3.87"/></svg>;
export const IconHome      = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
export const IconInbox     = ({ size, className }: IconProps) => <svg {...d(size, className)}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>;
export const IconNfc       = ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="3" y="7" width="7" height="10" rx="1.5"/><path d="M13.5 8.5a5 5 0 010 7"/><path d="M17 5.5a9 9 0 010 13"/><path d="M20.3 3a13 13 0 010 18"/></svg>;
export const IconRotate    = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M21 12a9 9 0 11-3.5-7.14"/><polyline points="21 3 21 9 15 9"/></svg>;
// Bus (vitrina pública del Cotizador de Buses, ver app/buses/page.tsx) — mismo lenguaje
// visual (trazo redondeado) que IconCar de arriba, silueta de bus en vez de carro.
export const IconPhone     = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.6a2 2 0 01-.5 2.1L8.1 9.6a16 16 0 006 6l1.2-1.2a2 2 0 012.1-.5c.8.3 1.7.6 2.6.7a2 2 0 011.7 2z"/></svg>;
export const IconMail      = ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="2" y="4.5" width="20" height="15" rx="2.5"/><path d="M2.5 6.5l9.5 6.5 9.5-6.5"/></svg>;
export const IconBus       = ({ size, className }: IconProps) => <svg {...d(size, className)}><rect x="3" y="4" width="18" height="13" rx="2.5"/><line x1="3" y1="10.5" x2="21" y2="10.5"/><circle cx="7.5" cy="19.5" r="1.6"/><circle cx="16.5" cy="19.5" r="1.6"/><line x1="6" y1="7" x2="9" y2="7"/></svg>;

// ── Set Medellín (identidad local) ──
export const IconMetrocable  = ({ size, className }: IconProps) => <svg {...d(size, className)}><line x1="2" y1="6" x2="22" y2="10"/><circle cx="12" cy="8" r="1.3" fill="currentColor" stroke="none"/><line x1="12" y1="9.3" x2="12" y2="13"/><path d="M8 13h8l-1.5 6h-5z"/><line x1="9.5" y1="16" x2="14.5" y2="16"/></svg>;
export const IconComuna13    = ({ size, className }: IconProps) => <svg {...d(size, className)}><path d="M3 21h4v-4h4v-4h4v-4h4v-4h3"/><line x1="3" y1="18" x2="22" y2="2"/></svg>;
export const IconCordillera  = ({ size, className }: IconProps) => <svg {...d(size, className)}><polyline points="2 19 6 10 9 14 13 6 17 12 22 19"/></svg>;
export const IconFlorMedellin= ({ size, className }: IconProps) => <svg {...d(size, className)}><circle cx="12" cy="7" r="3.3"/><circle cx="16.8" cy="10.5" r="3.3"/><circle cx="14.9" cy="16" r="3.3"/><circle cx="9.1" cy="16" r="3.3"/><circle cx="7.2" cy="10.5" r="3.3"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>;

// ── Logos de marcas ─────────────────────────────────────────────────────────
//
// Trazos oficiales tomados de Simple Icons (https://simpleicons.org), que publica los
// logotipos de cada marca en CC0 precisamente para esto: enlazar a los perfiles propios
// de una empresa.
//
// Se copian los trazos AQUÍ en vez de depender del paquete npm o de una CDN porque son
// cuatro rutas fijas que no cambian: traer una dependencia entera —o peor, pedirle el
// icono a un servidor ajeno en cada visita— para dibujar cuatro caminos sería pagar de
// más y meter un tercero en el camino crítico de la página de contacto.
//
// Van con `fill="currentColor"`, así que toman el color del texto que los rodea. NO se
// usan los colores de marca (el verde de WhatsApp, el degradado de Instagram): sobre el
// tema oscuro de la aplicación darían contraste irregular, y el logotipo monocromo es un
// uso que las dos marcas admiten expresamente en sus guías.
//
// ⚠️ Son marcas registradas de sus dueños. Sirven para enlazar a los perfiles de
// DrivePass y para nada más.

type PropsMarca = { size?: number; className?: string };

/** Logo oficial de WhatsApp (Simple Icons, CC0). Ver la nota de arriba. */
export const IconWhatsapp = ({ size = 16, className = '' }: PropsMarca) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
    className={className} role="img" aria-hidden="true" focusable="false">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
);
/** Logo oficial de Instagram (Simple Icons, CC0). Ver la nota de arriba. */
export const IconInstagram = ({ size = 16, className = '' }: PropsMarca) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
    className={className} role="img" aria-hidden="true" focusable="false">
    <path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077" />
  </svg>
);
/** Logo oficial de Google Maps (Simple Icons, CC0). Ver la nota de arriba. */
export const IconMaps = ({ size = 16, className = '' }: PropsMarca) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
    className={className} role="img" aria-hidden="true" focusable="false">
    <path d="M19.527 4.799c1.212 2.608.937 5.678-.405 8.173-1.101 2.047-2.744 3.74-4.098 5.614-.619.858-1.244 1.75-1.669 2.727-.141.325-.263.658-.383.992-.121.333-.224.673-.34 1.008-.109.314-.236.684-.627.687h-.007c-.466-.001-.579-.53-.695-.887-.284-.874-.581-1.713-1.019-2.525-.51-.944-1.145-1.817-1.79-2.671L19.527 4.799zM8.545 7.705l-3.959 4.707c.724 1.54 1.821 2.863 2.871 4.18.247.31.494.622.737.936l4.984-5.925-.029.01c-1.741.601-3.691-.291-4.392-1.987a3.377 3.377 0 0 1-.209-.716c-.063-.437-.077-.761-.004-1.198l.001-.007zM5.492 3.149l-.003.004c-1.947 2.466-2.281 5.88-1.117 8.77l4.785-5.689-.058-.05-3.607-3.035zM14.661.436l-3.838 4.563a.295.295 0 0 1 .027-.01c1.6-.551 3.403.15 4.22 1.626.176.319.323.683.377 1.045.068.446.085.773.012 1.22l-.003.016 3.836-4.561A8.382 8.382 0 0 0 14.67.439l-.009-.003zM9.466 5.868L14.162.285l-.047-.012A8.31 8.31 0 0 0 11.986 0a8.439 8.439 0 0 0-6.169 2.766l-.016.018 3.665 3.084z" />
  </svg>
);
/** Logo oficial de Waze (Simple Icons, CC0). Ver la nota de arriba. */
export const IconWaze = ({ size = 16, className = '' }: PropsMarca) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
    className={className} role="img" aria-hidden="true" focusable="false">
    <path d="M13.218 0C9.915 0 6.835 1.49 4.723 4.148c-1.515 1.913-2.31 4.272-2.31 6.706v1.739c0 .894-.62 1.738-1.862 1.813-.298.025-.547.224-.547.522-.05.82.82 2.31 2.012 3.502.82.844 1.788 1.515 2.832 2.036a3 3 0 0 0 2.955 3.528 2.966 2.966 0 0 0 2.931-2.385h2.509c.323 1.689 2.086 2.856 3.974 2.21 1.64-.546 2.36-2.409 1.763-3.924a12.84 12.84 0 0 0 1.838-1.465 10.73 10.73 0 0 0 3.18-7.65c0-2.882-1.118-5.589-3.155-7.625A10.899 10.899 0 0 0 13.218 0zm0 1.217c2.558 0 4.967.994 6.78 2.807a9.525 9.525 0 0 1 2.807 6.78A9.526 9.526 0 0 1 20 17.585a9.647 9.647 0 0 1-6.78 2.807h-2.46a3.008 3.008 0 0 0-2.93-2.41 3.03 3.03 0 0 0-2.534 1.367v.024a8.945 8.945 0 0 1-2.41-1.788c-.844-.844-1.316-1.614-1.515-2.11a2.858 2.858 0 0 0 1.441-.846 2.959 2.959 0 0 0 .795-2.036v-1.789c0-2.11.696-4.197 2.012-5.861 1.863-2.385 4.62-3.726 7.6-3.726zm-2.41 5.986a1.192 1.192 0 0 0-1.191 1.192 1.192 1.192 0 0 0 1.192 1.193A1.192 1.192 0 0 0 12 8.395a1.192 1.192 0 0 0-1.192-1.192zm7.204 0a1.192 1.192 0 0 0-1.192 1.192 1.192 1.192 0 0 0 1.192 1.193 1.192 1.192 0 0 0 1.192-1.193 1.192 1.192 0 0 0-1.192-1.192zm-7.377 4.769a.596.596 0 0 0-.546.845 4.813 4.813 0 0 0 4.346 2.757 4.77 4.77 0 0 0 4.347-2.757.596.596 0 0 0-.547-.845h-.025a.561.561 0 0 0-.521.348 3.59 3.59 0 0 1-3.254 2.061 3.591 3.591 0 0 1-3.254-2.061.64.64 0 0 0-.546-.348z" />
  </svg>
);
