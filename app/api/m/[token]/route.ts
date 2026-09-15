import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  cargarDetalleServicio, recomputarEstadoOperacion, ejecutarInspeccion,
  bloqueoFotosTarea, guardarFotosFase, guardarFotoCasilla, quitarFotoSuelta,
  omitirCasilla, quitarOmision, congelarActaDeFase,
  invalidarInspeccionSiFaseVacia, motivoFaseVacia, MAX_FOTOS_FASE,
} from '@/lib/operaciones';
import { registrarAuditoria } from '@/lib/permisos';
import {
  esCasilla, esFase, esUrlFotoSegura, normalizarMotivo, parseFotosServicio,
  MOTIVO_MIN, URL_MAX,
} from '@/lib/fotos-servicio';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { limiteInspeccion, faltanFotosParaInspeccion } from '@/lib/inspeccion-vehiculo';

export const dynamic = 'force-dynamic';
// Inerte en Railway (Docker): solo lo respetan plataformas tipo Vercel. El tope
// real de la inspección vive en lib/inspeccion-vehiculo.ts.
export const maxDuration = 60;

type Mensajero = { id: number; nombre: string };

// Acciones que pueden dejar una fase SIN fotos (ver el bloque al final del PUT).
const ACCIONES_QUE_QUITAN_FOTOS = new Set(['fotos', 'quitar_foto_suelta', 'foto_casilla']);

// Solo resuelve mensajeros ACTIVOS: al desactivar (o dar de baja) a un mensajero
// su enlace deja de funcionar de inmediato.
function resolverMensajero(token: string): Mensajero | undefined {
  if (!token || token.length < 8) return undefined;
  const db = getDb();
  return db.prepare('SELECT id, nombre FROM mensajeros WHERE token = ? AND activo = 1').get(token) as Mensajero | undefined;
}

function serializarOperacion(opId: number) {
  const db = getDb();
  const op = db.prepare('SELECT * FROM operaciones WHERE id = ?').get(opId) as Record<string, unknown>;
  const tareas = db.prepare('SELECT id, tipo, titulo, detalle, estado, orden FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId);
  return { ...op, detalle: cargarDetalleServicio(db, Number(op.reserva_id)) || null, tareas };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = resolverMensajero(token);
  if (!m) return NextResponse.json({ error: 'Enlace inválido' }, { status: 404 });

  const db = getDb();
  const ops = db.prepare('SELECT id FROM operaciones WHERE mensajero_id = ? ORDER BY created_at DESC, id DESC').all(m.id) as { id: number }[];
  const operaciones = ops.map(o => serializarOperacion(o.id));
  return NextResponse.json({ mensajero: { nombre: m.nombre }, operaciones, ia_disponible: tieneClaveAnthropic() });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = resolverMensajero(token);
  if (!m) return NextResponse.json({ error: 'Enlace inválido' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const opId = Number(body.operacion_id);
  const db = getDb();

  // La operación debe pertenecer a este mensajero.
  const op = db.prepare('SELECT id, mensajero_id FROM operaciones WHERE id = ?').get(opId) as { id: number; mensajero_id: number | null } | undefined;
  if (!op || op.mensajero_id !== m.id) return NextResponse.json({ error: 'Servicio no encontrado' }, { status: 404 });

  switch (body.accion) {
    case 'tarea': {
      const tareaId = Number(body.tarea_id);
      const estado = body.estado === 'hecho' ? 'hecho' : 'pendiente';
      const t = db.prepare('SELECT id, tipo FROM operacion_tareas WHERE id = ? AND operacion_id = ?').get(tareaId, opId) as { id: number; tipo: string } | undefined;
      if (!t) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
      // Las tareas de entrega y devolución exigen las 8 fotos de su fase (o el motivo
      // escrito de cada casilla que falte). Esta pantalla no tiene login: cualquiera
      // con el enlace puede llamar la API directo, así que la comprobación de verdad
      // es esta y no el botón deshabilitado. No aplica a las operaciones creadas antes
      // de las casillas guiadas (ver `bloqueoFotosTarea`). DESMARCAR nunca se bloquea.
      if (estado === 'hecho') {
        const bloqueo = bloqueoFotosTarea(db, opId, t.tipo);
        if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 400 });
      }
      db.prepare('UPDATE operacion_tareas SET estado = ? WHERE id = ?').run(estado, tareaId);
      recomputarEstadoOperacion(db, opId, m.id);
      // Congelar el respaldo al marcar una tarea de fase (entrega o devolución), no
      // solo al cerrarse el servicio: entre una cosa y otra pueden pasar días, y en esa
      // ventana se pueden quitar las fotos recién subidas sin dejar rastro. Este es el
      // único instante en que consta que estaban. `generarActaCierre` deduplica, así
      // que no genera versiones repetidas.
      if (estado === 'hecho') congelarActaDeFase(db, opId, t.tipo);
      break;
    }
    // Acción LEGADA (reemplaza TODA la lista de una fase). La pantalla ya no la usa:
    // quitar una foto suelta pasó a `quitar_foto_suelta`, que filtra en el servidor.
    // Se conserva para las versiones de la app que sigan abiertas en un celular.
    // Acepta los dos formatos: `urls` (strings) y `fotos` ([{casilla, url}]).
    //
    // La fase se valida con `esFase` y responde 400, igual que el resto de acciones:
    // antes, con `body.fase === 'entrada' ? 'entrada' : 'salida'`, un `fase:'Entrada'`
    // mal escrito caía en 'salida' y BORRABA todas las fotos de la entrega
    // respondiendo 200. Siendo la acción que reemplaza la fase entera, es la que más
    // necesitaba la validación.
    case 'fotos': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      const fase = body.fase;
      const crudas = Array.isArray(body.fotos) ? body.fotos : Array.isArray(body.urls) ? body.urls : null;
      if (crudas === null) return NextResponse.json({ error: 'Faltan las fotos' }, { status: 400 });
      if (crudas.length > MAX_FOTOS_FASE) {
        return NextResponse.json({ error: `Demasiadas fotos en una sola fase (máximo ${MAX_FOTOS_FASE}).` }, { status: 400 });
      }
      const fotos = parseFotosServicio(crudas).filter(f => esUrlFotoSegura(f.url));
      guardarFotosFase(db, opId, fase, fotos);
      break;
    }
    // Quitar UNA foto suelta (sin casilla) de un servicio viejo. Solo viaja la URL que
    // se quiere quitar: el filtrado ocurre en el servidor y no se pisa lo que otra
    // persona haya subido mientras el celular tenía la pantalla abierta.
    case 'quitar_foto_suelta': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url || url.length > URL_MAX) return NextResponse.json({ error: 'Falta la foto que se quiere quitar' }, { status: 400 });
      quitarFotoSuelta(db, opId, body.fase, url);
      break;
    }
    // Una sola casilla del recorrido guiado. `url` vacía = quitar esa foto.
    case 'foto_casilla': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      if (!esCasilla(body.casilla)) return NextResponse.json({ error: 'Casilla inválida' }, { status: 400 });
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (url && !esUrlFotoSegura(url)) return NextResponse.json({ error: 'La dirección de la foto no es válida' }, { status: 400 });
      guardarFotoCasilla(db, opId, body.fase, body.casilla, url);
      break;
    }
    // La salida de emergencia del bloqueo: omitir una casilla dejando por escrito el
    // motivo. Queda con el nombre del mensajero y la hora, y sale en el acta.
    case 'omitir_casilla': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      if (!esCasilla(body.casilla)) return NextResponse.json({ error: 'Casilla inválida' }, { status: 400 });
      const motivo = normalizarMotivo(body.motivo);
      if (!motivo) return NextResponse.json({ error: `Escribe el motivo por el que no puedes tomar esta foto (al menos ${MOTIVO_MIN} caracteres).` }, { status: 400 });
      const guardada = omitirCasilla(db, opId, body.fase, body.casilla, motivo, { nombre: m.nombre, tipo: 'mensajero' });
      // Falso = esa casilla ya tiene foto; registrar un motivo encima dejaría el acta
      // diciendo dos cosas a la vez.
      if (!guardada) return NextResponse.json({ error: 'Esa foto ya está tomada. Quítala primero si quieres dejar un motivo.' }, { status: 400 });
      break;
    }
    case 'quitar_omision': {
      if (!esFase(body.fase)) return NextResponse.json({ error: 'Fase inválida' }, { status: 400 });
      if (!esCasilla(body.casilla)) return NextResponse.json({ error: 'Casilla inválida' }, { status: 400 });
      quitarOmision(db, opId, body.fase, body.casilla);
      break;
    }
    case 'inspeccion': {
      if (!tieneClaveAnthropic()) {
        return NextResponse.json({ error: 'La inspección con IA no está configurada (falta ANTHROPIC_API_KEY).' }, { status: 503 });
      }
      // Esta pantalla no tiene login (basta el enlace del mensajero), así que el
      // tope por actor es la única barrera contra quemar consultas de IA con el
      // enlace filtrado. Se limita por mensajero, no por IP: los mensajeros
      // trabajan desde datos móviles y comparten NAT.
      // Primero lo barato: si el juego de fotos todavía no está completo, la
      // inspección ni siquiera sale de la app. Cobrarle un intento del límite
      // por eso dejaba al mensajero bloqueado 10 minutos con el cliente delante
      // por darle seis veces a un botón que nunca llamó a la IA.
      const fotosOp = db.prepare('SELECT fotos_salida, fotos_entrada FROM operaciones WHERE id = ?').get(opId) as { fotos_salida: string | null; fotos_entrada: string | null } | undefined;
      const faltan = faltanFotosParaInspeccion(fotosOp?.fotos_salida, fotosOp?.fotos_entrada);
      if (faltan) return NextResponse.json({ error: faltan }, { status: 400 });
      const excedido = limiteInspeccion(`mensajero:${m.id}`);
      if (excedido) return NextResponse.json({ error: excedido }, { status: 429 });
      try {
        await ejecutarInspeccion(db, opId);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Error en la inspección' }, { status: 400 });
      }
      break;
    }
    default:
      return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  }

  // Si la acción dejó una fase SIN NINGUNA foto, el veredicto de la inspección con IA
  // quedó huérfano y se limpia (mismo criterio que en el panel del admin, ver
  // `invalidarInspeccionSiFaseVacia`). Acá es donde más falta hace: el mensajero es
  // quien toma y quita las fotos en la calle, y quien puede haber fotografiado el carro
  // equivocado. No hay a quién avisar en pantalla ni quién decida, así que se limpia
  // solo y queda la constancia.
  //
  // La bitácora se escribe con `usuario_id` en NULL a propósito: el mensajero entra por
  // un enlace con token y no tiene fila en `usuarios`. Queda su nombre y el enlace como
  // identidad, que es exactamente lo que se sabe de él.
  if (ACCIONES_QUE_QUITAN_FOTOS.has(body.accion)) {
    const faseVacia = invalidarInspeccionSiFaseVacia(db, opId);
    if (faseVacia) {
      registrarAuditoria(db, { id: null, nombre: `${m.nombre} (mensajero)`, nivel: 'mensajero' }, {
        area: 'operaciones',
        accion: 'limpiar_inspeccion_ia',
        entidad: 'operaciones',
        entidad_id: opId,
        detalle: JSON.stringify({ motivo: motivoFaseVacia(faseVacia), accion: body.accion, mensajero_id: m.id }),
      });
    }
  }

  return NextResponse.json({ operacion: serializarOperacion(opId) });
}
