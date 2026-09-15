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
// Ambos helpers devuelven null ante cualquier entrada que no sea una URL http(s)
// bien formada. El guard de protocolo NO es decorativo: con un esquema no-especial
// (un typo tipo "htps://..." o un "host:puerto" sin esquema) `new URL()` NO lanza,
// el catch no se activa, y `u.origin` devuelve el string literal "null" — que es
// justamente el Origin que manda un navegador desde un iframe sandbox o una URL
// data:, o sea, el único origin que un atacante SÍ puede falsificar. Sin este
// guard, una variable de entorno mal escrita convertiría la allowlist en
// "permitir al atacante" en silencio; con él, una config mala falla cerrada
// (nadie entra) en vez de fallar medio-abierta.
function aOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

function varianteWww(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

// APP_URL se normaliza con `aOrigin` antes de entrar a la allowlist: el header
// Origin que manda el navegador nunca trae barra final, path ni mayúsculas, así
// que meter el valor crudo del entorno haría que un APP_URL escrito como
// "https://www.drivepasscol.com/" (con slash, muy fácil de configurar así) no
// matcheara nunca — reintroduciendo el mismo bug que este archivo arregla, pero
// del lado del dominio principal.
const APP_URL_ORIGIN = aOrigin(APP_URL);
const APP_URL_VARIANTE = varianteWww(APP_URL);

// Fuera de producción, además del propio dominio, permitimos las mismas IPs LAN de
// next.config.ts (allowedDevOrigins): el equipo prueba por celular en la misma red
// y Safari manda Origin también en requests same-origin al entrar por IP (por eso
// existe esa allowlist). localhost:3100 solo aplica en dev — en producción no hay
// nada legítimo sirviendo ahí.
const ORIGENES_PERMITIDOS = new Set([
  ...(APP_URL_ORIGIN ? [APP_URL_ORIGIN] : []),
  ...(APP_URL_VARIANTE ? [APP_URL_VARIANTE] : []),
  ...(EN_PRODUCCION ? [] : LAN_DEV_ORIGINS.map(host => `http://${host}:3100`)),
]);

// Fuera de producción se acepta CUALQUIER PUERTO de esos mismos hosts de desarrollo.
// El puerto oficial es 3100, pero `next dev` salta al siguiente libre si está ocupado
// (y hay quien levanta una segunda instancia a propósito): con la allowlist fija en
// ":3100" el propio equipo se quedaba fuera con un 403 "Origen no permitido" y la
// tentación pasaba a ser NO aplicar el control en el llamador — justo lo que no se
// quiere. El relajo está acotado por `EN_PRODUCCION` y por el host: en producción
// esta función no aporta ni un origen extra.
const HOSTS_DEV = new Set(LAN_DEV_ORIGINS);

function esOrigenDeDesarrollo(origin: string): boolean {
  if (EN_PRODUCCION) return false;
  try {
    const u = new URL(origin);
    // Mismo guard de protocolo que `aOrigin`: un Origin "null" (iframe sandbox, URL
    // data:) no es una URL válida y cae en el catch → no se exenta de nada.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return HOSTS_DEV.has(u.hostname);
  } catch {
    return false;
  }
}

export function origenNoPermitido(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  if (origin && !ORIGENES_PERMITIDOS.has(origin) && !esOrigenDeDesarrollo(origin)) {
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
