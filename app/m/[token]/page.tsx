'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import InspeccionResultado, { type InspeccionResultado as InspRes } from '@/components/InspeccionResultado';
import EstadoEntregaResultado, { type EstadoEntrega } from '@/components/EstadoEntregaResultado';
import VisorFotos, { type FotoVisor } from '@/components/VisorFotos';
import CasillasFotos from '@/components/CasillasFotos';
import { lugarResumen, type Lugar } from '@/lib/lugares';
import { parseFotosServicio, parseOmisiones, type CasillaId, type FaseFoto } from '@/lib/fotos-servicio';
import { IconCheck } from '@/components/Icons';
import ReporteMediciones from '@/components/ReporteMediciones';
import { ITEMS_ESTADO_VEHICULO } from '@/lib/contratos-datos';
import ConstanciaCliente from '@/components/ConstanciaCliente';

type Tarea = { id: number; tipo: string; titulo: string; detalle: string; estado: 'pendiente' | 'hecho'; orden: number };
type Detalle = {
  marca: string; modelo: string; anio: number; placa: string;
  usuario_nombre: string; usuario_celular: string; fecha_inicio: string; fecha_fin: string;
  recogida: string; entrega: string; total: number; recargo: number;
} | null;
type Operacion = {
  id: number; reserva_id: number; estado: string;
  fotos_salida: string; fotos_entrada: string; inspeccion_ia: string; inspeccion_estado: string;
  // Paso 1: inventario del estado en que SALE el vehículo (solo fotos de salida).
  entrega_ia: string; entrega_estado: string;
  // Casillas guiadas de fotos (ver lib/fotos-servicio.ts). `fotos_guiadas` vale 0 en
  // los servicios anteriores a las casillas: ahí no se exigen las 8 fotos.
  fotos_omitidas: string; fotos_guiadas: number;
  // Lo que antes se llenaba a mano en el acta impresa (ver lib/reporte-entrega.ts).
  kilometraje_salida: number | null; kilometraje_entrada: number | null;
  combustible_salida: number | null; combustible_entrada: number | null;
  inventario_salida: string; inventario_entrada: string;
  salida_confirmado_en: string; entrada_confirmado_en: string;
  salida_constancia: string; entrada_constancia: string;
  detalle: Detalle; tareas: Tarea[];
};

/**
 * Lee el inventario guardado. Local y no importado de lib/reporte-entrega.ts porque
 * aquel es de SERVIDOR (better-sqlite3) y esta pantalla es 'use client'. Acá basta con
 * leerlo para pintarlo; quien manda sobre qué es válido es el servidor al guardarlo.
 */
function parsearInventarioUI(json: string): Record<string, { estado: 'B' | 'R' | 'M'; nota: string }> {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

const TAREA_ICON: Record<string, string> = { lavar: '🚿', tanquear: '⛽', entregar: '📤', recibir: '📥', inspeccion: '📸' };
const OP_LABEL: Record<string, string> = { pendiente: 'Sin iniciar', asignada: 'Asignada', en_proceso: 'En proceso', finalizada: 'Finalizada' };

function parseInsp(s: string): InspRes | null { try { return s ? JSON.parse(s) as InspRes : null; } catch { return null; } }
function parseEntrega(s: string): EstadoEntrega | null {
  try {
    const o = s ? JSON.parse(s) as EstadoEntrega : null;
    return o && Array.isArray(o.marcas) ? o : null;
  } catch { return null; }
}
function resumenLugar(json: string): string { try { const o = JSON.parse(json || '{}') as Lugar; return lugarResumen(o.municipio ? o : null); } catch { return '—'; } }

export default function MensajeroPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [nombre, setNombre] = useState('');
  const [ops, setOps] = useState<Operacion[]>([]);
  const [iaDisponible, setIaDisponible] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [invalido, setInvalido] = useState(false);
  const [inspeccionando, setInspeccionando] = useState<number | null>(null);
  const [errorInsp, setErrorInsp] = useState<Record<number, string>>({});
  // Paso 1 (analizar el estado de entrega). Va aparte del estado de la comparación:
  // son dos botones y solo el que se tocó debe verse ocupado.
  const [analizandoEntrega, setAnalizandoEntrega] = useState<number | null>(null);
  const [errorEntrega, setErrorEntrega] = useState<Record<number, string>>({});
  // Mensaje del servidor cuando rechaza marcar una tarea (faltan fotos) o falla una
  // subida. Va por operación: en la pantalla hay varias tarjetas a la vez.
  const [errorTarea, setErrorTarea] = useState<Record<number, string>>({});
  const [errorCarga, setErrorCarga] = useState('');
  // Visor de fotos a pantalla completa (componente compartido con el panel de
  // Operaciones del admin). El padre es el dueño del índice para poder abrirlo
  // desde cualquier miniatura, de salida o de entrada.
  const [visor, setVisor] = useState<{ fotos: FotoVisor[]; indice: number; titulo: string } | null>(null);

  const cargar = async () => {
    setCargando(true);
    setErrorCarga('');
    try {
      const res = await fetch(`/api/m/${token}`, { cache: 'no-store' });
      if (res.status === 404) { setInvalido(true); return; }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorCarga('No pudimos cargar tus servicios. Intenta de nuevo.'); return; }
      setNombre(d.mensajero?.nombre || '');
      setOps(d.operaciones || []);
      setIaDisponible(!!d.ia_disponible);
    } catch {
      setErrorCarga('Sin conexión — revisa tu señal e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const reemplazar = (op: Operacion) => setOps(list => list.map(o => o.id === op.id ? op : o));

  const accion = async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/m/${token}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.operacion) reemplazar(d.operacion as Operacion);
      return { ok: res.ok, error: d.error };
    } catch {
      return { ok: false, error: 'Sin conexión — revisa tu señal e intenta de nuevo.' };
    }
  };

  const subirArchivo = async (file: File): Promise<string | null> => {
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/m/${token}/upload`, { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      return res.ok ? d.url : null;
    } catch {
      return null;
    }
  };

  // Una casilla a la vez: el servidor solo toca ESA casilla, así que dos guardados
  // que se crucen con mala señal no se pisan entre sí.
  const subirFotoCasilla = async (op: Operacion, fase: FaseFoto, casilla: CasillaId, file: File) => {
    setErrorTarea(e => ({ ...e, [op.id]: '' }));
    const url = await subirArchivo(file);
    if (!url) {
      setErrorTarea(e => ({ ...e, [op.id]: 'No se pudo subir la foto. Revisa tu señal e intenta de nuevo.' }));
      return;
    }
    const r = await accion({ accion: 'foto_casilla', operacion_id: op.id, fase, casilla, url });
    if (!r.ok) setErrorTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo guardar la foto.' }));
  };

  const quitarFotoCasilla = async (op: Operacion, fase: FaseFoto, casilla: CasillaId) => {
    await accion({ accion: 'foto_casilla', operacion_id: op.id, fase, casilla, url: '' });
  };

  const omitirCasilla = async (op: Operacion, fase: FaseFoto, casilla: CasillaId, motivo: string): Promise<string | null> => {
    const r = await accion({ accion: 'omitir_casilla', operacion_id: op.id, fase, casilla, motivo });
    return r.ok ? null : (r.error || 'No se pudo guardar el motivo.');
  };

  const quitarOmision = async (op: Operacion, fase: FaseFoto, casilla: CasillaId) => {
    await accion({ accion: 'quitar_omision', operacion_id: op.id, fase, casilla });
  };

  /**
   * Guarda un trozo del reporte: el kilometraje, el combustible o un ítem del
   * inventario. A trozos y no de una porque así es como se revisa un carro —una vuelta
   * alrededor, marcando— y nadie debería perder media revisión por cerrar la pantalla.
   */
  /** El cliente no pudo confirmar: queda escrito por qué, y la entrega sigue. */
  const dejarConstancia = async (op: Operacion, fase: FaseFoto, motivo: string): Promise<boolean> => {
    const r = await accion({ accion: 'constancia', operacion_id: op.id, fase, motivo });
    if (!r.ok) setErrorTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo guardar la constancia.' }));
    return r.ok;
  };

  const guardarMediciones = async (
    op: Operacion, fase: FaseFoto,
    datos: { kilometraje?: number; combustible?: number; inventario?: Record<string, { estado: string; nota: string }> },
  ): Promise<boolean> => {
    const r = await accion({ accion: 'mediciones', operacion_id: op.id, fase, ...datos });
    if (!r.ok) setErrorTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo guardar.' }));
    return r.ok;
  };

  // Fotos sueltas de servicios anteriores a las casillas. Se manda SOLO la URL que se
  // quiere quitar y el servidor filtra dentro de una transacción. Antes esta pantalla
  // reconstruía la lista completa desde su propia copia y la mandaba con la acción
  // `fotos` (que reemplaza la fase entera): con el celular abierto un rato, eso
  // devolvía un estado viejo y borraba lo que el administrador hubiera subido
  // mientras tanto.
  const quitarFotoSuelta = async (op: Operacion, fase: FaseFoto, url: string) => {
    await accion({ accion: 'quitar_foto_suelta', operacion_id: op.id, fase, url });
  };

  // Marcar/desmarcar una tarea. El servidor puede RECHAZARLO si faltan fotos de la
  // fase: ese mensaje hay que mostrarlo, o el mensajero toca la casilla y no pasa
  // nada sin saber por qué.
  const marcarTarea = async (op: Operacion, tarea: Tarea) => {
    setErrorTarea(e => ({ ...e, [op.id]: '' }));
    const r = await accion({
      accion: 'tarea', operacion_id: op.id, tarea_id: tarea.id,
      estado: tarea.estado === 'hecho' ? 'pendiente' : 'hecho',
    });
    if (!r.ok) setErrorTarea(e => ({ ...e, [op.id]: r.error || 'No se pudo marcar la tarea.' }));
  };

  // Paso 1: antes de entregarle el carro al cliente, con las fotos de salida. Anota lo
  // que el carro YA trae; el paso 2 (comparar, al recibirlo) lo usa como referencia.
  const analizarEntrega = async (op: Operacion) => {
    setAnalizandoEntrega(op.id);
    setErrorEntrega(e => ({ ...e, [op.id]: '' }));
    const r = await accion({ accion: 'analisis_entrega', operacion_id: op.id });
    if (!r.ok) setErrorEntrega(e => ({ ...e, [op.id]: r.error || 'No se pudo analizar el estado de entrega.' }));
    setAnalizandoEntrega(null);
  };

  const inspeccionar = async (op: Operacion) => {
    setInspeccionando(op.id);
    setErrorInsp(e => ({ ...e, [op.id]: '' }));
    const r = await accion({ accion: 'inspeccion', operacion_id: op.id });
    if (!r.ok) setErrorInsp(e => ({ ...e, [op.id]: r.error || 'No se pudo inspeccionar.' }));
    setInspeccionando(null);
  };

  if (cargando) return <div className="min-h-screen flex items-center justify-center text-ink/50">Cargando…</div>;
  if (errorCarga) return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <p className="text-4xl mb-3">📡</p>
        <p className="text-ink/60 mb-4">{errorCarga}</p>
        <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
      </div>
    </div>
  );
  if (invalido) return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <p className="text-4xl mb-3">🔒</p>
        <p className="text-ink/60">Este enlace no es válido. Pídele a tu administrador tu enlace personal.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="mb-5">
          <p className="text-xs text-accent font-semibold uppercase tracking-wide">DrivePass · Operaciones</p>
          <h1 className="text-xl font-bold text-ink">Hola, {nombre || 'mensajero'} 👋</h1>
          <p className="text-sm text-ink/50">Tus servicios asignados ({ops.length})</p>
        </div>

        {ops.length === 0 ? (
          <div className="text-center py-16 text-ink/50 bg-surface-2 rounded-2xl border border-border">
            <p className="text-3xl mb-2">📭</p>
            <p>No tienes servicios asignados por ahora.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {ops.map(op => {
              const d = op.detalle;
              const insp = parseInsp(op.inspeccion_ia);
              const entrega = parseEntrega(op.entrega_ia);
              // `parseFotosServicio` lee los DOS formatos: el array plano de strings de
              // los servicios viejos y el `[{casilla, url}]` de las casillas guiadas.
              const fotosSalida = parseFotosServicio(op.fotos_salida);
              const fotosEntrada = parseFotosServicio(op.fotos_entrada);
              const omisiones = parseOmisiones(op.fotos_omitidas);
              const exigidas = Number(op.fotos_guiadas) === 1;
              // Salida y entrada van en UNA sola lista para poder pasar de una a otra
              // sin cerrar el visor; la etiqueta ("SALIDA 2 de 4") sale del grupo.
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
                <div key={op.id} className="bg-surface-2 rounded-2xl border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{d ? `${d.marca} ${d.modelo} ${d.anio}` : `Servicio #${op.id}`}</p>
                      {d?.placa && <p className="text-xs text-ink/50">Placa {d.placa}</p>}
                    </div>
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface text-ink/60 border border-border shrink-0">
                      {OP_LABEL[op.estado] || op.estado}
                    </span>
                  </div>

                  {d && (
                    <div className="text-xs text-ink/60 space-y-0.5 bg-surface rounded-xl p-2.5 border border-border/60">
                      <p><span className="text-ink/50">Cliente:</span> {d.usuario_nombre}{d.usuario_celular ? ` · ${d.usuario_celular}` : ''}</p>
                      <p><span className="text-ink/50">Entrega:</span> {resumenLugar(d.recogida)} · {d.fecha_inicio}</p>
                      <p><span className="text-ink/50">Devolución:</span> {resumenLugar(d.entrega)} · {d.fecha_fin}</p>
                    </div>
                  )}

                  {/* Checklist */}
                  <div>
                    <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide mb-1.5">Tareas</p>
                    <ul className="space-y-1">
                      {op.tareas.map(t => (
                        <li key={t.id}>
                          <button
                            onClick={() => marcarTarea(op, t)}
                            className="w-full flex items-start gap-2.5 text-left rounded-xl px-2.5 py-2 hover:bg-surface transition">
                            <span className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${t.estado === 'hecho' ? 'bg-success border-success text-white' : 'border-border'}`}>
                              {t.estado === 'hecho' && <IconCheck size={13} />}
                            </span>
                            <span className="min-w-0">
                              <span className={`text-sm ${t.estado === 'hecho' ? 'line-through text-ink/50' : 'text-ink'}`}>{TAREA_ICON[t.tipo] || '•'} {t.titulo}</span>
                              {t.detalle && <span className="block text-[11px] text-ink/50">{t.detalle}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {errorTarea[op.id] && (
                      <p className="text-[11px] text-danger mt-1.5 bg-danger/10 rounded-lg px-2.5 py-1.5">{errorTarea[op.id]}</p>
                    )}
                  </div>

                  {/* Inspección con fotos */}
                  <div className="border-t border-border/60 pt-3 space-y-3">
                    <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Fotos del vehículo</p>
                    <CasillasFotos
                      fase="salida"
                      titulo="📤 Al ENTREGAR el carro"
                      fotos={fotosSalida}
                      omisiones={omisiones}
                      exigidas={exigidas}
                      usarCamara
                      onFoto={(casilla, file) => subirFotoCasilla(op, 'salida', casilla, file)}
                      onQuitarFoto={casilla => quitarFotoCasilla(op, 'salida', casilla)}
                      onOmitir={(casilla, motivo) => omitirCasilla(op, 'salida', casilla, motivo)}
                      onQuitarOmision={casilla => quitarOmision(op, 'salida', casilla)}
                      onVer={abrirVisor}
                      onQuitarSuelta={url => quitarFotoSuelta(op, 'salida', url)} />

                    {/* Lo que el ACTA necesita y antes se llenaba a mano en papel. Va
                        junto a las fotos de salida porque es el mismo momento: el
                        mensajero está con el carro delante, antes de entregarlo. */}
                    <div className="border-t border-border/60 pt-3">
                      <ReporteMediciones
                        titulo="📋 Estado al ENTREGAR"
                        items={ITEMS_ESTADO_VEHICULO}
                        kilometraje={op.kilometraje_salida}
                        combustible={op.combustible_salida}
                        inventario={parsearInventarioUI(op.inventario_salida)}
                        bloqueado={!!op.salida_confirmado_en}
                        onGuardar={datos => guardarMediciones(op, 'salida', datos)} />
                      {op.salida_confirmado_en && (
                        <p className="text-[11px] text-success mt-2">
                          El cliente ya confirmó este estado. Para corregir algo, escríbele al equipo.
                        </p>
                      )}
                    </div>

                    {/* PASO 1 — con las fotos de salida, ANTES de entregarle el carro al
                        cliente. Va justo debajo de esas casillas para que el orden de la
                        pantalla sea el orden real del trabajo. */}
                    <div className="space-y-1.5">
                      <button
                        onClick={() => analizarEntrega(op)}
                        disabled={analizandoEntrega === op.id || fotosSalida.length === 0 || !iaDisponible}
                        className="w-full flex items-center justify-center gap-2 bg-surface border border-border-strong text-ink py-2.5 rounded-xl font-bold text-sm disabled:opacity-50 transition">
                        {analizandoEntrega === op.id
                          ? <><span className="w-4 h-4 border-2 border-ink/20 border-t-ink/60 rounded-full animate-spin" /> Analizando…</>
                          : '📋 Paso 1 · Analizar estado de entrega'}
                      </button>
                      <p className="text-[11px] text-ink/50 text-center">
                        Anota las marcas que el carro YA tiene. Muéstraselas al cliente antes de entregárselo.
                      </p>
                      {errorEntrega[op.id] && <p className="text-[11px] text-danger text-center">{errorEntrega[op.id]}</p>}
                      {entrega && (
                        <div className="bg-surface rounded-xl p-3 border border-border/60">
                          <EstadoEntregaResultado res={entrega} />
                        </div>
                      )}
                    </div>

                    <CasillasFotos
                      fase="entrada"
                      titulo="📥 Al RECIBIR el carro"
                      fotos={fotosEntrada}
                      omisiones={omisiones}
                      exigidas={exigidas}
                      usarCamara
                      onFoto={(casilla, file) => subirFotoCasilla(op, 'entrada', casilla, file)}
                      onQuitarFoto={casilla => quitarFotoCasilla(op, 'entrada', casilla)}
                      onOmitir={(casilla, motivo) => omitirCasilla(op, 'entrada', casilla, motivo)}
                      onQuitarOmision={casilla => quitarOmision(op, 'entrada', casilla)}
                      onVer={abrirVisor}
                      onQuitarSuelta={url => quitarFotoSuelta(op, 'entrada', url)} />

                    {/* El mismo reporte, para la DEVOLUCIÓN. Es el otro momento de la
                        misma acta, y es lo que permite comparar cómo salió el carro con
                        cómo volvió. */}
                    <div className="border-t border-border/60 pt-3">
                      <ReporteMediciones
                        titulo="📋 Estado al RECIBIR"
                        items={ITEMS_ESTADO_VEHICULO}
                        kilometraje={op.kilometraje_entrada}
                        combustible={op.combustible_entrada}
                        inventario={parsearInventarioUI(op.inventario_entrada)}
                        bloqueado={!!op.entrada_confirmado_en}
                        onGuardar={datos => guardarMediciones(op, 'entrada', datos)} />
                      {op.entrada_confirmado_en && (
                        <p className="text-[11px] text-success mt-2">
                          El cliente ya confirmó este estado.
                        </p>
                      )}
                    </div>

                    {/* Si el cliente no puede confirmar, se deja constancia y la entrega
                        SIGUE. El acta dirá que no confirmó y por qué, en vez de afirmar
                        una conformidad que no hubo. */}
                    <ConstanciaCliente
                      salida={{ confirmado: !!op.salida_confirmado_en, constancia: op.salida_constancia }}
                      entrada={{ confirmado: !!op.entrada_confirmado_en, constancia: op.entrada_constancia }}
                      onDejar={(fase, motivo) => dejarConstancia(op, fase, motivo)} />

                    <button
                      onClick={() => inspeccionar(op)}
                      disabled={inspeccionando === op.id || fotosSalida.length === 0 || fotosEntrada.length === 0 || !iaDisponible}
                      className="w-full flex items-center justify-center gap-2 gradient-accent text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50 transition">
                      {inspeccionando === op.id
                        ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Comparando fotos…</>
                        : '🔍 Paso 2 · Comparar y detectar daños con IA'}
                    </button>
                    {!iaDisponible && <p className="text-[11px] text-warning text-center">La IA no está configurada todavía (falta la clave). Puedes subir las fotos igual.</p>}
                    {(fotosSalida.length === 0 || fotosEntrada.length === 0) && iaDisponible && (
                      <p className="text-[11px] text-ink/50 text-center">Sube al menos una foto de salida y una de entrada para comparar.</p>
                    )}
                    {errorInsp[op.id] && <p className="text-[11px] text-danger text-center">{errorInsp[op.id]}</p>}
                    {insp && (
                      <div className="bg-surface rounded-xl p-3 border border-border/60">
                        <InspeccionResultado res={insp} />
                      </div>
                    )}
                  </div>
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
