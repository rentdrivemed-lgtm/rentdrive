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

// Railway sirve el sitio en dos dominios (con y sin "www") SIN redirigir uno al
// otro — un visitante real puede llegar por cualquiera de los dos, y el navegador
// manda el Origin exacto que usó. Si solo permitiéramos APP_URL, cualquiera que
// entre por la variante no configurada quedaría bloqueado del login/registro/Google
// con un 403 "Origen no permitido" (bug real confirmado en producción: entrar por
// drivepasscol.com sin "www" cuando APP_URL apunta a www.drivepasscol.com). Se
// deriva automáticamente la variante alterna en vez de hardcodear un segundo
// literal, para que siga funcionando si el dominio configurado cambia.
function varianteWww(url: string): string | null {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
    return u.origin;
  } catch {
    return null;
  }
}
const APP_URL_VARIANTE = varianteWww(APP_URL);

// Fuera de producción, además del propio dominio, permitimos las mismas IPs LAN de
// next.config.ts (allowedDevOrigins): el equipo prueba por celular en la misma red
// y Safari manda Origin también en requests same-origin al entrar por IP (por eso
// existe esa allowlist). localhost:3100 solo aplica en dev — en producción no hay
// nada legítimo sirviendo ahí.
const ORIGENES_PERMITIDOS = new Set([
  APP_URL,
  ...(APP_URL_VARIANTE ? [APP_URL_VARIANTE] : []),
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
