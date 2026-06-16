// Logo de marca DrivePass (vectorial, fiel al Design System: assets/logo-*.svg).
// El "mark" es un tile azul autocontenido con dos vías (blanca + naranja),
// por eso luce bien sobre cualquier fondo. El "wordmark" añade el texto DrivePass.

export function LogoMark({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
      role="img" aria-label="DrivePass" className={className}>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="#1B3356" />
      <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" stroke="#FFFFFF" strokeOpacity="0.14" />
      <path d="M16 36 L21 14 L26 14 L23 36 Z" fill="#F4F6FA" />
      <path d="M30 36 L25 14 L30 14 L35 36 Z" fill="#F25C2B" />
    </svg>
  );
}

export function LogoWordmark({ height = 36, className = '' }: { height?: number; className?: string }) {
  const width = Math.round(height * (200 / 48));
  return (
    <svg width={width} height={height} viewBox="0 0 200 48" fill="none"
      role="img" aria-label="DrivePass" className={className}>
      <rect x="2" y="6" width="36" height="36" rx="11" fill="#1B3356" />
      <rect x="2.5" y="6.5" width="35" height="35" rx="10.5" stroke="#FFFFFF" strokeOpacity="0.14" />
      <path d="M14 34 L18 14 L22 14 L20 34 Z" fill="#F4F6FA" />
      <path d="M26 34 L22 14 L26 14 L30 34 Z" fill="#F25C2B" />
      <text x="50" y="32" fontFamily="var(--font-geist-sans), Geist, system-ui, sans-serif"
        fontSize="23" fontWeight="800" letterSpacing="-0.5" fill="#F4F6FA">
        Drive<tspan fill="#F25C2B">Pass</tspan>
      </text>
    </svg>
  );
}
