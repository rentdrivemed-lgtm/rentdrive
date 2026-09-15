'use client';
import { useEffect, useState } from 'react';
import { lugarResumen, type Lugar } from '@/lib/lugares';
import { IconCheck, IconShield } from '@/components/Icons';
import InspeccionResultado, { type InspeccionResultado as InspRes } from '@/components/InspeccionResultado';
import EstadoEntregaResultado, { type EstadoEntrega } from '@/components/EstadoEntregaResultado';
import VisorFotos, { type FotoVisor } from '@/components/VisorFotos';
import CasillasFotos from '@/components/CasillasFotos';
// `lib/fotos-servicio` sí se importa entero: es un módulo PURO (sin fs ni
// better-sqlite3), como lib/lugares o lib/pico-placa.
import {
  casillasPendientes, parseFotosServicio, parseOmisiones, FASE_NOMBRE,
  type CasillaId, type FaseFoto,
} from '@/lib/fotos-servicio';
// Solo el TIPO: `lib/acta-servicio` es server-only (better-sqlite3) y `import type`
// se borra en compilación, así que no entra nada de servidor a este bundle.
import type { ActaResumen } from '@/lib/acta-servicio';

type Tarea = { id: number; tipo: string; titulo: string; detalle: string; estado: 'pendiente' | 'hecho'; orden: number };
type Detalle = {
  reserva_id: number; marca: string; modelo: string; anio: number; placa: string;
  usuario_nombre: string; usuario_celular: string; fecha_inicio: string; fecha_fin: string;
  recogida: string; entrega: string; total: number; recargo: number;
} | null;
type Operacion = {
  id: number; reserva_id: number; mensajero_id: number | null; estado: string;
  notas: string; wa_admin: string; wa_mensajero: string; created_at: string;
  mensajero_nombre: string | null; mensajero_celular: string | null;
  fotos_salida: string; fotos_entrada: string; inspeccion_ia: string; inspeccion_estado: string;
  // Paso 1: inventario del estado en que SALE el vehículo (solo fotos de salida).
  entrega_ia: string; entrega_estado: string;
  // Casillas guiadas de fotos (ver lib/fotos-servicio.ts). `fotos_guiadas` vale 0 en
  // los servicios anteriores a las casillas: ahí no se exigen las 8 fotos.
  fotos_omitidas: string; fotos_guiadas: number;
  detalle: Detalle; tareas: Tarea[];
  // Solo viene en la carga inicial (GET /api/operaciones). El PUT de acciones
  // devuelve la operación sin este campo, por eso es opcional y por eso el
  // historial de actas vive en su propio estado (ver `actas` más abajo).
  actas?: ActaResumen[];
};
type Mensajero = { id: number; nombre: string; celular: string; activo: number; token?: string };

function parseInsp(s: string): InspRes | null { try { return s ? JSON.parse(s) as InspRes : null; } catch { return null; } }
function parseEntrega(s: string): EstadoEntrega | null {
  try {
    const o = s ? JSON.parse(s) as EstadoEntrega : null;
    return o && Array.isArray(o.marcas) ? o : null;
  } catch { return null; }
}

const TAREA_ICON: Record<string, string> = {
  lavar: '🚿', tanquear: '⛽', entregar: '📤', recibir: '📥', inspeccion: '📸',
};
const OP_BADGE: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning border-warning/25',
  asignada:   'bg-brand-muted text-ink border-border',
  en_proceso: 'bg-accent/15 text-accent border-accent/25',
  finalizada: 'bg-success/15 text-success border-success/30',
};
const OP_LABEL: Record<string, string> = {
  pendiente: 'Sin asignar', asignada: 'Asignada', en_proceso: 'En proceso', finalizada: 'Finalizada',
};

function pesos(n: number) { return `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`; }
function resumenLugar(json: string): string {
  try { const o = JSON.parse(json || '{}') as Lugar; return lugarResumen(o.municipio ? o : null); } catch { return '—'; }
}

export default function OperacionesPanel() {
  const [ops, setOps] = useState<Operacion[]>([]);
  const [mensajeros, setMensajeros] = useState<Mensajero[]>([]);
  const [adminWa, setAdminWa] = useState('');
  const [waHabilitado, setWaHabilitado] = useState(false);
  const [iaDisponible, setIaDisponible] = useState(false);
  const [inspeccionando, setInspeccionando] = useState<number | null>(null);
  const [errInsp, setErrInsp] = useState<Record<number, string>>({});
  // Paso 1 (analizar el estado de entrega). Estado propio y no compartido con el de la
  // comparación: son dos botones distintos y solo el que se pulsó debe verse ocupado.
  const [analizandoEntrega, setAnalizandoEntrega] = useState<number | null>(null);
  const [errEntrega, setErrEntrega] = useState<Record<number, string>>({});
  // Mensaje del servidor al rechazar el marcado de una tarea (faltan fotos de esa fase)
  // o al fallar una subida. Por operación: en el tablero hay varias tarjetas a la vez.
  const [errTarea, setErrTarea] = useState<Record<number, string>>({});
  const [copiado, setCopiado] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nuevoM, setNuevoM] = useState({ nombre: '', celular: '' });
  const [cfgMsg, setCfgMsg] = useState('');
  const [notasLocal, setNotasLocal] = useState<Record<number, string>>({});
  const [errorCarga, setErrorCarga] = useState('');
  // Visor de fotos a pantalla completa (componente compartido con la pantalla del
  // mensajero, /m/<token>).
  const [visor, setVisor] = useState<{ fotos: FotoVisor[]; indice: number; titulo: string } | null>(null);
  // Historial de respaldos por servicio. Va APARTE de `ops` a propósito: el PUT de
  // /api/operaciones/<id> devuelve la operación sin `actas`, y si vivieran dentro de
  // `ops` cualquier acción (marcar una tarea, guardar notas) los borraría de pantalla.
  const [actas, setActas] = useState<Record<number, ActaResumen[]>>({});
  const [generandoActa, setGenerandoActa] = useState<number | null>(null);
  const [errActa, setErrActa] = useState<Record<number, string>>({});
  // Cerrar / reabrir el servicio a mano. Por operación, igual que el resto: el tablero
  // muestra varias tarjetas y solo la que se está tocando debe verse ocupada.
  const [cambiandoEstado, setCambiandoEstado] = useState<number | null>(null);

  const cargar = async () => {
    setCargando(true);
    setErrorCarga('');
    try {
      const [ro, rm] = await Promise.all([
        fetch('/api/operaciones', { cache: 'no-store' }),
        fetch('/api/mensajeros', { cache: 'no-store' }),
      ]);
      const dataO = await ro.json().catch(() => ({}));
      const dataM = await rm.json().catch(() => ({}));
      if (!ro.ok || !rm.ok) { setErrorCarga('No pudimos cargar Operaciones. Intenta de nuevo.'); return; }
      const operaciones: Operacion[] = dataO.operaciones || [];
      setOps(operaciones);
      setAdminWa(dataO.admin_whatsapp || '');
      setWaHabilitado(!!dataO.whatsapp_habilitado);
      setIaDisponible(!!dataO.ia_disponible);
      setMensajeros(dataM.mensajeros || []);
      setNotasLocal(Object.fromEntries(operaciones.map(o => [o.id, o.notas || ''])));
      setActas(Object.fromEntries(operaciones.map(o => [o.id, o.actas || []])));
    } catch {
      setErrorCarga('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const activos = mensajeros.filter(m => m.activo);

  const reemplazar = (op: Operacion) => setOps(list => list.map(o => o.id === op.id ? op : o));

  // Devuelve el resultado para que quien lo necesite muestre el error. La mayoría de
  // los llamadores lo ignoran a propósito (asignar mensajero, notas…): son acciones
  // puntuales y, si falla la red, el estado local no cambia y se puede reintentar el
  // clic. Marcar una tarea SÍ lo usa: el servidor puede rechazarla por fotos faltantes
  // y ese mensaje hay que enseñarlo.
  const accion = async (opId: number, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/operaciones/${opId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.operacion) reemplazar(data.operacion as Operacion);
      return { ok: res.ok, error: data.error };
    } catch {
      return { ok: false, error: 'Sin conexión — intenta de nuevo.' };
    }
  };

  const subirArchivo = async (file: File): Promise<string | null> => {
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      return res.ok ? d.url : null;
    } catch {
      return null;
    }
  };
  // Una casilla a la vez: el servidor solo toca ESA casilla, así que dos guardados
  // que se crucen no se pisan entre sí (ver `guardarFotoCasilla` en lib/operaciones).
  const subirFotoCasilla = async (op: Operacion, fase: FaseFoto, casilla: CasillaId, file: File) => {
    setErrTarea(e => ({ ...e, [op.id]: '' }));
    const url = await subirArchivo(file);
    if (!url) { setErrTarea(e => ({ ...e, [op.id]: 'No se pudo subir la foto. Intenta de nuevo.' })); return; }
    const r = await accion(op.id, { accion: 'foto_casilla', fase, casilla, url });
    if (!r.ok) setErrTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo guardar la foto.' }));
  };
  const quitarFotoCasilla = async (op: Operacion, fase: FaseFoto, casilla: CasillaId) => {
    await accion(op.id, { accion: 'foto_casilla', fase, casilla, url: '' });
  };
  const omitirCasilla = async (op: Operacion, fase: FaseFoto, casilla: CasillaId, motivo: string): Promise<string | null> => {
    const r = await accion(op.id, { accion: 'omitir_casilla', fase, casilla, motivo });
    return r.ok ? null : (r.error || 'No se pudo guardar el motivo.');
  };
  const quitarOmision = async (op: Operacion, fase: FaseFoto, casilla: CasillaId) => {
    await accion(op.id, { accion: 'quitar_omision', fase, casilla });
  };
  // Fotos sueltas de servicios anteriores a las casillas. Se manda SOLO la URL que se
  // quiere quitar; el servidor la filtra dentro de una transacción. Antes se
  // reconstruía acá la lista completa de la fase y se mandaba con la acción `fotos`
  // (que reemplaza la fase entera), o sea que se le devolvía al servidor la copia que
  // tenía el navegador: todo lo que el mensajero hubiera subido desde la calle
  // mientras esta pestaña estaba abierta desaparecía sin dejar rastro.
  const quitarFotoSuelta = async (op: Operacion, fase: FaseFoto, url: string) => {
    await accion(op.id, { accion: 'quitar_foto_suelta', fase, url });
  };
  // El historial de respaldos NO viene en la respuesta del PUT de acciones, así que
  // cuando el servidor congela un acta solo (al cerrar el servicio o al marcar una
  // tarea de entrega/devolución) hay que ir a buscarlo. Si falla no se avisa nada: el
  // acta ya quedó guardada, solo no se ve hasta recargar.
  const refrescarActas = async (opId: number) => {
    try {
      const res = await fetch(`/api/operaciones/${opId}/acta`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(d.actas)) setActas(a => ({ ...a, [opId]: d.actas as ActaResumen[] }));
    } catch { /* se verá al recargar la página */ }
  };
  // El servidor puede RECHAZAR el marcado si faltan fotos de la fase. Sin mostrar ese
  // mensaje, la casilla simplemente no se marcaba y nadie sabía por qué.
  const marcarTarea = async (op: Operacion, t: Tarea) => {
    setErrTarea(e => ({ ...e, [op.id]: '' }));
    const marcar = t.estado === 'hecho' ? 'pendiente' : 'hecho';
    const r = await accion(op.id, { accion: 'tarea', tarea_id: t.id, estado: marcar });
    if (!r.ok) setErrTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo marcar la tarea.' }));
    // Marcar una tarea de entrega/devolución (o la última del checklist) congela un
    // respaldo en el servidor: se recarga el historial para que se vea de una vez.
    else if (marcar === 'hecho') await refrescarActas(op.id);
  };
  // ── Cerrar y reabrir el servicio ──────────────────────────────────────────
  //
  // El cierre normal lo hace el checklist: cuando se marca la última tarea, el
  // servidor pasa la operación a "finalizada" y congela el acta de respaldo. Pero el
  // servicio real no siempre termina así (el mensajero no marcó nada, el carro volvió
  // por otro lado, el cliente devolvió a mitad de camino), y hasta ahora el tablero no
  // tenía cómo darlo por cerrado ni cómo volver a abrirlo para corregirlo.
  //
  // Decisión del dueño: el administrador CONSERVA el poder de cerrar aunque falten
  // fotos. No se le bloquea — se le dice cuántas faltan y de qué fase antes de
  // confirmar, y él decide. Cerrar igual congela el respaldo con lo que haya, que es
  // mejor que no tener ninguno.

  /** Cuántas casillas faltan por fase, en texto. '' = no falta ninguna. */
  const faltanFotosTexto = (op: Operacion): string => {
    // En los servicios anteriores a las casillas guiadas (`fotos_guiadas = 0`) no se
    // exigen las 8 fotos, así que no tiene sentido advertir de algo que nadie pidió.
    if (Number(op.fotos_guiadas) !== 1) return '';
    const omisiones = parseOmisiones(op.fotos_omitidas);
    const partes = ([
      ['salida', parseFotosServicio(op.fotos_salida)],
      ['entrada', parseFotosServicio(op.fotos_entrada)],
    ] as const).flatMap(([fase, fotos]) => {
      const n = casillasPendientes(fotos, omisiones, fase).length;
      return n > 0 ? [`${n} de la ${FASE_NOMBRE[fase]}`] : [];
    });
    return partes.join(' y ');
  };

  const cerrarServicio = async (op: Operacion) => {
    const faltan = faltanFotosTexto(op);
    const pendientes = op.tareas.filter(t => t.estado !== 'hecho').length;
    // Solo se pregunta si de verdad hay algo a medias. Cerrar un servicio que ya
    // está completo no necesita confirmación: es lo que se espera que pase.
    if (faltan || pendientes > 0) {
      const detalle = [
        faltan ? `• Faltan fotos: ${faltan}.` : '',
        pendientes > 0 ? `• Quedan ${pendientes} tarea(s) del checklist sin marcar.` : '',
      ].filter(Boolean).join('\n');
      const ok = window.confirm(
        `Vas a cerrar este servicio con cosas pendientes:\n\n${detalle}\n\n`
        + 'El respaldo se va a guardar con lo que haya en este momento. Puedes reabrirlo después, '
        + 'completarlo y cerrarlo de nuevo: se guarda una versión más y la anterior no se borra.\n\n'
        + '¿Cerrar el servicio de todas formas?',
      );
      if (!ok) return;
    }
    setCambiandoEstado(op.id);
    setErrTarea(e => ({ ...e, [op.id]: '' }));
    const r = await accion(op.id, { accion: 'estado', estado: 'finalizada' });
    if (!r.ok) setErrTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo cerrar el servicio.' }));
    // Al cerrar, el servidor congela el acta: se recarga el historial para que
    // aparezca sin tener que refrescar la página.
    else await refrescarActas(op.id);
    setCambiandoEstado(null);
  };

  // Reabrir tiene un efecto que NO se puede deshacer (se borra el veredicto de la IA),
  // así que el diálogo dice punto por punto qué pasa con cada cosa. El caso que lo
  // originó fue un mensajero que fotografió un carro equivocado: el dueño reabre para
  // rehacer el servicio y no puede llevarse la sorpresa de que algo se fue sin avisar.
  const reabrirServicio = async (op: Operacion) => {
    const hayInspeccion = !!parseInsp(op.inspeccion_ia);
    const ok = window.confirm(
      '¿Reabrir este servicio?\n\n'
      + 'Vuelve a quedar EN PROCESO para poder corregirlo. Esto es lo que pasa con cada cosa:\n\n'
      + '• Las FOTOS se conservan tal como están. Si hay que rehacerlas, las quitas tú una por una.\n'
      + '• Las TAREAS del checklist se quedan como están, marcadas o sin marcar. No se desmarca ninguna.\n'
      + (hayInspeccion
        ? '• El RESULTADO DE LA INSPECCIÓN CON IA se borra. Es lo único que se pierde: ese veredicto '
          + 'era de las fotos de antes, y si se van a rehacer ya no describe nada. Se vuelve a correr '
          + 'cuando estén las fotos nuevas.\n'
        : '• No hay resultado de inspección con IA guardado, así que no se borra nada.\n')
      + '• Los RESPALDOS ya generados NO se tocan: el que se guardó al cerrar sigue diciendo lo que '
      + 'decía, con su resultado de IA incluido. Al cerrarlo de nuevo se guarda una versión más.\n\n'
      + '¿Reabrir?',
    );
    if (!ok) return;
    setCambiandoEstado(op.id);
    setErrTarea(e => ({ ...e, [op.id]: '' }));
    const r = await accion(op.id, { accion: 'estado', estado: 'en_proceso' });
    if (!r.ok) setErrTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo reabrir el servicio.' }));
    setCambiandoEstado(null);
  };

  // Paso 1: el inventario de lo que el carro YA trae, con las fotos de salida. Se corre
  // antes de entregarlo; el paso 2 (comparar) lo usa después como referencia.
  const analizarEntrega = async (op: Operacion) => {
    setAnalizandoEntrega(op.id);
    setErrEntrega(e => ({ ...e, [op.id]: '' }));
    const r = await accion(op.id, { accion: 'analisis_entrega' });
    if (!r.ok) setErrEntrega(e => ({ ...e, [op.id]: r.error || 'No se pudo analizar el estado de entrega.' }));
    setAnalizandoEntrega(null);
  };

  const inspeccionar = async (op: Operacion) => {
    setInspeccionando(op.id);
    setErrInsp(e => ({ ...e, [op.id]: '' }));
    try {
      const res = await fetch(`/api/operaciones/${op.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'inspeccion' }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.operacion) reemplazar(d.operacion as Operacion);
      else setErrInsp(e => ({ ...e, [op.id]: d.error || 'No se pudo inspeccionar.' }));
    } catch {
      setErrInsp(e => ({ ...e, [op.id]: 'Sin conexión — intenta de nuevo.' }));
    } finally {
      setInspeccionando(null);
    }
  };

  // Congela una versión NUEVA del respaldo. Regenerar nunca pisa la anterior: si se
  // agregaron fotos después del cierre, queda una versión más en el historial.
  const generarRespaldo = async (op: Operacion) => {
    setGenerandoActa(op.id);
    setErrActa(e => ({ ...e, [op.id]: '' }));
    try {
      const res = await fetch(`/api/operaciones/${op.id}/acta`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.acta) setActas(a => ({ ...a, [op.id]: [d.acta as ActaResumen, ...(a[op.id] || [])] }));
      else setErrActa(e => ({ ...e, [op.id]: d.error || 'No se pudo generar el respaldo.' }));
    } catch {
      setErrActa(e => ({ ...e, [op.id]: 'Sin conexión — intenta de nuevo.' }));
    } finally {
      setGenerandoActa(null);
    }
  };

  const guardarConfig = async () => {
    setCfgMsg('');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_whatsapp: adminWa }),
      });
      setCfgMsg(res.ok ? '✓ Guardado' : 'Error al guardar');
    } catch {
      setCfgMsg('Sin conexión');
    }
  };

  const addMensajero = async () => {
    if (!nuevoM.nombre.trim()) return;
    try {
      const res = await fetch('/api/mensajeros', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nuevoM),
      });
      if (res.ok) { setNuevoM({ nombre: '', celular: '' }); cargar(); }
    } catch { /* el usuario puede reintentar el clic */ }
  };
  const toggleMensajero = async (m: Mensajero) => {
    try {
      await fetch(`/api/mensajeros/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: !m.activo }) });
      cargar();
    } catch { /* el usuario puede reintentar el clic */ }
  };
  const delMensajero = async (m: Mensajero) => {
    try {
      await fetch(`/api/mensajeros/${m.id}`, { method: 'DELETE' });
      cargar();
    } catch { /* el usuario puede reintentar el clic */ }
  };
  const regenMensajero = async (m: Mensajero) => {
    if (!window.confirm(`¿Generar un enlace nuevo para ${m.nombre}? El enlace actual dejará de funcionar de inmediato y tendrás que enviarle el nuevo.`)) return;
    try {
      await fetch(`/api/mensajeros/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerar_token: true }) });
      cargar();
    } catch { /* el usuario puede reintentar el clic */ }
  };

  if (cargando) return <div className="text-center py-16 text-ink/50">Cargando operaciones…</div>;
  if (errorCarga) return (
    <div className="text-center py-16 bg-surface-2 rounded-2xl border border-border">
      <p className="text-ink/60 mb-4">{errorCarga}</p>
      <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Aviso de canal + WhatsApp admin */}
      <div className="bg-surface-2 rounded-2xl border border-border p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-[11px] text-ink/50 block mb-1">WhatsApp del administrador (recibe cada servicio confirmado)</label>
            <input
              value={adminWa}
              onChange={e => setAdminWa(e.target.value)}
              placeholder="Ej. 300 123 4567"
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40" />
          </div>
          <button onClick={guardarConfig} className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition">
            Guardar
          </button>
          {cfgMsg && <span className="text-xs text-success self-center">{cfgMsg}</span>}
        </div>
        <p className={`text-[11px] mt-2 ${waHabilitado ? 'text-success' : 'text-warning'}`}>
          {waHabilitado
            ? '✓ Canal de WhatsApp activo. Los avisos se envían automáticamente.'
            : 'El envío por WhatsApp está apagado. El tablero funciona igual; para enviar de verdad, define WHATSAPP_ENABLED=true (y WHATSAPP_BRIDGE_URL si aplica) en .env.local y reinicia.'}
        </p>
      </div>

      {/* Mensajeros */}
      <div className="bg-surface-2 rounded-2xl border border-border p-5">
        <h3 className="font-bold text-ink mb-3">Mensajeros</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={nuevoM.nombre}
            onChange={e => setNuevoM(s => ({ ...s, nombre: e.target.value }))}
            placeholder="Nombre del mensajero"
            className="flex-1 min-w-[160px] bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40" />
          <input
            value={nuevoM.celular}
            onChange={e => setNuevoM(s => ({ ...s, celular: e.target.value }))}
            placeholder="Celular (WhatsApp)"
            className="flex-1 min-w-[160px] bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40" />
          <button onClick={addMensajero} className="bg-accent/15 text-accent hover:bg-accent/20 px-4 py-2 rounded-xl font-semibold text-sm transition">
            + Agregar
          </button>
        </div>
        {mensajeros.length === 0 ? (
          <p className="text-xs text-ink/50">Aún no has registrado mensajeros.</p>
        ) : (
          <div className="space-y-1.5">
            {mensajeros.map(m => (
              <div key={m.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-xl px-3 py-2 border ${m.activo ? 'bg-surface border-border' : 'bg-surface/40 border-border/50 opacity-60'}`}>
                <span className="font-medium text-ink">{m.nombre}</span>
                <span className="text-ink/50">{m.celular || 'sin celular'}</span>
                <span className="ml-auto flex items-center gap-2">
                  {m.token && (
                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/m/${m.token}`;
                        navigator.clipboard?.writeText(url);
                        setCopiado(m.id);
                        setTimeout(() => setCopiado(c => c === m.id ? null : c), 1500);
                      }}
                      className="text-[11px] px-2 py-1 rounded-lg bg-accent/15 text-accent hover:bg-accent/20 transition">
                      {copiado === m.id ? '✓ Copiado' : '🔗 Copiar acceso'}
                    </button>
                  )}
                  {m.token && (
                    <button onClick={() => regenMensajero(m)} title="Genera un enlace nuevo y anula el anterior" className="text-[11px] px-2 py-1 rounded-lg bg-surface-2 text-ink/60 hover:text-ink transition">
                      ♻️ Regenerar enlace
                    </button>
                  )}
                  <button onClick={() => toggleMensajero(m)} className="text-[11px] px-2 py-1 rounded-lg bg-surface-2 text-ink/60 hover:text-ink transition">
                    {m.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button onClick={() => delMensajero(m)} className="text-[11px] px-2 py-1 rounded-lg text-danger hover:bg-danger/10 transition">
                    Eliminar
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tablero de servicios */}
      <div>
        <h3 className="font-bold text-ink mb-3">Servicios confirmados ({ops.length})</h3>
        {ops.length === 0 ? (
          <div className="text-center py-12 bg-surface-2 rounded-2xl border border-border text-ink/50">
            <p className="text-3xl mb-2">📋</p>
            <p>Aún no hay servicios. Cuando confirmes una reserva, aparecerá aquí con su checklist.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {ops.map(op => {
              const d = op.detalle;
              const hechas = op.tareas.filter(t => t.estado === 'hecho').length;
              return (
                <div key={op.id} className="bg-surface-2 rounded-2xl border border-border p-4 space-y-3">
                  {/* Encabezado */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-ink truncate">
                        {d ? `${d.marca} ${d.modelo} ${d.anio}` : `Reserva #${op.reserva_id}`}
                        {d?.placa ? <span className="text-ink/50 font-normal"> · {d.placa}</span> : null}
                      </p>
                      {d && <p className="text-xs text-ink/50">{d.usuario_nombre}{d.usuario_celular ? ` · ${d.usuario_celular}` : ''}</p>}
                    </div>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${OP_BADGE[op.estado] || OP_BADGE.pendiente}`}>
                      {OP_LABEL[op.estado] || op.estado}
                    </span>
                  </div>

                  {/* Datos del servicio */}
                  {d && (
                    <div className="text-xs text-ink/60 space-y-0.5 bg-surface rounded-xl p-2.5 border border-border/60">
                      <p><span className="text-ink/50">Fechas:</span> {d.fecha_inicio} → {d.fecha_fin}</p>
                      <p><span className="text-ink/50">Entrega al cliente:</span> {resumenLugar(d.recogida)}</p>
                      <p><span className="text-ink/50">Devolución:</span> {resumenLugar(d.entrega)}</p>
                      <p><span className="text-ink/50">Total:</span> {pesos(d.total)}{d.recargo ? ` (recargo ${pesos(d.recargo)})` : ''}</p>
                    </div>
                  )}

                  {/* Mensajero */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink/50 shrink-0">Mensajero:</span>
                    <select
                      value={op.mensajero_id ?? ''}
                      onChange={e => accion(op.id, { accion: 'asignar', mensajero_id: e.target.value || null })}
                      className="flex-1 bg-surface border border-border rounded-xl px-2.5 py-1.5 text-sm text-ink">
                      <option value="">— Sin asignar —</option>
                      {activos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                      {/* Si el asignado quedó inactivo, mantenerlo visible */}
                      {op.mensajero_id && !activos.some(m => m.id === op.mensajero_id) && op.mensajero_nombre && (
                        <option value={op.mensajero_id}>{op.mensajero_nombre} (inactivo)</option>
                      )}
                    </select>
                  </div>

                  {/* Checklist */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Checklist ({hechas}/{op.tareas.length})</span>
                    </div>
                    <ul className="space-y-1">
                      {op.tareas.map(t => (
                        <li key={t.id}>
                          <button
                            onClick={() => marcarTarea(op, t)}
                            className="w-full flex items-start gap-2 text-left text-sm rounded-lg px-2 py-1.5 hover:bg-surface transition">
                            <span className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${t.estado === 'hecho' ? 'bg-success border-success text-white' : 'border-border'}`}>
                              {t.estado === 'hecho' && <IconCheck size={11} />}
                            </span>
                            <span className="min-w-0">
                              <span className={`${t.estado === 'hecho' ? 'line-through text-ink/50' : 'text-ink'}`}>{TAREA_ICON[t.tipo] || '•'} {t.titulo}</span>
                              {t.detalle && <span className="block text-[11px] text-ink/50">{t.detalle}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {errTarea[op.id] && (
                      <p className="text-[11px] text-danger mt-1.5 bg-danger/10 rounded-lg px-2.5 py-1.5">{errTarea[op.id]}</p>
                    )}

                    {/* Cerrar / reabrir el servicio a mano.
                        El checklist cierra solo al marcar la última tarea, pero el
                        servicio real no siempre termina así. Cerrar acá congela el
                        respaldo igual que el cierre automático. */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {op.estado === 'finalizada' ? (
                        <>
                          <button
                            onClick={() => reabrirServicio(op)}
                            disabled={cambiandoEstado === op.id}
                            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-surface text-ink/70 hover:text-ink border border-border transition disabled:opacity-40">
                            {cambiandoEstado === op.id ? 'Reabriendo…' : '↩️ Reabrir servicio'}
                          </button>
                          <span className="text-[11px] text-ink/45">Servicio cerrado. Reábrelo si hay que corregir algo.</span>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => cerrarServicio(op)}
                            disabled={cambiandoEstado === op.id}
                            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-success/15 text-success hover:bg-success/25 transition disabled:opacity-40">
                            {cambiandoEstado === op.id ? 'Cerrando…' : '✅ Cerrar servicio'}
                          </button>
                          <span className="text-[11px] text-ink/45">
                            {faltanFotosTexto(op)
                              ? `Faltan fotos: ${faltanFotosTexto(op)}. Puedes cerrarlo igual, te lo va a preguntar.`
                              : 'Dar el servicio por terminado y guardar el respaldo.'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inspección de daños con IA */}
                  {(() => {
                    // `parseFotosServicio` lee los DOS formatos: el array plano de strings
                    // de los servicios viejos y el `[{casilla, url}]` de las casillas.
                    const fotosSalida = parseFotosServicio(op.fotos_salida);
                    const fotosEntrada = parseFotosServicio(op.fotos_entrada);
                    const omisiones = parseOmisiones(op.fotos_omitidas);
                    const exigidas = Number(op.fotos_guiadas) === 1;
                    const insp = parseInsp(op.inspeccion_ia);
                    const entrega = parseEntrega(op.entrega_ia);
                    // Salida y entrada van en UNA sola lista para poder pasar de una a
                    // otra sin cerrar el visor; la etiqueta ("SALIDA 2 de 4") sale del grupo.
                    const fotosVisor: FotoVisor[] = [
                      ...fotosSalida.map(f => ({ url: f.url, grupo: 'SALIDA' })),
                      ...fotosEntrada.map(f => ({ url: f.url, grupo: 'ENTRADA' })),
                    ];
                    const tituloVisor = d ? `${d.marca} ${d.modelo} ${d.anio}${d.placa ? ` · ${d.placa}` : ''}` : `Servicio #${op.id}`;
                    const abrirVisor = (url: string) => {
                      const i = fotosVisor.findIndex(f => f.url === url);
                      if (i >= 0) setVisor({ fotos: fotosVisor, indice: i, titulo: tituloVisor });
                    };
                    return (
                      <div className="border-t border-border/60 pt-3 space-y-2.5">
                        <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Fotos del vehículo (salida vs. entrada)</p>
                        <CasillasFotos
                          fase="salida"
                          titulo="Salida — entrega al cliente"
                          fotos={fotosSalida}
                          omisiones={omisiones}
                          exigidas={exigidas}
                          compacto
                          onFoto={(casilla, file) => subirFotoCasilla(op, 'salida', casilla, file)}
                          onQuitarFoto={casilla => quitarFotoCasilla(op, 'salida', casilla)}
                          onOmitir={(casilla, motivo) => omitirCasilla(op, 'salida', casilla, motivo)}
                          onQuitarOmision={casilla => quitarOmision(op, 'salida', casilla)}
                          onVer={abrirVisor}
                          onQuitarSuelta={url => quitarFotoSuelta(op, 'salida', url)} />

                        {/* PASO 1 — con las fotos de salida, ANTES de entregar el carro.
                            Va pegado a las casillas de salida y no junto al botón de
                            comparar para que el orden en pantalla sea el orden real del
                            servicio: primero se entrega, después se recibe. */}
                        <div className="space-y-1.5">
                          <button
                            onClick={() => analizarEntrega(op)}
                            disabled={analizandoEntrega === op.id || fotosSalida.length === 0 || !iaDisponible}
                            className="w-full flex items-center justify-center gap-2 bg-surface border border-border-strong text-ink py-2 rounded-xl font-semibold text-sm disabled:opacity-50 transition hover:bg-brand-muted">
                            {analizandoEntrega === op.id
                              ? <><span className="w-4 h-4 border-2 border-ink/20 border-t-ink/60 rounded-full animate-spin" /> Analizando…</>
                              : '📋 Paso 1 · Analizar estado de entrega'}
                          </button>
                          <p className="text-[11px] text-ink/50">
                            Solo con las fotos de salida: anota las marcas que el carro YA trae, para que en la
                            devolución no cuenten como nuevas. No compara nada todavía.
                          </p>
                          {errEntrega[op.id] && <p className="text-[11px] text-danger">{errEntrega[op.id]}</p>}
                          {entrega && (
                            <div className="bg-surface rounded-xl p-3 border border-border/60">
                              <EstadoEntregaResultado res={entrega} />
                            </div>
                          )}
                        </div>

                        <CasillasFotos
                          fase="entrada"
                          titulo="Entrada — devolución"
                          fotos={fotosEntrada}
                          omisiones={omisiones}
                          exigidas={exigidas}
                          compacto
                          onFoto={(casilla, file) => subirFotoCasilla(op, 'entrada', casilla, file)}
                          onQuitarFoto={casilla => quitarFotoCasilla(op, 'entrada', casilla)}
                          onOmitir={(casilla, motivo) => omitirCasilla(op, 'entrada', casilla, motivo)}
                          onQuitarOmision={casilla => quitarOmision(op, 'entrada', casilla)}
                          onVer={abrirVisor}
                          onQuitarSuelta={url => quitarFotoSuelta(op, 'entrada', url)} />
                        <button
                          onClick={() => inspeccionar(op)}
                          disabled={inspeccionando === op.id || fotosSalida.length === 0 || fotosEntrada.length === 0 || !iaDisponible}
                          className="w-full flex items-center justify-center gap-2 gradient-accent text-white py-2 rounded-xl font-semibold text-sm disabled:opacity-50 transition">
                          {inspeccionando === op.id
                            ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Comparando…</>
                            : '🔍 Paso 2 · Comparar y detectar daños con IA'}
                        </button>
                        <p className="text-[11px] text-ink/50">
                          {entrega
                            ? 'Va a usar el estado de entrega del paso 1: lo que ya estaba no se cuenta como daño nuevo.'
                            : 'Este servicio no tiene análisis de entrega (paso 1). La comparación funciona igual, pero con él es más difícil que una marca vieja parezca nueva.'}
                        </p>
                        {!iaDisponible && <p className="text-[11px] text-warning">IA no configurada (falta ANTHROPIC_API_KEY). Puedes subir fotos igual.</p>}
                        {errInsp[op.id] && <p className="text-[11px] text-danger">{errInsp[op.id]}</p>}
                        {insp && (
                          <div className="bg-surface rounded-xl p-3 border border-border/60 space-y-2">
                            <InspeccionResultado res={insp} />
                            {/* Sin este aviso, el resultado desaparece solo y parece un error de la
                                app. Es la regla que impide que un veredicto sobreviva a las fotos
                                que lo produjeron (pasó en producción con un carro equivocado). */}
                            <p className="text-[10px] text-ink/40 border-t border-border/60 pt-2">
                              Este resultado se borra solo si una de las dos fases se queda sin ninguna foto, o si
                              reabres el servicio: sería un veredicto de unas fotos que ya no existen. Los respaldos
                              ya generados lo conservan.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Respaldo descargable del servicio (acta) */}
                  {(() => {
                    const lista = actas[op.id] || [];
                    return (
                      <div className="border-t border-border/60 pt-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Respaldo del servicio</p>
                          <button
                            onClick={() => generarRespaldo(op)}
                            disabled={generandoActa === op.id}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-accent/15 text-accent hover:bg-accent/20 transition disabled:opacity-40">
                            {generandoActa === op.id ? 'Generando…' : '🧾 Generar respaldo'}
                          </button>
                        </div>
                        {lista.length === 0 ? (
                          <p className="text-[11px] text-ink/50">
                            Todavía no hay respaldos de este servicio. Se genera solo cuando se termina el checklist,
                            y también puedes generarlo ahora: guarda los datos y las fotos tal como están en este
                            momento, y quedan a salvo aunque después alguien borre una foto.
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {lista.map(a => (
                              <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] bg-surface rounded-xl px-2.5 py-1.5 border border-border/60">
                                <a
                                  href={`/api/operaciones/${op.id}/acta/${a.id}`}
                                  className="font-semibold text-accent hover:underline">
                                  ⬇️ {a.numero}
                                </a>
                                <span className="text-ink/50">{a.fotos_total} foto{a.fotos_total === 1 ? '' : 's'}</span>
                                <span className="text-ink/50">· {a.created_at}</span>
                                <span className="text-ink/50">
                                  · {a.generada_por === 'sistema' ? 'automático al cerrar el servicio' : (a.generada_por_nombre || 'generado a mano')}
                                </span>
                                {!a.tiene_inspeccion && <span className="text-warning">· sin inspección de IA</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {errActa[op.id] && <p className="text-[11px] text-danger">{errActa[op.id]}</p>}
                        <p className="text-[10px] text-ink/40">
                          Cada respaldo es una copia congelada: si agregas fotos después, genera uno nuevo — el anterior no se borra.
                        </p>
                      </div>
                    );
                  })()}

                  {/* Notas */}
                  <div>
                    <textarea
                      value={notasLocal[op.id] ?? ''}
                      onChange={e => setNotasLocal(n => ({ ...n, [op.id]: e.target.value }))}
                      onBlur={() => accion(op.id, { accion: 'notas', notas: notasLocal[op.id] ?? '' })}
                      placeholder="Notas internas del servicio…"
                      rows={2}
                      className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink/40 resize-none" />
                  </div>

                  {/* Estados de envío + reenvío */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
                    <button onClick={() => accion(op.id, { accion: 'reenviar', destino: 'mensajero' })}
                      disabled={!op.mensajero_id}
                      className="text-[11px] px-2 py-1 inline-flex items-center gap-1 rounded-lg bg-accent/15 text-accent hover:bg-accent/20 transition disabled:opacity-40">
                      <IconShield size={12} /> Reenviar a mensajero
                    </button>
                    <button onClick={() => accion(op.id, { accion: 'reenviar', destino: 'admin' })}
                      className="text-[11px] px-2 py-1 rounded-lg bg-surface text-ink/60 hover:text-ink transition">
                      Reenviar a admin
                    </button>
                  </div>
                  {(op.wa_mensajero || op.wa_admin) && (
                    <div className="text-[10px] text-ink/50 space-y-0.5">
                      {op.wa_mensajero && <p>Mensajero: {op.wa_mensajero}</p>}
                      {op.wa_admin && <p>Admin: {op.wa_admin}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {visor && (
        <VisorFotos
          fotos={visor.fotos}
          indice={visor.indice}
          titulo={visor.titulo}
          onIndice={i => setVisor(v => (v ? { ...v, indice: i } : v))}
          onCerrar={() => setVisor(null)} />
      )}
    </div>
  );
}
