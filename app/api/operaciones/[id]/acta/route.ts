// Actas de respaldo de un servicio (ver lib/acta-servicio.ts).
//
//   GET  /api/operaciones/<id>/acta  → historial de respaldos de ese servicio
//   POST /api/operaciones/<id>/acta  → congela una versión NUEVA (no pisa la anterior)
//
// ⚠️ Permisos — SOLO ADMIN con la sección "operaciones" (mismo esquema que el resto
// del panel, `guardArea`). El mensajero NO puede descargar actas, ni siquiera de sus
// propios servicios, y es a propósito:
//   · Su acceso es un enlace sin contraseña (`/m/<token>`) que viaja por WhatsApp y no
//     caduca. El acta concentra en un solo archivo descargable el documento de
//     identidad del cliente, su celular, la dirección de entrega y el valor pagado —
//     mucha más superficie de fuga que el checklist operativo que sí necesita para
//     trabajar, y que ya tiene.
//   · El respaldo no lo necesita el mensajero para hacer el servicio: lo necesita el
//     dueño como constancia. No hay pérdida operativa al dejarlo fuera.
//   · Generar el acta queda así siempre atado a una identidad real de `usuarios`, que
//     es lo que la bitácora (`auditoria`) puede registrar; un token de mensajero no
//     identifica a una persona en ese sentido.
// El acta de CIERRE sí se genera sola cuando el mensajero termina su checklist, pero la
// dispara el servidor (actor 'sistema'), no una petición suya.
import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { generarActa, listarActas, resumenActa } from '@/lib/acta-servicio';

export const dynamic = 'force-dynamic';

function idDeRuta(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('operaciones');
  if ('error' in g) return g.error;
  const { db } = g;

  const { id } = await params;
  const opId = idDeRuta(id);
  if (opId === null) return NextResponse.json({ error: 'Servicio inválido' }, { status: 400 });

  const op = db.prepare('SELECT id FROM operaciones WHERE id = ?').get(opId);
  if (!op) return NextResponse.json({ error: 'Servicio no encontrado' }, { status: 404 });

  // Solo los metadatos: el PDF (y las fotos) se piden aparte, por acta.
  return NextResponse.json({ actas: listarActas(db, opId).map(resumenActa) });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('operaciones');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const { id } = await params;
  const opId = idDeRuta(id);
  if (opId === null) return NextResponse.json({ error: 'Servicio inválido' }, { status: 400 });

  const acta = generarActa(db, opId, { tipo: 'admin', id: user.id, nombre: user.nombre || user.correo || '' });
  if (!acta) return NextResponse.json({ error: 'Servicio no encontrado' }, { status: 404 });

  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'operaciones',
    accion: 'generar_acta_servicio',
    entidad: 'actas_servicio',
    entidad_id: acta.id,
    detalle: JSON.stringify({ operacion_id: opId, version: acta.version, fotos: acta.fotos.length }),
  });

  return NextResponse.json({ acta: resumenActa(acta) }, { status: 201 });
}
