import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { precioMercadoSugerido, segmentoValido } from '@/lib/precioMercado';
import { eliminarVehiculoInteligente } from '@/lib/eliminar';
import { registrarAuditoria } from '@/lib/permisos';
import { contieneLenguajeInapropiado, extraerUrlsFotos, fotosRegistradasEntre, normalizarUrlFoto } from '@/lib/moderacion';
import { documentosConUrlsValidas } from '@/lib/storage';
import { tecnoRequerida } from '@/lib/tecnomecanica';
import { esCombustibleValido, inscripcionExencionConfirmada, requiereInscripcionExencion, sanitizarClaseVehiculo } from '@/lib/vehiculo-campos';
import { filtrarVehiculo } from '@/lib/vehiculo-publico';

// Documentos que hoy se le piden al propietario. `todo_riesgo` YA NO está en la lista
// (sep-2026): DrivePass expide la póliza directamente, así que dejó de pedirse, mostrarse
// y revisarse. Los vehículos que ya la habían subido CONSERVAN su `documentos.todo_riesgo`
// en la BD y su archivo en Cloudinary — esta lista solo controla qué se pide/etiqueta/revisa,
// nunca borra claves del JSON. Eso lo garantiza el PUT de más abajo, que re-inyecta
// explícitamente toda clave presente en la BD y ausente del body (ver "Preservación de claves
// legadas de `documentos`"); no depende de que el cliente reenvíe el JSON completo.
const DOC_KEYS = ['soat', 'tecno', 'tarjeta'] as const;
const DOC_LABELS: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad',
};

type DocRevision = { estado: string; nota: string };
type VehicleRow = { documentos: string; documentos_revisiones: string; propietario_id: number; marca: string; modelo: string; anio: number; placa?: string; disponible: number };

// `anio` (año-modelo, aproximación de la fecha de matrícula) decide si `tecno` cuenta dentro
// del estado agregado — ver lib/tecnomecanica.ts (Ley 2294 de 2023).
//
// Compartida entre `computeEstado` (estado agregado) y la nota de rechazo que arma el admin
// en `revisar_documento` más abajo — mismo criterio en ambos lugares (antes solo lo aplicaba
// `computeEstado`; la nota seguía mencionando "denegado" para una clave irrelevante para ESE
// vehículo, ej. una tecno exenta, lo cual confundía al propietario sin bloquear
// realmente la publicación).
function clavesRelevantes(anio: number | null | undefined): (typeof DOC_KEYS)[number][] {
  const claves: (typeof DOC_KEYS)[number][] = ['soat', 'tarjeta'];
  if (tecnoRequerida(anio)) claves.push('tecno');
  return claves;
}

function computeEstado(docs: Record<string, { url?: string } | undefined>, revs: Record<string, DocRevision>, anio: number | null | undefined): string {
  const claves = clavesRelevantes(anio);
  const uploaded = claves.filter(k => (docs[k] as { url?: string } | undefined)?.url);
  if (uploaded.length === 0) return 'sin_documentos';
  if (uploaded.some(k => revs[k]?.estado === 'denegado')) return 'denegado';
  if (uploaded.every(k => revs[k]?.estado === 'aprobado')) return 'aprobado';
  return 'en_revision';
}

/** Expande un rango 'YYYY-MM-DD'..'YYYY-MM-DD' (inclusive) en días, en hora local (sin desfase UTC). */
function* rangoDias(a: string, b: string): Generator<string> {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  if (!ay || !by) return;
  const cur = new Date(ay, am - 1, ad);
  const end = new Date(by, bm - 1, bd);
  while (cur <= end) {
    yield `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    cur.setDate(cur.getDate() + 1);
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  // Ruta pública (detalle de vehículo + página de pago): igual que el listado
  // (ver GET /api/vehiculos), un vehículo archivado nunca debe ser visible/accesible
  // por URL directa. El admin no usa esta ruta para ver archivados — usa
  // GET /api/vehiculos?archivados=1 (lista completa, con guard de sesión+permiso).
  const vehiculo = db.prepare(`
    SELECT v.*, u.nombre as propietario_nombre
    FROM vehiculos v JOIN usuarios u ON v.propietario_id = u.id
    WHERE v.id = ? AND v.archivado = 0
  `).get(Number(id)) as Record<string, unknown> | undefined;

  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Moderación de contenido (ver lib/moderacion.ts): un vehículo marcado en revisión de
  // contenido (contenido_revision=1) tampoco debe ser visible/accesible por esta ruta
  // pública — antes solo GET /api/vehiculos (el listado) lo excluía; esta ruta de detalle
  // por id se podía seguir consultando directo aunque el vehículo no apareciera listado.
  // Mismo criterio que `archivado`, pero el propietario dueño SÍ puede seguir viendo el
  // detalle de su propio vehículo (para ver por qué está en revisión), igual que el admin
  // con la sección "vehiculos".
  // Sesión + permiso de área: deciden si este detalle es visible estando en revisión de
  // contenido (abajo) y qué campos sensibles pueden salir en la respuesta.
  const sesion = await getCurrentUser();
  const esAdminConPermiso = !!sesion && sesion.rol === 'admin' && adminTieneArea(db, sesion.id, 'vehiculos');

  if (Number(vehiculo.contenido_revision) === 1) {
    const esDueño = !!sesion && sesion.rol === 'propietario' && Number(vehiculo.propietario_id) === sesion.id;
    if (!esDueño && !esAdminConPermiso) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }
  }

  // Fechas ya ocupadas por reservas activas (rango inclusivo, igual que la verificación de conflictos del POST).
  const reservas = db.prepare(
    `SELECT fecha_inicio, fecha_fin FROM reservas WHERE vehiculo_id = ? AND estado NOT IN ('cancelada')`
  ).all(Number(id)) as { fecha_inicio: string; fecha_fin: string }[];

  const ocupadasSet = new Set<string>();
  for (const r of reservas) {
    for (const d of rangoDias(r.fecha_inicio, r.fecha_fin)) ocupadasSet.add(d);
  }

  // Ruta pública (ficha del vehículo y página de pago, ambas sin sesión): los campos
  // privados del propietario (documentos y su revisión, valor comercial) solo salen para el
  // dueño del vehículo o para el admin con la sección "vehiculos". `placa` SÍ se mantiene
  // pública: la ficha la necesita para el pico y placa del calendario
  // (app/vehiculos/[id]/page.tsx → components/CalendarioReserva.tsx). Ver lib/vehiculo-publico.ts.
  const vehiculoVisible = filtrarVehiculo(vehiculo, { usuarioId: sesion?.id ?? null, esAdminConPermiso });

  return NextResponse.json({ vehiculo: vehiculoVisible, ocupadas: [...ocupadasSet] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(Number(id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Guard temprano — defensa en profundidad: un vehículo convertido a bus (tipo === 'bus',
  // ver POST /api/buses/convertir) NO se edita desde este endpoint (columnas de carro como
  // `precio_dia`/documentos SOAT-Tecno no aplican; escribir acá sobre él dejaría huérfanos
  // `bus_categoria`/`capacidad_pasajeros`/`bus_tarifas_*_veh` sin limpiarlos). El frontend ya
  // no debería mandar este PUT (ver app/dashboard/propietario/page.tsx, filtra tipo==='bus'
  // fuera de "Mis vehículos"), pero se rechaza acá también por si algún otro camino llega a
  // intentarlo. Va ANTES de cualquier otra lógica de escritura del endpoint.
  if (vehiculo.tipo === 'bus') {
    return NextResponse.json(
      { error: 'Este vehículo es un bus — edítalo desde el panel de Buses, no desde aquí.' },
      { status: 400 },
    );
  }

  // Ruta compartida: la usan el propietario dueño del carro Y el admin.
  // Rama admin -> se le exige la sección "vehiculos" (nivel + excepciones por empleado);
  // rama propietario -> sigue mandando la pertenencia, sin tocar permisos de admin.
  const isAdmin = user.rol === 'admin';
  if (isAdmin) {
    if (!adminTieneArea(db, user.id, 'vehiculos')) return sinPermisoArea();
  } else if (Number(vehiculo.propietario_id) !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const body = await req.json();

  // Filtro de lenguaje inapropiado en la descripción (texto libre público). Igual criterio
  // que POST /api/vehiculos: se rechaza el request completo con un mensaje claro en vez de
  // mandarlo a revisión manual silenciosa. Aplica a ambos roles (propietario y admin) porque
  // `descripcion` es un campo visible públicamente.
  if (body.descripcion !== undefined) {
    const chequeoTexto = contieneLenguajeInapropiado(body.descripcion);
    if (chequeoTexto.encontrado) {
      return NextResponse.json(
        { error: 'Tu descripción contiene lenguaje inapropiado, por favor corrígela.' },
        { status: 400 },
      );
    }
  }

  // ── Validación/normalización de `anio` (ago-2026) ──
  // A diferencia de `precio_ajuste_pct` (que se clampea silenciosamente más abajo), un año de
  // vehículo inválido no tiene un "valor razonable más cercano" obvio, así que acá se rechaza
  // explícito con 400 en vez de corromper el dato o dejar pasar algo raro (null, un string no
  // numérico, un literal hexadecimal como "0x7e8" que `Number()` sí sabría parsear pero que no
  // es una entrada legítima de este formulario, etc.). Corre ANTES de que `body.anio` se use
  // para decidir si cambia la exigibilidad de la tecno (ver bloque de cierre de bypass más
  // abajo) y antes del loop genérico que lo persiste — de aquí en adelante `body.anio`, si
  // está presente, es siempre un entero limpio dentro de rango.
  if (body.anio !== undefined) {
    const rawAnio = body.anio;
    let anioNum = NaN;
    if (typeof rawAnio === 'number') {
      anioNum = rawAnio;
    } else if (typeof rawAnio === 'string' && /^-?\d+(\.\d+)?$/.test(rawAnio.trim())) {
      anioNum = Number(rawAnio);
    }
    anioNum = Math.trunc(anioNum);
    const anioMaxValido = new Date().getFullYear() + 2;
    if (!Number.isFinite(anioNum) || anioNum < 1900 || anioNum > anioMaxValido) {
      return NextResponse.json({ error: 'Año de vehículo inválido.' }, { status: 400 });
    }
    body.anio = anioNum;
  }

  // ── `combustible` / `clase_vehiculo` (campos de la matrícula, ver lib/vehiculo-campos.ts) ──
  // `combustible` es una lista cerrada, no texto libre: además de describir el vehículo,
  // decide (junto con `exencion_pico_placa_inscrita`) la exención de pico y placa
  // (lib/pico-placa.ts), así que un valor inventado desde el cliente podría hacerle creer a un
  // arrendatario que su carro no tiene restricción. Se rechaza explícito (mismo criterio que `anio` arriba) en vez de
  // normalizar en silencio. Vacío = "no declarado", que es el estado de todos los vehículos
  // anteriores a esta columna y sigue siendo válido.
  if (body.combustible !== undefined) {
    if (body.combustible === null || body.combustible === '') {
      body.combustible = '';
    } else if (!esCombustibleValido(body.combustible)) {
      return NextResponse.json({ error: 'Tipo de combustible inválido.' }, { status: 400 });
    }
  }
  // `clase_vehiculo` sí es texto transcrito de la matrícula (el RUNT usa variantes), así que
  // no hay lista cerrada — solo se recorta para no guardar un texto arbitrariamente largo.
  if (body.clase_vehiculo !== undefined) {
    body.clase_vehiculo = sanitizarClaseVehiculo(body.clase_vehiculo);
  }

  // `exencion_pico_placa_inscrita`: el propietario confirma que inscribió la exención de pico
  // y placa ante la Secretaría de Movilidad de Medellín. Solo tiene sentido para híbridos y
  // gas (GNV) — la de los eléctricos es automática y el resto no es exento —, así que el
  // servidor la DERIVA en vez de confiar en el cliente: si el combustible efectivo no requiere
  // el trámite, se fuerza a 0. Eso implementa también el reseteo al cambiar de combustible
  // (cambiar un híbrido inscrito a gasolina apaga el flag solo, aunque el body no lo mande).
  // Se guarda como INTEGER 0/1 y nunca como booleano crudo: better-sqlite3 no acepta booleans.
  if (body.exencion_pico_placa_inscrita !== undefined || body.combustible !== undefined) {
    const combustibleEfectivo = body.combustible !== undefined ? body.combustible : vehiculo.combustible;
    const confirmada = body.exencion_pico_placa_inscrita !== undefined
      ? inscripcionExencionConfirmada(body.exencion_pico_placa_inscrita)
      : inscripcionExencionConfirmada(vehiculo.exencion_pico_placa_inscrita);
    body.exencion_pico_placa_inscrita = requiereInscripcionExencion(combustibleEfectivo) && confirmada ? 1 : 0;
  }

  // ── Admin: review individual document ──
  if (isAdmin && body.revisar_documento) {
    const { key, estado, nota } = body.revisar_documento as { key: string; estado: string; nota: string };

    const row = db.prepare('SELECT documentos, documentos_revisiones, propietario_id, marca, modelo, anio, placa, disponible FROM vehiculos WHERE id = ?').get(Number(id)) as VehicleRow | undefined;
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    let docs: Record<string, { url?: string } | undefined> = {};
    let revs: Record<string, DocRevision> = {};
    try { docs = JSON.parse(row.documentos || '{}'); } catch { /* */ }
    try { revs = JSON.parse(row.documentos_revisiones || '{}'); } catch { /* */ }

    revs[key] = { estado, nota: nota || '' };
    const newEstado = computeEstado(docs, revs, row.anio);
    // Solo se listan en la nota las claves relevantes para ESTE vehículo (mismo criterio que
    // `computeEstado`, ver `clavesRelevantes`) — así un rechazo de `tecno` en un vehículo
    // exento no aparece en la nota como si bloqueara la publicación.
    const clavesRel = clavesRelevantes(row.anio);
    const newNota = DOC_KEYS
      .filter(k => clavesRel.includes(k) && revs[k]?.estado === 'denegado')
      .map(k => `${DOC_LABELS[k]}: ${revs[k]?.nota || 'Sin motivo'}`)
      .join('\n');

    // Si esta revisión deja SOAT o Tecno sin estar "aprobado" (ej. el admin deniega uno que
    // ya estaba aprobado), el vehículo no puede seguir disponible — ver gate de disponibilidad
    // más abajo en el PUT. Se apaga en la MISMA escritura, no queda "disponible" colgado con
    // un documento recién rechazado.
    const aprobadoTrasRevision = (clave: string) => !!docs[clave]?.url && revs[clave]?.estado === 'aprobado';
    const nuevoDisponible = (row.disponible === 1 && (!aprobadoTrasRevision('soat') || (tecnoRequerida(row.anio) && !aprobadoTrasRevision('tecno'))))
      ? 0 : row.disponible;

    db.prepare('UPDATE vehiculos SET documentos_revisiones = ?, documentos_estado = ?, documentos_nota = ?, disponible = ? WHERE id = ?')
      .run(JSON.stringify(revs), newEstado, newNota, nuevoDisponible, Number(id));

    // Nota de diseño: esta notificación individual se dispara igual aunque `key` no sea
    // relevante para este vehículo (tecno exenta, o una clave legada como todo_riesgo). A diferencia de
    // `documentos_nota`/`documentos_estado` (que sí excluyen claves irrelevantes, ver
    // `clavesRelevantes` arriba, porque esos SÍ deciden si el vehículo puede publicarse), esta
    // notificación es un mensaje 1-a-1 sobre el documento puntual que el admin acaba de
    // revisar: si subieron una tecno vencida en un carro exento, el admin puede querer
    // avisarle igual que ese documento en concreto no sirve, sin que eso implique que el
    // vehículo está bloqueado. Se deja intacto a propósito.
    if (estado === 'aprobado' || estado === 'denegado') {
      const vLabel = `${row.marca} ${row.modelo} ${row.anio}`;
      const docLabel = DOC_LABELS[key] || key;
      const titulo = estado === 'aprobado' ? '✅ Documento aprobado' : '❌ Documento rechazado';
      const mensaje = estado === 'aprobado'
        ? `Tu documento "${docLabel}" para ${vLabel} fue aprobado.`
        : `Tu documento "${docLabel}" para ${vLabel} fue rechazado.${nota ? ` Motivo: ${nota}` : ''}`;
      db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.propietario_id, `documento_${estado}`, titulo, mensaje, Number(id), 'vehiculo');
    }

    return NextResponse.json({ ok: true, documentos_estado: newEstado, documentos_nota: newNota, documentos_revisiones: JSON.stringify(revs) });
  }

  // Reglas de disponibilidad (ver lib/disponibilidad-reglas.ts): el propietario
  // las ve siempre en el panel de su calendario, pero NO se bloquean acá.
  // El calendario se guarda clic por clic — un propietario que recién empieza a
  // abrir un mes nuevo (ej. un solo día en septiembre) fallaría la regla semanal
  // de ESE mes hasta terminar de marcarlo, así que bloquear cada guardado
  // intermedio le impediría completar su propio calendario. Quedan como guía
  // visible, no como bloqueo duro.

  // ── Gate de disponibilidad: SOAT y Tecno-mecánica aprobados (Punto 1) ──
  // Un vehículo nuevo nace con `disponible = 0` (ver POST /api/vehiculos) y solo puede
  // volver a marcarse disponible=1 si el SOAT y la Tecno-mecánica YA fueron aprobados
  // (por IA de alta confianza o por revisión humana — mismo estado que usa el admin en
  // "revisar_documento" arriba y /api/verificar-documentos). Esto aplica tanto al
  // propietario como al admin: la vía correcta para habilitar un vehículo es aprobar sus
  // documentos primero, no togglear "disponible" a mano. No es retroactivo — un vehículo
  // que YA estaba disponible=1 antes de este cambio no se toca aquí; el gate solo corre
  // cuando alguien intenta ENCENDER disponible=1 de nuevo.
  //
  // Blindaje anti-bypass-en-un-request (ago-2026): si el body trae `documentos` a la vez
  // que intenta `disponible=1`, se rechaza sin excepción — sin importar qué decían los
  // documentos viejos. El camino correcto es en dos pasos: (1) subir documentos nuevos,
  // (2) una vez aprobados por el flujo normal, en una request POSTERIOR intentar
  // `disponible=1`.
  //
  // Blindaje anti-carrera entre DOS requests (ago-2026): NO reutilizamos la variable
  // `vehiculo` leída arriba (línea ~108) para este chequeo, porque esa lectura ocurrió
  // ANTES del único `await` de esta función (`await req.json()`). Si dos PUT llegan casi
  // simultáneos — uno subiendo `documentos` nuevos (resetea documentos_revisiones) y otro
  // con `disponible: 1` — ambos podrían haber capturado la fila vieja antes de que el
  // primero terminara de escribir, y el segundo pasaría el gate con datos obsoletos. Por
  // eso releemos documentos/documentos_revisiones/anio DE LA BASE justo aquí, DESPUÉS del
  // `await`: de aquí en adelante el resto del handler es 100% síncrono (better-sqlite3 no
  // usa promesas), así que lectura → chequeo → escritura corren en un solo turno de Node
  // sin ninguna ventana donde otro request pueda interponerse. Esta relectura (`filaFresca`
  // abajo) es la ÚNICA relectura síncrona post-`await` que usa este PUT — la comparte el
  // gate de abajo y el cierre de bypass de `anio` que sigue (no hay una segunda lectura
  // paralela e inconsistente: cuando ambos chequeos aplican al mismo request, corren sobre
  // exactamente los mismos `docsFrescos`/`revsFrescos` en memoria).
  const intentaHabilitar = body.disponible !== undefined && Number(body.disponible) === 1;
  const traeDocumentosNuevos = body.documentos !== undefined;
  if (intentaHabilitar && traeDocumentosNuevos) {
    return NextResponse.json({
      error: 'No puedes subir documentos nuevos y marcar el vehículo como disponible en la misma solicitud. Sube los documentos primero; una vez aprobados por DrivePass, actívalo.',
    }, { status: 400 });
  }

  // ── Cierre de bypass: `anio` autodeclarado invalida la aprobación de `tecno` al cambiar
  //    (ago-2026) ──
  // BYPASS QUE SE CIERRA: `anio` es un campo autodeclarado por el propietario — nunca lo
  // valida la IA de verificación de documentos (`lib/verificacion-docs.ts` solo contrasta
  // placa y propietario, jamás año) — y es editable libremente en cualquier momento vía este
  // mismo PUT (está en `ownFields` más abajo), incluso DESPUÉS de que la Tecno-mecánica ya
  // fue revisada bajo el año real. Sin este bloque, el año decide si `tecno` es exigible
  // (ver `tecnoRequerida`/`computeEstado`) pero nada revalida esa decisión cuando el año
  // cambia, así que una aprobación (o falta de aprobación) vieja quedaba "congelada" con el
  // año viejo aunque el año declarado hoy sea otro. Ejemplo reproducible en dos requests SIN
  // condición de carrera: (1) PUT { anio: 2015 } sobre un vehículo real de 2015 con tecno
  // nunca aprobada (disponible=0 por el gate de arriba) — se guardaba sin ninguna
  // validación; (2) PUT { anio: 2024 } (año falso, "vehículo nuevo") — con el código viejo
  // esto también se guardaba sin más, y una request posterior `disponible: 1` pasaba el gate
  // porque `tecnoRequerida(2024)` da `false`, dejando el vehículo disponible SIN que la
  // tecnomecánica real jamás se haya revisado. Peor aún: si el propietario luego REVERTÍA el
  // año a su valor real (2015, ej. sin querer o porque ya lo vieron), `disponible` seguía en
  // 1 indefinidamente — no había ningún re-chequeo retroactivo al cambiar `anio` de vuelta.
  //
  // LA DEFENSA: cualquier cambio de `anio` en este PUT (`body.anio` distinto al valor actual
  // en BD) borra `revs.tecno` (si existía, aprobado o denegado — su vigencia dependía de la
  // edad declarada anterior, que acaba de cambiar) y recalcula `documentos_estado` y
  // `disponible` con el año NUEVO. SOAT/tarjeta no dependen de la edad del
  // vehículo, así que no se tocan. Esto cierra el hueco retroactivo (revertir el año vuelve a
  // apagar `disponible` si ya no cumple) sin necesitar validar `anio` contra un documento
  // real (limitación conocida y fuera del alcance de este fix — ver lib/tecnomecanica.ts).
  //
  // Relectura: reutilizamos la MISMA `filaFresca` síncrona post-`await` de arriba cuando el
  // mismo request también trae `disponible` (evita una segunda query idéntica); si el
  // request SOLO cambia `anio` sin tocar `disponible`, esta es su propia lectura síncrona
  // (sigue ocurriendo después del único `await` de la función, sin ningún `await` de por
  // medio hasta el UPDATE final — mismo invariante anti-carrera documentado arriba).
  const bodyTraeAnio = body.anio !== undefined;
  let filaFresca: { documentos: string; documentos_revisiones: string; anio: number; disponible: number } | undefined;
  let docsFrescos: Record<string, { url?: string } | undefined> = {};
  let revsFrescos: Record<string, DocRevision> = {};
  let anioEfectivo: number | null | undefined;
  let anioCambio = false;
  let disponibleAntesDePut = 0;

  if (intentaHabilitar || bodyTraeAnio) {
    filaFresca = db.prepare('SELECT documentos, documentos_revisiones, anio, disponible FROM vehiculos WHERE id = ?')
      .get(Number(id)) as { documentos: string; documentos_revisiones: string; anio: number; disponible: number } | undefined;
    if (!filaFresca) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    try { docsFrescos = JSON.parse(filaFresca.documentos || '{}'); } catch { /* */ }
    try { revsFrescos = JSON.parse(filaFresca.documentos_revisiones || '{}'); } catch { /* */ }
    anioEfectivo = filaFresca.anio;
    disponibleAntesDePut = filaFresca.disponible;

    if (bodyTraeAnio && Number(body.anio) !== Number(filaFresca.anio)) {
      const anioNuevo = Number(body.anio);
      // No todo cambio de `anio` altera si `tecno` es exigible (ej. corregir un typo de 2018 a
      // 2017 sin cruzar el umbral de 5 años de `tecnoRequerida`) — solo forzamos el reset de
      // `revs.tecno` (y el recálculo de `documentos_estado`/`disponible` que sigue más abajo)
      // cuando el cambio de año SÍ mueve la exigibilidad, para no tirar a la basura una
      // aprobación legítima de tecno por una corrección de año que no cambia nada real.
      const exigibilidadCambio = tecnoRequerida(filaFresca.anio) !== tecnoRequerida(anioNuevo);
      anioEfectivo = anioNuevo; // el año efectivo (para el gate de disponibilidad) es SIEMPRE el nuevo, cambie o no la exigibilidad
      if (exigibilidadCambio) {
        anioCambio = true;
        if (revsFrescos.tecno) delete revsFrescos.tecno;
      }
    }
  }

  const aprobadoFresco = (clave: string) => !!docsFrescos[clave]?.url && revsFrescos[clave]?.estado === 'aprobado';

  if (intentaHabilitar) {
    const tecnoExigible = tecnoRequerida(anioEfectivo);
    if (!aprobadoFresco('soat') || (tecnoExigible && !aprobadoFresco('tecno'))) {
      return NextResponse.json({
        error: tecnoExigible
          ? 'No puedes marcar el vehículo como disponible: el SOAT y la Tecno-mecánica deben estar aprobados por DrivePass primero.'
          : 'No puedes marcar el vehículo como disponible: el SOAT debe estar aprobado por DrivePass primero.',
      }, { status: 400 });
    }
  }

  // ── Preservación de claves legadas de `documentos` ──
  // El formulario del propietario ya no muestra `todo_riesgo` (sep-2026: DrivePass expide la
  // póliza), pero los vehículos que la subieron CONSERVAN esa clave en la BD y nadie debe
  // borrarla. Hasta ahora eso dependía de que el cliente reenviara el JSON completo tal como
  // lo cargó — un passthrough frágil que TypeScript ya no vigila (la clave salió del tipo
  // `Documentos`). Acá se vuelve estructural: cualquier clave que esté en la BD y NO venga en
  // el body se re-inyecta antes de escribir. Ningún flujo de la app borra claves de
  // `documentos` (el formulario siempre reenvía las que conoce, y el admin solo escribe
  // `documentos_revisiones`), así que esto no bloquea nada real.
  if (traeDocumentosNuevos) {
    let docsBody: unknown = null;
    let docsBD: Record<string, unknown> = {};
    try { docsBody = JSON.parse(String(body.documentos ?? '{}')); } catch { docsBody = null; }
    try { docsBD = JSON.parse(String(vehiculo.documentos ?? '{}')) as Record<string, unknown>; } catch { /* JSON corrupto en BD: no hay nada que preservar */ }
    if (docsBody && typeof docsBody === 'object' && docsBD && typeof docsBD === 'object') {
      const destino = docsBody as Record<string, unknown>;
      let agregadas = false;
      for (const [clave, valor] of Object.entries(docsBD)) {
        if (Object.hasOwn(destino, clave)) continue;
        // `defineProperty` y no `destino[clave] = valor`: una clave `__proto__` guardada en el
        // JSON dispararía el setter de Object.prototype (cambiaría el prototipo del objeto en
        // vez de agregar la clave). Definirla como propiedad propia hace lo que se espera.
        Object.defineProperty(destino, clave, { value: valor, writable: true, enumerable: true, configurable: true });
        agregadas = true;
      }
      if (agregadas) body.documentos = JSON.stringify(destino);
    }
  }

  // ── Validación de URLs de documentos (Punto 3) ──
  // `documentos` debe contener SOLO URLs que realmente vengan de nuestro storage
  // (Cloudinary vía uploadFile(), ver lib/storage.ts) — nunca un string arbitrario que el
  // cliente se haya inventado (que jamás pasó por revisión ni existe de verdad).
  //
  // Se valida solo lo que CAMBIA: las URLs que YA están guardadas en este vehículo pasan sin
  // re-chequeo (mismo criterio que la allow-list de fotos más abajo). Si no, un documento
  // legado con URL anterior a Cloudinary (`/uploads/...`) — típicamente `todo_riesgo`, que ya
  // no se puede re-subir desde el formulario — dejaba la sección Documentos imposible de
  // guardar para siempre. La lista de exentas sale de la BD, no del body, así que una URL
  // NUEVA de dominio ajeno se sigue rechazando igual que antes.
  if (traeDocumentosNuevos && !documentosConUrlsValidas(body.documentos, String(vehiculo.documentos ?? ''))) {
    return NextResponse.json({ error: 'Documento inválido, vuelve a subirlo' }, { status: 400 });
  }

  // Tope defensivo (ver lib/precioMercado.ts): `precio_ajuste_pct` es para afinar +/- alta o
  // baja demanda, no para desplazar el precio arbitrariamente. El resultado final ya queda
  // acotado al rango del segmento dentro de precioMercadoSugerido, pero acotar también la
  // entrada evita guardar en la BD un valor sin sentido.
  if (body.precio_ajuste_pct !== undefined) {
    body.precio_ajuste_pct = Math.min(20, Math.max(-20, Number(body.precio_ajuste_pct) || 0));
  }

  // ── Standard field update ──
  // `precio_dia` NO se actualiza por el loop genérico: lo controla la lógica de precio automático
  // más abajo (recalcula desde categoría + valor comercial) o el override manual del admin.
  const ownFields = ['marca', 'modelo', 'anio', 'tipo', 'ubicacion', 'valor_comercial', 'precio_ajuste_pct',
    'descripcion', 'disponible', 'dias_disponibles', 'fotos_detalle', 'fotos', 'placa', 'documentos',
    'combustible', 'clase_vehiculo', 'exencion_pico_placa_inscrita'];
  // `archivado`: solo el admin lo toca (ni siquiera el propietario dueño), y solo para
  // DESARCHIVAR (0) — la vía normal para ENTRAR a archivado es DELETE (eliminar inteligente,
  // ver más abajo), que decide solo cuándo corresponde según el historial real del vehículo.
  // `contenido_revision`/`contenido_revision_motivo`: solo el admin los toca a mano, y solo
  // para APROBAR (contenido_revision: 0) tras revisar manualmente una publicación marcada.
  // La vía normal para ENTRAR a revisión es automática (ver más abajo), no este campo directo.
  const adminOnlyFields = ['documentos_estado', 'documentos_nota', 'en_vitrina', 'precio_manual', 'archivado',
    'contenido_revision', 'contenido_revision_motivo'];
  const allowed = isAdmin ? [...ownFields, ...adminOnlyFields] : ownFields;

  if (isAdmin && body.archivado !== undefined) {
    registrarAuditoria(db, user, {
      area: 'vehiculos', accion: Number(body.archivado) ? 'archivar_vehiculo' : 'desarchivar_vehiculo',
      entidad: 'vehiculo', entidad_id: Number(id),
      detalle: `${Number(body.archivado) ? 'Archivó' : 'Desarchivó'} ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}`,
    });
  }
  if (isAdmin && body.contenido_revision !== undefined) {
    registrarAuditoria(db, user, {
      area: 'vehiculos', accion: Number(body.contenido_revision) ? 'marcar_revision_contenido' : 'aprobar_revision_contenido',
      entidad: 'vehiculo', entidad_id: Number(id),
      detalle: `${Number(body.contenido_revision) ? 'Marcó en revisión de contenido' : 'Aprobó tras revisión de contenido'} ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}`,
    });
  }

  const pairs: string[] = [];
  const values: unknown[] = [];
  for (const f of allowed) {
    if (body[f] !== undefined) {
      pairs.push(`${f} = ?`);
      values.push(body[f]);
    }
  }

  // Moderación de contenido de fotos — modelo ALLOW-LIST (ver lib/moderacion.ts): si esta
  // actualización trae fotos, cada URL NUEVA (que el vehículo no tenía ya guardada antes
  // de este request) debe tener un registro server-side de haber pasado por /api/upload,
  // perteneciente al usuario que hace este request (propietario dueño o admin) — si no,
  // se rechaza (URL externa inventada, o subida por otra persona). Las URLs que el
  // vehículo YA tenía guardadas antes de este cambio se dejan pasar sin este chequeo de
  // pertenencia (compatibilidad con fotos que ya existían antes de esta migración/feature
  // y no tienen registro propio). Además, si alguna foto (nueva o ya existente) está
  // marcada como contenido inapropiado, se fuerza contenido_revision=1 sin importar el
  // rol (esto NO se puede omitir desde el cliente) — gana sobre lo que haya puesto el
  // admin en el mismo request (si mandó contenido_revision:0 para aprobar pero una foto
  // de ese mismo request sigue marcada, prevalece la marca de la IA, así que se
  // sobreescribe el valor ya puesto por el loop genérico en vez de duplicar la columna).
  if (body.fotos !== undefined || body.fotos_detalle !== undefined) {
    const urlsFotos = extraerUrlsFotos(body.fotos, body.fotos_detalle);
    const urlsExistentes = new Set(extraerUrlsFotos(vehiculo.fotos, vehiculo.fotos_detalle).map(normalizarUrlFoto));
    const urlsNuevas = urlsFotos.filter(u => !urlsExistentes.has(normalizarUrlFoto(u)));

    if (urlsNuevas.length > 0) {
      const registradasNuevas = fotosRegistradasEntre(db, urlsNuevas);
      for (const u of urlsNuevas) {
        const registro = registradasNuevas.get(normalizarUrlFoto(u));
        if (!registro || registro.usuarioId !== user.id) {
          return NextResponse.json(
            { error: 'Una o más fotos no son válidas. Vuelve a subirlas desde este formulario e intenta de nuevo.' },
            { status: 400 },
          );
        }
      }
    }

    const registradasTodas = fotosRegistradasEntre(db, urlsFotos);
    const fotosMarcadas = [...registradasTodas.values()].filter(r => r.contenidoInapropiado);
    if (fotosMarcadas.length > 0) {
      const motivo = fotosMarcadas.map(f => f.motivo).filter(Boolean).join(' | ');
      const idxRevision = pairs.indexOf('contenido_revision = ?');
      if (idxRevision !== -1) values[idxRevision] = 1;
      else { pairs.push('contenido_revision = ?'); values.push(1); }
      const idxMotivo = pairs.indexOf('contenido_revision_motivo = ?');
      if (idxMotivo !== -1) values[idxMotivo] = motivo;
      else { pairs.push('contenido_revision_motivo = ?'); values.push(motivo); }
    }
  }

  // ── Aplicar a la escritura atómica el cierre de bypass de `anio` (ver comentario extenso
  //    más arriba, junto al gate de disponibilidad) ──
  // Si además llegaron `documentos` NUEVOS en este mismo request, el bloque de abajo
  // (`if (body.documentos !== undefined)`) ya hace un reset MÁS fuerte — TODAS las
  // revisiones a '{}' (no solo `tecno`) y `disponible` a 0 incondicionalmente — así que lo
  // dejamos ganar en ese caso raro combinado, para no pisarlo con un `documentos_revisiones`
  // parcial calculado sobre datos que esta misma request está a punto de reemplazar.
  if (anioCambio && !traeDocumentosNuevos) {
    const nuevoEstadoDocs = computeEstado(docsFrescos, revsFrescos, anioEfectivo);
    const tecnoExigibleFinal = tecnoRequerida(anioEfectivo);
    // `baseDisponible`: si este MISMO request también trae `disponible` explícito, se usa
    // ese valor como base (ya sea el 0 que alguien pidió directamente, o el 1 que ya pasó el
    // gate de arriba usando estos mismos `docsFrescos`/`revsFrescos`/`anioEfectivo` — así que
    // recalcularlo acá con la misma lógica da el mismo resultado, sin pelear con el gate). Si
    // el request NO toca `disponible`, se usa el valor que tenía en BD antes de este PUT —
    // este es el caso del bypass retroactivo: un vehículo YA disponible=1 al que le cambian
    // el `anio` sin pedir nada sobre `disponible`, y que debe apagarse si ya no cumple.
    const baseDisponible = body.disponible !== undefined ? Number(body.disponible) : disponibleAntesDePut;
    const nuevoDisponible = (baseDisponible === 1 && (!aprobadoFresco('soat') || (tecnoExigibleFinal && !aprobadoFresco('tecno'))))
      ? 0 : baseDisponible;

    // Mismo patrón "upsert" ya usado arriba para `contenido_revision`/`contenido_revision_motivo`
    // (ver bloque de moderación de fotos): si el loop genérico de `ownFields`/`adminOnlyFields`
    // ya iba a escribir alguno de estos 3 campos (`disponible` está en `ownFields`;
    // `documentos_estado` en `adminOnlyFields`), este cálculo tiene la última palabra —
    // sobrescribe el valor en `values` en vez de duplicar la columna en el `UPDATE`.
    const upsertPair = (col: string, val: unknown) => {
      const key = `${col} = ?`;
      const idx = pairs.indexOf(key);
      if (idx !== -1) values[idx] = val;
      else { pairs.push(key); values.push(val); }
    };
    upsertPair('documentos_revisiones', JSON.stringify(revsFrescos));
    upsertPair('documentos_estado', nuevoEstadoDocs);
    upsertPair('disponible', nuevoDisponible);
  }

  if (body.documentos !== undefined) {
    // Nota: este reset se aplica sin distinguir admin/propietario. Documentos nuevos
    // siempre invalidan las revisiones previas y apagan `disponible`, sin importar quién
    // los suba — hoy solo el propietario manda `documentos` por esta ruta, pero el campo
    // también está permitido para el admin (ver `ownFields` arriba), y este reset debe
    // aplicar igual si algún día lo usa.
    pairs.push('documentos_estado = ?'); values.push('en_revision');
    pairs.push('documentos_nota = ?');   values.push('');
    pairs.push('documentos_revisiones = ?'); values.push('{}');
    // Reemplazar documentos deja SOAT/Tecno sin revisar de nuevo (documentos_revisiones
    // queda '{}' arriba) — el gate de disponibilidad ya bloquea que esta MISMA request
    // encienda disponible=1 (ver arriba), pero si el vehículo YA estaba disponible=1 por
    // una request anterior, ese estado quedaría colgado indefinidamente sin este apagado
    // explícito. Se fuerza a 0 aquí para que no siga siendo rentable con documentos que ya
    // no están aprobados.
    pairs.push('disponible = ?'); values.push(0);

    const adminRow = db.prepare("SELECT id FROM usuarios WHERE rol='admin' LIMIT 1").get() as { id: number } | undefined;
    if (adminRow) {
      const vRow = db.prepare('SELECT marca, modelo, anio, placa FROM vehiculos WHERE id = ?').get(Number(id)) as { marca: string; modelo: string; anio: number; placa?: string } | undefined;
      const vLabel = vRow
        ? `${vRow.marca} ${vRow.modelo} ${vRow.anio}${vRow.placa ? ` (${vRow.placa})` : ''}`
        : `Vehículo #${id}`;
      db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(adminRow.id, 'documentos_subidos', '📄 Documentos pendientes de revisión',
          `${user.nombre} subió documentos para ${vLabel}`, Number(id), 'vehiculo');
    }
  }

  if (pairs.length > 0) {
    db.prepare(`UPDATE vehiculos SET ${pairs.join(', ')} WHERE id = ?`).run(...values, Number(id));
  }

  // ── Precio automático de mercado ──
  // Regla: el precio se deriva de la categoría + valor comercial (lib/precioMercado.ts) y se
  // recalcula solo cuando cambia algo que lo afecta, salvo que el admin lo haya fijado a mano.
  let precioFinal: number | null = null;
  if (isAdmin && body.precio_dia !== undefined) {
    // Override manual del admin: guarda el precio y bloquea el recálculo automático.
    precioFinal = Math.max(0, Number(body.precio_dia) || 0);
    db.prepare('UPDATE vehiculos SET precio_dia = ?, precio_manual = 1 WHERE id = ?').run(precioFinal, Number(id));
  } else {
    const afectaPrecio = ['tipo', 'valor_comercial', 'precio_ajuste_pct', 'precio_manual']
      .some(f => body[f] !== undefined);
    if (afectaPrecio) {
      const row = db.prepare('SELECT tipo, valor_comercial, precio_ajuste_pct, precio_manual FROM vehiculos WHERE id = ?')
        .get(Number(id)) as { tipo: string; valor_comercial: number; precio_ajuste_pct: number; precio_manual: number } | undefined;
      if (row && !row.precio_manual) {
        precioFinal = precioMercadoSugerido(segmentoValido(row.tipo), Number(row.valor_comercial) || 0, Number(row.precio_ajuste_pct) || 0);
        db.prepare('UPDATE vehiculos SET precio_dia = ? WHERE id = ?').run(precioFinal, Number(id));
      }
    }
  }

  return NextResponse.json({ ok: true, ...(precioFinal !== null ? { precio_dia: precioFinal } : {}) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(Number(id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Mismo criterio que el PUT: al admin se le exige la sección, al propietario la pertenencia.
  if (user.rol === 'admin') {
    if (!adminTieneArea(db, user.id, 'vehiculos')) return sinPermisoArea();
  } else if (Number(vehiculo.propietario_id) !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // "Eliminar inteligente" (ver lib/eliminar.ts): antes esto era un DELETE sin ninguna
  // validación de historial, capaz de tumbar reservas/remisiones/liquidaciones ya
  // existentes por la FK NOT NULL de esas tablas hacia vehiculos(id). Ahora, si el
  // vehículo tiene reservas (historial de negocio real) se ARCHIVA en vez de borrarse
  // (reversible, ver PUT { archivado: 0 } más arriba); si nunca tuvo reservas, se borra
  // de verdad.
  const resultado = eliminarVehiculoInteligente(db, Number(id));

  registrarAuditoria(db, user, {
    area: 'vehiculos',
    accion: resultado === 'borrado' ? 'eliminar_vehiculo' : 'archivar_vehiculo',
    entidad: 'vehiculo', entidad_id: Number(id),
    detalle: resultado === 'borrado'
      ? `Eliminó (borrado real) ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} — sin historial de negocio`
      : `Archivó ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} — tiene reservas, se conserva reversible`,
  });

  return NextResponse.json({ ok: true, resultado });
}
