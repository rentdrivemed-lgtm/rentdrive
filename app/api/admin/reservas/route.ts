import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { guardArea } from '@/lib/guard';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { registrarAuditoria } from '@/lib/permisos';
import { enviarCorreo } from '@/lib/email';
import { type Lugar, lugarResumen } from '@/lib/lugares';
import { validarCelular, validarDocumentoIdentidad, PAIS_TEL_DEFAULT } from '@/lib/validacion';
import { asignarCodigoReferido, consumirCreditos, procesarRecompensaReferido } from '@/lib/referidos';
import { procesarPagoConfirmado } from '@/lib/contabilidad';
import { generarCodigoCorreo, expiraEnMinutos, CODIGO_VIGENCIA_MIN } from '@/lib/verificacion-correo';
import { crearOperacionYNotificar, avisarPorChat } from '@/lib/reserva-confirmacion';
import {
  validarNochesMinimas, validarFormatoFechas, validarFechaInicioNoPasada,
  validarDocumentosReserva, resolverDocumentosIdentidad, urlsDocumentosGuardadas, validarLugaresReserva,
  cargarVehiculoReservable, validarDisponibilidadFechas,
  leerPerfilOperacion, resolverDatosOperacion, rellenarDatosOperacionFaltantes,
  precargarDocumentosEnPerfil, calcularCobroReserva, insertarReserva,
  esMetodoPago, ORIGEN_MOSTRADOR, METODOS_PAGO,
} from '@/lib/reserva-core';
import {
  camposDePerfilQueFaltan, motivoNoReservable, calcularEdad, CORREO_RE,
} from '@/lib/cliente-mostrador';
import { passwordAleatoria, generarTokenActivacion, enlaceActivacion, ACTIVACION_VIGENCIA_HORAS } from '@/lib/acceso-cliente';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// Reserva creada en el PUNTO DE ATENCIÓN ("mostrador")
// ═══════════════════════════════════════════════════════════════════════════
//
// El cliente llega físicamente, el empleado lo atiende, le recibe el pago y le
// entrega el carro. Esta ruta existe porque POST /api/reservas está cerrada a
// `rol === 'usuario'` a propósito (un admin reservando ahí quedaría como titular
// de la reserva) y NO se debilita: se abre una vía aparte, con su propio permiso.
//
// Permiso: sección "reservas" (`guardArea('reservas')`) = principal, socio y
// secretaria. El nivel `secretaria` se llama literalmente "Secretaría / punto de
// atención" (lib/permisos.ts): es exactamente este caso de uso.
//
// CSRF: SÍ se aplica `bloqueadoPorCsrf`, aunque las demás rutas de /api/admin no lo
// hagan. SameSite=Lax NO alcanza como única defensa acá:
//   · Lax protege contra otros SITIOS, no contra otros ORÍGENES del mismo sitio:
//     cualquier subdominio de drivepasscol.com (una landing, un preview, uno tomado)
//     es "same-site" y su POST sí lleva la cookie `token`. El chequeo de Origin sí lo
//     ataja.
//   · La otra capa de `bloqueadoPorCsrf` ni siquiera mira el Origin: exige
//     Content-Type: application/json. `req.json()` de Next parsea el body sin mirar
//     la cabecera, así que sin esto el endpoint aceptaba el bypass clásico de
//     JSON-CSRF vía <form enctype="text/plain">, que no dispara preflight.
// Esta ruta crea una reserva confirmada, pagada y facturada: es la de /api/admin con
// más consecuencias contables, así que es donde menos se justifica ahorrárselo.
//
// Toda la regla de negocio (mínimo de noches, documentos, lugares, vehículo
// reservable, solapamiento, calendario del propietario, cobro, INSERT) sale del
// mismo módulo que la vía pública: lib/reserva-core.ts. Donde el mostrador se
// aparta, lo hace pasando la vía a ese módulo (ver la diferencia 8), no con lógica
// propia.
//
// ── Diferencias deliberadas respecto a POST /api/reservas ───────────────────
//  1. `correoNoVerificado`: NO se exige. Ese gate existe para que una cuenta
//     autoregistrada por internet no reserve antes de probar que el correo es
//     suyo. En mostrador la identidad la verifica una persona del equipo con la
//     cédula física en la mano, que es una prueba más fuerte, no más débil. La
//     cuenta igual queda con `correo_verificado = 0` y su código pendiente: si
//     después reserva sola por la app, ahí sí se le exige.
//  2. `perfilIncompleto`: SÍ se exige (documento, fecha de nacimiento y
//     contraseña son necesarios para facturar y para la mayoría de edad), pero el
//     admin puede completarlo en la misma petición (`cliente_datos`), y la
//     contraseña la resuelve el servidor con un enlace de activación
//     (lib/acceso-cliente.ts) — si no, un cliente con cuenta creada por Google
//     quedaría sin forma de ser atendido en el mostrador.
//  3. `firma_contrato`: en mostrador no hay firma dentro de la app. Se exige que
//     el empleado marque que el cliente aceptó el contrato presencialmente y se
//     guarda una constancia con QUIÉN lo registró (ver `firmaDeMostrador`).
//  4. La reserva nace `confirmada` + `pagado` con el método de pago recibido, y
//     dispara los mismos efectos que una aprobación normal: contabilidad
//     (factura + liquidación + remisión), recompensa de referido y la operación
//     logística con su aviso al equipo.
//  5. Fechas: acá sí se valida el formato Y que la recogida no quede en el pasado
//     (la vía pública no hace ninguna de las dos; ver `validarFormatoFechas` y
//     `validarFechaInicioNoPasada` en lib/reserva-core.ts). El piso de fecha importa
//     porque esta vía factura de inmediato: sin él se podían fabricar alquileres
//     "pagados" del mes pasado.
//  6. URLs de documentos: ya NO es una diferencia. La exigencia de que sean subidas
//     nuestras vivía solo acá, así que por la vía pública entraba a `reservas`
//     cualquier cadena; ahora está dentro de `resolverDocumentosIdentidad` y rige las
//     dos vías. Lo que sigue siendo propio del mostrador es el contraste del
//     dorso/pasaporte contra el tipo de documento del CLIENTE titular, no del empleado.
//  7. Perfil del cliente: en la vía pública el titular es el propio usuario
//     autenticado, así que la reserva sobrescribe SU perfil sin problema. Acá el
//     titular lo elige el empleado (`usuario_id`), de modo que sobre una cuenta que
//     YA existía solo se RELLENA lo que estaba vacío — nunca se pisa un dato ni un
//     documento que el cliente ya tenía (ver `rellenarDatosOperacionFaltantes` y
//     `precargarDocumentosEnPerfil(..., { soloSiVacio })`), y si algo se completa
//     queda su propia entrada de auditoría.
//  8. Mínimo de noches: acá el mínimo es de 1 noche (alquiler de un solo día), no
//     las 2 de la web. Es una decisión del dueño y una excepción del punto de
//     atención: el empleado tiene al cliente enfrente, ve sus papeles y recibe el
//     pago, así que puede decidir caso por caso. `MIN_NOCHES_RESERVA` sigue intacto
//     y rigiendo la vía pública; la excepción está escrita en `MIN_NOCHES_POR_VIA`
//     (lib/reserva-core.ts), que es lo que decide el mínimo de cada vía.

type CuerpoClienteNuevo = {
  nombre?: unknown; correo?: unknown;
  tipo_documento?: unknown; documento_identidad?: unknown; fecha_nacimiento?: unknown;
  celular?: unknown; celular_indicativo?: unknown; numero_licencia?: unknown;
};

type FilaUsuario = {
  id: number; nombre: string; correo: string; rol: string; estado_cuenta: string;
  password: string | null;
  tipo_documento: string | null; documento_identidad: string | null; fecha_nacimiento: string | null;
};

const SELECT_USUARIO = `
  SELECT id, nombre, correo, rol, estado_cuenta, password,
         tipo_documento, documento_identidad, fecha_nacimiento
  FROM usuarios WHERE id = ?`;

const txt = (v: unknown) => String(v ?? '').trim();
const mal = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Constancia de aceptación presencial del contrato. Reemplaza a la firma que en la
 * app captura el propio cliente (app/pago/page.tsx). Deja explícito el modo y el
 * empleado que lo registró, para que una revisión posterior sepa que esa reserva no
 * tiene firma digital del titular sino aceptación en punto de atención.
 */
function firmaDeMostrador(
  clienteNombre: string, vehiculo: string, recogida?: Lugar | null, entrega?: Lugar | null,
  registradoPor?: { id: number; nombre: string; correo: string },
): string {
  return JSON.stringify({
    nombre: clienteNombre,
    fecha: new Date().toISOString(),
    modo: 'presencial',
    constancia: 'El cliente aceptó el contrato de alquiler en el punto de atención.',
    registrado_por: registradoPor
      ? { id: registradoPor.id, nombre: registradoPor.nombre, correo: registradoPor.correo }
      : null,
    vehiculo,
    recogida: lugarResumen(recogida),
    entrega: lugarResumen(entrega),
  });
}

export async function POST(req: NextRequest) {
  const csrfError = bloqueadoPorCsrf(req);
  if (csrfError) return csrfError;

  const g = await guardArea('reservas');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const vehiculoId = Number(body.vehiculo_id);
  const fechaInicio = txt(body.fecha_inicio);
  const fechaFin = txt(body.fecha_fin);
  if (!vehiculoId || !fechaInicio || !fechaFin) return mal('Faltan datos');

  // ── 1. Reglas de la reserva que no dependen del cliente ───────────────────
  const errFormato = validarFormatoFechas(fechaInicio, fechaFin);
  if (errFormato) return mal(errFormato.error, errFormato.status);

  const errPasado = validarFechaInicioNoPasada(fechaInicio);
  if (errPasado) return mal(errPasado.error, errPasado.status);

  // Vía 'mostrador': el mínimo de 2 noches NO aplica acá (excepción deliberada, ver
  // `MIN_NOCHES_POR_VIA` en lib/reserva-core.ts y el punto 8 de las diferencias de
  // arriba). Queda un piso de 1 noche: el empleado puede hacer alquileres de un día,
  // no reservas de cero días.
  const errNoches = validarNochesMinimas(fechaInicio, fechaFin, 'mostrador');
  if (errNoches) return mal(errNoches.error, errNoches.status);

  // Documento de identidad (frente) y los dos lados de la licencia. El DORSO del
  // documento de identidad y la exigencia de que las URLs sean subidas nuestras se
  // resuelven más abajo (paso 3.b): la exención de dorso por pasaporte NO se le puede
  // creer al body, hay que contrastarla contra el tipo de documento REGISTRADO del
  // titular, y acá todavía no se sabe quién es.
  const documentosBody = {
    documento_id_url: txt(body.documento_id_url),
    documento_id_url_dorso: txt(body.documento_id_url_dorso),
    documento_es_pasaporte: body.documento_es_pasaporte === true,
    licencia_url: txt(body.licencia_url),
    licencia_url_dorso: txt(body.licencia_url_dorso),
  };
  const errDocs = validarDocumentosReserva(documentosBody);
  if (errDocs) return mal(errDocs.error, errDocs.status);

  if (body.contrato_aceptado_presencial !== true) {
    return mal('Confirma que el cliente aceptó el contrato de alquiler en el punto de atención.');
  }

  const metodoPago = txt(body.metodo_pago);
  if (!esMetodoPago(metodoPago)) {
    return mal(`Indica cómo se recibió el pago (${METODOS_PAGO.join(', ')}).`);
  }
  const pagoReferencia = txt(body.pago_referencia).slice(0, 120);

  // Los lugares que se usan de acá en adelante son los que devuelve la validación
  // (ya normalizados), nunca el objeto crudo del body: es lo que garantiza que el
  // recargo de aeropuerto se cobre exactamente sobre el mismo dato que se validó y
  // que se guarda. Ver `normalizarLugar` en lib/lugares.ts.
  const lugares = validarLugaresReserva(body.recogida, body.entrega);
  if ('error' in lugares) return mal(lugares.error.error, lugares.error.status);
  const { recogida, entrega } = lugares.lugares;

  // ── 2. Titular: cuenta existente o cuenta nueva ───────────────────────────
  // Nunca hay reserva sin cuenta (ver lib/cliente-mostrador.ts). Acá SOLO se
  // resuelve y valida; la escritura ocurre más abajo, dentro de la transacción,
  // para no dejar una cuenta huérfana si la reserva termina rechazada.
  const clienteNuevo = (body.cliente_nuevo ?? null) as CuerpoClienteNuevo | null;
  let cliente: FilaUsuario | null = null;
  let crearCuenta: {
    nombre: string; correo: string; tipoDocumento: string; documentoIdentidad: string;
    fechaNacimiento: string; celular: string; celularIndicativo: string; numeroLicencia: string;
  } | null = null;

  if (body.usuario_id) {
    cliente = db.prepare(SELECT_USUARIO).get(Number(body.usuario_id)) as FilaUsuario | undefined ?? null;
    if (!cliente) return mal('No encontramos esa cuenta de cliente.', 404);
  } else if (clienteNuevo) {
    const nombre = txt(clienteNuevo.nombre).slice(0, 120);
    const correo = txt(clienteNuevo.correo).toLowerCase();
    const tipoDocumento = txt(clienteNuevo.tipo_documento) || 'cedula';
    const documentoIdentidad = txt(clienteNuevo.documento_identidad);
    const fechaNacimiento = txt(clienteNuevo.fecha_nacimiento);
    const celularIndicativo = txt(clienteNuevo.celular_indicativo) || PAIS_TEL_DEFAULT;
    const celular = txt(clienteNuevo.celular);

    if (nombre.length < 3) return mal('Escribe el nombre completo del cliente.');
    if (!CORREO_RE.test(correo)) return mal('El correo del cliente no es válido.');
    // Mismas validaciones autoritativas que POST /api/auth/registro.
    const errDoc = validarDocumentoIdentidad(tipoDocumento, documentoIdentidad);
    if (errDoc) return mal(errDoc);
    const errCel = validarCelular(celularIndicativo, celular);
    if (errCel) return mal(errCel);
    if (!fechaNacimiento || calcularEdad(fechaNacimiento) < 18) {
      return mal('El cliente debe ser mayor de 18 años para alquilar.');
    }

    // Si el correo ya existe, se REUSA esa cuenta (decisión explícita: nunca crear
    // un duplicado). Se busca sin distinguir mayúsculas, igual que la búsqueda.
    const porCorreo = db.prepare(`
      SELECT id, nombre, correo, rol, estado_cuenta, password,
             tipo_documento, documento_identidad, fecha_nacimiento
      FROM usuarios WHERE LOWER(correo) = LOWER(?)
      ORDER BY CASE WHEN rol = 'usuario' THEN 0 ELSE 1 END, id
      LIMIT 1
    `).get(correo) as FilaUsuario | undefined;

    if (porCorreo) {
      cliente = porCorreo;
    } else {
      // Otro freno a los duplicados: si ese número de documento ya está en otra
      // cuenta (con correo distinto), no se crea una segunda — se le dice al
      // empleado que busque por cédula y use la que ya existe.
      const porDocumento = db.prepare(
        "SELECT id, correo FROM usuarios WHERE documento_identidad = ? AND documento_identidad != '' ORDER BY id LIMIT 1"
      ).get(documentoIdentidad) as { id: number; correo: string } | undefined;
      if (porDocumento) {
        return NextResponse.json({
          error: 'Ese número de documento ya tiene una cuenta con otro correo. Búscalo por cédula y usa esa cuenta.',
          codigo: 'documento_duplicado',
        }, { status: 409 });
      }
      crearCuenta = {
        nombre, correo, tipoDocumento, documentoIdentidad, fechaNacimiento,
        celular, celularIndicativo, numeroLicencia: txt(clienteNuevo.numero_licencia).slice(0, 40),
      };
    }
  } else {
    return mal('Indica el cliente titular de la reserva (búscalo o créalo).');
  }

  // ── 3. Cuenta existente: debe servir como titular y tener perfil completo ──
  // `cliente_datos` permite completar en el mismo acto lo que le falte (típico de
  // una cuenta creada con Google, sin documento ni fecha de nacimiento).
  const datosPatch = (body.cliente_datos ?? null) as CuerpoClienteNuevo | null;
  let patchPerfil: { tipoDocumento: string; documentoIdentidad: string; fechaNacimiento: string } | null = null;

  if (cliente) {
    const motivo = motivoNoReservable(cliente);
    if (motivo) return NextResponse.json({ error: motivo, codigo: 'cuenta_no_reservable' }, { status: 409 });

    const faltan = camposDePerfilQueFaltan(cliente);
    if (faltan.length > 0) {
      const tipoDocumento = txt(datosPatch?.tipo_documento) || txt(cliente.tipo_documento) || 'cedula';
      const documentoIdentidad = txt(datosPatch?.documento_identidad) || txt(cliente.documento_identidad);
      const fechaNacimiento = txt(datosPatch?.fecha_nacimiento) || txt(cliente.fecha_nacimiento);

      const errDoc = validarDocumentoIdentidad(tipoDocumento, documentoIdentidad);
      if (errDoc) return NextResponse.json({ error: errDoc, codigo: 'perfil_cliente_incompleto', faltan }, { status: 400 });
      if (!fechaNacimiento || calcularEdad(fechaNacimiento) < 18) {
        return NextResponse.json(
          { error: 'El cliente debe ser mayor de 18 años para alquilar.', codigo: 'perfil_cliente_incompleto', faltan },
          { status: 400 },
        );
      }
      // Ese documento no puede estar ya en otra cuenta.
      const enOtra = db.prepare(
        "SELECT id FROM usuarios WHERE documento_identidad = ? AND documento_identidad != '' AND id != ? ORDER BY id LIMIT 1"
      ).get(documentoIdentidad, cliente.id) as { id: number } | undefined;
      if (enOtra) return mal('Ese número de documento ya está registrado en otra cuenta.', 409);

      patchPerfil = { tipoDocumento, documentoIdentidad, fechaNacimiento };
    }
  }

  // ── 3.b Dorso del documento de identidad del TITULAR ──────────────────────
  // Misma regla de la vía pública y mismo código (lib/reserva-core.ts): el pasaporte
  // es la única exención legítima del dorso, y `documento_es_pasaporte` lo manda quien
  // hace la petición, así que se contrasta contra el `tipo_documento` REGISTRADO.
  //
  // Acá el titular NO es quien llama, es el cliente resuelto arriba, así que el
  // contraste va contra el tipo de documento de ESE cliente:
  //   · cuenta que ya existía → el de su fila, o el que esta misma petición está
  //     completando (`patchPerfil`, que ya pasó por `validarDocumentoIdentidad`);
  //   · cuenta nueva → el del formulario del mostrador (`crearCuenta`, mismo valor que
  //     va a quedar guardado en `usuarios.tipo_documento` unas líneas más abajo).
  // Nunca el del empleado que atiende.
  const tipoDocumentoTitular = crearCuenta
    ? crearCuenta.tipoDocumento
    : (patchPerfil?.tipoDocumento || cliente!.tipo_documento);

  // La exigencia de que las 4 URLs sean subidas NUESTRAS vivía acá suelta; ahora está
  // dentro de `resolverDocumentosIdentidad`, que es lo que hace que la vía pública la
  // aplique también (antes no la tenía). Los documentos que el cliente ya tuviera
  // guardados quedan exentos, igual que en /pago: una URL antigua en su perfil no
  // puede impedirle al mostrador atenderlo. Cuenta nueva = sin exenciones.
  const identidad = resolverDocumentosIdentidad(documentosBody, tipoDocumentoTitular, {
    descartarDorsoSiPasaporte: true,
    urlsExentas: cliente ? urlsDocumentosGuardadas(db, cliente.id) : [],
  });
  if ('error' in identidad) return mal(identidad.error.error, identidad.error.status);
  const documentos = identidad.documentos;

  // ── 4. Vehículo y fechas ──────────────────────────────────────────────────
  const vehiculo = cargarVehiculoReservable(db, vehiculoId);
  if (!vehiculo) return mal('Vehículo no disponible');

  const errFechas = validarDisponibilidadFechas(db, vehiculo, fechaInicio, fechaFin);
  if (errFechas) return mal(errFechas.error, errFechas.status);

  // ── 5. Datos de la operación (dirección, ciudad, contacto de emergencia) ──
  const perfilOperacion = cliente ? leerPerfilOperacion(db, cliente.id) : null;
  const operacion = resolverDatosOperacion(perfilOperacion, {
    direccion: body.direccion, ciudad: body.ciudad,
    emergencia_nombre: body.emergencia_nombre, emergencia_tel: body.emergencia_tel,
  });
  if ('error' in operacion) return mal(operacion.error.error, operacion.error.status);

  // ── 6. Escritura ──────────────────────────────────────────────────────────
  // Crear la cuenta (si aplica) y la reserva van en la MISMA transacción: si el
  // INSERT de la reserva falla, no queda una cuenta a medias del cliente.
  const codigoCorreo = generarCodigoCorreo();
  const ahora = new Date();

  type Resultado = {
    reservaId: number; clienteId: number; clienteNombre: string; clienteCorreo: string;
    cuentaCreada: boolean; tokenActivacion: string; total: number; creditosUsados: number; recargo: number;
    /** Columnas del perfil que ESTA petición escribió (para la bitácora). */
    columnasPerfil: string[];
  };

  let resultado: Resultado;
  try {
    resultado = db.transaction((): Resultado => {
      let clienteId: number;
      let clienteNombre: string;
      let clienteCorreo: string;
      let cuentaCreada = false;
      let necesitaActivacion = false;
      const columnasPerfil: string[] = [];

      if (crearCuenta) {
        const info = db.prepare(`
          INSERT INTO usuarios
            (nombre, correo, password, rol,
             tipo_documento, documento_identidad, fecha_nacimiento,
             celular, celular_indicativo, direccion, ciudad, numero_licencia, contacto_emergencia,
             correo_verificado, correo_codigo, correo_codigo_expira, correo_codigo_generado_at)
          VALUES (?, ?, ?, 'usuario', ?, ?, ?, ?, ?, '', '', ?, '{}', 0, ?, ?, ?)
        `).run(
          crearCuenta.nombre, crearCuenta.correo, bcrypt.hashSync(passwordAleatoria(), 10),
          crearCuenta.tipoDocumento, crearCuenta.documentoIdentidad, crearCuenta.fechaNacimiento,
          crearCuenta.celular, crearCuenta.celularIndicativo, crearCuenta.numeroLicencia,
          codigoCorreo, expiraEnMinutos(CODIGO_VIGENCIA_MIN, ahora), ahora.toISOString(),
        );
        clienteId = Number(info.lastInsertRowid);
        clienteNombre = crearCuenta.nombre;
        clienteCorreo = crearCuenta.correo;
        cuentaCreada = true;
        necesitaActivacion = true;
        try { asignarCodigoReferido(db, clienteId, crearCuenta.nombre); } catch (e) {
          console.error('[admin/reservas] No se pudo asignar el código de referido:', e instanceof Error ? e.message : e);
        }
      } else {
        clienteId = cliente!.id;
        clienteNombre = cliente!.nombre;
        clienteCorreo = cliente!.correo;
        if (patchPerfil) {
          // Solo se llega acá si `camposDePerfilQueFaltan` marcó algo: se completa lo
          // que faltaba, no se reemplaza un documento que la cuenta ya tenía.
          db.prepare('UPDATE usuarios SET tipo_documento = ?, documento_identidad = ?, fecha_nacimiento = ? WHERE id = ?')
            .run(patchPerfil.tipoDocumento, patchPerfil.documentoIdentidad, patchPerfil.fechaNacimiento, clienteId);
          columnasPerfil.push('tipo_documento', 'documento_identidad', 'fecha_nacimiento');
        }
        // Cuenta sin contraseña (registro por Google): se le pone una aleatoria que
        // nadie conoce y se le manda el enlace para que fije la suya. Sin esto,
        // `perfilIncompleto` la seguiría considerando incompleta para siempre.
        if (!String(cliente!.password ?? '').trim()) {
          db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(bcrypt.hashSync(passwordAleatoria(), 10), clienteId);
          necesitaActivacion = true;
          columnasPerfil.push('password (aleatoria, enlace de activación al cliente)');
        }
      }

      const tokenActivacion = necesitaActivacion ? generarTokenActivacion(db, clienteId) : '';

      // ── Perfil del cliente: SOLO se rellena lo vacío ────────────────────────
      // Acá el titular lo elige el empleado (`usuario_id` del body), no es quien hace
      // la petición. Escribir incondicionalmente sobre esa fila le daba la capacidad
      // de reemplazar la dirección, el contacto de emergencia y —lo grave— la cédula
      // y la licencia guardadas de CUALQUIER cliente, con URLs de documentos de otro
      // cliente sacadas de GET /api/reservas (`esUrlDeStorageValida` valida el
      // dominio, no de quién es el documento). Como app/pago/page.tsx precarga la
      // próxima reserva desde el perfil, el cambio se propagaba solo.
      //
      // Para una cuenta RECIÉN CREADA el efecto es el mismo de antes: todas esas
      // columnas nacen vacías, así que se pueblan completas.
      columnasPerfil.push(
        ...rellenarDatosOperacionFaltantes(db, clienteId, cuentaCreada ? null : perfilOperacion, operacion.datos),
        ...precargarDocumentosEnPerfil(db, clienteId, documentos, { soloSiVacio: true }),
      );

      const { recargo, totalBruto } = calcularCobroReserva(db, vehiculo, fechaInicio, fechaFin, recogida, entrega);
      // Créditos de referido: igual que en la vía pública, los descuenta el servidor
      // contra el saldo real (nunca se confía en un monto que venga en el body).
      const creditosUsados = body.usar_creditos ? consumirCreditos(db, clienteId, totalBruto) : 0;
      const total = totalBruto - creditosUsados;

      const reservaId = insertarReserva(db, {
        usuarioId: clienteId,
        vehiculoId,
        fechaInicio,
        fechaFin,
        total,
        estado: 'confirmada',
        pagoEstado: 'pagado',
        documentos,
        firmaContrato: firmaDeMostrador(
          clienteNombre,
          `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}`,
          recogida, entrega,
          { id: user.id, nombre: user.nombre, correo: user.correo },
        ),
        recogida,
        entrega,
        recargo,
        creditosUsados,
        origen: ORIGEN_MOSTRADOR,
        creadaPorAdminId: user.id,
        metodoPago,
        pagoReferencia,
        pagoRegistradoPor: user.id,
      });

      return { reservaId, clienteId, clienteNombre, clienteCorreo, cuentaCreada, tokenActivacion, total, creditosUsados, recargo, columnasPerfil };
    })();
  } catch (e) {
    console.error('[admin/reservas] No se pudo crear la reserva de mostrador:', e instanceof Error ? e.message : e);
    return mal('No se pudo crear la reserva. Intenta de nuevo.', 500);
  }

  // ── 7. Bitácora ───────────────────────────────────────────────────────────
  if (resultado.cuentaCreada) {
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'reservas', accion: 'crear_cliente_mostrador', entidad: 'usuario', entidad_id: resultado.clienteId,
      detalle: `Creó la cuenta de cliente ${resultado.clienteNombre} (${resultado.clienteCorreo}) en el punto de atención`,
    });
  }
  // Tocar el perfil de una cuenta que NO se acaba de crear se registra aparte: es una
  // escritura sobre los datos personales de un tercero hecha desde el área "reservas"
  // (la secretaria no tiene el área "usuarios"), y aunque solo rellene lo vacío tiene
  // que poder auditarse sin tener que deducirla de la entrada de la reserva.
  if (!resultado.cuentaCreada && resultado.columnasPerfil.length > 0) {
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'reservas', accion: 'completar_perfil_cliente_mostrador', entidad: 'usuario', entidad_id: resultado.clienteId,
      detalle:
        `Al crear la reserva #${resultado.reservaId} completó datos que faltaban en la cuenta existente de ` +
        `${resultado.clienteNombre} (${resultado.clienteCorreo}): ${resultado.columnasPerfil.join(', ')}`,
    });
  }
  registrarAuditoria(db, { ...user, nivel }, {
    area: 'reservas', accion: 'crear_reserva_mostrador', entidad: 'reserva', entidad_id: resultado.reservaId,
    detalle:
      `Reserva #${resultado.reservaId} en punto de atención para ${resultado.clienteNombre} (${resultado.clienteCorreo}) — ` +
      `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} del ${fechaInicio} al ${fechaFin}, ` +
      `total $${resultado.total.toLocaleString('es-CO')} pagado por ${metodoPago}` +
      (pagoReferencia ? ` (ref. ${pagoReferencia})` : '') +
      (resultado.cuentaCreada ? ' — cuenta de cliente creada en el momento' : ''),
  });

  // ── 8. Mismos efectos que una reserva aprobada y pagada por la vía normal ──
  // Cada uno aislado: un fallo acá no debe deshacer una reserva ya cobrada.
  try {
    await procesarPagoConfirmado(db, resultado.reservaId); // cotización + factura + liquidación + remisión
  } catch (e) {
    console.error('[contabilidad] No se pudo procesar el pago confirmado:', e instanceof Error ? e.message : e);
  }
  try {
    procesarRecompensaReferido(db, resultado.clienteId, resultado.reservaId);
  } catch (e) {
    console.error('[referidos] No se pudo procesar la recompensa:', e instanceof Error ? e.message : e);
  }
  try {
    avisarPorChat(db, resultado.reservaId, user.id,
      `✅ Reserva confirmada en el punto de atención: ${vehiculo.marca} ${vehiculo.modelo} del ${fechaInicio} al ${fechaFin}. Pago recibido.`);
  } catch (e) {
    console.error('[reservas] No se pudo avisar por chat:', e instanceof Error ? e.message : e);
  }
  await crearOperacionYNotificar(db, resultado.reservaId); // ya trae su propio try/catch

  // Correo al cliente: confirmación + (si la cuenta es nueva o no tenía contraseña)
  // el enlace para crear su clave y el código para verificar el correo.
  let correoEnviado = false;
  try {
    const activacion = resultado.tokenActivacion
      ? `\n\nPara entrar a tu cuenta y ver tus reservas, crea tu contraseña aquí (el enlace vence en ${ACTIVACION_VIGENCIA_HORAS} horas): ${enlaceActivacion(resultado.tokenActivacion)}` +
        (resultado.cuentaCreada ? `\n\nPara verificar tu correo usa este código: ${codigoCorreo} (vence en ${CODIGO_VIGENCIA_MIN} minutos).` : '')
      : '';
    const envio = await enviarCorreo(resultado.clienteCorreo, 'Tu reserva en DrivePass quedó confirmada',
      `Hola ${resultado.clienteNombre.split(' ')[0]}, confirmamos tu reserva del ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} ` +
      `del ${fechaInicio} al ${fechaFin} por $${resultado.total.toLocaleString('es-CO')}. ` +
      `Recibimos tu pago (${metodoPago}) en nuestro punto de atención.` + activacion);
    correoEnviado = envio.enviado;
    if (!envio.enviado && resultado.tokenActivacion) {
      // El enlace de activación NUNCA se escribe en el log de producción. En
      // POST /api/auth/olvide-password ese respaldo es tolerable (token de 60 min,
      // y sin RESEND_API_KEY no hay forma de probar el flujo en local); acá NO:
      // este token vive 72 horas y `enviarCorreo` devuelve enviado:false ante
      // CUALQUIER fallo de Resend en producción (rate limit, dominio sin verificar,
      // red), no solo por falta de API key. Cualquiera con acceso a los logs de
      // Railway se llevaría un enlace vivo de toma de cuenta durante 3 días.
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[admin/reservas] Enlace de activación para ${resultado.clienteCorreo}: ${enlaceActivacion(resultado.tokenActivacion)} (envío real falló: ${envio.detalle})`);
      } else {
        console.error(`[admin/reservas] No se pudo enviar el correo de activación a la reserva #${resultado.reservaId} (el enlace no se registra): ${envio.detalle}`);
      }
    }
  } catch (e) {
    console.error('[admin/reservas] No se pudo enviar el correo al cliente:', e instanceof Error ? e.message : e);
  }
  // La cuenta necesita activarse pero el correo NO salió. Se le dice al empleado para
  // que no le prometa al cliente un correo que nunca llegó: puede pedirlo él mismo
  // desde "¿Olvidaste tu contraseña?" con su correo, sin que nadie del equipo toque
  // el token.
  const activacionEnviada = !!resultado.tokenActivacion && correoEnviado;
  const activacionPendiente = !!resultado.tokenActivacion && !correoEnviado;

  // El token de activación NUNCA sale en la respuesta (ver lib/acceso-cliente.ts).
  return NextResponse.json({
    id: resultado.reservaId,
    usuario_id: resultado.clienteId,
    cuenta_creada: resultado.cuentaCreada,
    activacion_enviada: activacionEnviada,
    activacion_pendiente: activacionPendiente,
    total: resultado.total,
    recargo: resultado.recargo,
    creditos_usados: resultado.creditosUsados,
    metodo_pago: metodoPago,
  }, { status: 201 });
}
