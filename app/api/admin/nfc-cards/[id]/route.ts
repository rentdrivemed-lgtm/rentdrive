import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { guardarTarjetaHtml, eliminarTarjetaHtml, subirAudioTarjeta, eliminarAudioTarjeta, type TarjetaAudio } from '@/lib/storage';
import { parseAudioManifest } from '@/lib/tarjetas';

export const dynamic = 'force-dynamic';

const ESTADOS = ['borrador', 'activa', 'inactiva'] as const;
type Tarjeta = { id: number; slug: string; estado: string; creador_nombre: string; audio_manifest: string };

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('nfc');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;
  const { id } = await params;
  const tarjeta = db.prepare('SELECT id, slug, estado, creador_nombre, audio_manifest FROM nfc_cards WHERE id = ?').get(Number(id)) as Tarjeta | undefined;
  if (!tarjeta) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

  const contentType = req.headers.get('content-type') || '';

  // Reemplazo de archivos (nuevo HTML y/o audios nuevos) — multipart/form-data.
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData().catch(() => null);
    if (!formData) return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 });

    const html = formData.get('html') as File | null;
    const audios = formData.getAll('audio').filter((f): f is File => f instanceof File);
    const creadorNombre = formData.has('creador_nombre') ? String(formData.get('creador_nombre') || '').trim() : null;
    const creadorHandle = formData.has('creador_handle') ? String(formData.get('creador_handle') || '').trim() : null;
    const estado = ESTADOS.includes(formData.get('estado') as typeof ESTADOS[number]) ? String(formData.get('estado')) : null;

    if (html && html.type !== 'text/html' && !html.name.toLowerCase().endsWith('.html')) {
      return NextResponse.json({ error: 'El archivo principal debe ser .html' }, { status: 400 });
    }
    if (html && html.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'El HTML supera 5 MB' }, { status: 400 });
    for (const a of audios) {
      if (!a.type.startsWith('audio/') && !a.name.toLowerCase().endsWith('.mp3')) {
        return NextResponse.json({ error: `"${a.name}" no parece un audio válido` }, { status: 400 });
      }
      if (a.size > 25 * 1024 * 1024) return NextResponse.json({ error: `"${a.name}" supera 25 MB` }, { status: 400 });
    }

    try {
      if (html) await guardarTarjetaHtml(tarjeta.slug, await html.arrayBuffer());
      if (audios.length > 0) {
        const previos = parseAudioManifest(tarjeta.audio_manifest);
        const nuevos: TarjetaAudio[] = [];
        for (const a of audios) nuevos.push(await subirAudioTarjeta(tarjeta.slug, a.name, await a.arrayBuffer()));
        // Reemplaza por nombre si ya existía (mismo archivo re-subido), agrega si es nuevo.
        const manifest = [...previos.filter(p => !nuevos.some(n => n.nombre === p.nombre)), ...nuevos];
        db.prepare("UPDATE nfc_cards SET audio_manifest = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
          .run(JSON.stringify(manifest), tarjeta.id);
      }
      if (creadorNombre !== null) db.prepare('UPDATE nfc_cards SET creador_nombre = ? WHERE id = ?').run(creadorNombre, tarjeta.id);
      if (creadorHandle !== null) db.prepare('UPDATE nfc_cards SET creador_handle = ? WHERE id = ?').run(creadorHandle, tarjeta.id);
      if (estado) db.prepare('UPDATE nfc_cards SET estado = ? WHERE id = ?').run(estado, tarjeta.id);

      if (html || audios.length > 0 || estado) {
        registrarAuditoria(db, { ...user, nivel }, {
          area: 'nfc', accion: 'editar_tarjeta',
          detalle: [html && 'HTML', audios.length > 0 && `${audios.length} audio(s)`, estado && `estado→${estado}`].filter(Boolean).join(', '),
          entidad: 'nfc_cards', entidad_id: tarjeta.id,
        });
      }

      const actualizada = db.prepare('SELECT * FROM nfc_cards WHERE id = ?').get(tarjeta.id);
      return NextResponse.json({ tarjeta: actualizada });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar la tarjeta';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Actualización simple de metadatos — JSON.
  const body = await req.json().catch(() => ({}));
  const updates: string[] = [];
  const valores: unknown[] = [];
  if (typeof body.estado === 'string' && ESTADOS.includes(body.estado)) { updates.push('estado = ?'); valores.push(body.estado); }
  if (typeof body.creador_nombre === 'string') { updates.push('creador_nombre = ?'); valores.push(body.creador_nombre.trim()); }
  if (typeof body.creador_handle === 'string') { updates.push('creador_handle = ?'); valores.push(body.creador_handle.trim()); }
  if (typeof body.notas === 'string') { updates.push('notas = ?'); valores.push(body.notas); }
  if (updates.length === 0) return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });

  updates.push("updated_at = datetime('now', 'localtime')");
  valores.push(tarjeta.id);
  db.prepare(`UPDATE nfc_cards SET ${updates.join(', ')} WHERE id = ?`).run(...valores);

  if (typeof body.estado === 'string') {
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'nfc', accion: 'cambiar_estado_tarjeta', detalle: `${tarjeta.creador_nombre} → ${body.estado}`,
      entidad: 'nfc_cards', entidad_id: tarjeta.id,
    });
  }

  const actualizada = db.prepare('SELECT * FROM nfc_cards WHERE id = ?').get(tarjeta.id);
  return NextResponse.json({ tarjeta: actualizada });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('nfc');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;
  const { id } = await params;
  const tarjeta = db.prepare('SELECT id, slug, creador_nombre, audio_manifest FROM nfc_cards WHERE id = ?').get(Number(id)) as Tarjeta | undefined;
  if (!tarjeta) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

  db.prepare('DELETE FROM nfc_cards WHERE id = ?').run(tarjeta.id);
  await eliminarTarjetaHtml(tarjeta.slug);
  for (const a of parseAudioManifest(tarjeta.audio_manifest)) await eliminarAudioTarjeta(a.public_id);

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'nfc', accion: 'eliminar_tarjeta', detalle: `Eliminó la tarjeta de ${tarjeta.creador_nombre} (${tarjeta.slug})`,
    entidad: 'nfc_cards', entidad_id: tarjeta.id,
  });

  return NextResponse.json({ ok: true });
}
