import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { obtenerOCrearConversacion, cargarHistorialSoporte, responderMensajeSoporte } from '@/lib/soporte-agente';
import { tieneClaveAnthropic } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';

// GET — propietario/usuario: su propia conversación con historial.
//       admin: lista de todas las conversaciones de soporte.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();

  // Rama de administración (bandeja completa de soporte) -> exige la sección.
  if (user.rol === 'admin') {
    if (!adminTieneArea(db, user.id, 'soporte')) return sinPermisoArea();
    const conversaciones = db.prepare(`
      SELECT c.*, u.nombre AS solicitante_nombre, u.correo AS solicitante_correo,
        (SELECT contenido FROM mensajes_soporte WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1) AS ultimo_mensaje,
        (SELECT created_at FROM mensajes_soporte WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1) AS ultimo_at
      FROM conversaciones_soporte c JOIN usuarios u ON c.solicitante_id = u.id
      ORDER BY c.actualizado_en DESC
    `).all();
    return NextResponse.json({ conversaciones });
  }

  if (user.rol !== 'propietario' && user.rol !== 'usuario') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const conv = obtenerOCrearConversacion(user.id, user.rol);
  const mensajes = db.prepare(
    'SELECT id, remitente_tipo, remitente_admin_id, contenido, created_at FROM mensajes_soporte WHERE conversacion_id = ? ORDER BY id ASC'
  ).all(conv.id);

  return NextResponse.json({ conversacion: conv, mensajes, ia_disponible: tieneClaveAnthropic() });
}

function notificarAdmins(db: ReturnType<typeof getDb>, convId: number, nombre: string, rol: string, motivo: string) {
  const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin'").all() as { id: number }[];
  const titulo = '🆘 Chat de soporte necesita intervención';
  const mensaje = `${nombre} (${rol}) tiene una duda que el asistente no pudo resolver: ${motivo || 'sin detalle'}`;
  const insN = db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)');
  for (const a of admins) insN.run(a.id, 'soporte_escalado', titulo, mensaje, convId, 'soporte');
}

// POST — el propio solicitante envía un mensaje; corre el asistente y guarda ambos lados.
//        Si es admin y manda { solicitante_id }, INICIA una conversación con ese
//        propietario/usuario (queda escalada = atención humana) y lo notifica.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  // Solicitud estructurada de reajuste de precio (Punto 3 — el propietario no puede
  // editar el precio directamente, ver lib/precioMercado.ts). Se salta al asistente
  // de IA a propósito: es una solicitud de negocio concreta que SIEMPRE debe llegar
  // a un humano, no algo que el bot deba intentar responder o filtrar. Reutiliza el
  // mismo chat de soporte propietario↔DrivePass (conversaciones_soporte) en vez de un
  // endpoint nuevo de "cambiar precio" — un admin la revisa y ajusta a mano si aplica.
  if (user.rol === 'propietario' && body.tipo === 'reajuste_precio') {
    const vehiculoId = Number(body.vehiculo_id);
    if (!vehiculoId) return NextResponse.json({ error: 'Falta el vehículo.' }, { status: 400 });
    const veh = db.prepare('SELECT id, propietario_id, marca, modelo, anio, placa, precio_dia FROM vehiculos WHERE id = ?')
      .get(vehiculoId) as { id: number; propietario_id: number; marca: string; modelo: string; anio: number; placa?: string; precio_dia: number } | undefined;
    if (!veh || veh.propietario_id !== user.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const conv = obtenerOCrearConversacion(user.id, user.rol);
    const vLabel = `${veh.marca} ${veh.modelo} ${veh.anio}${veh.placa ? ` (${veh.placa})` : ''}`;
    const comentario = String(body.mensaje || '').trim().slice(0, 500);
    const contenido = `⚖️ Solicitud de reajuste de precio para ${vLabel}. Precio actual: $${veh.precio_dia.toLocaleString('es-CO')}/día.`
      + (comentario ? ` Comentario del propietario: ${comentario}` : '');

    db.prepare('INSERT INTO mensajes_soporte (conversacion_id, remitente_tipo, contenido) VALUES (?, ?, ?)')
      .run(conv.id, 'solicitante', contenido);
    const motivo = `Reajuste de precio para ${vLabel} (actual $${veh.precio_dia.toLocaleString('es-CO')}/día)`;
    db.prepare("UPDATE conversaciones_soporte SET estado = 'escalada', motivo_escalada = ?, actualizado_en = datetime('now','localtime') WHERE id = ?")
      .run(motivo, conv.id);
    notificarAdmins(db, conv.id, user.nombre, user.rol, motivo);

    return NextResponse.json({ ok: true, conversacion_id: conv.id });
  }

  const texto = String(body.mensaje || '').trim().slice(0, 2000);
  if (!texto) return NextResponse.json({ error: 'Escribe un mensaje.' }, { status: 400 });

  // Admin inicia (o retoma) una conversación con un propietario/usuario.
  if (user.rol === 'admin') {
    if (!adminTieneArea(db, user.id, 'soporte')) return sinPermisoArea();
    const solicitanteId = Number(body.solicitante_id);
    if (!solicitanteId) return NextResponse.json({ error: 'Falta el destinatario.' }, { status: 400 });
    const destino = db.prepare("SELECT id, nombre, rol FROM usuarios WHERE id = ?").get(solicitanteId) as { id: number; nombre: string; rol: string } | undefined;
    if (!destino || (destino.rol !== 'propietario' && destino.rol !== 'usuario')) {
      return NextResponse.json({ error: 'Solo puedes escribirle a un propietario o cliente.' }, { status: 400 });
    }
    const conv = obtenerOCrearConversacion(destino.id, destino.rol as 'propietario' | 'usuario');
    db.prepare('INSERT INTO mensajes_soporte (conversacion_id, remitente_tipo, remitente_admin_id, contenido) VALUES (?, ?, ?, ?)')
      .run(conv.id, 'admin', user.id, texto);
    db.prepare("UPDATE conversaciones_soporte SET estado = 'escalada', actualizado_en = datetime('now','localtime') WHERE id = ?").run(conv.id);
    db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(destino.id, 'soporte_respuesta', '💬 Mensaje de soporte de DrivePass', 'Un administrador de DrivePass te escribió por el chat de soporte.', conv.id, 'soporte');
    return NextResponse.json({ ok: true, conversacion_id: conv.id });
  }

  if (user.rol !== 'propietario' && user.rol !== 'usuario') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const conv = obtenerOCrearConversacion(user.id, user.rol);

  db.prepare('INSERT INTO mensajes_soporte (conversacion_id, remitente_tipo, contenido) VALUES (?, ?, ?)')
    .run(conv.id, 'solicitante', texto);

  // Si ya está escalada, un humano la está atendiendo — no dejamos que la IA responda encima.
  if (conv.estado === 'escalada') {
    db.prepare("UPDATE conversaciones_soporte SET actualizado_en = datetime('now','localtime') WHERE id = ?").run(conv.id);
    return NextResponse.json({ ok: true, escalada: true, respuesta: null });
  }

  if (!tieneClaveAnthropic()) {
    const respuesta = 'Gracias por tu mensaje. El asistente automático todavía no está activado — un administrador lo va a revisar pronto.';
    const motivo = 'El asistente de IA no está configurado (falta ANTHROPIC_API_KEY).';
    db.prepare('INSERT INTO mensajes_soporte (conversacion_id, remitente_tipo, contenido) VALUES (?, ?, ?)').run(conv.id, 'ia', respuesta);
    db.prepare("UPDATE conversaciones_soporte SET estado = 'escalada', motivo_escalada = ?, actualizado_en = datetime('now','localtime') WHERE id = ?")
      .run(motivo, conv.id);
    notificarAdmins(db, conv.id, user.nombre, user.rol, motivo);
    return NextResponse.json({ ok: true, escalada: true, respuesta });
  }

  const historial = cargarHistorialSoporte(conv.id);
  let resultado;
  try {
    resultado = await responderMensajeSoporte({ id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol }, texto, historial);
  } catch (e) {
    console.error('[soporte] Error del asistente:', e instanceof Error ? e.message : e);
    resultado = { respuesta: 'Tuve un problema respondiendo — un administrador va a revisar tu mensaje pronto.', escalar: true, motivo: 'Error técnico del asistente.' };
  }

  db.prepare('INSERT INTO mensajes_soporte (conversacion_id, remitente_tipo, contenido) VALUES (?, ?, ?)')
    .run(conv.id, 'ia', resultado.respuesta);

  if (resultado.escalar) {
    db.prepare("UPDATE conversaciones_soporte SET estado = 'escalada', motivo_escalada = ?, actualizado_en = datetime('now','localtime') WHERE id = ?")
      .run(resultado.motivo || '', conv.id);
    notificarAdmins(db, conv.id, user.nombre, user.rol, resultado.motivo || '');
  } else {
    db.prepare("UPDATE conversaciones_soporte SET actualizado_en = datetime('now','localtime') WHERE id = ?").run(conv.id);
  }

  return NextResponse.json({ ok: true, escalada: resultado.escalar, respuesta: resultado.respuesta });
}
