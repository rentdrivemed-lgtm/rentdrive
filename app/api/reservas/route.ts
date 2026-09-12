import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { esUrlDeStorageValida } from '@/lib/storage';
import { calcularRecargo, calcularDiasAlquiler, calcularTotalAlquiler, lugarValido, type Lugar } from '@/lib/lugares';
import { enviarCorreo } from '@/lib/email';
import { generarCotizacion } from '@/lib/contabilidad';
import { consumirCreditos } from '@/lib/referidos';
import { MIN_NOCHES_RESERVA } from '@/lib/disponibilidad-reglas';
import { validarDireccion, validarCiudad, validarNombreContacto, validarTelefonoContacto } from '@/lib/validacion';
import { perfilIncompleto, CODIGO_PERFIL_INCOMPLETO } from '@/lib/perfil';
import { correoNoVerificado, CODIGO_CORREO_NO_VERIFICADO } from '@/lib/verificacion-correo';

export const dynamic = 'force-dynamic';

type ReservaRow = {
  id: number; vehiculo_id: number; usuario_id: number;
  marca: string; modelo: string; anio: number; tipo: string; precio_dia: number;
  propietario_id: number; usuario_nombre: string; usuario_correo: string;
  propietario_nombre: string; fecha_inicio: string; fecha_fin: string;
  total: number; estado: string; pago_estado: string;
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const vehiculoId   = searchParams.get('vehiculoId');
  const estado       = searchParams.get('estado');
  const pagoEstado   = searchParams.get('pagoEstado');
  const fechaDesde   = searchParams.get('fechaDesde');
  const fechaHasta   = searchParams.get('fechaHasta');
  const busqueda     = searchParams.get('busqueda');

  let query = `
    SELECT r.*,
      v.marca, v.modelo, v.anio, v.tipo, v.precio_dia,
      v.propietario_id,
      u.nombre  AS usuario_nombre,
      u.correo  AS usuario_correo,
      p.nombre  AS propietario_nombre
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios  u ON r.usuario_id  = u.id
    JOIN usuarios  p ON v.propietario_id = p.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  // Ruta compartida: cliente ve SUS reservas, propietario las de SUS vehículos y el
  // admin las ve todas. Solo la rama de administración (la que no filtra por dueño)
  // exige la sección "reservas"; a cliente y propietario no se les cambia nada.
  if (user.rol === 'usuario') {
    query += ' AND r.usuario_id = ?';
    params.push(user.id);
  } else if (user.rol === 'propietario') {
    query += ' AND v.propietario_id = ?';
    params.push(user.id);
  } else if (!adminTieneArea(db, user.id, 'reservas')) {
    return sinPermisoArea();
  }

  if (vehiculoId)  { query += ' AND r.vehiculo_id = ?';         params.push(Number(vehiculoId)); }
  if (estado)      { query += ' AND r.estado = ?';              params.push(estado); }
  if (pagoEstado)  { query += ' AND r.pago_estado = ?';         params.push(pagoEstado); }
  if (fechaDesde)  { query += ' AND r.fecha_inicio >= ?';       params.push(fechaDesde); }
  if (fechaHasta)  { query += ' AND r.fecha_fin   <= ?';        params.push(fechaHasta); }
  if (busqueda) {
    query += ' AND (v.marca LIKE ? OR v.modelo LIKE ? OR u.nombre LIKE ?)';
    const like = `%${busqueda}%`;
    params.push(like, like, like);
  }

  query += ' ORDER BY r.fecha_inicio DESC';

  const reservas = db.prepare(query).all(...params) as ReservaRow[];

  const stats = {
    total:       reservas.length,
    ingresos:    reservas
                   .filter(r => r.estado !== 'cancelada')
                   .reduce((s, r) => s + Number(r.total), 0),
    confirmadas: reservas.filter(r => r.estado === 'confirmada').length,
    completadas: reservas.filter(r => r.estado === 'completada').length,
    canceladas:  reservas.filter(r => r.estado === 'cancelada').length,
  };

  return NextResponse.json({ reservas, stats });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'usuario') {
    return NextResponse.json({ error: 'Solo usuarios pueden reservar' }, { status: 403 });
  }

  // Gate real (server-side) de correo verificado — cuenta pendiente de activación
  // no puede reservar. Ver lib/verificacion-correo.ts (incluye el kill switch de
  // emailHabilitado()===false, así que si el correo no está configurado hoy este
  // gate no bloquea a nadie).
  if (correoNoVerificado(user.id)) {
    return NextResponse.json(
      { error: 'Verifica tu correo antes de reservar un vehículo.', codigo: CODIGO_CORREO_NO_VERIFICADO },
      { status: 403 },
    );
  }

  // Gate real (server-side) de perfil completo — cierra el hueco que deja el login
  // con Google (sin contraseña ni documento/fecha de nacimiento). Ver lib/perfil.ts.
  // codigo:'perfil_incompleto' es lo que el frontend usa para redirigir a
  // /completar-perfil en vez de solo mostrar un error genérico.
  if (perfilIncompleto(user.id)) {
    return NextResponse.json(
      { error: 'Completa tu perfil antes de reservar un vehículo.', codigo: CODIGO_PERFIL_INCOMPLETO },
      { status: 403 },
    );
  }

  const {
    vehiculo_id, fecha_inicio, fecha_fin,
    documento_id_url, documento_id_url_dorso, documento_es_pasaporte,
    licencia_url, licencia_url_dorso,
    firma_contrato, recogida, entrega, usar_creditos,
    direccion, ciudad, emergencia_nombre, emergencia_tel,
  } = await req.json();
  if (!vehiculo_id || !fecha_inicio || !fecha_fin) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }
  const nochesSolicitadas = Math.ceil((new Date(fecha_fin).getTime() - new Date(fecha_inicio).getTime()) / 86400000);
  if (nochesSolicitadas < MIN_NOCHES_RESERVA) {
    return NextResponse.json({ error: `El alquiler mínimo es de ${MIN_NOCHES_RESERVA} noches.` }, { status: 400 });
  }
  if (!documento_id_url) return NextResponse.json({ error: 'Debes subir tu documento de identidad.' }, { status: 400 });
  if (!documento_es_pasaporte && !documento_id_url_dorso) return NextResponse.json({ error: 'Falta el dorso de tu documento de identidad.' }, { status: 400 });
  if (!licencia_url || !licencia_url_dorso) return NextResponse.json({ error: 'Debes subir frente y dorso de tu licencia de conducción.' }, { status: 400 });
  if (!firma_contrato) return NextResponse.json({ error: 'Debes aceptar el contrato.' }, { status: 400 });

  const db = getDb();

  // ── Datos de la operación que antes se pedían en el registro ──────────────
  // Se movieron acá para que crear la cuenta sea rápido: la dirección, la ciudad
  // y el contacto de emergencia solo hacen falta cuando de verdad hay un alquiler.
  // Solo se le piden a quien todavía no los tiene guardados (p. ej. de una reserva
  // anterior); si ya están en su perfil, se usan esos y no se vuelve a preguntar.
  const perfil = db.prepare(
    'SELECT direccion, ciudad, contacto_emergencia FROM usuarios WHERE id = ?'
  ).get(user.id) as { direccion: string | null; ciudad: string | null; contacto_emergencia: string | null } | undefined;

  let emergenciaGuardada: { nombre?: string; telefono?: string } = {};
  try { emergenciaGuardada = JSON.parse(perfil?.contacto_emergencia || '{}') || {}; } catch { emergenciaGuardada = {}; }

  const txt = (v: unknown) => String(v ?? '').trim();

  // Usuarios legacy (registro viejo, casi sin validación) pueden tener guardado
  // un valor que las reglas ACTUALES rechazarían (p. ej. ciudad "a", teléfono
  // "300"). Priorizar "¿ya lo tiene guardado?" solo por truthiness los dejaría
  // atascados para siempre: nunca se les volvería a pedir el dato y no tienen
  // dónde corregirlo. Por eso se revalida el valor guardado con las MISMAS
  // reglas que se le exigirían hoy a un dato nuevo; si no pasa, se trata como si
  // no existiera (se pide al cliente y se puede sobrescribir con uno válido).
  const direccionGuardada = txt(perfil?.direccion);
  const direccionFinal = validarDireccion(direccionGuardada) === null ? direccionGuardada : txt(direccion);

  const ciudadGuardada = txt(perfil?.ciudad);
  const ciudadFinal = validarCiudad(ciudadGuardada) === null ? ciudadGuardada : txt(ciudad);

  const emNombreGuardado = txt(emergenciaGuardada.nombre);
  const emNombreFinal = validarNombreContacto(emNombreGuardado) === null ? emNombreGuardado : txt(emergencia_nombre);

  const emTelGuardado = txt(emergenciaGuardada.telefono).replace(/\D/g, '');
  const emTelEnviado = txt(emergencia_tel).replace(/\D/g, '');
  const emTelFinal = validarTelefonoContacto(emTelGuardado) === null ? emTelGuardado : emTelEnviado;

  const errDireccion = validarDireccion(direccionFinal);
  if (errDireccion) return NextResponse.json({ error: errDireccion }, { status: 400 });
  const errCiudad = validarCiudad(ciudadFinal);
  if (errCiudad) return NextResponse.json({ error: errCiudad }, { status: 400 });
  const errEmNombre = validarNombreContacto(emNombreFinal);
  if (errEmNombre) return NextResponse.json({ error: errEmNombre }, { status: 400 });
  const errEmTel = validarTelefonoContacto(emTelFinal);
  if (errEmTel) return NextResponse.json({ error: errEmTel }, { status: 400 });

  const recogidaL = recogida as Lugar | undefined;
  const entregaL  = entrega  as Lugar | undefined;
  if (!lugarValido(recogidaL)) return NextResponse.json({ error: 'Indica el lugar y la hora de recogida.' }, { status: 400 });
  if (!lugarValido(entregaL))  return NextResponse.json({ error: 'Indica el lugar y la hora de entrega.' }, { status: 400 });

  // `archivado = 0` explícito además de `disponible = 1`: un vehículo archivado ya
  // queda con `disponible = 0` al archivarse (ver lib/eliminar.ts), pero se valida
  // acá también en defensa en profundidad — nunca debe poder reservarse uno archivado.
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ? AND disponible = 1 AND archivado = 0').get(Number(vehiculo_id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'Vehículo no disponible' }, { status: 400 });

  const conflicto = db.prepare(`
    SELECT id FROM reservas
    WHERE vehiculo_id = ? AND estado NOT IN ('cancelada')
    AND NOT (fecha_fin < ? OR fecha_inicio > ?)
  `).get(Number(vehiculo_id), fecha_inicio, fecha_fin);
  if (conflicto) return NextResponse.json({ error: 'Vehículo no disponible en esas fechas' }, { status: 409 });

  const dispStr = (vehiculo.dias_disponibles as string) || '[]';
  let diasDisp: string[] = [];
  try { diasDisp = JSON.parse(dispStr); } catch { diasDisp = []; }

  if (diasDisp.length > 0) {
    const dispSet = new Set(diasDisp);
    const cur = new Date(fecha_inicio);
    const fin = new Date(fecha_fin);
    while (cur < fin) {
      const str = cur.toISOString().split('T')[0];
      if (!dispSet.has(str)) {
        return NextResponse.json({ error: `El día ${str} no está disponible` }, { status: 409 });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Se guardan en el perfil para no volver a pedirlos en la próxima reserva.
  db.prepare('UPDATE usuarios SET direccion = ?, ciudad = ?, contacto_emergencia = ? WHERE id = ?')
    .run(direccionFinal, ciudadFinal, JSON.stringify({ nombre: emNombreFinal, telefono: emTelFinal }), user.id);

  // Mismo espíritu: guarda también los documentos frescos de ESTA reserva en el
  // perfil (incluido el dorso, que el atajo de foto del registro nunca captura),
  // para que la PRÓXIMA reserva ya venga precargada (ver app/pago/page.tsx). Es
  // best-effort a propósito — si falla, no debe tumbar la creación de la reserva,
  // que es lo importante.
  //
  // Igual que en POST /api/auth/registro y /api/auth/completar-perfil: antes de
  // escribir a `usuarios` se exige que cada URL sea de verdad una subida nuestra
  // (Cloudinary bajo nuestro cloud_name) — sin esto, un cliente que arme el body a
  // mano (no vino de DocUpload/DocUploadDoble) podría inyectar una URL arbitraria
  // que quedara guardada como si fuera el documento del cliente. El `INSERT INTO
  // reservas` de abajo es preexistente y queda fuera de este alcance: solo se
  // filtra lo que entra al perfil del usuario.
  //
  // IMPORTANTE: el UPDATE se construye de forma DINÁMICA/CONDICIONAL (mismo
  // patrón que POST /api/auth/completar-perfil) — solo se toca cada columna
  // cuando el valor de ESTA reserva es válido Y aplica, para no pisar/perder un
  // documento bueno que el usuario ya tenía guardado de una reserva anterior:
  //   - Si en esta reserva el documento de identidad es un pasaporte
  //     (documento_es_pasaporte), NO se tocan cedula_url/cedula_url_dorso: son de
  //     un tipo de documento distinto (el pasaporte no tiene dorso — ver
  //     app/pago/page.tsx), así que pisarlos aquí borraría o mezclaría la cédula
  //     que el usuario sí tenía guardada.
  //   - Si NO es pasaporte, cedula_url/cedula_url_dorso se actualizan solo si la
  //     URL de esta reserva pasa esUrlDeStorageValida (si no, se deja el valor
  //     ya guardado tal cual, nunca se pisa con '').
  //   - licencia_url/licencia_url_dorso se actualizan siempre que la URL de esta
  //     reserva pase esUrlDeStorageValida (la licencia no depende del tipo de
  //     documento de identidad usado en esta reserva).
  const setsPerfil: string[] = [];
  const valoresPerfil: unknown[] = [];

  if (!documento_es_pasaporte) {
    if (typeof documento_id_url === 'string' && esUrlDeStorageValida(documento_id_url)) {
      setsPerfil.push('cedula_url = ?'); valoresPerfil.push(documento_id_url);
    }
    if (typeof documento_id_url_dorso === 'string' && esUrlDeStorageValida(documento_id_url_dorso)) {
      setsPerfil.push('cedula_url_dorso = ?'); valoresPerfil.push(documento_id_url_dorso);
    }
  }
  if (typeof licencia_url === 'string' && esUrlDeStorageValida(licencia_url)) {
    setsPerfil.push('licencia_url = ?'); valoresPerfil.push(licencia_url);
  }
  if (typeof licencia_url_dorso === 'string' && esUrlDeStorageValida(licencia_url_dorso)) {
    setsPerfil.push('licencia_url_dorso = ?'); valoresPerfil.push(licencia_url_dorso);
  }

  if (setsPerfil.length > 0) {
    try {
      valoresPerfil.push(user.id);
      db.prepare(`UPDATE usuarios SET ${setsPerfil.join(', ')} WHERE id = ?`).run(...valoresPerfil);
    } catch (e) {
      console.error('[reservas] No se pudo precargar los documentos en el perfil (best-effort, no bloquea la reserva):', e instanceof Error ? e.message : e);
    }
  }

  const dias = calcularDiasAlquiler(fecha_inicio, fecha_fin);
  const recargo = calcularRecargo(recogidaL, entregaL); // autoritativo: server-side
  const totalBruto = calcularTotalAlquiler(dias, Number(vehiculo.precio_dia), recargo);

  // Créditos de referidos: se descuentan del servidor (nunca se confía en un monto
  // que mande el cliente), y solo hasta el saldo real disponible.
  const creditosUsados = usar_creditos ? consumirCreditos(db, user.id, totalBruto) : 0;
  const total = totalBruto - creditosUsados;

  const result = db.prepare(`
    INSERT INTO reservas (
      usuario_id, vehiculo_id, fecha_inicio, fecha_fin, total, pago_estado, estado,
      documento_id_url, documento_id_url_dorso, documento_es_pasaporte,
      licencia_url, licencia_url_dorso,
      firma_contrato, recogida, entrega, recargo, creditos_usados
    )
    VALUES (?, ?, ?, ?, ?, 'pendiente', 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, Number(vehiculo_id), fecha_inicio, fecha_fin, total,
    documento_id_url || '', documento_id_url_dorso || '', documento_es_pasaporte ? 1 : 0,
    licencia_url || '', licencia_url_dorso || '',
    firma_contrato || '{}',
    JSON.stringify(recogidaL), JSON.stringify(entregaL), recargo, creditosUsados,
  );

  try {
    await enviarCorreo(user.correo, 'Tu solicitud de reserva en RentDrive',
      `Hola ${user.nombre.split(' ')[0]}, recibimos tu solicitud de reserva del ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} ` +
      `del ${fecha_inicio} al ${fecha_fin} por $${total.toLocaleString('es-CO')}. Te avisamos apenas quede confirmada. ` +
      'Recuerda: cancelaciones con menos de 72h de anticipación tienen un cargo del 50%, y si no te presentas a la hora de recogida (con 3h de gracia) se cobra el 100%.');
  } catch (e) {
    console.error('[reservas] No se pudo enviar el correo de confirmación:', e instanceof Error ? e.message : e);
  }

  try {
    await generarCotizacion(db, Number(result.lastInsertRowid), true);
  } catch (e) {
    console.error('[contabilidad] No se pudo generar la cotización:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ id: result.lastInsertRowid, total, recargo, creditos_usados: creditosUsados }, { status: 201 });
}
