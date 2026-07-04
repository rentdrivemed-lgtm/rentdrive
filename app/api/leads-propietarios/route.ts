import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { enviarWhatsappCodigo } from '@/lib/whatsapp';

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODIGO_VIGENCIA_MIN = 10;

function generarCodigo(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function mensajeCodigo(nombre: string, codigo: string): string {
  return `Hola ${nombre.split(' ')[0]}, tu código para ver la calculadora de ganancias de RentDrive es: ${codigo}. Vence en ${CODIGO_VIGENCIA_MIN} minutos.`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const nombre = (body.nombre || '').toString().trim();
  const correo = (body.correo || '').toString().trim();
  const celular = (body.celular || '').toString().trim();
  const tipoVehiculo = (body.tipo_vehiculo || '').toString().trim();
  const canal = (body.canal || '').toString().trim();

  if (!nombre || !correo || !celular) {
    return NextResponse.json({ error: 'Nombre, correo y celular son obligatorios' }, { status: 400 });
  }
  if (!CORREO_RE.test(correo)) {
    return NextResponse.json({ error: 'Correo inválido' }, { status: 400 });
  }
  if (canal !== 'correo' && canal !== 'whatsapp') {
    return NextResponse.json({ error: 'Elige un canal de verificación (correo o whatsapp)' }, { status: 400 });
  }

  const db = getDb();
  const codigo = generarCodigo();
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + CODIGO_VIGENCIA_MIN * 60_000).toISOString();

  const result = db.prepare(
    `INSERT INTO leads_propietarios
      (nombre, correo, celular, tipo_vehiculo, origen, canal_verificacion, codigo, codigo_expira, codigo_generado_at)
     VALUES (?, ?, ?, ?, 'calculadora', ?, ?, ?, ?)`
  ).run(nombre, correo, celular, tipoVehiculo, canal, codigo, expira, ahora.toISOString());

  const mensaje = mensajeCodigo(nombre, codigo);
  const envio = canal === 'correo'
    ? await enviarCorreo(correo, 'Tu código de verificación RentDrive', mensaje)
    : await enviarWhatsappCodigo(celular, mensaje, codigo);

  if (!envio.enviado) {
    // Fallback de desarrollo: si el envío real no está configurado (falta RESEND_API_KEY o
    // WHATSAPP_ENABLED), el código queda solo en el log del servidor para poder seguir probando.
    console.log(`[leads-propietarios] Código para ${canal === 'correo' ? correo : celular}: ${codigo} (envío real falló: ${envio.detalle})`);
  }

  return NextResponse.json({ id: result.lastInsertRowid, enviado: envio.enviado, detalle: envio.detalle });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const db = getDb();
  const leads = db.prepare(
    'SELECT id, nombre, correo, celular, tipo_vehiculo, canal_verificacion, verificado, created_at FROM leads_propietarios ORDER BY created_at DESC'
  ).all();
  return NextResponse.json({ leads });
}
