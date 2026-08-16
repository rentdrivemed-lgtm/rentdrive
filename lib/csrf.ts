import { NextRequest, NextResponse } from 'next/server';

// Defensa básica contra CSRF en los endpoints de auth que mutan sesión
// (login/registro/google/logout). Dos capas, independientes entre sí:
//
// 1) Content-Type estricto: bloquea el bypass clásico de "JSON CSRF" en el que un
//    <form>/fetch cross-site manda el body como text/plain (no dispara preflight
//    CORS) pero el server igual lo interpreta como JSON con req.json().
// 2) Origin: si el navegador manda el header Origin (no todos lo hacen en
//    same-origin), debe coincidir con nuestro propio dominio. Si no viene, se deja
//    pasar (muchos navegadores/proxies no lo envían en requests same-origin).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.drivepasscol.com';
const ORIGENES_PERMITIDOS = new Set([APP_URL, 'http://localhost:3100']);

export function origenNoPermitido(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  if (origin && !ORIGENES_PERMITIDOS.has(origin)) {
    return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 });
  }
  return null;
}

/** Para endpoints que esperan body JSON (login, registro, google). */
export function bloqueadoPorCsrf(req: NextRequest): NextResponse | null {
  const contentType = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  return origenNoPermitido(req);
}
