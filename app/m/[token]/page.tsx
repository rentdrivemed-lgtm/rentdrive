'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import InspeccionResultado, { type InspeccionResultado as InspRes } from '@/components/InspeccionResultado';
import { lugarResumen, type Lugar } from '@/lib/lugares';
import { IconCheck } from '@/components/Icons';

type Tarea = { id: number; tipo: string; titulo: string; detalle: string; estado: 'pendiente' | 'hecho'; orden: number };
type Detalle = {
  marca: string; modelo: string; anio: number; placa: string;
  usuario_nombre: string; usuario_celular: string; fecha_inicio: string; fecha_fin: string;
  recogida: string; entrega: string; total: number; recargo: number;
} | null;
type Operacion = {
  id: number; reserva_id: number; estado: string;
  fotos_salida: string; fotos_entrada: string; inspeccion_ia: string; inspeccion_estado: string;
  detalle: Detalle; tareas: Tarea[];
};

const TAREA_ICON: Record<string, string> = { lavar: '🚿', tanquear: '⛽', entregar: '📤', recibir: '📥', inspeccion: '📸' };
const OP_LABEL: Record<string, string> = { pendiente: 'Sin iniciar', asignada: 'Asignada', en_proceso: 'En proceso', finalizada: 'Finalizada' };

function parseArr(s: string): string[] { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function parseInsp(s: string): InspRes | null { try { return s ? JSON.parse(s) as InspRes : null; } catch { return null; } }
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

  const cargar = async () => {
    const res = await fetch(`/api/m/${token}`, { cache: 'no-store' });
    if (res.status === 404) { setInvalido(true); setCargando(false); return; }
    const d = await res.json().catch(() => ({}));
    setNombre(d.mensajero?.nombre || '');
    setOps(d.operaciones || []);
    setIaDisponible(!!d.ia_disponible);
    setCargando(false);
  };
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const reemplazar = (op: Operacion) => setOps(list => list.map(o => o.id === op.id ? op : o));

  const accion = async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch(`/api/m/${token}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.operacion) reemplazar(d.operacion as Operacion);
    return { ok: res.ok, error: d.error };
  };

  const subirArchivo = async (file: File): Promise<string | null> => {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`/api/m/${token}/upload`, { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    return res.ok ? d.url : null;
  };

  const subirFotos = async (op: Operacion, fase: 'salida' | 'entrada', files: FileList) => {
    const actuales = parseArr(fase === 'salida' ? op.fotos_salida : op.fotos_entrada);
    const nuevas: string[] = [];
    for (const f of Array.from(files)) {
      const url = await subirArchivo(f);
      if (url) nuevas.push(url);
    }
    if (nuevas.length) await accion({ accion: 'fotos', operacion_id: op.id, fase, urls: [...actuales, ...nuevas] });
  };

  const quitarFoto = async (op: Operacion, fase: 'salida' | 'entrada', url: string) => {
    const actuales = parseArr(fase === 'salida' ? op.fotos_salida : op.fotos_entrada).filter(u => u !== url);
    await accion({ accion: 'fotos', operacion_id: op.id, fase, urls: actuales });
  };

  const inspeccionar = async (op: Operacion) => {
    setInspeccionando(op.id);
    setErrorInsp(e => ({ ...e, [op.id]: '' }));
    const r = await accion({ accion: 'inspeccion', operacion_id: op.id });
    if (!r.ok) setErrorInsp(e => ({ ...e, [op.id]: r.error || 'No se pudo inspeccionar.' }));
    setInspeccionando(null);
  };

  if (cargando) return <div className="min-h-screen flex items-center justify-center text-ink/40">Cargando…</div>;
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
          <div className="text-center py-16 text-ink/40 bg-surface-2 rounded-2xl border border-border">
            <p className="text-3xl mb-2">📭</p>
            <p>No tienes servicios asignados por ahora.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {ops.map(op => {
              const d = op.detalle;
              const insp = parseInsp(op.inspeccion_ia);
              const fotosSalida = parseArr(op.fotos_salida);
              const fotosEntrada = parseArr(op.fotos_entrada);
              return (
                <div key={op.id} className="bg-surface-2 rounded-2xl border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{d ? `${d.marca} ${d.modelo} ${d.anio}` : `Servicio #${op.id}`}</p>
                      {d?.placa && <p className="text-xs text-ink/40">Placa {d.placa}</p>}
                    </div>
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface text-ink/60 border border-border shrink-0">
                      {OP_LABEL[op.estado] || op.estado}
                    </span>
                  </div>

                  {d && (
                    <div className="text-xs text-ink/60 space-y-0.5 bg-surface rounded-xl p-2.5 border border-border/60">
                      <p><span className="text-ink/40">Cliente:</span> {d.usuario_nombre}{d.usuario_celular ? ` · ${d.usuario_celular}` : ''}</p>
                      <p><span className="text-ink/40">Entrega:</span> {resumenLugar(d.recogida)} · {d.fecha_inicio}</p>
                      <p><span className="text-ink/40">Devolución:</span> {resumenLugar(d.entrega)} · {d.fecha_fin}</p>
                    </div>
                  )}

                  {/* Checklist */}
                  <div>
                    <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide mb-1.5">Tareas</p>
                    <ul className="space-y-1">
                      {op.tareas.map(t => (
                        <li key={t.id}>
                          <button
                            onClick={() => accion({ accion: 'tarea', operacion_id: op.id, tarea_id: t.id, estado: t.estado === 'hecho' ? 'pendiente' : 'hecho' })}
                            className="w-full flex items-start gap-2.5 text-left rounded-xl px-2.5 py-2 hover:bg-surface transition">
                            <span className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${t.estado === 'hecho' ? 'bg-success border-success text-white' : 'border-border'}`}>
                              {t.estado === 'hecho' && <IconCheck size={13} />}
                            </span>
                            <span className="min-w-0">
                              <span className={`text-sm ${t.estado === 'hecho' ? 'line-through text-ink/40' : 'text-ink'}`}>{TAREA_ICON[t.tipo] || '•'} {t.titulo}</span>
                              {t.detalle && <span className="block text-[11px] text-ink/40">{t.detalle}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Inspección con fotos */}
                  <div className="border-t border-border/60 pt-3 space-y-3">
                    <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Inspección de daños</p>
                    <FaseFotos label="📸 Fotos de SALIDA (sede)" fotos={fotosSalida} onAdd={files => subirFotos(op, 'salida', files)} onRemove={u => quitarFoto(op, 'salida', u)} />
                    <FaseFotos label="📸 Fotos de ENTRADA (devolución)" fotos={fotosEntrada} onAdd={files => subirFotos(op, 'entrada', files)} onRemove={u => quitarFoto(op, 'entrada', u)} />

                    <button
                      onClick={() => inspeccionar(op)}
                      disabled={inspeccionando === op.id || fotosSalida.length === 0 || fotosEntrada.length === 0 || !iaDisponible}
                      className="w-full flex items-center justify-center gap-2 gradient-accent text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50 transition">
                      {inspeccionando === op.id
                        ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Comparando fotos…</>
                        : '🔍 Comparar y detectar daños con IA'}
                    </button>
                    {!iaDisponible && <p className="text-[11px] text-warning text-center">La IA no está configurada todavía (falta la clave). Puedes subir las fotos igual.</p>}
                    {(fotosSalida.length === 0 || fotosEntrada.length === 0) && iaDisponible && (
                      <p className="text-[11px] text-ink/40 text-center">Sube al menos una foto de salida y una de entrada para comparar.</p>
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
    </div>
  );
}

function FaseFotos({ label, fotos, onAdd, onRemove }: {
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
      <div className="flex flex-wrap gap-2">
        {fotos.map(u => (
          <div key={u} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="foto" className="w-full h-full object-cover" />
            <button onClick={() => onRemove(u)} className="absolute top-0.5 right-0.5 bg-black/60 text-white w-4 h-4 rounded-full text-[10px] leading-none">×</button>
          </div>
        ))}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
          className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-ink/40 hover:border-accent/50 transition disabled:opacity-50">
          {subiendo ? '…' : '+'}
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handle} />
    </div>
  );
}
