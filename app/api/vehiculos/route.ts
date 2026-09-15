import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { tieneAltaDisponibilidadEsteMes } from '@/lib/disponibilidad-reglas';
import { precioMercadoSugerido, segmentoValido } from '@/lib/precioMercado';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { perfilIncompleto, CODIGO_PERFIL_INCOMPLETO } from '@/lib/perfil';
import { correoNoVerificado, CODIGO_CORREO_NO_VERIFICADO } from '@/lib/verificacion-correo';
import { contieneLenguajeInapropiado, extraerUrlsFotos, fotosRegistradasEntre, normalizarUrlFoto } from '@/lib/moderacion';
import { documentosConUrlsValidas } from '@/lib/storage';
import { quitarPolizaDeEntrada } from '@/lib/poliza-vehiculo';
import { esCombustibleValido, inscripcionExencionConfirmada, requiereInscripcionExencion, sanitizarClaseVehiculo } from '@/lib/vehiculo-campos';
import { filtrarVehiculos } from '@/lib/vehiculo-publico';
import { validarDiasDisponibles } from '@/lib/dias-disponibles';

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
  // Cola de revisión de moderación de contenido (ver lib/moderacion.ts): igual que
  // `archivados=1`, exclusiva del admin con la sección "vehiculos".
  const revisionContenido = searchParams.get('revisionContenido') === '1';
  // Marca explícita de que la llamada viene del panel de administración (ver
  // app/dashboard/admin/page.tsx), no de la home pública (app/page.tsx). Es la única forma
  // confiable de distinguir ambos casos: el servidor no puede inferirlo solo del rol de la
  // sesión, porque un admin también navega la home pública como cualquier usuario normal.
  const panelAdmin = searchParams.get('panelAdmin') === '1';

  // Sesión + permiso de área, resueltos UNA sola vez para toda la ruta: deciden tanto qué
  // vehículos se listan (ramas de abajo) como qué campos sensibles pueden salir en la
  // respuesta (documentos del propietario, ver lib/vehiculo-publico.ts).
  const sesion = await getCurrentUser();
  const esAdminConPermiso = !!sesion && sesion.rol === 'admin' && adminTieneArea(db, sesion.id, 'vehiculos');

  // Vista de archivados / en revisión de contenido: exclusiva del admin con la sección
  // "vehiculos" (ver lib/eliminar.ts). Esta ruta es pública para el resto de casos, así
  // que aquí sí hay que exigir sesión + permiso.
  if (archivados || revisionContenido) {
    if (!esAdminConPermiso) return sinPermisoArea();
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
  } else if (revisionContenido) {
    query += ' AND v.archivado = 0 AND v.contenido_revision = 1';
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
  if (!archivados && !revisionContenido) {
    if (vitrina) {
      query += ' AND v.en_vitrina = 1';
      query += ' AND v.disponible = 1 AND v.contenido_revision = 0';
    } else if (propietarioId) {
      // Filtro por propietarioId: el propio dueño autenticado (o un admin con la sección
      // "vehiculos") puede ver TODOS sus vehículos, incluidos los no disponibles o
      // marcados en revisión de contenido — para saber que están pendientes. Cualquier
      // otro visitante (sin sesión, o con sesión de otro usuario que no sea admin) solo
      // debe ver lo mismo que ve el listado público — mismo criterio que ya aplica
      // GET /api/vehiculos/[id] para el detalle de un vehículo en revisión.
      const esDueño = !!sesion && sesion.id === Number(propietarioId);
      const puedeVerTodos = esDueño || esAdminConPermiso;
      if (!puedeVerTodos) query += ' AND v.disponible = 1 AND v.contenido_revision = 0';
    } else {
      // Listado principal sin propietarioId: para el público (y cualquier usuario sin
      // permiso admin) sigue ocultando vehículos inactivos o marcados en revisión de
      // contenido. Pero el admin con la sección "vehiculos", y ÚNICAMENTE cuando la llamada
      // viene marcada como `panelAdmin=1` (ver app/dashboard/admin/page.tsx), SÍ debe poder
      // ver acá los vehículos con disponible=0 (p. ej. pendientes de aprobación de
      // documentos) para poder gestionarlos — la revisión de contenido
      // (contenido_revision=1) ya tiene su propia pestaña dedicada (revisionContenido=1
      // arriba), así que esa sí se sigue excluyendo para no duplicar esa vista dentro de la
      // lista principal. Sin `panelAdmin=1` (p. ej. el mismo admin navegando la home
      // pública en app/page.tsx como cualquier usuario) el comportamiento debe ser
      // idéntico al de un visitante sin permisos.
      if (panelAdmin && esAdminConPermiso) {
        query += ' AND v.contenido_revision = 0';
      } else {
        query += ' AND v.disponible = 1 AND v.contenido_revision = 0';
      }
    }

    // Los buses (tipo='bus') tienen su propio cotizador dedicado en app/buses/ (ver
    // components/buses/CotizadorPublico.tsx) — la ficha de un vehículo normal
    // (app/vehiculos/[id]/page.tsx) no sabe cotizar un bus (precio_dia=0 por diseño), así
    // que nunca deben aparecer mezclados en la vitrina pública ni en el listado del panel
    // admin (que ya tiene su propia pestaña "🚌 Buses" con BusesPanel/`/api/buses`). Esto
    // solo aplica al listado "general" (sin `propietarioId`): el propio dueño (o un admin
    // con permiso) consultando `propietarioId=` sigue viendo también sus buses — ver el
    // filtro client-side ya existente en app/dashboard/propietario/page.tsx. Y si alguien
    // pide `tipo=` explícito (incluido `tipo=bus`), se respeta tal cual sin forzar esta
    // exclusión.
    if (!propietarioId && !tipo) {
      query += " AND v.tipo != 'bus'";
    }
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

  // Los campos privados del propietario (documentos y su revisión, valor comercial) solo
  // salen para el dueño de CADA vehículo o para el admin con la sección "vehiculos" — el
  // resto de llamadas (home/vitrina públicas, otro usuario autenticado) los recibe sin
  // ellos. Ver lib/vehiculo-publico.ts.
  const ctx = { usuarioId: sesion?.id ?? null, esAdminConPermiso };
  return NextResponse.json({ vehiculos: filtrarVehiculos(vehiculos, ctx) });
}

function parseDias(json: string | undefined): string[] {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'propietario') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // Gate real (server-side) de correo verificado — ver lib/verificacion-correo.ts
  // (incluye el kill switch de emailHabilitado()===false).
  if (correoNoVerificado(user.id)) {
    return NextResponse.json(
      { error: 'Verifica tu correo antes de publicar un vehículo.', codigo: CODIGO_CORREO_NO_VERIFICADO },
      { status: 403 },
    );
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
          fotos, fotos_detalle, dias_disponibles, placa, documentos, combustible, clase_vehiculo,
          exencion_pico_placa_inscrita } = body;

  if (!marca || !modelo || !anio) {
    return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
  }

  // `combustible` es una lista cerrada (ver lib/vehiculo-campos.ts), no texto libre: además
  // de describir el vehículo, decide —junto con `exencion_pico_placa_inscrita`— la exención de
  // pico y placa (lib/pico-placa.ts), así que un valor inventado desde el cliente podría
  // hacerle creer a un arrendatario que su carro no tiene restricción. Vacío/ausente = "no declarado" (el
  // estado de todos los vehículos anteriores a esta columna) y es perfectamente válido.
  if (combustible !== undefined && combustible !== null && combustible !== '' && !esCombustibleValido(combustible)) {
    return NextResponse.json({ error: 'Tipo de combustible inválido.' }, { status: 400 });
  }
  const combustibleFinal = esCombustibleValido(combustible) ? combustible : '';
  // `clase_vehiculo` sí es texto transcrito de la matrícula (el RUNT usa variantes), así que
  // no hay lista cerrada — solo se recorta para que no entre un texto arbitrariamente largo.
  const claseVehiculoFinal = sanitizarClaseVehiculo(clase_vehiculo);
  // `exencion_pico_placa_inscrita`: confirmación de que el propietario inscribió la exención
  // ante la Secretaría de Movilidad de Medellín. La derivamos del combustible ya validado en
  // vez de confiar en el cliente — solo híbridos y gas (GNV) la necesitan; en los eléctricos
  // la exención es automática y en el resto no existe. Se guarda como INTEGER 0/1.
  const exencionInscritaFinal = requiereInscripcionExencion(combustibleFinal)
    && inscripcionExencionConfirmada(exencion_pico_placa_inscrita) ? 1 : 0;

  // Filtro de lenguaje inapropiado en la descripción (texto libre público). Se rechaza el
  // request de una — más simple y mejor UX que mandarlo a revisión manual silenciosa (a
  // diferencia de las fotos, que son ambiguas para un humano sin mirar; una palabra soez es
  // inequívoca y el propietario puede corregirla al toque). Ver lib/moderacion.ts.
  const chequeoTexto = contieneLenguajeInapropiado(descripcion);
  if (chequeoTexto.encontrado) {
    return NextResponse.json(
      { error: 'Tu descripción contiene lenguaje inapropiado, por favor corrígela.' },
      { status: 400 },
    );
  }

  // Igual que en PUT /api/vehiculos/[id]: el calendario de disponibilidad se valida antes de
  // escribirlo. Sin esto, un `dias_disponibles` que no parsee entra crudo a la BD y después
  // todo el sistema lo lee con `try { JSON.parse } catch { dias = [] }` — que por la semántica
  // invertida de la columna (ver lib/dias-disponibles.ts) deja el vehículo ABIERTO sin
  // restricciones. Un vehículo recién creado no tiene reservas, así que acá solo aplica la
  // validación de formato (la protección contra cerrar días reservados vive en el PUT).
  const diasValidacion = validarDiasDisponibles(dias_disponibles ?? '[]');
  if (!diasValidacion.ok) {
    return NextResponse.json({ error: diasValidacion.error }, { status: 400 });
  }

  // ── `documentos.poliza`: la carga DrivePass, no el propietario ──
  // Este endpoint es EXCLUSIVO del rol `propietario` (ver el guard de arriba), justo el
  // actor que la barrera excluye, y `documentos` entra crudo desde el body. Sin esto
  // bastaba con crear el vehículo mandando `{"poliza":{...}}` para escribir un documento
  // que solo le corresponde a la empresa: `documentosConUrlsValidas` no lo frena (subir un
  // PDF propio por POST /api/upload/documento es trivial para cualquier autenticado), el
  // panel lo pintaba como póliza vigente, entraba al paquete descargable rotulado como
  // carátula de la póliza, y la preservación de claves del PUT lo re-inyectaba para
  // siempre. La clave se ARRANCA incondicionalmente, con la misma función que usa el PUT
  // (lib/poliza-vehiculo.ts) para que la barrera sea una sola y no dos copias.
  //
  // `quitarPolizaDeEntrada` además FALLA CERRADO: un `documentos` que no sea un objeto
  // JSON plano (un array, `null`, un número, un JSON roto) se rechaza con 400 en vez de
  // colarse hasta el INSERT.
  const documentosBarrera = quitarPolizaDeEntrada(documentos);
  if (!documentosBarrera.ok) {
    return NextResponse.json({ error: documentosBarrera.error }, { status: 400 });
  }
  const documentosFinal = documentosBarrera.json;

  // Igual que en PUT /api/vehiculos/[id]: `documentos` debe contener SOLO URLs que
  // realmente vengan de nuestro storage (Cloudinary vía uploadFile(), ver lib/storage.ts) —
  // nunca un string arbitrario inventado por el cliente. Se valida lo que se va a ESCRIBIR
  // (ya sin la póliza), no lo que mandó el cliente.
  if (!documentosConUrlsValidas(documentosFinal)) {
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
  try { docsIniciales = JSON.parse(documentosFinal); } catch { docsIniciales = {}; }
  const tieneDocumentoInicial = Object.values(docsIniciales).some(d => d?.url);
  // Igual que en el PUT: si llega al menos un documento ya en la creación, arranca "en
  // revisión" (no "sin_documentos") y se avisa al equipo, en vez de esperar a que el
  // propietario vuelva a tocar el vehículo para que se dispare ese aviso.
  const documentosEstadoInicial = tieneDocumentoInicial ? 'en_revision' : 'sin_documentos';

  const db = getDb();

  // Moderación de contenido de fotos — modelo ALLOW-LIST (ver lib/moderacion.ts): cada
  // URL en fotos/fotos_detalle debe tener un registro server-side de haber pasado por
  // /api/upload, perteneciente a ESTE propietario. Si alguna URL no tiene registro (nunca
  // pasó por /api/upload — p. ej. una URL externa inventada a mano) o pertenece a otro
  // usuario, se rechaza el request completo. Esto es lo que cierra el hueco de evasión:
  // antes solo se cruzaban las fotos marcadas como sospechosas, así que cualquier URL sin
  // registro (incluida una externa) simplemente pasaba sin ningún chequeo.
  const urlsFotos = extraerUrlsFotos(fotos, fotos_detalle);
  const registradas = fotosRegistradasEntre(db, urlsFotos);
  for (const u of urlsFotos) {
    const registro = registradas.get(normalizarUrlFoto(u));
    if (!registro || registro.usuarioId !== user.id) {
      return NextResponse.json(
        { error: 'Una o más fotos no son válidas. Vuelve a subirlas desde este formulario e intenta de nuevo.' },
        { status: 400 },
      );
    }
  }
  const fotosMarcadas = [...registradas.values()].filter(r => r.contenidoInapropiado);
  const contenidoRevision = fotosMarcadas.length > 0 ? 1 : 0;
  const contenidoRevisionMotivo = fotosMarcadas.map(f => f.motivo).filter(Boolean).join(' | ');

  const result = await db.prepare(`
    INSERT INTO vehiculos
      (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion,
       fotos, fotos_detalle, dias_disponibles, placa, valor_comercial, precio_ajuste_pct, precio_manual,
       disponible, documentos, documentos_estado, contenido_revision, contenido_revision_motivo,
       combustible, clase_vehiculo, exencion_pico_placa_inscrita)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, marca, modelo, anio,
    segmento, ubicacion || 'Medellín',
    precioAuto, descripcion || '',
    fotos || '[]',
    fotos_detalle || '{}',
    diasValidacion.json,
    (placa || '').toString().toUpperCase().trim(),
    valorComercial, ajuste,
    documentosFinal, documentosEstadoInicial,
    contenidoRevision, contenidoRevisionMotivo,
    combustibleFinal, claseVehiculoFinal, exencionInscritaFinal,
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
