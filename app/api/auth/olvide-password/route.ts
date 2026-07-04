import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { enviarCorreo } from '@/lib/email';
import { appBaseUrl } from '@/lib/operaciones';

const TOKEN_VIGENCIA_MIN = 60;

export async function POST(req: NextRequest) {
  const { correo } = await req.json();
  if (!correo) return NextResponse.json({ error: 'Ingresa tu correo' }, { status: 400 });

  const db = getDb();
  const user = db.prepare('SELECT id, nombre FROM usuarios WHERE correo = ?').get(correo) as { id: number; nombre: string } | undefined;

  // Respuesta genérica siempre — no revelar si el correo existe o no (evita enumeración de usuarios).
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + TOKEN_VIGENCIA_MIN * 60_000).toISOString();
    db.prepare('UPDATE usuarios SET reset_token = ?, reset_token_expira = ? WHERE id = ?').run(token, expira, user.id);

    const base = appBaseUrl() || 'http://localhost:3100';
    const enlace = `${base}/restablecer-password?token=${token}`;
    const envio = await enviarCorreo(correo, 'Restablece tu contraseña de RentDrive',
      `Hola ${user.nombre.split(' ')[0]}, para restablecer tu contraseña entra a este enlace (vence en ${TOKEN_VIGENCIA_MIN} minutos): ${enlace}\n\nSi no pediste esto, ignora el correo — tu contraseña sigue igual.`);
    if (!envio.enviado) {
      // Fallback de desarrollo: si falta RESEND_API_KEY, el enlace queda en el log del servidor.
      console.log(`[olvide-password] Enlace de reseteo para ${correo}: ${enlace} (envío real falló: ${envio.detalle})`);
    }
  }

  return NextResponse.json({ ok: true, mensaje: 'Si el correo existe en RentDrive, te enviamos un enlace para restablecer tu contraseña.' });
}
