import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { tieneAltaDisponibilidadEsteMes } from '@/lib/disponibilidad-reglas';
import { precioMercadoSugerido, segmentoValido } from '@/lib/precioMercado';

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  const fin = new Date(end);
  while (cur < fin) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const tipo         = searchParams.get('tipo');
  const ubicacion    = searchParams.get('ubicacion');
  const precioMax    = searchParams.get('precioMax');
  const propietarioId = searchParams.get('propietarioId');
  const fechaInicio  = searchParams.get('fechaInicio');
  const fechaFin     = searchParams.get('fechaFin');
  const vitrina      = searchParams.get('vitrina');

  let query = `
    SELECT v.*, u.nombre as propietario_nombre
    FROM vehiculos v
    JOIN usuarios u ON v.propietario_id = u.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (tipo)         { query += ' AND v.tipo = ?';            params.push(tipo); }
  if (ubicacion)    { query += ' AND v.ubicacion LIKE ?';    params.push(`%${ubicacion}%`); }
  if (precioMax)    { query += ' AND v.precio_dia <= ?';     params.push(Number(precioMax)); }
  if (propietarioId){ query += ' AND v.propietario_id = ?';  params.push(Number(propietarioId)); }
  if (vitrina)      { query += ' AND v.en_vitrina = 1';      query += ' AND v.disponible = 1'; }
  // Listado público: ocultar vehículos inactivos. El propietario sí ve los suyos (filtra por propietarioId).
  else if (!propietarioId) query += ' AND v.disponible = 1';

  let vehiculos = db.prepare(query).all(...params) as Record<string, unknown>[];

  // Post-filter by date availability if both dates provided
  if (fechaInicio && fechaFin && fechaInicio < fechaFin) {
    const needed = new Set(datesInRange(fechaInicio, fechaFin));

    // Vehículos con una reserva activa que solapa el rango pedido (mismo criterio inclusivo que el POST de /reservas).
    const ocupados = new Set(
      (db.prepare(
        `SELECT DISTINCT vehiculo_id FROM reservas
         WHERE estado NOT IN ('cancelada') AND fecha_inicio <= ? AND fecha_fin >= ?`
      ).all(fechaFin, fechaInicio) as { vehiculo_id: number }[]).map(r => r.vehiculo_id)
    );

    vehiculos = vehiculos.filter(v => {
      if (ocupados.has(Number(v.id))) return false; // ya reservado en esas fechas
      let dias: string[] = [];
      try { dias = JSON.parse((v.dias_disponibles as string) || '[]'); } catch { dias = []; }
      if (dias.length === 0) return true; // sin restricción del propietario — mostrar
      return [...needed].every(d => dias.includes(d));
    });
  }

  // Boost de orden: vehículos con >80% de disponibilidad este mes aparecen primero
  // (mismo criterio de "alta disponibilidad" que ve el propietario en su calendario).
  vehiculos.sort((a, b) => {
    const altaA = tieneAltaDisponibilidadEsteMes(parseDias(a.dias_disponibles as string)) ? 1 : 0;
    const altaB = tieneAltaDisponibilidadEsteMes(parseDias(b.dias_disponibles as string)) ? 1 : 0;
    return altaB - altaA;
  });

  return NextResponse.json({ vehiculos });
}

function parseDias(json: string | undefined): string[] {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'propietario') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const body = await req.json();
  const { marca, modelo, anio, tipo, ubicacion, valor_comercial, precio_ajuste_pct, descripcion,
          fotos, fotos_detalle, dias_disponibles, placa } = body;

  if (!marca || !modelo || !anio) {
    return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
  }

  // Precio automático de mercado: se deriva de la categoría + valor comercial (lib/precioMercado.ts).
  // El propietario no fija el precio a mano; se calcula solo. Si no dan valor comercial, queda 0
  // ("precio por asignar") y el equipo lo completa después.
  const segmento = segmentoValido(tipo);
  const valorComercial = Math.max(0, Number(valor_comercial) || 0);
  const ajuste = Number(precio_ajuste_pct) || 0;
  const precioAuto = precioMercadoSugerido(segmento, valorComercial, ajuste);

  const db = getDb();
  const result = await db.prepare(`
    INSERT INTO vehiculos
      (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion,
       fotos, fotos_detalle, dias_disponibles, placa, valor_comercial, precio_ajuste_pct, precio_manual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    user.id, marca, modelo, anio,
    segmento, ubicacion || 'Medellín',
    precioAuto, descripcion || '',
    fotos || '[]',
    fotos_detalle || '{}',
    dias_disponibles || '[]',
    (placa || '').toString().toUpperCase().trim(),
    valorComercial, ajuste,
  );

  try {
    await enviarCorreo(user.correo, 'Publicaste un vehículo en RentDrive',
      `Hola ${user.nombre.split(' ')[0]}, tu ${marca} ${modelo} ${anio} quedó publicado en RentDrive. ` +
      'Nuestro equipo revisará los documentos y activará el precio antes de que empiece a recibir reservas.');
  } catch (e) {
    console.error('[vehiculos] No se pudo enviar el correo de confirmación:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
}
