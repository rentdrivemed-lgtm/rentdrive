import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { guardArea } from '@/lib/guard';
import {
  registrarAuditoria, normalizarNivel, esNivel, NIVEL_LABEL,
  AREAS_ASIGNABLES, AREA_NO_ASIGNABLE, areaLabel, esAreaAsignable,
  parsePermisosExtra, serializarPermisosExtra, fusionarPermisosExtra,
  type PermisosExtraDelta,
} from '@/lib/permisos';
import { eliminarUsuarioInteligente } from '@/lib/eliminar';
import { mapaDocumentos } from '@/lib/documentos-ref';

export async function GET() {
  const g = await guardArea('usuarios');
  if ('error' in g) return g.error;
  const { db } = g;
  const filas = db.prepare(`
    SELECT id, nombre, correo, rol, admin_nivel, permisos_extra, estado_cuenta, created_at,
           tipo_documento, documento_identidad, fecha_nacimiento,
           celular, celular_indicativo, direccion, ciudad, numero_licencia, contacto_emergencia,
           cedula_url, cedula_url_dorso,
           -- Documentos que hasta ahora NO llegaban al panel y por eso no se veían en
           -- ninguna pantalla: la licencia del perfil y, sobre todo, el CERTIFICADO
           -- BANCARIO del propietario, que se venía pidiendo como obligatorio y guardando
           -- sin que nadie pudiera abrirlo después. Van al mismo sitio que cedula_url, que
           -- ya viajaba por acá, y esta ruta ya exige el área usuarios.
           licencia_url, licencia_url_dorso, certificado_bancario_url,
           banco, numero_cuenta,
           -- Autorización para alquilar un solo día por la web (ver lib/reserva-core.ts).
           dia_suelto_autorizado, dia_suelto_autorizado_por_nombre, dia_suelto_autorizado_en, dia_suelto_motivo
    FROM usuarios
    ORDER BY created_at DESC
  `).all() as Array<Record<string, unknown>>;

  // Las direcciones de los documentos de identidad NO salen de aquí. Se leen para
  // saber cuáles existen y de qué tipo son, y se sustituyen por una REFERENCIA
  // (`usuario/<id>/<clave>`) que solo resuelve `/api/documentos/...` contra la sesión
  // de quien pide, dejando cada apertura en la bitácora.
  //
  // Por qué justo en esta respuesta: es la de mayor alcance. La consume todo el
  // equipo con la sección «Usuarios», y de ella salían las URLs públicas y eternas
  // que terminaban pegadas en WhatsApp o en el historial del navegador.
  const usuarios = filas.map(u => {
    const documentos_id = mapaDocumentos('usuario', u.id, {
      cedula_frente:        u.cedula_url,
      cedula_dorso:         u.cedula_url_dorso,
      licencia_frente:      u.licencia_url,
      licencia_dorso:       u.licencia_url_dorso,
      certificado_bancario: u.certificado_bancario_url,
    });
    const {
      cedula_url: _a, cedula_url_dorso: _b, licencia_url: _c, licencia_url_dorso: _d,
      certificado_bancario_url: _e, ...resto
    } = u;
    void _a; void _b; void _c; void _d; void _e;
    return { ...resto, documentos_id };
  });

  return NextResponse.json({ usuarios });
}

// Crear una cuenta de equipo (rol='admin' con un nivel: socio / secretaria / principal).
export async function POST(req: NextRequest) {
  const g = await guardArea('usuarios_gestion');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const nombre = String(body.nombre || '').trim().slice(0, 120);
  const correo = String(body.correo || '').trim().toLowerCase();
  const password = String(body.password || '');
  const adminNivel = normalizarNivel(body.admin_nivel);

  if (!nombre) return NextResponse.json({ error: 'Falta el nombre.' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return NextResponse.json({ error: 'Correo inválido.' }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });

  const existe = db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo);
  if (existe) return NextResponse.json({ error: 'Ya existe una cuenta con ese correo.' }, { status: 409 });

  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare(
    "INSERT INTO usuarios (nombre, correo, password, rol, admin_nivel, estado_cuenta) VALUES (?, ?, ?, 'admin', ?, 'activa')"
  ).run(nombre, correo, hash, adminNivel);
  const id = Number(info.lastInsertRowid);

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'usuarios', accion: 'crear_cuenta_equipo', entidad: 'usuario', entidad_id: id,
    detalle: `Creó a ${nombre} (${correo}) como ${NIVEL_LABEL[adminNivel]}`,
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const g = await guardArea('usuarios_gestion');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json() as { id?: number; estado_cuenta?: string; nueva_contrasena?: string; admin_nivel?: string; permisos_extra?: unknown; accion?: string };
  const { id, estado_cuenta, nueva_contrasena, admin_nivel, accion } = body;
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const objetivo = db.prepare('SELECT id, nombre, correo, rol, admin_nivel, permisos_extra, estado_cuenta FROM usuarios WHERE id = ?').get(id) as
    { id: number; nombre: string; correo: string; rol: string; admin_nivel: string; permisos_extra?: string; estado_cuenta: string } | undefined;
  if (!objetivo) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  // ── Desarchivar ── (única forma de sacar una cuenta de 'archivada'; ver DELETE más abajo
  // para cómo entra a ese estado). Vuelve a 'inactiva' —NO directo a 'activa'— para que quien
  // gestiona el equipo decida conscientemente reactivar el acceso después, en vez de reabrir
  // sesión automáticamente para alguien que en su momento se decidió sacar del sistema.
  if (accion === 'desarchivar') {
    if (objetivo.estado_cuenta !== 'archivada') {
      return NextResponse.json({ error: 'Esta cuenta no está archivada.' }, { status: 400 });
    }
    db.prepare("UPDATE usuarios SET estado_cuenta = 'inactiva' WHERE id = ?").run(id);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: 'desarchivar_cuenta', entidad: 'usuario', entidad_id: id,
      detalle: `Desarchivó a ${objetivo.nombre} (${objetivo.correo}) — queda inactiva, pendiente de reactivar`,
    });
    return NextResponse.json({ ok: true, estado_cuenta: 'inactiva' });
  }

  if (nueva_contrasena) {
    if (nueva_contrasena.length < 6) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
    }
    const hash = await bcrypt.hash(nueva_contrasena, 12);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hash, id);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: 'resetear_clave', entidad: 'usuario', entidad_id: id,
      detalle: `Reseteó la contraseña de ${objetivo.nombre} (${objetivo.correo})`,
    });
    return NextResponse.json({ ok: true });
  }

  if (admin_nivel !== undefined) {
    if (objetivo.rol !== 'admin') return NextResponse.json({ error: 'El nivel solo aplica a cuentas de administración.' }, { status: 400 });
    if (!esNivel(admin_nivel)) return NextResponse.json({ error: 'Nivel inválido.' }, { status: 400 });
    if (objetivo.id === user.id && admin_nivel !== 'principal') {
      return NextResponse.json({ error: 'No puedes quitarte a ti mismo el nivel principal.' }, { status: 400 });
    }
    db.prepare('UPDATE usuarios SET admin_nivel = ? WHERE id = ?').run(admin_nivel, id);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: 'cambiar_nivel', entidad: 'usuario', entidad_id: id,
      detalle: `Cambió el nivel de ${objetivo.nombre} de ${NIVEL_LABEL[normalizarNivel(objetivo.admin_nivel)]} a ${NIVEL_LABEL[admin_nivel]}`,
    });
    return NextResponse.json({ ok: true });
  }

  // ── Permisos por empleado (casillas por sección) ───────────────────────────
  // Guardas duras, en este orden:
  //  1) solo cuentas rol='admin' reciben excepciones (nunca clientes ni propietarios);
  //  2) nadie edita sus propias excepciones (aunque la UI lo escondiera);
  //  3) `usuarios_gestion` se RECHAZA explícitamente (403) — es la raíz de confianza:
  //     quien la tuviera podría repartirse el resto de permisos y escalar a dueño;
  //  4) lista blanca estricta de áreas (solo claves de AREA_NIVELES) y valores booleanos.
  // Nota: llegar hasta aquí ya exige `usuarios_gestion`, que solo tiene el nivel
  // `principal` y que no es otorgable por casilla, así que el reparto de permisos
  // queda cerrado sobre el dueño.
  if (body.permisos_extra !== undefined) {
    if (objetivo.rol !== 'admin') {
      return NextResponse.json({ error: 'Los permisos por sección solo aplican a cuentas de administración.' }, { status: 400 });
    }
    if (objetivo.id === user.id) {
      return NextResponse.json({ error: 'No puedes cambiar tus propios permisos.' }, { status: 403 });
    }
    const payload = body.permisos_extra;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Formato de permisos inválido.' }, { status: 400 });
    }
    // El cliente manda un DELTA (solo las claves que tocó desde que abrió el panel),
    // no el mapa completo. `null` = quitar la excepción (volver al nivel).
    const delta: PermisosExtraDelta = {};
    for (const [clave, valor] of Object.entries(payload as Record<string, unknown>)) {
      if (clave === AREA_NO_ASIGNABLE) {
        return NextResponse.json({ error: 'La gestión del equipo no se puede asignar por casilla: es exclusiva del administrador principal.' }, { status: 403 });
      }
      if (!esAreaAsignable(clave)) {
        return NextResponse.json({ error: `Sección desconocida: ${clave}` }, { status: 400 });
      }
      if (valor !== null && typeof valor !== 'boolean') {
        return NextResponse.json({ error: `El valor de "${clave}" debe ser verdadero, falso o nulo (para quitar la excepción).` }, { status: 400 });
      }
      delta[clave] = valor as boolean | null;
    }

    // Se relee `permisos_extra` de la BD justo antes de escribir (dentro de una
    // transacción) y se fusiona el delta encima, en vez de reemplazar el mapa
    // completo con el draft que el navegador tenía en memoria. Así, si otra sesión
    // cambió una clave distinta del mismo empleado mientras esta editaba, ambos
    // cambios quedan aplicados (no se pisan entre sí).
    const fusionar = db.transaction((idObjetivo: number, cambios: PermisosExtraDelta) => {
      const fila = db.prepare('SELECT permisos_extra FROM usuarios WHERE id = ?').get(idObjetivo) as { permisos_extra?: string } | undefined;
      const actual = parsePermisosExtra(fila?.permisos_extra);
      const fusionado = fusionarPermisosExtra(actual, cambios);
      db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?').run(serializarPermisosExtra(fusionado), idObjetivo);
      return { antes: actual, despues: fusionado };
    });
    const { antes, despues } = fusionar(id, delta);

    const cambios = AREAS_ASIGNABLES.flatMap(area => {
      if (antes[area] === despues[area]) return [];
      if (despues[area] === undefined) return [`${areaLabel(area)}: vuelve al nivel`];
      return [`${areaLabel(area)}: ${despues[area] ? 'otorgado' : 'revocado'}`];
    });
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: 'cambiar_permisos', entidad: 'usuario', entidad_id: id,
      detalle: `Permisos por sección de ${objetivo.nombre} (${objetivo.correo}) — ${cambios.length ? cambios.join('; ') : 'sin cambios'}`,
    });
    return NextResponse.json({ ok: true, permisos_extra: despues });
  }

  if (estado_cuenta) {
    // 'archivada' NO se puede fijar por esta vía manual: solo es un resultado automático
    // de DELETE (eliminar inteligente, ver más abajo) o se revierte con accion:'desarchivar'.
    // Así el flujo de archivado queda siempre atado a la decisión "tiene historial de negocio".
    if (estado_cuenta !== 'activa' && estado_cuenta !== 'inactiva') {
      return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
    }
    if (objetivo.id === user.id && estado_cuenta === 'inactiva') {
      return NextResponse.json({ error: 'No puedes desactivar tu propia cuenta.' }, { status: 400 });
    }
    db.prepare('UPDATE usuarios SET estado_cuenta = ? WHERE id = ?').run(estado_cuenta, id);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'usuarios', accion: estado_cuenta === 'inactiva' ? 'desactivar_cuenta' : 'activar_cuenta', entidad: 'usuario', entidad_id: id,
      detalle: `${estado_cuenta === 'inactiva' ? 'Desactivó' : 'Activó'} a ${objetivo.nombre} (${objetivo.correo})`,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
}

// Eliminar una cuenta (borrado inteligente): si nunca tuvo actividad de negocio real
// (reservas, vehículos, pagos, chat, soporte, referidos, tarjetas NFC…) se borra de
// verdad; si sí la tuvo, queda archivada (reversible con PUT { accion: 'desarchivar' }).
// Exclusivo de `usuarios_gestion` — misma raíz de confianza que crear cuentas y cambiar
// niveles — sin excepción posible, y nadie puede eliminarse/archivarse a sí mismo.
export async function DELETE(req: NextRequest) {
  const g = await guardArea('usuarios_gestion');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  if (id === user.id) {
    return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta.' }, { status: 400 });
  }

  const objetivo = db.prepare('SELECT id, nombre, correo, estado_cuenta FROM usuarios WHERE id = ?').get(id) as
    { id: number; nombre: string; correo: string; estado_cuenta: string } | undefined;
  if (!objetivo) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const resultado = eliminarUsuarioInteligente(db, id);

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'usuarios',
    accion: resultado === 'borrado' ? 'eliminar_cuenta' : 'archivar_cuenta',
    entidad: 'usuario', entidad_id: id,
    detalle: resultado === 'borrado'
      ? `Eliminó (borrado real) a ${objetivo.nombre} (${objetivo.correo}) — sin historial de negocio`
      : `Archivó a ${objetivo.nombre} (${objetivo.correo}) — tiene historial de negocio, se conserva reversible`,
  });

  return NextResponse.json({ ok: true, resultado });
}
