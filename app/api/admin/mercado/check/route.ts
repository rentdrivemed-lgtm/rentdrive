import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { guardArea } from '@/lib/guard';
import { extraerPreciosPagina, calcularPrecioObjetivo } from '@/lib/mercado';
import { secretoCronValido } from '@/lib/cron-secret';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIPOS = ['sedan', 'suv', 'compacto', 'pickup'] as const;

// POST /api/admin/mercado/check — ejecutar chequeo de precios (admin o cron)
export async function POST(req: NextRequest) {
  // Admite autenticación por sesión (admin) o por CRON_SECRET
  const cronSecret = req.headers.get('x-cron-secret');
  const esCron = secretoCronValido(cronSecret, process.env.CRON_SECRET);

  // Doble puerta: el cron entra con su secreto; una persona entra solo si es admin
  // Y tiene la sección "mercado" (el chequeo puede reescribir precios de la flota).
  if (!esCron) {
    const g = await guardArea('mercado');
    if ('error' in g) return g.error;
  }

  const db = getDb();

  type CompetidorRow = {
    id: number; nombre: string; url: string; ajuste_pct: number; auto_actualizar: number;
  };
  const competidores = db.prepare(
    "SELECT id, nombre, url, ajuste_pct, auto_actualizar FROM competidores WHERE activo = 1"
  ).all() as CompetidorRow[];

  if (competidores.length === 0) {
    return NextResponse.json({ ok: true, mensaje: 'No hay competidores activos configurados' });
  }

  const resultados: Array<{ nombre: string; url: string; precios: Record<string, number | null | boolean | string> }> = [];
  const insPrecios = db.prepare(
    'INSERT INTO precios_mercado (competidor_id, sedan, suv, compacto, pickup, encontrado, nota, datos_raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  // Verificar cada competidor
  for (const comp of competidores) {
    const precios = await extraerPreciosPagina(comp.url, comp.nombre);

    insPrecios.run(
      comp.id,
      precios.sedan, precios.suv, precios.compacto, precios.pickup,
      precios.encontrado ? 1 : 0,
      precios.nota,
      JSON.stringify(precios),
    );

    db.prepare("UPDATE competidores SET ultimo_check = datetime('now') WHERE id = ?").run(comp.id);
    resultados.push({ nombre: comp.nombre, url: comp.url, precios });
  }

  // Auto-actualizar precios si algún competidor tiene auto_actualizar = 1
  const autoComp = competidores.filter(c => c.auto_actualizar === 1);
  const preciosEncontrados = resultados
    .filter(r => r.precios.encontrado)
    .map(r => r.precios as { sedan: number | null; suv: number | null; compacto: number | null; pickup: number | null; encontrado: boolean; nota: string });

  const ajustePct = autoComp.length > 0 ? autoComp[0].ajuste_pct : -5;
  const cambios: string[] = [];

  if (preciosEncontrados.length > 0 && autoComp.length > 0) {
    for (const tipo of TIPOS) {
      const precioObj = calcularPrecioObjetivo(preciosEncontrados, tipo, ajustePct);
      if (!precioObj) continue;

      const vehiculosActualizados = db.prepare(
        "UPDATE vehiculos SET precio_dia = ? WHERE tipo = ? AND precio_dia > 0"
      ).run(precioObj, tipo);

      if (vehiculosActualizados.changes > 0) {
        cambios.push(`${tipo}: $${precioObj.toLocaleString('es-CO')}/día (${vehiculosActualizados.changes} vehículo${vehiculosActualizados.changes !== 1 ? 's' : ''})`);
      }
    }
  }

  // Notificar al admin con el resumen
  const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin'").all() as { id: number }[];
  const encontrados = resultados.filter(r => r.precios.encontrado).length;
  const titulo = `📊 Análisis de mercado completado`;
  const mensaje = `Se verificaron ${competidores.length} competidor${competidores.length !== 1 ? 'es' : ''}. `
    + `${encontrados} con precios encontrados.`
    + (cambios.length > 0 ? ` Precios actualizados: ${cambios.join(', ')}.` : ' Sin cambios automáticos.');

  const insNotif = db.prepare(
    'INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje) VALUES (?, ?, ?, ?)'
  );
  for (const a of admins) insNotif.run(a.id, 'mercado_actualizado', titulo, mensaje);

  return NextResponse.json({ ok: true, resultados, cambios, mensaje });
}
