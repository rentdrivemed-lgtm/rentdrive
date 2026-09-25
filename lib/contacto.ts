// Datos de contacto públicos de DrivePass — ÚNICA fuente de verdad.
// El pie de página, el chat de soporte y el JSON-LD de SEO leen de aquí: si
// cambia la sede o el celular, se cambia en este archivo y queda cambiado en
// todo el sitio (y en lo que Google indexa).
//
// Módulo PURO: sin BD, sin `fs`, sin `next/*`. Lo importan tanto componentes
// cliente (`components/Footer.tsx`) como el layout de servidor (`app/layout.tsx`).
import { DIRECCION_PUNTO_ATENCION } from './lugares';

/** Dirección del punto de atención, tal como se le muestra al cliente.
 *  Sale del catálogo de lugares (`lib/lugares.ts`) para que la dirección que se
 *  publica y la que se guarda en las reservas no puedan desincronizarse. */
export const CONTACTO_DIRECCION = DIRECCION_PUNTO_ATENCION;
export const CONTACTO_BARRIO = 'San Joaquín';
export const CONTACTO_CIUDAD = 'Medellín';
export const CONTACTO_DEPARTAMENTO = 'Antioquia';
export const CONTACTO_PAIS = 'Colombia';

/** Dirección completa para mapas y buscadores. Lleva ciudad y país a propósito:
 *  "Calle 42A" sola existe en media Colombia y el mapa abriría en otra ciudad. */
export const CONTACTO_DIRECCION_COMPLETA =
  `${CONTACTO_DIRECCION}, ${CONTACTO_BARRIO}, ${CONTACTO_CIUDAD}, ${CONTACTO_PAIS}`;

/** Celular de atención. Se guarda en piezas para no repetir el número: el href
 *  de `tel:`, el de WhatsApp y lo que se ve en pantalla salen todos de aquí. */
export const CONTACTO_INDICATIVO_PAIS = '57';
export const CONTACTO_CELULAR = '3118290666';
/** E.164 — formato que esperan `tel:` y los buscadores. */
export const CONTACTO_TELEFONO_E164 = `+${CONTACTO_INDICATIVO_PAIS}${CONTACTO_CELULAR}`;
/** Como se lee en pantalla: "+57 311 829 0666". */
export const CONTACTO_TELEFONO_VISIBLE =
  `+${CONTACTO_INDICATIVO_PAIS} ${CONTACTO_CELULAR.slice(0, 3)} ${CONTACTO_CELULAR.slice(3, 6)} ${CONTACTO_CELULAR.slice(6)}`;
export const CONTACTO_TEL_HREF = `tel:${CONTACTO_TELEFONO_E164}`;
/** wa.me va SIN '+' y con indicativo: en Colombia la gente escribe antes de llamar. */
export const CONTACTO_WHATSAPP_URL = `https://wa.me/${CONTACTO_INDICATIVO_PAIS}${CONTACTO_CELULAR}`;

export const CONTACTO_INSTAGRAM_USUARIO = 'drivepasscol_';
export const CONTACTO_INSTAGRAM_URL = `https://instagram.com/${CONTACTO_INSTAGRAM_USUARIO}`;

/**
 * Correo de atención al público.
 *
 * NO es el mismo que `AGENTE.correo` (notificaciones@), que es la dirección para
 * notificaciones contractuales y habeas data que citan los contratos. Ese vive en
 * lib/contratos-datos.ts y no se toca desde aquí: cambiar el correo comercial no puede
 * mover el de las notificaciones legales, que es el que quedó impreso —y firmado— en
 * los documentos ya emitidos.
 */
export const CONTACTO_CORREO = 'info@drivepasscol.com';
export const CONTACTO_CORREO_HREF = `mailto:${CONTACTO_CORREO}`;

// ── Mapas ────────────────────────────────────────────────────────────────────
// Los enlaces van POR CONSULTA DE DIRECCIÓN, no por coordenadas: hoy solo está
// confirmada la calle (San Joaquín, Laureles-Estadio), no el número exacto, y un
// pin corrido manda al cliente a la puerta equivocada. Que lo resuelva el propio
// mapa, que sabe más que nosotros.
//
// Cuando llegue el pin exacto: reemplazar `CONSULTA_MAPA` por `"<lat>,<lng>"`
// (sin encodeURIComponent extra, la coma es segura) y todo el sitio queda
// apuntando al punto correcto sin tocar ninguna vista.
const CONSULTA_MAPA = encodeURIComponent(CONTACTO_DIRECCION_COMPLETA);
export const CONTACTO_GOOGLE_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${CONSULTA_MAPA}`;
export const CONTACTO_WAZE_URL = `https://waze.com/ul?q=${CONSULTA_MAPA}&navigate=yes`;
