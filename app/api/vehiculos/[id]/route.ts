import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { precioMercadoSugerido, segmentoValido } from '@/lib/precioMercado';
import { eliminarVehiculoInteligente } from '@/lib/eliminar';
import { registrarAuditoria } from '@/lib/permisos';
import { documentosConUrlsValidas } from '@/lib/storage';

const DOC_KEYS = ['soat', 'tecno', 'tarjeta', 'todo_riesgo'] as const;
const DOC_LABELS: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad', todo_riesgo: 'Seguro todo riesgo',
};

type DocRevision = { estado: string; nota: string };
type VehicleRow = { documentos: string; documentos_revisiones: string; propietario_id: number; marca: string; modelo: string; anio: number; placa?: string; disponible: number };

function computeEstado(docs: Record<string, { url?: string } | undefined>, revs: Record<string, DocRevision>): string {
  const uploaded = DOC_KEYS.filter(k => (docs[k] as { url?: string } | undefined)?.url);
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
  `).get(Number(id));

  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Fechas ya ocupadas por reservas activas (rango inclusivo, igual que la verificación de conflictos del POST).
  const reservas = db.prepare(
    `SELECT fecha_inicio, fecha_fin FROM reservas WHERE vehiculo_id = ? AND estado NOT IN ('cancelada')`
  ).all(Number(id)) as { fecha_inicio: string; fecha_fin: string }[];

  const ocupadasSet = new Set<string>();
  for (const r of reservas) {
    for (const d of rangoDias(r.fecha_inicio, r.fecha_fin)) ocupadasSet.add(d);
  }

  return NextResponse.json({ vehiculo, ocupadas: [...ocupadasSet] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(Number(id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

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
    const newEstado = computeEstado(docs, revs);
    const newNota = DOC_KEYS
      .filter(k => revs[k]?.estado === 'denegado')
      .map(k => `${DOC_LABELS[k]}: ${revs[k]?.nota || 'Sin motivo'}`)
      .join('\n');

    // Si esta revisión deja SOAT o Tecno sin estar "aprobado" (ej. el admin deniega uno que
    // ya estaba aprobado), el vehículo no puede seguir disponible — ver gate de disponibilidad
    // más abajo en el PUT. Se apaga en la MISMA escritura, no queda "disponible" colgado con
    // un documento recién rechazado.
    const aprobadoTrasRevision = (clave: string) => !!docs[clave]?.url && revs[clave]?.estado === 'aprobado';
    const nuevoDisponible = (row.disponible === 1 && (!aprobadoTrasRevision('soat') || !aprobadoTrasRevision('tecno')))
      ? 0 : row.disponible;

    db.prepare('UPDATE vehiculos SET documentos_revisiones = ?, documentos_estado = ?, documentos_nota = ?, disponible = ? WHERE id = ?')
      .run(JSON.stringify(revs), newEstado, newNota, nuevoDisponible, Number(id));

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
  // `vehiculo` leída arriba (línea ~74) para este chequeo, porque esa lectura ocurrió
  // ANTES del único `await` de esta función (`await req.json()`). Si dos PUT llegan casi
  // simultáneos — uno subiendo `documentos` nuevos (resetea documentos_revisiones) y otro
  // con `disponible: 1` — ambos podrían haber capturado la fila vieja antes de que el
  // primero terminara de escribir, y el segundo pasaría el gate con datos obsoletos. Por
  // eso releemos documentos/documentos_revisiones DE LA BASE justo aquí, DESPUÉS del
  // `await`: de aquí en adelante el resto del handler es 100% síncrono (better-sqlite3 no
  // usa promesas), así que lectura → chequeo → escritura corren en un solo turno de Node
  // sin ninguna ventana donde otro request pueda interponerse.
  const intentaHabilitar = body.disponible !== undefined && Number(body.disponible) === 1;
  const traeDocumentosNuevos = body.documentos !== undefined;
  if (intentaHabilitar && traeDocumentosNuevos) {
    return NextResponse.json({
      error: 'No puedes subir documentos nuevos y marcar el vehículo como disponible en la misma solicitud. Sube los documentos primero; una vez aprobados por DrivePass, actívalo.',
    }, { status: 400 });
  }
  if (intentaHabilitar) {
    const filaActual = db.prepare('SELECT documentos, documentos_revisiones FROM vehiculos WHERE id = ?')
      .get(Number(id)) as { documentos: string; documentos_revisiones: string } | undefined;
    if (!filaActual) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    let docs: Record<string, { url?: string } | undefined> = {};
    let revs: Record<string, { estado?: string }> = {};
    try { docs = JSON.parse(filaActual.documentos || '{}'); } catch { /* */ }
    try { revs = JSON.parse(filaActual.documentos_revisiones || '{}'); } catch { /* */ }
    const aprobado = (clave: string) => !!docs[clave]?.url && revs[clave]?.estado === 'aprobado';
    if (!aprobado('soat') || !aprobado('tecno')) {
      return NextResponse.json({
        error: 'No puedes marcar el vehículo como disponible: el SOAT y la Tecno-mecánica deben estar aprobados por DrivePass primero.',
      }, { status: 400 });
    }
  }

  // ── Validación de URLs de documentos (Punto 3) ──
  // `documentos` debe contener SOLO URLs que realmente vengan de nuestro storage
  // (Cloudinary vía uploadFile(), ver lib/storage.ts) — nunca un string arbitrario que el
  // cliente se haya inventado (que jamás pasó por revisión ni existe de verdad).
  if (traeDocumentosNuevos && !documentosConUrlsValidas(body.documentos)) {
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
    'descripcion', 'disponible', 'dias_disponibles', 'fotos_detalle', 'fotos', 'placa', 'documentos'];
  // `archivado`: solo el admin lo toca (ni siquiera el propietario dueño), y solo para
  // DESARCHIVAR (0) — la vía normal para ENTRAR a archivado es DELETE (eliminar inteligente,
  // ver más abajo), que decide solo cuándo corresponde según el historial real del vehículo.
  const adminOnlyFields = ['documentos_estado', 'documentos_nota', 'en_vitrina', 'precio_manual', 'archivado'];
  const allowed = isAdmin ? [...ownFields, ...adminOnlyFields] : ownFields;

  if (isAdmin && body.archivado !== undefined) {
    registrarAuditoria(db, user, {
      area: 'vehiculos', accion: Number(body.archivado) ? 'archivar_vehiculo' : 'desarchivar_vehiculo',
      entidad: 'vehiculo', entidad_id: Number(id),
      detalle: `${Number(body.archivado) ? 'Archivó' : 'Desarchivó'} ${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}`,
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
