import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { marcarLiquidacionesPagadas, generarRemision } from '@/lib/contabilidad';

export const dynamic = 'force-dynamic';

type LiquidacionRow = {
  id: number; reserva_id: number; propietario_id: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  estado: string; pagado_en: string; comprobante: string; comprobante_url: string;
  propietario_nombre: string; propietario_correo: string; propietario_documento: string;
  banco: string; numero_cuenta: string; placa: string; remision_numero: string;
  marca: string; modelo: string; anio: number; fecha_inicio: string; fecha_fin: string; usuario_nombre: string;
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const soloEstado = searchParams.get('estado') || 'pendiente';

  const db = getDb();

  // Backfill: asegura que cada liquidación tenga su remisión guardada como soporte del propietario.
  const sinRemision = db.prepare(`
    SELECT l.reserva_id FROM liquidaciones l
    LEFT JOIN remisiones rem ON rem.reserva_id = l.reserva_id
    WHERE l.estado = ? AND rem.id IS NULL
  `).all(soloEstado) as Array<{ reserva_id: number }>;
  for (const s of sinRemision) { try { generarRemision(db, s.reserva_id); } catch { /* no bloquea el listado */ } }

  const liquidaciones = db.prepare(`
    SELECT l.*, p.nombre AS propietario_nombre, p.correo AS propietario_correo,
           COALESCE(p.documento_identidad,'') AS propietario_documento,
           COALESCE(p.banco,'') AS banco, COALESCE(p.numero_cuenta,'') AS numero_cuenta,
           COALESCE(v.placa,'') AS placa, COALESCE(rem.numero,'') AS remision_numero,
           v.marca, v.modelo, v.anio, r.fecha_inicio, r.fecha_fin, u.nombre AS usuario_nombre
    FROM liquidaciones l
    JOIN usuarios p ON l.propietario_id = p.id
    JOIN reservas r ON l.reserva_id = r.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios u ON r.usuario_id = u.id
    LEFT JOIN remisiones rem ON rem.reserva_id = l.reserva_id
    WHERE l.estado = ?
    ORDER BY r.fecha_fin DESC
  `).all(soloEstado) as LiquidacionRow[];

  const porPropietario: Record<number, {
    propietario_id: number; propietario_nombre: string; propietario_correo: string;
    banco: string; numero_cuenta: string; total_neto: number; liquidaciones: LiquidacionRow[];
  }> = {};

  for (const l of liquidaciones) {
    if (!porPropietario[l.propietario_id]) {
      porPropietario[l.propietario_id] = {
        propietario_id: l.propietario_id, propietario_nombre: l.propietario_nombre, propietario_correo: l.propietario_correo,
        banco: l.banco, numero_cuenta: l.numero_cuenta, total_neto: 0, liquidaciones: [],
      };
    }
    porPropietario[l.propietario_id].total_neto += l.neto;
    porPropietario[l.propietario_id].liquidaciones.push(l);
  }

  return NextResponse.json({
    liquidaciones,
    por_propietario: Object.values(porPropietario),
    total_general: liquidaciones.reduce((s, l) => s + l.neto, 0),
  });
}

// Marca una o varias liquidaciones como pagadas (transferencia manual, ya realizada) y avisa al propietario.
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const body = await req.json() as { reserva_ids?: number[]; reserva_id?: number; comprobante?: string; comprobante_url?: string };
  const ids: number[] = body.reserva_ids || (body.reserva_id ? [body.reserva_id] : []);
  if (ids.length === 0) return NextResponse.json({ error: 'Se requiere al menos un reserva_id' }, { status: 400 });

  const db = getDb();

  type Fila = { reserva_id: number; propietario_id: number; neto: number; marca: string; modelo: string; fecha_inicio: string; fecha_fin: string };
  const rows = db.prepare(`
    SELECT l.reserva_id, l.propietario_id, l.neto, v.marca, v.modelo, r.fecha_inicio, r.fecha_fin
    FROM liquidaciones l JOIN reservas r ON l.reserva_id = r.id JOIN vehiculos v ON r.vehiculo_id = v.id
    WHERE l.reserva_id IN (${ids.map(() => '?').join(',')}) AND l.estado = 'pendiente'
  `).all(...ids) as Fila[];

  if (rows.length === 0) return NextResponse.json({ error: 'No hay liquidaciones pendientes con esos IDs' }, { status: 400 });

  const comprobante = body.comprobante || '';
  const comprobanteUrl = body.comprobante_url || '';
  marcarLiquidacionesPagadas(db, rows.map(r => r.reserva_id), comprobante, comprobanteUrl);

  const propGrupos: Record<number, Fila[]> = {};
  for (const r of rows) {
    if (!propGrupos[r.propietario_id]) propGrupos[r.propietario_id] = [];
    propGrupos[r.propietario_id].push(r);
  }

  const insNotif = db.prepare(
    'INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const comprobanteTxt = comprobante ? ` Comprobante: ${comprobante}.` : '';

  for (const [pidStr, filas] of Object.entries(propGrupos)) {
    const pid = Number(pidStr);
    const totalPagado = filas.reduce((s, r) => s + r.neto, 0);
    const n = filas.length;
    const titulo = n === 1 ? `💰 Pago recibido: ${filas[0].marca} ${filas[0].modelo}` : `💰 ${n} pagos realizados`;
    const mensaje = n === 1
      ? `DrivePass transfirió $${totalPagado.toLocaleString('es-CO')} (neto, ya descontada la comisión) por el alquiler del ${filas[0].fecha_inicio} al ${filas[0].fecha_fin}.${comprobanteTxt}`
      : `DrivePass transfirió $${totalPagado.toLocaleString('es-CO')} (neto) por ${n} alquileres completados.${comprobanteTxt}`;
    insNotif.run(pid, 'pago_realizado', titulo, mensaje, filas[0].reserva_id, 'reserva');
  }

  return NextResponse.json({ ok: true, actualizados: rows.length });
}
