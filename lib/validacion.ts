// Validación de datos personales — se usa tanto en los formularios (feedback inmediato)
// como en las rutas de API (autoritativo: el frontend se puede saltar, la API no).

export type PaisTel = {
  dial: string;
  nombre: string;
  longitud: [number, number];
  patron?: RegExp;
};

// Cobertura pensada para el mercado actual (Colombia) y el de captación en EE. UU.,
// más algunos países vecinos comunes. "Otro" cubre el resto con una validación laxa.
export const PAISES_TEL: PaisTel[] = [
  { dial: '+57',  nombre: 'Colombia',        longitud: [10, 10], patron: /^3\d{9}$/ },
  { dial: '+1',   nombre: 'Estados Unidos / Canadá', longitud: [10, 10] },
  { dial: '+52',  nombre: 'México',          longitud: [10, 10] },
  { dial: '+34',  nombre: 'España',          longitud: [9, 9] },
  { dial: '+51',  nombre: 'Perú',            longitud: [9, 9] },
  { dial: '+56',  nombre: 'Chile',           longitud: [9, 9] },
  { dial: '+54',  nombre: 'Argentina',       longitud: [10, 11] },
  { dial: '+593', nombre: 'Ecuador',         longitud: [9, 9] },
  { dial: '+507', nombre: 'Panamá',          longitud: [7, 8] },
  { dial: '+55',  nombre: 'Brasil',          longitud: [10, 11] },
  { dial: '+44',  nombre: 'Reino Unido',     longitud: [10, 10] },
  { dial: '',     nombre: 'Otro',            longitud: [6, 15] },
];

export const PAIS_TEL_DEFAULT = '+57';

export function buscarPaisTel(dial: string): PaisTel {
  return PAISES_TEL.find(p => p.dial === dial) || PAISES_TEL[PAISES_TEL.length - 1];
}

/** Devuelve el mensaje de error, o null si el celular es válido para el indicativo dado. */
export function validarCelular(dial: string, numero: string): string | null {
  const limpio = (numero || '').replace(/\D/g, '');
  if (!limpio) return 'Ingresa tu número de celular.';
  const pais = buscarPaisTel(dial);
  const [min, max] = pais.longitud;
  if (limpio.length < min || limpio.length > max) {
    return min === max
      ? `El número debe tener ${min} dígitos para ${pais.nombre}.`
      : `El número debe tener entre ${min} y ${max} dígitos para ${pais.nombre}.`;
  }
  if (pais.patron && !pais.patron.test(limpio)) {
    return `Ese no parece un celular válido de ${pais.nombre} (ej: celular colombiano empieza en 3).`;
  }
  return null;
}

/** Normaliza a solo dígitos, recortado a la longitud máxima del país (evita pegar basura). */
export function limpiarCelular(dial: string, numero: string): string {
  const pais = buscarPaisTel(dial);
  return (numero || '').replace(/\D/g, '').slice(0, pais.longitud[1]);
}

/**
 * Heurística simple contra direcciones falsas ("asdf", "no tengo", etc.) — no es una
 * validación real de que la dirección exista (eso requeriría un servicio pago tipo
 * Google Places), solo un mínimo de calidad: longitud razonable + al menos un número.
 */
export function validarDireccion(direccion: string): string | null {
  const d = (direccion || '').trim();
  if (d.length < 8) return 'Ingresa tu dirección completa (calle/carrera, número, barrio).';
  if (!/\d/.test(d)) return 'La dirección debe incluir un número (ej: Calle 10 # 43-20).';
  return null;
}

export type TipoDocumentoIdentidad = 'cedula' | 'cedula_ext' | 'pasaporte' | string;

/** Devuelve el mensaje de error, o null si el número de documento es válido para ese tipo. */
export function validarDocumentoIdentidad(tipo: TipoDocumentoIdentidad, numero: string): string | null {
  const n = (numero || '').trim();
  if (!n) return 'Ingresa tu número de documento.';
  if (tipo === 'pasaporte') {
    if (!/^[A-Za-z0-9]+$/.test(n)) return 'El número de pasaporte solo debe tener letras y números.';
    if (n.length < 5 || n.length > 15) return 'El número de pasaporte debe tener entre 5 y 15 caracteres.';
    return null;
  }
  // cédula de ciudadanía / extranjería: solo dígitos en Colombia.
  if (!/^\d+$/.test(n)) return 'La cédula solo debe tener números.';
  if (n.length < 6 || n.length > 10) return 'La cédula debe tener entre 6 y 10 dígitos.';
  return null;
}
