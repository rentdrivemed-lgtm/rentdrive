import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Lista de propietarios/clientes a los que un admin puede iniciarles una conversación de soporte.
export async function GET(req: NextRequest) {
  const g = await guardArea('soporte');
  if ('error' in g) return g.error;
  const { db } = g;

  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  let sql = `SELECT id, nombre, correo, rol FROM usuarios WHERE rol IN ('propietario','usuario') AND estado_cuenta = 'activa'`;
  const params: unknown[] = [];
  if (q) {
    sql += ' AND (LOWER(nombre) LIKE ? OR LOWER(correo) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY nombre LIMIT 50';

  const contactos = db.prepare(sql).all(...params);
  return NextResponse.json({ contactos });
}
