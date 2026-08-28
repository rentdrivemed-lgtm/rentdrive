import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { precioMercadoSugerido, segmentoValido } from '@/lib/precioMercado';
import { eliminarVehiculoInteligente } from '@/lib/eliminar';
import { registrarAuditoria } from '@/lib/permisos';
import { contieneLenguajeInapropiado, extraerUrlsFotos, fotosRegistradasEntre, normalizarUrlFoto } from '@/lib/moderacion';

const DOC_KEYS = ['soat', 'tecno', 'tarjeta', 'todo_riesgo'] as const;
const DOC_LABELS: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad', todo_riesgo: 'Seguro todo riesgo',
};

type DocRevision = { estado: string; nota: string };
type VehicleRow = { documentos: string; documentos_revisiones: string; propietario_id: number; marca: string; modelo: string; anio: number; placa?: string };

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
  `).get(Number(id)) as Record<string, unknown> | undefined;

  if (!vehiculo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  // Moderación de contenido (ver lib/moderacion.ts): un vehículo marcado en revisión de
  // contenido (contenido_revision=1) tampoco debe ser visible/accesible por esta ruta
  // pública — antes solo GET /api/vehiculos (el listado) lo excluía; esta ruta de detalle
  // por id se podía seguir consultando directo aunque el vehículo no apareciera listado.
  // Mismo criterio que `archivado`, pero el propietario dueño SÍ puede seguir viendo el
  // detalle de su propio vehículo (para ver por qué está en revisión), igual que el admin
  // con la sección "vehiculos".
  if (Number(vehiculo.contenido_revision) === 1) {
    const user = await getCurrentUser();
    const esDueño = !!user && user.rol === 'propietario' && Number(vehiculo.propietario_id) === user.id;
    const esAdminConPermiso = !!user && user.rol === 'admin' && adminTieneArea(db, user.id, 'vehiculos');
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

  // ── Admin: review individual document ──
  if (isAdmin && body.revisar_documento) {
    const { key, estado, nota } = body.revisar_documento as { key: string; estado: string; nota: string };

    const row = db.prepare('SELECT documentos, documentos_revisiones, propietario_id, marca, modelo, anio, placa FROM vehiculos WHERE id = ?').get(Number(id)) as VehicleRow | undefined;
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

    db.prepare('UPDATE vehiculos SET documentos_revisiones = ?, documentos_estado = ?, documentos_nota = ? WHERE id = ?')
      .run(JSON.stringify(revs), newEstado, newNota, Number(id));

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

  // ── Standard field update ──
  // `precio_dia` NO se actualiza por el loop genérico: lo controla la lógica de precio automático
  // más abajo (recalcula desde categoría + valor comercial) o el override manual del admin.
  const ownFields = ['marca', 'modelo', 'anio', 'tipo', 'ubicacion', 'valor_comercial', 'precio_ajuste_pct',
    'descripcion', 'disponible', 'dias_disponibles', 'fotos_detalle', 'fotos', 'placa', 'documentos'];
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

  if (!isAdmin && body.documentos !== undefined) {
    pairs.push('documentos_estado = ?'); values.push('en_revision');
    pairs.push('documentos_nota = ?');   values.push('');
    pairs.push('documentos_revisiones = ?'); values.push('{}');

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
