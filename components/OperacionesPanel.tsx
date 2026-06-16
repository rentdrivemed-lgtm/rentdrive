'use client';
import { useEffect, useState, useRef } from 'react';
import { lugarResumen, type Lugar } from '@/lib/lugares';
import { IconCheck, IconShield } from '@/components/Icons';
import InspeccionResultado, { type InspeccionResultado as InspRes } from '@/components/InspeccionResultado';

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
  detalle: Detalle; tareas: Tarea[];
};
type Mensajero = { id: number; nombre: string; celular: string; activo: number; token?: string };

function parseArr(s: string): string[] { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function parseInsp(s: string): InspRes | null { try { return s ? JSON.parse(s) as InspRes : null; } catch { return null; } }

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
  const [copiado, setCopiado] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nuevoM, setNuevoM] = useState({ nombre: '', celular: '' });
  const [cfgMsg, setCfgMsg] = useState('');
  const [notasLocal, setNotasLocal] = useState<Record<number, string>>({});

  const cargar = async () => {
    const [ro, rm] = await Promise.all([
      fetch('/api/operaciones', { cache: 'no-store' }),
      fetch('/api/mensajeros', { cache: 'no-store' }),
    ]);
    const dataO = await ro.json().catch(() => ({}));
    const dataM = await rm.json().catch(() => ({}));
    const operaciones: Operacion[] = dataO.operaciones || [];
    setOps(operaciones);
    setAdminWa(dataO.admin_whatsapp || '');
    setWaHabilitado(!!dataO.whatsapp_habilitado);
    setIaDisponible(!!dataO.ia_disponible);
    setMensajeros(dataM.mensajeros || []);
    setNotasLocal(Object.fromEntries(operaciones.map(o => [o.id, o.notas || ''])));
    setCargando(false);
  };

  useEffect(() => { cargar(); }, []);

  const activos = mensajeros.filter(m => m.activo);

  const reemplazar = (op: Operacion) => setOps(list => list.map(o => o.id === op.id ? op : o));

  const accion = async (opId: number, body: Record<string, unknown>) => {
    const res = await fetch(`/api/operaciones/${opId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.operacion) reemplazar(data.operacion as Operacion);
  };

  const subirArchivo = async (file: File): Promise<string | null> => {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    return res.ok ? d.url : null;
  };
  const subirFotos = async (op: Operacion, fase: 'salida' | 'entrada', files: FileList) => {
    const actuales = parseArr(fase === 'salida' ? op.fotos_salida : op.fotos_entrada);
    const nuevas: string[] = [];
    for (const f of Array.from(files)) { const url = await subirArchivo(f); if (url) nuevas.push(url); }
    if (nuevas.length) await accion(op.id, { accion: 'fotos', fase, urls: [...actuales, ...nuevas] });
  };
  const quitarFoto = async (op: Operacion, fase: 'salida' | 'entrada', url: string) => {
    const actuales = parseArr(fase === 'salida' ? op.fotos_salida : op.fotos_entrada).filter(u => u !== url);
    await accion(op.id, { accion: 'fotos', fase, urls: actuales });
  };
  const inspeccionar = async (op: Operacion) => {
    setInspeccionando(op.id);
    setErrInsp(e => ({ ...e, [op.id]: '' }));
    const res = await fetch(`/api/operaciones/${op.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'inspeccion' }) });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.operacion) reemplazar(d.operacion as Operacion);
    else setErrInsp(e => ({ ...e, [op.id]: d.error || 'No se pudo inspeccionar.' }));
    setInspeccionando(null);
  };

  const guardarConfig = async () => {
    setCfgMsg('');
    const res = await fetch('/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_whatsapp: adminWa }),
    });
    setCfgMsg(res.ok ? '✓ Guardado' : 'Error al guardar');
  };

  const addMensajero = async () => {
    if (!nuevoM.nombre.trim()) return;
    const res = await fetch('/api/mensajeros', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nuevoM),
    });
    if (res.ok) { setNuevoM({ nombre: '', celular: '' }); cargar(); }
  };
  const toggleMensajero = async (m: Mensajero) => {
    await fetch(`/api/mensajeros/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: !m.activo }) });
    cargar();
  };
  const delMensajero = async (m: Mensajero) => {
    await fetch(`/api/mensajeros/${m.id}`, { method: 'DELETE' });
    cargar();
  };

  if (cargando) return <div className="text-center py-16 text-ink/40">Cargando operaciones…</div>;

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
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/30" />
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
            className="flex-1 min-w-[160px] bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/30" />
          <input
            value={nuevoM.celular}
            onChange={e => setNuevoM(s => ({ ...s, celular: e.target.value }))}
            placeholder="Celular (WhatsApp)"
            className="flex-1 min-w-[160px] bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/30" />
          <button onClick={addMensajero} className="bg-accent/15 text-accent hover:bg-accent/20 px-4 py-2 rounded-xl font-semibold text-sm transition">
            + Agregar
          </button>
        </div>
        {mensajeros.length === 0 ? (
          <p className="text-xs text-ink/40">Aún no has registrado mensajeros.</p>
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
          <div className="text-center py-12 bg-surface-2 rounded-2xl border border-border text-ink/40">
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
                        {d?.placa ? <span className="text-ink/40 font-normal"> · {d.placa}</span> : null}
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
                      <p><span className="text-ink/40">Fechas:</span> {d.fecha_inicio} → {d.fecha_fin}</p>
                      <p><span className="text-ink/40">Entrega al cliente:</span> {resumenLugar(d.recogida)}</p>
                      <p><span className="text-ink/40">Devolución:</span> {resumenLugar(d.entrega)}</p>
                      <p><span className="text-ink/40">Total:</span> {pesos(d.total)}{d.recargo ? ` (recargo ${pesos(d.recargo)})` : ''}</p>
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
                            onClick={() => accion(op.id, { accion: 'tarea', tarea_id: t.id, estado: t.estado === 'hecho' ? 'pendiente' : 'hecho' })}
                            className="w-full flex items-start gap-2 text-left text-sm rounded-lg px-2 py-1.5 hover:bg-surface transition">
                            <span className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${t.estado === 'hecho' ? 'bg-success border-success text-white' : 'border-border'}`}>
                              {t.estado === 'hecho' && <IconCheck size={11} />}
                            </span>
                            <span className="min-w-0">
                              <span className={`${t.estado === 'hecho' ? 'line-through text-ink/40' : 'text-ink'}`}>{TAREA_ICON[t.tipo] || '•'} {t.titulo}</span>
                              {t.detalle && <span className="block text-[11px] text-ink/40">{t.detalle}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Inspección de daños con IA */}
                  {(() => {
                    const fotosSalida = parseArr(op.fotos_salida);
                    const fotosEntrada = parseArr(op.fotos_entrada);
                    const insp = parseInsp(op.inspeccion_ia);
                    return (
                      <div className="border-t border-border/60 pt-3 space-y-2.5">
                        <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Inspección de daños (salida vs. entrada)</p>
                        <AdminFaseFotos label="Salida (sede)" fotos={fotosSalida} onAdd={files => subirFotos(op, 'salida', files)} onRemove={u => quitarFoto(op, 'salida', u)} />
                        <AdminFaseFotos label="Entrada (devolución)" fotos={fotosEntrada} onAdd={files => subirFotos(op, 'entrada', files)} onRemove={u => quitarFoto(op, 'entrada', u)} />
                        <button
                          onClick={() => inspeccionar(op)}
                          disabled={inspeccionando === op.id || fotosSalida.length === 0 || fotosEntrada.length === 0 || !iaDisponible}
                          className="w-full flex items-center justify-center gap-2 gradient-accent text-white py-2 rounded-xl font-semibold text-sm disabled:opacity-50 transition">
                          {inspeccionando === op.id
                            ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Comparando…</>
                            : '🔍 Comparar y detectar daños con IA'}
                        </button>
                        {!iaDisponible && <p className="text-[11px] text-warning">IA no configurada (falta ANTHROPIC_API_KEY). Puedes subir fotos igual.</p>}
                        {errInsp[op.id] && <p className="text-[11px] text-danger">{errInsp[op.id]}</p>}
                        {insp && <div className="bg-surface rounded-xl p-3 border border-border/60"><InspeccionResultado res={insp} /></div>}
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
                      className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink/30 resize-none" />
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
                    <div className="text-[10px] text-ink/40 space-y-0.5">
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
    </div>
  );
}

function AdminFaseFotos({ label, fotos, onAdd, onRemove }: {
  label: string; fotos: string[];
  onAdd: (files: FileList) => Promise<void>; onRemove: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setSubiendo(true);
    await onAdd(e.target.files);
    setSubiendo(false);
    if (inputRef.current) inputRef.current.value = '';
  };
  return (
    <div>
      <p className="text-[11px] text-ink/50 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {fotos.map(u => (
          <div key={u} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="foto" className="w-full h-full object-cover" />
            <button onClick={() => onRemove(u)} className="absolute top-0.5 right-0.5 bg-black/60 text-white w-4 h-4 rounded-full text-[10px] leading-none">×</button>
          </div>
        ))}
        <button onClick={() => inputRef.current?.click()} disabled={subiendo}
          className="w-14 h-14 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-ink/40 hover:border-accent/50 transition disabled:opacity-50">
          {subiendo ? '…' : '+'}
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={handle} />
    </div>
  );
}
