import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { tieneAltaDisponibilidadEsteMes } from '@/lib/disponibilidad-reglas';
import { precioMercadoSugerido, segmentoValido } from '@/lib/precioMercado';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { perfilIncompleto, CODIGO_PERFIL_INCOMPLETO } from '@/lib/perfil';
import { documentosConUrlsValidas } from '@/lib/storage';

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
  const archivados   = searchParams.get('archivados') === '1';

  // Vista de archivados: exclusiva del admin con la sección "vehiculos" (ver lib/eliminar.ts).
  // Esta ruta es pública para el resto de casos, así que aquí sí hay que exigir sesión + permiso.
  if (archivados) {
    const user = await getCurrentUser();
    if (!user || user.rol !== 'admin' || !adminTieneArea(db, user.id, 'vehiculos')) return sinPermisoArea();
  }

  let query = `
    SELECT v.*, u.nombre as propietario_nombre
    FROM vehiculos v
    JOIN usuarios u ON v.propietario_id = u.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (archivados) {
    query += ' AND v.archivado = 1';
  } else {
    // Un vehículo archivado (tenía historial de negocio real al "eliminarlo") nunca debe
    // aparecer en ningún listado normal: ni público, ni panel de administración, ni el
    // propio dashboard del propietario. Solo la vista `archivados=1` de arriba lo muestra.
    query += ' AND v.archivado = 0';
  }

  if (tipo)         { query += ' AND v.tipo = ?';            params.push(tipo); }
  if (ubicacion)    { query += ' AND v.ubicacion LIKE ?';    params.push(`%${ubicacion}%`); }
  if (precioMax)    { query += ' AND v.precio_dia <= ?';     params.push(Number(precioMax)); }
  if (propietarioId){ query += ' AND v.propietario_id = ?';  params.push(Number(propietarioId)); }
  if (!archivados) {
    if (vitrina)      { query += ' AND v.en_vitrina = 1';      query += ' AND v.disponible = 1'; }
    // Listado público: ocultar vehículos inactivos. El propietario sí ve los suyos (filtra por propietarioId).
    else if (!propietarioId) query += ' AND v.disponible = 1';
  }

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

  // Gate real (server-side) de perfil completo — ver lib/perfil.ts.
  if (perfilIncompleto(user.id)) {
    return NextResponse.json(
      { error: 'Completa tu perfil antes de publicar un vehículo.', codigo: CODIGO_PERFIL_INCOMPLETO },
      { status: 403 },
    );
  }

  const body = await req.json();
  const { marca, modelo, anio, tipo, ubicacion, valor_comercial, precio_ajuste_pct, descripcion,
          fotos, fotos_detalle, dias_disponibles, placa, documentos } = body;

  if (!marca || !modelo || !anio) {
    return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
  }

  // Igual que en PUT /api/vehiculos/[id]: `documentos` debe contener SOLO URLs que
  // realmente vengan de nuestro storage (Cloudinary vía uploadFile(), ver lib/storage.ts) —
  // nunca un string arbitrario inventado por el cliente.
  if (!documentosConUrlsValidas(documentos)) {
    return NextResponse.json({ error: 'Documento inválido, vuelve a subirlo' }, { status: 400 });
  }

  // Precio automático de mercado: se deriva de la categoría + valor comercial (lib/precioMercado.ts).
  // El propietario no fija el precio a mano; se calcula solo. Si no dan valor comercial, queda 0
  // ("precio por asignar") y el equipo lo completa después.
  const segmento = segmentoValido(tipo);
  const valorComercial = Math.max(0, Number(valor_comercial) || 0);
  // Tope defensivo: `precio_ajuste_pct` está pensado para afinar +/- una demanda alta o baja
  // (ver comentario en lib/precioMercado.ts), no para desplazar el precio arbitrariamente.
  // precioMercadoSugerido ya recorta el resultado final al rango del segmento, pero acotar
  // también la entrada evita guardar en la BD un valor sin sentido (ej. -300%).
  const ajuste = Math.min(20, Math.max(-20, Number(precio_ajuste_pct) || 0));
  const precioAuto = precioMercadoSugerido(segmento, valorComercial, ajuste);

  // ── Documentos: reutiliza la tarjeta de propiedad ya subida para el atajo de IA ──
  // (ver app/api/vehiculos/extraer-matricula/route.ts): si el propietario usó ese atajo,
  // las fotos de frente/reverso YA se guardaron y sus URLs llegan acá en `documentos`, así
  // que no hay que pedirlas de nuevo en la sección de documentos del vehículo.
  let docsIniciales: Record<string, { url?: string; url_dorso?: string } | undefined> = {};
  try { docsIniciales = JSON.parse(documentos || '{}'); } catch { docsIniciales = {}; }
  const tieneDocumentoInicial = Object.values(docsIniciales).some(d => d?.url);
  // Igual que en el PUT: si llega al menos un documento ya en la creación, arranca "en
  // revisión" (no "sin_documentos") y se avisa al equipo, en vez de esperar a que el
  // propietario vuelva a tocar el vehículo para que se dispare ese aviso.
  const documentosEstadoInicial = tieneDocumentoInicial ? 'en_revision' : 'sin_documentos';

  const db = getDb();
  const result = await db.prepare(`
    INSERT INTO vehiculos
      (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion,
       fotos, fotos_detalle, dias_disponibles, placa, valor_comercial, precio_ajuste_pct, precio_manual,
       disponible, documentos, documentos_estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    user.id, marca, modelo, anio,
    segmento, ubicacion || 'Medellín',
    precioAuto, descripcion || '',
    fotos || '[]',
    fotos_detalle || '{}',
    dias_disponibles || '[]',
    (placa || '').toString().toUpperCase().trim(),
    valorComercial, ajuste,
    documentos || '{}', documentosEstadoInicial,
  );

  // Aviso al equipo, mismo criterio que el PUT cuando el propietario sube documentos por
  // primera vez (ver app/api/vehiculos/[id]/route.ts).
  if (tieneDocumentoInicial) {
    const adminRow = db.prepare("SELECT id FROM usuarios WHERE rol='admin' LIMIT 1").get() as { id: number } | undefined;
    if (adminRow) {
      const vLabel = `${marca} ${modelo} ${anio}${placa ? ` (${(placa as string).toUpperCase()})` : ''}`;
      db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(adminRow.id, 'documentos_subidos', '📄 Documentos pendientes de revisión',
          `${user.nombre} subió documentos para ${vLabel}`, Number(result.lastInsertRowid), 'vehiculo');
    }
  }

  try {
    await enviarCorreo(user.correo, 'Publicaste un vehículo en RentDrive',
      `Hola ${user.nombre.split(' ')[0]}, tu ${marca} ${modelo} ${anio} quedó publicado en RentDrive. ` +
      'Nuestro equipo revisará los documentos y activará el precio antes de que empiece a recibir reservas.');
  } catch (e) {
    console.error('[vehiculos] No se pudo enviar el correo de confirmación:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
}
