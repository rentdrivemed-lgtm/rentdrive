import { NextRequest, NextResponse } from 'next/server';
import { LAN_DEV_ORIGINS } from '@/next.config';

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
const EN_PRODUCCION = process.env.NODE_ENV === 'production';

// Fuera de producción, además del propio dominio, permitimos las mismas IPs LAN de
// next.config.ts (allowedDevOrigins): el equipo prueba por celular en la misma red
// y Safari manda Origin también en requests same-origin al entrar por IP (por eso
// existe esa allowlist). localhost:3100 solo aplica en dev — en producción no hay
// nada legítimo sirviendo ahí.
const ORIGENES_PERMITIDOS = new Set([
  APP_URL,
  ...(EN_PRODUCCION ? [] : LAN_DEV_ORIGINS.map(host => `http://${host}:3100`)),
]);

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
