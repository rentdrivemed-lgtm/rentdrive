import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { guardarTarjetaHtml, subirAudioTarjeta, type TarjetaAudio } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TIPOS = ['embajador', 'cliente'] as const;
const ESTADOS = ['borrador', 'activa', 'inactiva'] as const;

export async function GET() {
  const g = await guardArea('nfc');
  if ('error' in g) return g.error;
  const { db } = g;
  const tarjetas = db.prepare(`
    SELECT id, slug, usuario_id, tipo, creador_nombre, creador_handle, estado,
           audio_manifest, visitas, notas, created_at, updated_at
    FROM nfc_cards
    ORDER BY created_at DESC
  `).all();
  return NextResponse.json({ tarjetas });
}

export async function POST(req: NextRequest) {
  const g = await guardArea('nfc');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 });

  const slug = String(formData.get('slug') || '').trim().toLowerCase();
  const creadorNombre = String(formData.get('creador_nombre') || '').trim();
  const creadorHandle = String(formData.get('creador_handle') || '').trim();
  const tipo = TIPOS.includes(formData.get('tipo') as typeof TIPOS[number]) ? String(formData.get('tipo')) : 'embajador';
  const estado = ESTADOS.includes(formData.get('estado') as typeof ESTADOS[number]) ? String(formData.get('estado')) : 'borrador';
  const html = formData.get('html') as File | null;
  const audios = formData.getAll('audio').filter((f): f is File => f instanceof File);

  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'Slug inválido. Usa minúsculas, números y guiones (ej. marlon-solorzano).' }, { status: 400 });
  }
  if (!creadorNombre) return NextResponse.json({ error: 'Falta el nombre del creador' }, { status: 400 });
  if (!html) return NextResponse.json({ error: 'Falta el archivo .html de la tarjeta' }, { status: 400 });
  if (html.type !== 'text/html' && !html.name.toLowerCase().endsWith('.html')) {
    return NextResponse.json({ error: 'El archivo principal debe ser .html' }, { status: 400 });
  }
  if (html.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'El HTML supera 8 MB' }, { status: 400 });
  for (const a of audios) {
    if (!a.type.startsWith('audio/') && !a.name.toLowerCase().endsWith('.mp3')) {
      return NextResponse.json({ error: `"${a.name}" no parece un audio válido` }, { status: 400 });
    }
    if (a.size > 25 * 1024 * 1024) return NextResponse.json({ error: `"${a.name}" supera 25 MB` }, { status: 400 });
  }

  const existe = db.prepare('SELECT id FROM nfc_cards WHERE slug = ?').get(slug);
  if (existe) return NextResponse.json({ error: 'Ya existe una tarjeta con ese slug' }, { status: 409 });

  try {
    await guardarTarjetaHtml(slug, await html.arrayBuffer());
    const manifest: TarjetaAudio[] = [];
    for (const a of audios) manifest.push(await subirAudioTarjeta(slug, a.name, await a.arrayBuffer()));

    const info = db.prepare(`
      INSERT INTO nfc_cards (slug, tipo, creador_nombre, creador_handle, estado, audio_manifest, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(slug, tipo, creadorNombre, creadorHandle, estado, JSON.stringify(manifest), user.id);

    registrarAuditoria(db, { ...user, nivel }, {
      area: 'nfc', accion: 'crear_tarjeta', detalle: `Creó la tarjeta NFC de ${creadorNombre} (${slug})`,
      entidad: 'nfc_cards', entidad_id: Number(info.lastInsertRowid),
    });

    const tarjeta = db.prepare('SELECT * FROM nfc_cards WHERE id = ?').get(info.lastInsertRowid);
    return NextResponse.json({ tarjeta }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al crear la tarjeta';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
