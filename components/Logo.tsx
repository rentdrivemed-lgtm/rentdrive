// Logo de marca DrivePass — ícono oficial (07_Marca_e_Imagen/Logos/DrivePass_Icono.svg):
// cuadro azul redondeado (#1B2A44) con la "A" de dos barras (blanca + naranja).
// El "mark" es el isotipo; el "wordmark" añade el texto DrivePass + tagline "RENT A CAR".

export function LogoMark({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
      role="img" aria-label="DrivePass" className={className}>
      <rect x="1" y="1" width="98" height="98" rx="26" fill="#1B2A44" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      <polygon points="43.88,83.27 30.12,80.73 42.12,15.73 55.88,18.27" fill="#F4F6FA" />
      <polygon points="69.88,80.69 56.12,83.31 44.12,20.31 57.88,17.69" fill="#F25C2B" />
    </svg>
  );
}

export function LogoWordmark({ height = 40, className = '' }: { height?: number; className?: string }) {
  const width = Math.round(height * (210 / 58));
  return (
    <svg width={width} height={height} viewBox="0 0 210 58" fill="none"
      role="img" aria-label="DrivePass rent a car" className={className}>
      <g transform="translate(3,3) scale(0.44)">
        <rect x="1" y="1" width="98" height="98" rx="26" fill="#1B2A44" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
        <polygon points="43.88,83.27 30.12,80.73 42.12,15.73 55.88,18.27" fill="#F4F6FA" />
        <polygon points="69.88,80.69 56.12,83.31 44.12,20.31 57.88,17.69" fill="#F25C2B" />
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
