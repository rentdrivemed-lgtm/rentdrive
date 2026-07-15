'use client';

import { useState } from 'react';

/**
 * Campo de porcentaje robusto.
 * - `value` es una FRACCIÓN (0.04 = 4%). Se muestra como porcentaje (4).
 * - Mantiene un buffer de texto local mientras está enfocado para poder escribir
 *   decimales ("4.5") sin que el reformateo del render pelee con el cursor.
 * - Al enfocar SELECCIONA todo el contenido: al hacer clic y escribir, se
 *   REEMPLAZA el valor en vez de sumarle dígitos.
 * - No usa el parser de miles (que borraba el punto decimal y multiplicaba ×10).
 */
export default function InputPorcentaje({
  value,
  onChange,
  decimals = 1,
  className = '',
}: {
  value: number; // fracción, p.ej. 0.04
  onChange: (fraccion: number) => void;
  decimals?: number;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [buffer, setBuffer] = useState('');

  const canonical = (Math.round(value * 100 * 10 ** decimals) / 10 ** decimals).toString();
  const shown = focused ? buffer : canonical;

  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      className={className}
      onFocus={(e) => {
        setBuffer(canonical);
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        // solo dígitos y un punto decimal
        const s = e.target.value.replace(/[^0-9.]/g, '');
        setBuffer(s);
        const n = parseFloat(s);
        if (Number.isFinite(n)) onChange(n / 100);
        else if (s === '' || s === '.') onChange(0);
      }}
    />
  );
}
