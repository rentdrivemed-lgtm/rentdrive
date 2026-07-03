import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { enviarCorreo } from '@/lib/email';
import { enviarWhatsapp } from '@/lib/whatsapp';

const CODIGO_VIGENCIA_MIN = 10;
const COOLDOWN_SEGUNDOS = 30;

type LeadRow = { id: number; nombre: string; correo: string; celular: string; canal_verificacion: string; codigo_generado_at: string; verificado: number };

function generarCodigo(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 });

  const db = getDb();
  const lead = db.prepare(
    'SELECT id, nombre, correo, celular, canal_verificacion, codigo_generado_at, verificado FROM leads_propietarios WHERE id = ?'
  ).get(id) as LeadRow | undefined;

  if (!lead) return NextResponse.json({ error: 'No encontramos tu solicitud, vuelve a empezar.' }, { status: 404 });
  if (lead.verificado) return NextResponse.json({ enviado: true, detalle: 'ya estaba verificado' });

  if (lead.codigo_generado_at) {
    const segundosDesdeUltimo = (Date.now() - new Date(lead.codigo_generado_at).getTime()) / 1000;
    if (segundosDesdeUltimo < COOLDOWN_SEGUNDOS) {
      return NextResponse.json({ error: `Espera ${Math.ceil(COOLDOWN_SEGUNDOS - segundosDesdeUltimo)}s antes de pedir otro código.` }, { status: 429 });
    }
  }

  const codigo = generarCodigo();
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + CODIGO_VIGENCIA_MIN * 60_000).toISOString();

  db.prepare(
    'UPDATE leads_propietarios SET codigo = ?, codigo_expira = ?, codigo_generado_at = ?, codigo_intentos = 0 WHERE id = ?'
  ).run(codigo, expira, ahora.toISOString(), id);

  const mensaje = `Hola ${lead.nombre.split(' ')[0]}, tu nuevo código RentDrive es: ${codigo}. Vence en ${CODIGO_VIGENCIA_MIN} minutos.`;
  const envio = lead.canal_verificacion === 'correo'
    ? await enviarCorreo(lead.correo, 'Tu código de verificación RentDrive', mensaje)
    : await enviarWhatsapp(lead.celular, mensaje);

  if (!envio.enviado) {
    console.log(`[leads-propietarios] Código reenviado para lead ${id}: ${codigo} (envío real falló: ${envio.detalle})`);
  }

  return NextResponse.json({ enviado: envio.enviado, detalle: envio.detalle });
}
