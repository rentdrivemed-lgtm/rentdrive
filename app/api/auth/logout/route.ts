import { NextRequest, NextResponse } from 'next/server';
import { origenNoPermitido } from '@/lib/csrf';

// Logout no parsea body (el frontend llama fetch(..., { method: 'POST' }) sin
// Content-Type), así que aquí NO exigimos application/json como en los otros 3
// endpoints de auth — solo el chequeo de Origin (forzar un logout cross-site es de
// bajo impacto, pero no cuesta nada bloquearlo si el navegador manda el header).
export async function POST(req: NextRequest) {
  const origenError = origenNoPermitido(req);
  if (origenError) return origenError;

  const res = NextResponse.json({ ok: true });
  res.cookies.set('token', '', {
    httpOnly: true, path: '/', maxAge: 0,
    secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
  });
  return res;
}
