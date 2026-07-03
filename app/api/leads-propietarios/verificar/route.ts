import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const MAX_INTENTOS = 5;

type LeadRow = { id: number; codigo: string; codigo_expira: string; codigo_intentos: number; verificado: number };

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  const codigo = (body.codigo || '').toString().trim();

  if (!id || !codigo) {
    return NextResponse.json({ ok: false, error: 'Falta el id o el código' }, { status: 400 });
  }

  const db = getDb();
  const lead = db.prepare(
    'SELECT id, codigo, codigo_expira, codigo_intentos, verificado FROM leads_propietarios WHERE id = ?'
  ).get(id) as LeadRow | undefined;

  if (!lead) return NextResponse.json({ ok: false, error: 'No encontramos tu solicitud, vuelve a empezar.' }, { status: 404 });
  if (lead.verificado) return NextResponse.json({ ok: true });

  if (lead.codigo_intentos >= MAX_INTENTOS) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos — pide un código nuevo.' }, { status: 429 });
  }
  if (!lead.codigo_expira || new Date(lead.codigo_expira) < new Date()) {
    return NextResponse.json({ ok: false, error: 'El código venció — pide uno nuevo.' }, { status: 410 });
  }

  db.prepare('UPDATE leads_propietarios SET codigo_intentos = codigo_intentos + 1 WHERE id = ?').run(id);

  if (codigo !== lead.codigo) {
    return NextResponse.json({ ok: false, error: 'Código incorrecto.' }, { status: 400 });
  }

  db.prepare('UPDATE leads_propietarios SET verificado = 1 WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
