import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { enviarCorreo } from '@/lib/email';
import { generarCotizacion } from '@/lib/contabilidad';
import { consumirCreditos } from '@/lib/referidos';
import { perfilIncompleto, CODIGO_PERFIL_INCOMPLETO } from '@/lib/perfil';
import { mapaDocumentos } from '@/lib/documentos-ref';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { correoNoVerificado, CODIGO_CORREO_NO_VERIFICADO } from '@/lib/verificacion-correo';
import { vinculacionAlDia } from '@/lib/contratos-vinculacion';
import { CODIGO_VINCULACION_PENDIENTE } from '@/lib/contratos-vinculacion-texto';
import { esMetodoPagoWeb } from '@/lib/metodo-pago-web';
import { obtenerTokensAceptacion, crearFuentePago, crearTransaccion, esperarResultadoTransaccion, anularTransaccion } from '@/lib/pagos';
// Reglas de negocio compartidas con la vía de mostrador (POST /api/admin/reservas).
// Ver lib/reserva-core.ts: ahí viven mínimo de noches, documentos (incluido el
// contraste del pasaporte contra el tipo de documento registrado), lugares,
// vehículo reservable, solapamiento, calendario del propietario, datos de la
// operación, cobro e INSERT. Esta ruta conserva TODO lo que es propio de ella
// (solo rol 'usuario', gates de correo verificado y perfil completo, cobro
// inmediato con Wompi justo antes de insertar, y correo de "solicitud recibida").
import {
  validarNochesMinimasCliente, consumirAutorizacionDiaSuelto, validarFormatoFechas, MIN_NOCHES_POR_VIA, validarDocumentosReserva, resolverDocumentosIdentidad, validarLugaresReserva,
  cargarVehiculoReservable, validarDisponibilidadFechas,
  leerPerfilOperacion, urlsDocumentosGuardadas, resolverDatosOperacion, guardarDatosOperacionEnPerfil,
  precargarDocumentosEnPerfil, calcularCobroReserva, insertarReserva,
} from '@/lib/reserva-core';

export const dynamic = 'force-dynamic';

type ReservaRow = {
  id: number; vehiculo_id: number; usuario_id: number;
  marca: string; modelo: string; anio: number; tipo: string; precio_dia: number;
  propietario_id: number; usuario_nombre: string; usuario_correo: string;
  propietario_nombre: string; fecha_inicio: string; fecha_fin: string;
  total: number; estado: string; pago_estado: string;
  // Llegan en el `SELECT r.*` y NO salen en la respuesta: se convierten en
  // referencias (`documentos_id`). Ver más abajo.
  documento_id_url?: string | null; documento_id_url_dorso?: string | null;
  licencia_url?: string | null; licencia_url_dorso?: string | null;
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

  const filas = db.prepare(query).all(...params) as ReservaRow[];

  // Documentos de identidad del cliente: la fila los trae (es un `SELECT r.*`), pero
  // sus DIRECCIONES no salen de aquí. Se sustituyen por una referencia por documento
  // (`reserva/<id>/<clave>`) que solo resuelve /api/documentos/... contra la sesión de
  // quien pide, y que deja cada apertura en la bitácora.
  //
  // Esta respuesta la reciben TRES roles distintos (el cliente, el propietario del
  // vehículo y el equipo con la sección «Reservas»); era, junto con la de usuarios, la
  // otra vía por la que una cédula pública salía de la aplicación.
  const reservas = filas.map(r => {
    const documentos_id = mapaDocumentos('reserva', r.id, {
      documento_frente: r.documento_id_url,
      documento_dorso:  r.documento_id_url_dorso,
      licencia_frente:  r.licencia_url,
      licencia_dorso:   r.licencia_url_dorso,
    });
    const {
      documento_id_url: _a, documento_id_url_dorso: _b, licencia_url: _c, licencia_url_dorso: _d,
      ...resto
    } = r as ReservaRow & Record<string, unknown>;
    void _a; void _b; void _c; void _d;
    return { ...resto, documentos_id };
  });

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

/**
 * Cuántas solicitudes puede tener un cliente a la vez sin pagar ni confirmar.
 *
 * Existe desde que se puede reservar en efectivo: una reserva pendiente bloquea el
 * vehículo en el calendario, y sin cobro de por medio no había nada que impidiera a
 * una cuenta bloquear toda la flota. 3 es holgado para un cliente real (puede estar
 * comparando fechas o carros) y corta el abuso en seco.
 */
const MAX_RESERVAS_PENDIENTES_SIN_PAGAR = 3;

export async function POST(req: NextRequest) {
  // Mismo blindaje que el resto de rutas mutantes. Importa más desde que reservar ya
  // no exige token de tarjeta: sin él, un form cross-site podía crear reservas a
  // nombre de cualquiera que tuviera sesión abierta.
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

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
    metodo_pago, card_token,
  } = await req.json();
  if (!vehiculo_id || !fecha_inicio || !fecha_fin) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }
  // Cómo va a pagar el cliente. OJO, cambió con la pasarela: con 'tarjeta' SÍ se cobra
  // acá mismo y la reserva puede quedar `pago_estado: 'pagado'`; con 'efectivo' o
  // 'transferencia' no se pasa por Wompi y queda 'pendiente'. Un valor desconocido cae
  // a 'tarjeta', que es el comportamiento más exigente de los tres.
  const metodoPagoWeb = esMetodoPagoWeb(metodo_pago) ? metodo_pago : 'tarjeta';

  const documentosBody = {
    documento_id_url, documento_id_url_dorso, documento_es_pasaporte,
    licencia_url, licencia_url_dorso,
  };
  // El DORSO se valida más abajo (`resolverDocumentosIdentidad`): la exención por
  // pasaporte NO se puede creer del body, hay que contrastarla con el tipo de
  // documento que la persona tiene registrado, y para eso hace falta la BD.
  const errDocs = validarDocumentosReserva(documentosBody);
  if (errDocs) return NextResponse.json({ error: errDocs.error }, { status: errDocs.status });
  if (!firma_contrato) return NextResponse.json({ error: 'Debes aceptar el contrato.' }, { status: 400 });
  // El token de la tarjeta SOLO se exige a quien eligió pagar con tarjeta. Quien paga
  // en efectivo o por transferencia no pasa por la pasarela: su reserva nace pendiente
  // de pago y la plata entra al recoger el vehículo. Antes se exigía siempre, y eso
  // dejaba sin poder reservar a todo el que no tuviera tarjeta.
  if (metodoPagoWeb === 'tarjeta' && !card_token) {
    return NextResponse.json({ error: 'Falta el token de la tarjeta.' }, { status: 400 });
  }

  const db = getDb();

  // ⚠️ FORMATO DE FECHAS — esto NO puede faltar acá. La vía pública nunca lo validó
  // (ver la nota de `validarFormatoFechas`): una fecha basura daba `noches = NaN`, y
  // como `NaN < 2` es `false`, se colaba por el mínimo de noches. Mientras el cobro con
  // tarjeta era obligatorio el daño se cortaba solo —`Math.round(NaN*100)` hacía fallar
  // la pasarela antes del INSERT—, pero desde que se puede pagar en efectivo esa barrera
  // ya no existe: la reserva entraba con `total` NULL (better-sqlite3 liga NaN como
  // NULL), saltándose el mínimo y bloqueando el vehículo. Mostrador ya lo validaba.
  const errFormato = validarFormatoFechas(fecha_inicio, fecha_fin);
  if (errFormato) return NextResponse.json({ error: errFormato.error }, { status: errFormato.status });

  // ── Tope de reservas pendientes sin pagar ──────────────────────────────
  // Una reserva `pendiente` YA bloquea el vehículo (el solapamiento y el calendario
  // público cuentan todo lo que no esté cancelado). Mientras el cobro con tarjeta era
  // obligatorio eso tenía un costo real; desde que se puede reservar en efectivo, una
  // sola cuenta podría sacar la flota entera del mercado en un bucle, gratis. El tope
  // es por CLIENTE y solo mira lo que sigue pendiente de pago y sin confirmar: quien
  // paga, o a quien le confirman la reserva, puede seguir reservando sin límite.
  const pendientesSinPagar = db.prepare(`
    SELECT COUNT(*) AS n FROM reservas
    WHERE usuario_id = ? AND estado = 'pendiente' AND pago_estado = 'pendiente'
  `).get(user.id) as { n: number };
  if ((Number(pendientesSinPagar?.n) || 0) >= MAX_RESERVAS_PENDIENTES_SIN_PAGAR) {
    return NextResponse.json({
      error: `Tienes ${MAX_RESERVAS_PENDIENTES_SIN_PAGAR} solicitudes de reserva sin pagar todavía. `
        + 'Espera a que las confirmemos o cancela alguna antes de pedir otra.',
    }, { status: 429 });
  }

  // Vía 'publica' = el mínimo real del negocio (MIN_NOCHES_RESERVA, hoy 2 noches).
  // Quien reserva por la web no tiene a nadie del equipo evaluando el caso, así que el
  // mínimo se mantiene salvo que a ESTE cliente el equipo le haya concedido antes una
  // autorización de día suelto (ver `minimoNochesPara`). La excepción permanente de 1
  // día sigue siendo solo del punto de atención (ver MIN_NOCHES_POR_VIA).
  const errNoches = validarNochesMinimasCliente(db, user.id, fecha_inicio, fecha_fin, 'publica');
  if (errNoches) return NextResponse.json({ error: errNoches.error }, { status: errNoches.status });

  // Contrato de vinculación firmado: sin él no se reserva. Solo frena a quien YA lo
  // tiene emitido y sin firmar — ver la nota de `vinculacionAlDia`, que explica por qué
  // las cuentas anteriores al módulo no quedan bloqueadas de golpe.
  if (!vinculacionAlDia(db, user.id, user.rol)) {
    return NextResponse.json({
      error: 'Antes de reservar tienes que firmar tu contrato de vinculación. Lo encuentras en tu perfil.',
      codigo: CODIGO_VINCULACION_PENDIENTE,
    }, { status: 409 });
  }

  // ── Datos de la operación que antes se pedían en el registro ──────────────
  // Se movieron acá para que crear la cuenta sea rápido: la dirección, la ciudad
  // y el contacto de emergencia solo hacen falta cuando de verdad hay un alquiler.
  // Solo se le piden a quien todavía no los tiene guardados (p. ej. de una reserva
  // anterior); si ya están en su perfil, se usan esos y no se vuelve a preguntar.
  // La misma lectura trae `tipo_documento`, que es lo que hace falta para el dorso.
  const perfil = leerPerfilOperacion(db, user.id);

  // ── Dorso del documento de identidad (obligatorio) ────────────────────────
  // La única excepción legítima es el pasaporte, que no tiene dorso (solo la
  // página con la foto). Pero `documento_es_pasaporte` lo manda el CLIENTE: si se
  // le cree sin más, cualquiera marca la casilla y se salta el dorso. Se contrasta
  // contra el `tipo_documento` que la persona tiene registrado en su perfil
  // (registro / completar-perfil), que es el único dato que ella no controla desde
  // este request. La opción NO se elimina: quien de verdad se registró con
  // pasaporte sigue pudiendo reservar sin dorso.
  //
  // La regla vive en lib/reserva-core.ts para que la vía de mostrador
  // (POST /api/admin/reservas) la aplique sobre SU titular con el mismo código, y
  // `documentos` (con el flag ya derivado del tipo REGISTRADO, no del body) es lo
  // único que aceptan `precargarDocumentosEnPerfil` e `insertarReserva`.
  // `urlsExentas`: los documentos que esta persona ya tenía guardados se aceptan tal
  // cual. /pago los precarga en el formulario, así que sin la exención una URL antigua
  // impediría reservar sobre un campo que la propia página rellenó.
  const identidad = resolverDocumentosIdentidad(documentosBody, perfil?.tipo_documento, {
    urlsExentas: urlsDocumentosGuardadas(db, user.id),
  });
  if ('error' in identidad) return NextResponse.json({ error: identidad.error.error }, { status: identidad.error.status });
  const documentos = identidad.documentos;

  // La mezcla perfil-guardado/body y la revalidación de datos legacy viven en
  // `resolverDatosOperacion` (lib/reserva-core.ts).
  const operacion = resolverDatosOperacion(perfil, {
    direccion, ciudad, emergencia_nombre, emergencia_tel,
  });
  if ('error' in operacion) return NextResponse.json({ error: operacion.error.error }, { status: operacion.error.status });

  // `validarLugaresReserva` devuelve los lugares YA normalizados (campos recortados
  // y verificados como texto). De acá en adelante se usan esos y NO el objeto crudo
  // del body, para que el recargo que se cobra y el lugar que se guarda sean el
  // mismo dato que se validó.
  // `permitirPorDefecto`: si no eligió NINGUNO de los dos lugares, se toma el punto de
  // atención. La pantalla ya se lo propuso y lo aceptó antes de llegar acá (ver el
  // aviso de app/pago/page.tsx); esto es lo que lo hace válido también para una
  // petición que no pase por ella.
  const lugares = validarLugaresReserva(recogida, entrega, { permitirPorDefecto: true });
  if ('error' in lugares) return NextResponse.json({ error: lugares.error.error }, { status: lugares.error.status });
  const { recogida: recogidaL, entrega: entregaL } = lugares.lugares;

  const vehiculo = cargarVehiculoReservable(db, Number(vehiculo_id));
  if (!vehiculo) return NextResponse.json({ error: 'Vehículo no disponible' }, { status: 400 });

  const errFechas = validarDisponibilidadFechas(db, vehiculo, fecha_inicio, fecha_fin);
  if (errFechas) return NextResponse.json({ error: errFechas.error }, { status: errFechas.status });

  // Se guardan en el perfil para no volver a pedirlos en la próxima reserva.
  guardarDatosOperacionEnPerfil(db, user.id, operacion.datos);

  // Mismo espíritu: guarda también los documentos frescos de ESTA reserva en el
  // perfil, para que la PRÓXIMA ya venga precargada (ver lib/reserva-core.ts).
  // Decide con el `documento_es_pasaporte` YA contrastado: con el flag del body, un
  // pasaporte de verdad terminaba pisando la cédula guardada del usuario.
  precargarDocumentosEnPerfil(db, user.id, documentos);

  const { recargo, totalBruto } = calcularCobroReserva(db, vehiculo, fecha_inicio, fecha_fin, recogidaL, entregaL);

  // Créditos de referidos: se descuentan del servidor (nunca se confía en un monto
  // que mande el cliente), y solo hasta el saldo real disponible.
  const creditosUsados = usar_creditos ? consumirCreditos(db, user.id, totalBruto) : 0;
  const total = totalBruto - creditosUsados;

  // ── Cobro ───────────────────────────────────────────────────────────────
  //
  // Con TARJETA se cobra ANTES de insertar la reserva: si el banco rechaza, no se
  // crea nada. Con EFECTIVO o TRANSFERENCIA no hay nada que cobrar acá — la reserva
  // nace `pago_estado: 'pendiente'` y la plata entra al recoger el vehículo o por
  // consignación, como venía pasando antes de que existiera la pasarela.
  let fuentePagoId: number | undefined;
  let transaccionId = '';
  let pagoEstado: 'pagado' | 'pendiente' = 'pendiente';
  // Marca/últimos 4 salen de la respuesta de Wompi, no del navegador: desde que
  // el checkout usa su widget para tokenizar, nunca vemos el número de la
  // tarjeta como para derivarlos nosotros.
  let cardBrand = '';
  let cardLast4 = '';

  // Devuelve los créditos de referido que se consumieron arriba. Se llama en TODOS los
  // caminos de error del cobro: sin esto, un cliente con créditos al que el banco le
  // rechaza la tarjeta se quedaba sin reserva Y sin créditos.
  const devolverCreditos = () => {
    if (creditosUsados > 0) {
      try { db.prepare('UPDATE usuarios SET creditos_referido = creditos_referido + ? WHERE id = ?').run(creditosUsados, user.id); }
      catch (e) { console.error('[reservas] No se pudieron devolver los créditos:', e instanceof Error ? e.message : e); }
    }
  };

  // Total 0 (los créditos cubren todo, o todos los días son de pico y placa sin
  // recargo): no hay nada que cobrar. Se salta la pasarela, que rechaza un monto de 0
  // y devolvía un 502 quemando de paso los créditos del cliente.
  if (metodoPagoWeb === 'tarjeta' && total <= 0) {
    pagoEstado = 'pagado';
  } else if (metodoPagoWeb === 'tarjeta') {
    try {
      const { acceptanceToken, personalAuthToken } = await obtenerTokensAceptacion();
      const fuente = await crearFuentePago({
        token: card_token, correo: user.correo, acceptanceToken, personalAuthToken,
      });
      fuentePagoId = fuente.id;

      const transaccion = await crearTransaccion({
        montoEnCentavos: Math.round(total * 100),
        referencia: `alquiler-${user.id}-${Date.now()}`,
        correo: user.correo,
        acceptanceToken,
        fuentePagoId: fuente.id,
      });
      const final = transaccion.status === 'PENDING'
        ? await esperarResultadoTransaccion(transaccion.id)
        : transaccion;

      transaccionId = final.id;
      cardBrand = final.payment_method?.extra?.brand || '';
      cardLast4 = final.payment_method?.extra?.last_four || '';
      if (final.status === 'APPROVED') pagoEstado = 'pagado';
      else if (final.status === 'DECLINED' || final.status === 'ERROR' || final.status === 'VOIDED') {
        devolverCreditos();
        return NextResponse.json({ error: 'El pago fue rechazado. Verifica los datos de tu tarjeta e intenta de nuevo.' }, { status: 402 });
      }
      // Si sigue en PENDING tras esperar, dejamos pago_estado='pendiente' y el
      // webhook de Wompi confirmará el resultado final más adelante.
    } catch (e) {
      console.error('[pagos] Error al cobrar el alquiler:', e instanceof Error ? e.message : e);
      devolverCreditos();
      return NextResponse.json({ error: 'No se pudo procesar el pago con la pasarela. Intenta de nuevo.' }, { status: 502 });
    }
  }

  // El INSERT y el consumo de la autorización de día suelto van en la MISMA
  // transacción: si se consumiera aparte, dos peticiones simultáneas del mismo cliente
  // podrían pasar las dos la validación y gastar una sola autorización en dos reservas
  // de un día. El `WHERE dia_suelto_autorizado = 1` del UPDATE es lo que hace que solo
  // una de las dos gane.
  const noches = Math.ceil((new Date(fecha_fin).getTime() - new Date(fecha_inicio).getTime()) / 86400000);
  let autorizacionConsumida = false;
  let reservaId: number;
  try {
    reservaId = db.transaction(() => {
      const id = insertarReserva(db, {
        // Queda escrito que el lugar se asignó, no se eligió: si algún día alguien
        // reclama «yo nunca pedí recoger en San Joaquín», la reserva puede responder.
        lugaresPorDefecto: lugares.porDefecto,
        usuarioId: user.id,
        vehiculoId: Number(vehiculo_id),
        fechaInicio: fecha_inicio,
        fechaFin: fecha_fin,
        total,
        estado: 'pendiente',
        pagoEstado,
        documentos,
        firmaContrato: firma_contrato || '{}',
        recogida: recogidaL,
        entrega: entregaL,
        recargo,
        creditosUsados,
        metodoPago: metodoPagoWeb,
      });
      autorizacionConsumida = consumirAutorizacionDiaSuelto(db, user.id, id, noches, 'publica');
      // Si esta reserva estaba por debajo del mínimo, la autorización TIENE que haberse
      // consumido aquí. Que no se consuma significa que otra petición se la llevó entre
      // el chequeo de arriba y esta transacción: entonces esta reserva no tiene permiso y
      // se revierte entera. Sin esto, el «un solo uso» no era una garantía sino una
      // intención: la segunda petición se insertaba igual.
      if (noches < MIN_NOCHES_POR_VIA['publica'] && !autorizacionConsumida) {
        throw new Error('La autorización de día suelto ya fue utilizada.');
      }
      return id;
    })();
  } catch (e) {
    // El cobro ya se hizo y la reserva NO se pudo crear: lo peor que puede pasar acá.
    // Se anula la transacción en Wompi y se devuelven los créditos antes de responder,
    // para que el cliente no quede pagando algo que no existe. Antes, cualquier fallo
    // en este tramo devolvía un 500 con el cargo aprobado y sin anular.
    console.error('[reservas] Falló el INSERT tras el cobro:', e instanceof Error ? e.message : e);
    if (transaccionId) {
      try { await anularTransaccion(transaccionId); }
      catch (err) { console.error(`[pagos] ⚠️ NO se pudo anular la transacción ${transaccionId} — revisar a mano en Wompi:`, err instanceof Error ? err.message : err); }
    }
    devolverCreditos();
    const yaUsada = e instanceof Error && e.message.includes('autorización de día suelto');
    return NextResponse.json(
      { error: yaUsada ? 'La autorización para alquilar un día ya fue utilizada.' : 'No se pudo crear la reserva. Si te cobraron, el cargo fue anulado.' },
      { status: yaUsada ? 409 : 500 },
    );
  }

  if (autorizacionConsumida) {
    console.log(`[reservas] Reserva ${reservaId}: consumida la autorización de día suelto del usuario ${user.id}.`);
  }

  // `wompi_transaccion_id` es propio de esta vía (no existe en NuevaReserva /
  // insertarReserva, que también sirve al mostrador): se fija en un UPDATE aparte.
  if (transaccionId) {
    db.prepare('UPDATE reservas SET wompi_transaccion_id = ? WHERE id = ?').run(transaccionId, reservaId);
  }

  if (fuentePagoId) {
    db.prepare(`
      INSERT INTO fuentes_pago (usuario_id, wompi_fuente_id, marca, ultimos4)
      VALUES (?, ?, ?, ?)
    `).run(user.id, fuentePagoId, cardBrand, cardLast4);
  }

  try {
    await enviarCorreo(user.correo, 'Tu solicitud de reserva en RentDrive',
      `Hola ${user.nombre.split(' ')[0]}, recibimos tu solicitud de reserva del ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} ` +
      `del ${fecha_inicio} al ${fecha_fin} por $${total.toLocaleString('es-CO')}. Te avisamos apenas quede confirmada. ` +
      'Recuerda: cancelaciones con menos de 72h de anticipación tienen un cargo del 50%, y si no te presentas a la hora de recogida (con 3h de gracia) se cobra el 100%.');
  } catch (e) {
    console.error('[reservas] No se pudo enviar el correo de confirmación:', e instanceof Error ? e.message : e);
  }

  try {
    await generarCotizacion(db, reservaId, true);
  } catch (e) {
    console.error('[contabilidad] No se pudo generar la cotización:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ id: reservaId, total, recargo, creditos_usados: creditosUsados, pago_estado: pagoEstado }, { status: 201 });
}
