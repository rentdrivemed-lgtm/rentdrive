import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import {
  cargarDetalleServicio, mensajeMensajero, mensajeAdmin, getConfig, recomputarEstadoOperacion,
  ejecutarInspeccion, appBaseUrl, bloqueoFotosTarea, guardarFotosFase, guardarFotoCasilla,
  quitarFotoSuelta, omitirCasilla, quitarOmision, congelarActa, congelarActaDeFase,
  limpiarInspeccion, invalidarInspeccionSiFaseVacia, motivoFaseVacia, MAX_FOTOS_FASE,
} from '@/lib/operaciones';
import { registrarAuditoria } from '@/lib/permisos';
import {
  esCasilla, esFase, esUrlFotoSegura, normalizarMotivo, parseFotosServicio,
  MOTIVO_MIN, URL_MAX,
} from '@/lib/fotos-servicio';
import { enviarWhatsapp } from '@/lib/whatsapp';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { limiteInspeccion, faltanFotosParaInspeccion } from '@/lib/inspeccion-vehiculo';

export const dynamic = 'force-dynamic';
// La inspección con IA manda hasta 16 fotos en una sola llamada a Claude: puede
// tardar bastante más que el resto de acciones de esta ruta (mismo valor que ya
// usa /api/m/[token], que ejecuta exactamente la misma inspección).
// OJO: en el despliegue actual (Railway con Docker) este valor no corta nada —
// solo lo respetan plataformas tipo Vercel. El tope real de la inspección vive
// en lib/inspeccion-vehiculo.ts (TIMEOUT_LLAMADA_MS / PRESUPUESTO_TOTAL_MS).
export const maxDuration = 60;

type Op = { id: number; reserva_id: number; mensajero_id: number | null; estado: string; notas: string };

const ESTADOS_OP = ['pendiente', 'asignada', 'en_proceso', 'finalizada'];

// Acciones que pueden dejar una fase SIN fotos. Después de cualquiera de ellas se
// comprueba si el veredicto de la IA se quedó huérfano (ver el bloque al final del PUT).
const ACCIONES_QUE_QUITAN_FOTOS = new Set(['fotos', 'quitar_foto_suelta', 'foto_casilla']);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('operaciones');
  if ('error' in g) return g.error;
  const { db } = g;

  const { id } = await params;
  const opId = Number(id);
  const body = await req.json().catch(() => ({}));

  const op = db.prepare('SELECT id, reserva_id, mensajero_id, estado, notas FROM operaciones WHERE id = ?').get(opId) as Op | undefined;
  if (!op) return NextResponse.json({ error: 'Operación no encontrada' }, { status: 404 });

  switch (body.accion) {
    // ── Asignar mensajero y notificarlo por WhatsApp ──
    case 'asignar': {
      const mensajeroId = body.mensajero_id ? Number(body.mensajero_id) : null;
      let wa = '';
      if (mensajeroId) {
        const m = db.prepare('SELECT nombre, celular, token FROM mensajeros WHERE id = ?').get(mensajeroId) as { nombre: string; celular: string; token: string } | undefined;
        if (!m) return NextResponse.json({ error: 'Mensajero no encontrado' }, { status: 404 });
        db.prepare("UPDATE operaciones SET mensajero_id = ?, estado = CASE WHEN estado = 'pendiente' THEN 'asignada' ELSE estado END WHERE id = ?").run(mensajeroId, opId);

        const det = cargarDetalleServicio(db, op.reserva_id);
        const tareas = db.prepare('SELECT titulo, detalle FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId) as { titulo: string; detalle: string }[];
        const enlace = m.token ? `${appBaseUrl()}/m/${m.token}` : undefined;
        wa = det
          ? (await enviarWhatsapp(m.celular, mensajeMensajero(det, tareas, enlace))).detalle
          : 'no enviado: sin detalle del servicio';
        if (!m.celular) wa = 'no enviado: el mensajero no tiene celular registrado';
        db.prepare('UPDATE operaciones SET wa_mensajero = ? WHERE id = ?').run(wa, opId);
      } else {
        db.prepare("UPDATE operaciones SET mensajero_id = NULL, wa_mensajero = '' WHERE id = ?").run(opId);
      }
      break;
    }

    // ── Cerrar o reabrir el servicio a mano (botón del panel) ──
    //
    // Es un ATAJO deliberado: el administrador puede dar por cerrado un servicio
    // aunque falten fotos o tareas por marcar (decisión del dueño — la pantalla le
    // dice cuántas faltan y de qué fase antes de confirmar, pero no se lo impide).
    //
    // Por eso el acta se congela TAMBIÉN acá. `recomputarEstadoOperacion` solo la
    // dispara en la transición que hace la última tarea, y su UPDATE lleva
    // `AND estado != 'finalizada'`: una vez cerrado a mano, el estado es pegajoso y
    // marcar las tareas después ya no vuelve a pasar por esa transición. Sin esta
    // llamada, el atajo dejaba el servicio cerrado SIN NINGÚN respaldo y sin que
    // nadie se enterara — justo el caso en que más falta hace, porque se cerró con
    // cosas a medias.
    //
    // REABRIR limpia además el veredicto de la inspección con IA. Caso real: un
    // mensajero fotografió un carro equivocado, la IA dictaminó "con daños" sobre el
    // capó de un vehículo que no era el de la reserva, y ese veredicto se quedó
    // guardado sin ninguna forma de quitarlo. Si el servicio se reabre es justamente
    // para rehacerlo: el veredicto anterior ya no describe nada, y un "con daños"
    // huérfano es con lo que se le cobra un daño a quien no lo hizo.
    // Las actas ya congeladas NO se tocan (ver `limpiarInspeccion`): la que se generó
    // al cerrar conserva el veredicto que había en ese momento, que es su trabajo.
    case 'estado': {
      if (!ESTADOS_OP.includes(body.estado)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
      const reabierto = op.estado === 'finalizada' && body.estado !== 'finalizada';
      db.prepare('UPDATE operaciones SET estado = ? WHERE id = ?').run(body.estado, opId);
      // `op.estado` es el valor de ANTES (se leyó al entrar). Reabrir y volver a
      // cerrar genera una versión NUEVA, sin pisar la anterior; si entre un cierre y
      // otro no cambió nada del respaldo, `generarActaCierre` deduplica y no llena el
      // historial de copias iguales. El acta se congela ANTES de cualquier limpieza:
      // el cierre guarda lo que había, la limpieza solo ocurre al reabrir.
      if (body.estado === 'finalizada' && op.estado !== 'finalizada') congelarActa(db, opId);
      if (reabierto) {
        const limpiada = limpiarInspeccion(db, opId);
        registrarAuditoria(db, { id: g.user.id, nombre: g.user.nombre, correo: g.user.correo, nivel: g.nivel }, {
          area: 'operaciones',
          accion: 'reabrir_servicio',
          entidad: 'operaciones',
          entidad_id: opId,
          detalle: JSON.stringify({
            reserva_id: op.reserva_id,
            estado_nuevo: body.estado,
            inspeccion_ia_limpiada: limpiada,
          }),
        });
      }
      break;
    }

    // ── Marcar/desmarcar una tarea ──
    case 'tarea': {
      const tareaId = Number(body.tarea_id);
      const estadoTarea = body.estado === 'hecho' ? 'hecho' : 'pendiente';
      const t = db.prepare('SELECT id, tipo FROM operacion_tareas WHERE id = ? AND operacion_id = ?').get(tareaId, opId) as { id: number; tipo: string } | undefined;
      if (!t) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
      // Las tareas de entrega y devolución exigen las 8 fotos de su fase (o el motivo
      // escrito de cada casilla que falte). La comprobación es del SERVIDOR: que la
      // pantalla deshabilite el botón no sirve de nada contra una llamada directa.
      // No aplica a las operaciones creadas antes de las casillas guiadas (ver
      // `bloqueoFotosTarea`). DESMARCAR nunca se bloquea.
      if (estadoTarea === 'hecho') {
        const bloqueo = bloqueoFotosTarea(db, opId, t.tipo);
        if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 400 });
      }
      db.prepare('UPDATE operacion_tareas SET estado = ? WHERE id = ?').run(estadoTarea, tareaId);
      recomputarEstadoOperacion(db, opId, op.mensajero_id);
      // Congelar el respaldo también acá, y no solo al cerrarse el servicio: entre
      // marcar "vehículo entregado" y cerrar pueden pasar días, y en esa ventana
      // cualquiera puede quitar las fotos que se acaban de subir sin dejar rastro
      // (el bloqueo solo mira el instante en que se marca la tarea). Este es el único
      // momento en que consta que las fotos estaban. Solo aplica a las tareas de fase
      // —entrega y devolución—; el dedupe de `generarActaCierre` evita versiones
      // repetidas si `recomputarEstadoOperacion` ya congeló una recién.
      if (estadoTarea === 'hecho') congelarActaDeFase(db, opId, t.tipo);
      break;
    }

    // ── Notas internas ──
    case 'notas': {
      db.prepare('UPDATE operaciones SET notas = ? WHERE id = ?').run(String(body.notas ?? ''), opId);
      break;
    }

    // ── Reemplazar TODA la lista de fotos de una fase ──
    // Acción LEGADA (ninguna pantalla la usa ya: quitar una foto suelta pasó a
    // `quitar_foto_suelta`, que filtra en el servidor). Se conserva para las versiones
    // de la app que sigan abiertas en un navegador. Acepta los dos formatos: `urls`
    // (array de strings, lo que mandaban las versiones anteriores) y `fotos`
    // ([{casilla, url}]).
    //
    // La fase se valida con `esFase` y responde 400, igual que el resto de acciones.
    // Antes era `body.fase === 'entrada' ? 'entrada' : 'salida'`, y como esta acción
    // REEMPLAZA la fase entera, cualquier fase mal escrita —'Entrada', 'ENTRADA', un
    // typo— caía en 'salida' y borraba las fotos de la entrega devolviendo 200. Es la
    // acción más destructiva de la ruta: es la que más falta le hacía.
    case 'fotos': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      const fase = body.fase;
      const crudas = Array.isArray(body.fotos) ? body.fotos : Array.isArray(body.urls) ? body.urls : null;
      if (crudas === null) return NextResponse.json({ error: 'Faltan las fotos' }, { status: 400 });
      if (crudas.length > MAX_FOTOS_FASE) {
        return NextResponse.json({ error: `Demasiadas fotos en una sola fase (máximo ${MAX_FOTOS_FASE}).` }, { status: 400 });
      }
      // Se validan al ESCRIBIR, nunca al leer: filtrar al leer borraría de pantalla
      // fotos de servicios reales sin que nadie se entere.
      const fotos = parseFotosServicio(crudas).filter(f => esUrlFotoSegura(f.url));
      guardarFotosFase(db, opId, fase, fotos);
      break;
    }

    // ── Quitar UNA foto suelta (sin casilla) de las operaciones viejas ──
    // Sustituye al uso que la pantalla le daba a `fotos`: mandaba la lista completa
    // desde su propia copia, así que borraba de paso todo lo que alguien más hubiera
    // subido mientras tanto. Acá solo viaja la URL que se quiere quitar y el filtrado
    // ocurre en el servidor, dentro de una transacción.
    case 'quitar_foto_suelta': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url || url.length > URL_MAX) return NextResponse.json({ error: 'Falta la foto que se quiere quitar' }, { status: 400 });
      // Idempotente a propósito: si la foto ya no estaba, el estado final es el que se
      // pedía y la pantalla se refresca con la operación actualizada.
      quitarFotoSuelta(db, opId, body.fase, url);
      break;
    }

    // ── Guardar/reemplazar la foto de UNA casilla del recorrido guiado ──
    // Solo toca su casilla: dos guardados que se crucen no se pisan entre sí.
    // `url` vacía = quitar la foto de esa casilla.
    case 'foto_casilla': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      if (!esCasilla(body.casilla)) return NextResponse.json({ error: 'Casilla inválida' }, { status: 400 });
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (url && !esUrlFotoSegura(url)) return NextResponse.json({ error: 'La dirección de la foto no es válida' }, { status: 400 });
      guardarFotoCasilla(db, opId, body.fase, body.casilla, url);
      break;
    }

    // ── Omitir una casilla dejando el motivo por escrito ──
    // La salida de emergencia del bloqueo: sin esto, un mensajero sin batería o con
    // el carro encajonado se queda sin poder cerrar el servicio. El motivo queda con
    // nombre y hora, y sale impreso en el acta de respaldo.
    case 'omitir_casilla': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      if (!esCasilla(body.casilla)) return NextResponse.json({ error: 'Casilla inválida' }, { status: 400 });
      const motivo = normalizarMotivo(body.motivo);
      if (!motivo) return NextResponse.json({ error: `Escribe el motivo por el que no se puede tomar esta foto (al menos ${MOTIVO_MIN} caracteres).` }, { status: 400 });
      const guardada = omitirCasilla(db, opId, body.fase, body.casilla, motivo, {
        nombre: g.user.nombre || g.user.correo || 'Administrador',
        tipo: 'admin',
      });
      // Falso = esa casilla ya tiene foto; registrar un motivo encima dejaría el acta
      // diciendo dos cosas a la vez.
      if (!guardada) return NextResponse.json({ error: 'Esa foto ya está tomada. Quítala primero si quieres dejar un motivo.' }, { status: 400 });
      break;
    }

    // ── Deshacer una omisión ──
    // Solo puede volver a BLOQUEAR la tarea (la casilla vuelve a contar como
    // pendiente), nunca desbloquearla.
    case 'quitar_omision': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      if (!esCasilla(body.casilla)) return NextResponse.json({ error: 'Casilla inválida' }, { status: 400 });
      quitarOmision(db, opId, body.fase, body.casilla);
      break;
    }

    // ── Ejecutar inspección de daños con IA ──
    case 'inspeccion': {
      if (!tieneClaveAnthropic()) {
        return NextResponse.json({ error: 'La inspección con IA no está configurada: falta ANTHROPIC_API_KEY.' }, { status: 503 });
      }
      // Los chequeos BARATOS van antes de gastar un intento del límite: el fallo
      // más común (todavía no hay fotos de un juego) no llega a descargar nada
      // ni a llamar a la IA, así que no tiene por qué consumir cuota.
      const fotosOp = db.prepare('SELECT fotos_salida, fotos_entrada FROM operaciones WHERE id = ?').get(opId) as { fotos_salida: string | null; fotos_entrada: string | null } | undefined;
      const faltan = faltanFotosParaInspeccion(fotosOp?.fotos_salida, fotosOp?.fotos_entrada);
      if (faltan) return NextResponse.json({ error: faltan }, { status: 400 });
      const excedido = limiteInspeccion(`admin:${g.user.id}`);
      if (excedido) return NextResponse.json({ error: excedido }, { status: 429 });
      try {
        await ejecutarInspeccion(db, opId);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Error en la inspección' }, { status: 400 });
      }
      break;
    }

    // ── Reenviar WhatsApp (al mensajero o al administrador) ──
    case 'reenviar': {
      const det = cargarDetalleServicio(db, op.reserva_id);
      if (!det) return NextResponse.json({ error: 'Sin detalle del servicio' }, { status: 400 });
      if (body.destino === 'admin') {
        const adminWa = getConfig(db, 'admin_whatsapp');
        const r = adminWa ? (await enviarWhatsapp(adminWa, mensajeAdmin(det))).detalle : 'no enviado: falta el WhatsApp del administrador';
        db.prepare('UPDATE operaciones SET wa_admin = ? WHERE id = ?').run(r, opId);
      } else {
        if (!op.mensajero_id) return NextResponse.json({ error: 'No hay mensajero asignado' }, { status: 400 });
        const m = db.prepare('SELECT celular, token FROM mensajeros WHERE id = ?').get(op.mensajero_id) as { celular: string; token: string } | undefined;
        const tareas = db.prepare('SELECT titulo, detalle FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId) as { titulo: string; detalle: string }[];
        const enlace = m?.token ? `${appBaseUrl()}/m/${m.token}` : undefined;
        const r = m?.celular ? (await enviarWhatsapp(m.celular, mensajeMensajero(det, tareas, enlace))).detalle : 'no enviado: el mensajero no tiene celular';
        db.prepare('UPDATE operaciones SET wa_mensajero = ? WHERE id = ?').run(r, opId);
      }
      break;
    }

    default:
      return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  }

  // Si la acción dejó una fase SIN NINGUNA foto, el veredicto de la inspección ya no
  // describe nada que exista: se limpia solo y queda constancia de quién lo provocó
  // (ver `invalidarInspeccionSiFaseVacia` para el porqué de "fase vacía" y de que sea
  // automático). Va DESPUÉS del switch para que la operación que se devuelve abajo ya
  // salga sin el veredicto, y las actas ya congeladas no se tocan.
  if (ACCIONES_QUE_QUITAN_FOTOS.has(body.accion)) {
    const faseVacia = invalidarInspeccionSiFaseVacia(db, opId);
    if (faseVacia) {
      registrarAuditoria(db, { id: g.user.id, nombre: g.user.nombre, correo: g.user.correo, nivel: g.nivel }, {
        area: 'operaciones',
        accion: 'limpiar_inspeccion_ia',
        entidad: 'operaciones',
        entidad_id: opId,
        detalle: JSON.stringify({ reserva_id: op.reserva_id, motivo: motivoFaseVacia(faseVacia), accion: body.accion }),
      });
    }
  }

  // Devolver la operación actualizada (con detalle, tareas y mensajero).
  const actualizada = db.prepare(`
    SELECT o.*, m.nombre AS mensajero_nombre, m.celular AS mensajero_celular
    FROM operaciones o LEFT JOIN mensajeros m ON o.mensajero_id = m.id WHERE o.id = ?
  `).get(opId) as Record<string, unknown>;
  const tareas = db.prepare('SELECT id, tipo, titulo, detalle, estado, orden FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId);
  return NextResponse.json({ operacion: { ...actualizada, detalle: cargarDetalleServicio(db, op.reserva_id) || null, tareas } });
}
