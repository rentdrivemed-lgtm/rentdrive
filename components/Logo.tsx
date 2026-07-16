// Logo de marca DrivePass (vectorial, fiel al Design System: assets/logo-*.svg).
// El "mark" es una placa azul redondeada con dos flechas de intercambio —naranja→ / ←clara—
// que representan el handoff P2P (las llaves pasan del propietario al conductor). Se ve bien
// sobre cualquier fondo. El "wordmark" añade el texto DrivePass + tagline "RENT A CAR".

export function LogoMark({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none"
      role="img" aria-label="DrivePass" className={className}>
      <rect x="4" y="4" width="88" height="88" rx="26" fill="#1B3356" />
      <rect x="4.5" y="4.5" width="87" height="87" rx="25.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.14" />
      <path d="M26 38 H63" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round" />
      <polyline points="55,29 66,38 55,47" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M70 58 H33" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round" />
      <polyline points="41,49 30,58 41,67" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LogoWordmark({ height = 40, className = '' }: { height?: number; className?: string }) {
  const width = Math.round(height * (210 / 58));
  return (
    <svg width={width} height={height} viewBox="0 0 210 58" fill="none"
      role="img" aria-label="DrivePass rent a car" className={className}>
      <g transform="translate(2,2) scale(0.458)">
        <rect x="4" y="4" width="88" height="88" rx="26" fill="#1B3356" />
        <rect x="4.5" y="4.5" width="87" height="87" rx="25.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.14" />
        <path d="M26 38 H63" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round" />
        <polyline points="55,29 66,38 55,47" fill="none" stroke="#F25C2B" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M70 58 H33" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round" />
        <polyline points="41,49 30,58 41,67" fill="none" stroke="#F4F6FA" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="54" y="30" fontFamily="var(--font-geist-sans), Geist, system-ui, sans-serif"
        fontSize="23" fontWeight="800" letterSpacing="-0.5" fill="#F4F6FA">
        Drive<tspan fill="#F25C2B">Pass</tspan>
      </text>
      <line x1="55" y1="41" x2="203" y2="41" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="1" />
      <text x="55" y="52" fontFamily="var(--font-geist-sans), Geist, system-ui, sans-serif"
        fontSize="10.5" fontWeight="600" letterSpacing="3.4" fill="#A9B8CE">RENT A CAR</text>
    </svg>
  );
}
