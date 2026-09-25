// La vCard de la empresa, para el botón «Guardar contacto» de /contacto.
//
// Se genera en el SERVIDOR y no en la pantalla porque el archivo tiene que ser idéntico
// venga de donde venga, y porque con el `Content-Type` correcto el teléfono lo abre como
// un contacto en vez de dejarlo como una descarga suelta que nadie sabe qué hacer con
// ella.
//
// vCard 3.0 y no 4.0: es la que abren sin quejarse tanto iOS como Android. La 4.0 es más
// limpia pero todavía hay lectores que la ignoran, y este archivo existe justo para que
// funcione en el teléfono de cualquiera.
//
// Los datos salen de lib/contacto.ts, igual que la página. No hay ningún número escrito
// a mano acá.
import { NextResponse } from 'next/server';
import {
  CONTACTO_DIRECCION, CONTACTO_BARRIO, CONTACTO_CIUDAD, CONTACTO_DEPARTAMENTO,
  CONTACTO_PAIS, CONTACTO_TELEFONO_E164, CONTACTO_INSTAGRAM_URL,
} from '@/lib/contacto';

export const dynamic = 'force-dynamic';

const SITIO = 'https://www.drivepasscol.com';
const RAZON_SOCIAL = 'DRIVEPASS COL S.A.S.';
const NOMBRE_COMERCIAL = 'DrivePass';

/**
 * Escapa lo que la especificación de vCard trata como separadores.
 *
 * Sin esto, una dirección con una coma parte el campo en dos y el contacto llega roto al
 * teléfono. Hoy ninguna de nuestras constantes lleva comas, pero se escapa igual: el día
 * que alguien cambie la dirección en lib/contacto.ts nadie se va a acordar de esto.
 */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function GET() {
  // CRLF, no '\n': la especificación lo exige y hay lectores que con saltos de línea de
  // Unix se comen la última propiedad.
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(NOMBRE_COMERCIAL)}`,
    `N:${esc(NOMBRE_COMERCIAL)};;;;`,
    `ORG:${esc(RAZON_SOCIAL)}`,
    'TITLE:Alquiler de carros y transporte de grupos',
    `TEL;TYPE=CELL,VOICE:${CONTACTO_TELEFONO_E164}`,
    `URL:${SITIO}`,
    `URL;TYPE=Instagram:${CONTACTO_INSTAGRAM_URL}`,
    `X-SOCIALPROFILE;TYPE=instagram:${CONTACTO_INSTAGRAM_URL}`,
    // ADR: apartado;extendido;calle;ciudad;región;código postal;país
    `ADR;TYPE=WORK:;;${esc(`${CONTACTO_DIRECCION}, ${CONTACTO_BARRIO}`)};${esc(CONTACTO_CIUDAD)};${esc(CONTACTO_DEPARTAMENTO)};;${esc(CONTACTO_PAIS)}`,
    'END:VCARD',
  ].join('\r\n');

  return new NextResponse(vcard, {
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'attachment; filename="DrivePass.vcf"',
      // Son datos públicos y casi nunca cambian: que el CDN los sirva.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
