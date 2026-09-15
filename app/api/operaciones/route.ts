import { NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { cargarDetalleServicio, getConfig, crearOperacionParaReserva } from '@/lib/operaciones';
import { whatsappHabilitado } from '@/lib/whatsapp';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { resumenActasPorOperacion } from '@/lib/acta-servicio';
import { exigeCasillasPorFecha } from '@/lib/fotos-servicio';

export const dynamic = 'force-dynamic';

type OperacionRow = {
  id: number; reserva_id: number; mensajero_id: number | null;
  estado: string; notas: string; wa_admin: string; wa_mensajero: string; created_at: string;
  mensajero_nombre: string | null; mensajero_celular: string | null;
};

export async function GET() {
  const g = await guardArea('operaciones');
  if ('error' in g) return g.error;
  const { db } = g;

  // Backfill idempotente: crea la operación para reservas confirmadas/en curso que
  // aún no la tengan (p. ej. confirmadas antes de existir este módulo). Sin WhatsApp.
  const faltantes = db.prepare(`
    SELECT r.id, r.created_at FROM reservas r
    LEFT JOIN operaciones o ON o.reserva_id = r.id
    WHERE o.id IS NULL AND r.estado IN ('confirmada','en_curso')
  `).all() as { id: number; created_at: string }[];
  for (const f of faltantes) {
    // Si se le exige o no el recorrido de 8 fotos lo decide la FECHA DE LA RESERVA
    // (`exigeCasillasPorFecha`), no el hecho de venir por el backfill. Antes esto era
    // un `guiadas: false` fijo, con el razonamiento "sin operación = reserva vieja";
    // pero una reserva de hoy puede quedarse sin operación (por ejemplo si
    // `crearOperacionYNotificar` falló y se tragó el error), y entonces nacía acá
    // exenta del bloqueo de fotos PARA SIEMPRE — no existe ninguna forma de volver a
    // ponerle `fotos_guiadas = 1`. Con la fecha, una reserva anterior al lanzamiento
    // sigue exenta (nadie pudo tomar esas fotos cuando tocaba) y una posterior se
    // crea exigida, sin importar por qué rama llegó.
    try {
      crearOperacionParaReserva(db, f.id, { guiadas: exigeCasillasPorFecha(f.created_at) });
    } catch { /* ignorar reservas problemáticas */ }
  }

  const ops = db.prepare(`
    SELECT o.*, m.nombre AS mensajero_nombre, m.celular AS mensajero_celular
    FROM operaciones o
    LEFT JOIN mensajeros m ON o.mensajero_id = m.id
    ORDER BY o.created_at DESC, o.id DESC
  `).all() as OperacionRow[];

  const tareasStmt = db.prepare('SELECT id, tipo, titulo, detalle, estado, orden FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id');

  // Solo metadatos de los respaldos ya congelados (ver lib/acta-servicio.ts); el PDF
  // se pide aparte por GET /api/operaciones/<id>/acta/<actaId>.
  // UNA consulta para todas las operaciones: antes era un `listarActas` por servicio
  // con `SELECT *`, o sea que el tablero traía de la base el snapshot completo de cada
  // acta (datos personales del cliente, resultado de la IA, lista de fotos) para
  // quedarse con cuatro números.
  const actasPorOp = resumenActasPorOperacion(db);

  const operaciones = ops.map(o => ({
    ...o,
    detalle: cargarDetalleServicio(db, o.reserva_id) || null,
    tareas: tareasStmt.all(o.id),
    actas: actasPorOp.get(o.id) ?? [],
  }));

  const mensajeros = db.prepare('SELECT id, nombre, celular, activo FROM mensajeros WHERE activo = 1 ORDER BY nombre').all();
  const admin_whatsapp = getConfig(db, 'admin_whatsapp');

  return NextResponse.json({ operaciones, mensajeros, admin_whatsapp, whatsapp_habilitado: whatsappHabilitado(), ia_disponible: tieneClaveAnthropic() });
}
