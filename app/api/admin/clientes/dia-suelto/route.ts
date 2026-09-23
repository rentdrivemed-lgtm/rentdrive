// Autorización para que un cliente alquile UN SOLO DÍA por la web.
//
//   POST   /api/admin/clientes/dia-suelto   { usuario_id, motivo }  → conceder
//   DELETE /api/admin/clientes/dia-suelto   { usuario_id }          → retirar
//
// Por la web el mínimo son 2 noches (`MIN_NOCHES_POR_VIA` en lib/reserva-core.ts) y
// existe para evitar alquileres de un día pedidos a ciegas por internet. Esta ruta es
// la excepción que pidió el dueño: el equipo autoriza ANTES a un cliente concreto, y
// entonces ese cliente sí puede reservar un día suelto desde la app.
//
// La autorización es DE UN SOLO USO: se gasta al crear la reserva
// (`consumirAutorizacionDiaSuelto`, dentro de la transacción del INSERT).
//
// ── Por qué el área `usuarios` ──────────────────────────────────────────────
// Es la misma que gobierna la pestaña «Personas» del panel, que es donde vive el
// control: `principal` y `socio`, no secretaría.
//
// Se consideró `reservas` (que sí incluye a secretaría) con el argumento de que en el
// mostrador ella YA puede alquilar por un día sin pedir permiso
// (`MIN_NOCHES_POR_VIA.mostrador = 1`). No es equivalente: en el mostrador tiene al
// cliente enfrente, ve el documento y cobra. Esto otro habilita al cliente a reservar
// un día suelto SOLO, desde la web y cuando quiera, sin nadie delante — que es
// exactamente el caso que el mínimo de 2 noches existe para evitar.
//
// Si se decide que secretaría también pueda autorizar, basta cambiar el área a
// 'reservas' en los dos verbos de este archivo Y la de la pestaña que lo muestra: con
// solo lo primero tendría el permiso por API pero ninguna pantalla donde usarlo.
import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { guardArea } from '@/lib/guard';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { registrarAuditoriaEstricta } from '@/lib/permisos';

const MAX_MOTIVO = 300;

type FilaCliente = {
  id: number; nombre: string; rol: string; estado_cuenta: string;
  dia_suelto_autorizado: number;
};

function leerCliente(db: Database.Database, id: number): FilaCliente | undefined {
  return db.prepare('SELECT id, nombre, rol, estado_cuenta, dia_suelto_autorizado FROM usuarios WHERE id = ?')
    .get(id) as FilaCliente | undefined;
}

export async function POST(req: NextRequest) {
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const g = await guardArea('usuarios');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({})) as { usuario_id?: unknown; motivo?: unknown };
  const usuarioId = Number(body.usuario_id);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });
  }
  const motivo = String(body.motivo ?? '').trim().slice(0, MAX_MOTIVO);
  if (!motivo) {
    // Se exige a propósito: una excepción a una regla del negocio sin motivo escrito no
    // se puede auditar después, y esta queda registrada a nombre de quien la concede.
    return NextResponse.json({ error: 'Escribe por qué se autoriza el alquiler de un día.' }, { status: 400 });
  }

  const cliente = leerCliente(db, usuarioId);
  if (!cliente) return NextResponse.json({ error: 'El cliente no existe.' }, { status: 404 });
  if (cliente.rol !== 'usuario') {
    return NextResponse.json({ error: 'Solo se autoriza a cuentas de cliente.' }, { status: 409 });
  }
  if (cliente.estado_cuenta !== 'activa') {
    return NextResponse.json({ error: 'La cuenta del cliente no está activa.' }, { status: 409 });
  }
  if (Number(cliente.dia_suelto_autorizado) === 1) {
    return NextResponse.json({ ok: true, ya_tenia: true, cliente: { id: cliente.id, nombre: cliente.nombre } });
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE usuarios
         SET dia_suelto_autorizado = 1,
             dia_suelto_autorizado_por = ?,
             dia_suelto_autorizado_por_nombre = ?,
             dia_suelto_autorizado_en = datetime('now', 'localtime'),
             dia_suelto_motivo = ?
       WHERE id = ?
    `).run(user.id, user.nombre || '', motivo, usuarioId);

    registrarAuditoriaEstricta(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
      area: 'usuarios', accion: 'autorizar_dia_suelto', entidad: 'usuario', entidad_id: usuarioId,
      detalle: `Autorizó a ${cliente.nombre} (#${usuarioId}) a alquilar por un día · ${motivo}`,
    });
  })();

  return NextResponse.json({ ok: true, ya_tenia: false, cliente: { id: cliente.id, nombre: cliente.nombre } });
}

export async function DELETE(req: NextRequest) {
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const g = await guardArea('usuarios');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({})) as { usuario_id?: unknown };
  const usuarioId = Number(body.usuario_id);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });
  }

  const cliente = leerCliente(db, usuarioId);
  if (!cliente) return NextResponse.json({ error: 'El cliente no existe.' }, { status: 404 });
  if (Number(cliente.dia_suelto_autorizado) !== 1) {
    return NextResponse.json({ ok: true, no_tenia: true });
  }

  db.transaction(() => {
    db.prepare("UPDATE usuarios SET dia_suelto_autorizado = 0, dia_suelto_motivo = '' WHERE id = ?").run(usuarioId);
    registrarAuditoriaEstricta(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
      area: 'usuarios', accion: 'retirar_dia_suelto', entidad: 'usuario', entidad_id: usuarioId,
      detalle: `Retiró la autorización de alquiler por un día a ${cliente.nombre} (#${usuarioId})`,
    });
  })();

  return NextResponse.json({ ok: true, no_tenia: false });
}
