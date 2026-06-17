'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import FotoUpload from '@/components/FotoUpload';
import DocUpload from '@/components/DocUpload';
import CalendarioDisponibilidad from '@/components/CalendarioDisponibilidad';
import CalendarioReservas, { type ReservaCalendario } from '@/components/CalendarioReservas';
import { IconCar, IconCalendar, IconChat, IconCheck } from '@/components/Icons';

type DocItem = { url: string; vence?: string };
type Documentos = {
  soat?: DocItem;
  tecno?: DocItem;
  tarjeta?: { url: string };
  todo_riesgo?: { url: string; aseguradora?: string; poliza?: string; vence?: string };
};

type DocRevision = { estado: string; nota: string };

type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number;
  tipo: string; precio_dia: number; disponible: number;
  dias_disponibles: string; placa?: string; documentos?: string;
  documentos_estado?: string; documentos_nota?: string;
  documentos_revisiones?: string;
};
type Reserva = ReservaCalendario & { usuario_id: number };
type User = {
  id: number; nombre: string; correo: string;
  tipo_documento?: string; documento_identidad?: string;
  celular?: string; cedula_url?: string;
};

type Fotos = {
  lado_izquierdo: string; lado_derecho: string;
  frente: string; trasera: string;
  cojineria: string; baul: string; tablero: string;
};
const FOTOS_VACIAS: Fotos = {
  lado_izquierdo: '', lado_derecho: '', frente: '', trasera: '',
  cojineria: '', baul: '', tablero: '',
};
const FOTOS_LABELS: Record<keyof Fotos, string> = {
  lado_izquierdo: 'Lado izquierdo',
  lado_derecho: 'Lado derecho',
  frente: 'Frente',
  trasera: 'Parte trasera',
  cojineria: 'Cojinería',
  baul: 'Baúl',
  tablero: 'Tablero',
};

const FORM_INICIAL = {
  marca: '', modelo: '', anio: '', tipo: 'sedan', ubicacion: 'Medellín', descripcion: '', placa: '',
};

const estadoColor: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning',
  confirmada: 'bg-brand-muted text-ink',
  en_curso:   'bg-success/15 text-success',
  completada: 'bg-surface text-ink/50',
  cancelada:  'bg-danger/15 text-danger',
};

export default function DashboardPropietario() {
  const [user, setUser] = useState<User | null>(null);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loadingReservas, setLoadingReservas] = useState(false);
  const [errorReservas, setErrorReservas] = useState('');
  const [form, setForm] = useState(FORM_INICIAL);
  const [fotos, setFotos] = useState<Fotos>(FOTOS_VACIAS);
  const [diasDisponibles, setDiasDisponibles] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [publicando, setPublicando] = useState(false);
  const [tab, setTab] = useState<'vehiculos' | 'reservas' | 'nuevo' | 'perfil'>('vehiculos');
  const [calTab, setCalTab] = useState<number | null>(null);
  const [docTab, setDocTab] = useState<number | null>(null);
  const [docsEditando, setDocsEditando] = useState<Record<number, Documentos>>({});
  const [placaMsg, setPlacaMsg] = useState<Record<number, string>>({});
  const [perfil, setPerfil] = useState({ tipo_documento: 'cedula', documento_identidad: '', celular: '', cedula_url: '' });
  const [perfilMsg, setPerfilMsg] = useState('');
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);
  const router = useRouter();

  const cargarVehiculos = async (uid: number) => {
    const res = await fetch(`/api/vehiculos?propietarioId=${uid}`);
    const data = await res.json();
    setVehiculos(data.vehiculos || []);
  };

  const cargarReservas = async () => {
    setLoadingReservas(true);
    setErrorReservas('');
    try {
      const res = await fetch('/api/reservas', { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorReservas(err.error || `Error ${res.status} al cargar reservas`);
        setLoadingReservas(false);
        return;
      }
      const data = await res.json();
      setReservas(data.reservas || []);
    } catch {
      setErrorReservas('Error de red al cargar reservas. Intenta de nuevo.');
    }
    setLoadingReservas(false);
  };

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.rol !== 'propietario') { router.push('/login'); return; }
      setUser(d.user);
      setPerfil({
        tipo_documento: d.user.tipo_documento || 'cedula',
        documento_identidad: d.user.documento_identidad || '',
        celular: d.user.celular || '',
        cedula_url: d.user.cedula_url || '',
      });
      cargarVehiculos(d.user.id);
      cargarReservas();
    });
  }, [router]);

  // Recargar reservas cada vez que el usuario cambia a la tab de reservas
  useEffect(() => {
    if (tab === 'reservas') cargarReservas();
  }, [tab]);

  const guardarPlaca = async (vid: number, valor: string) => {
    const placa = valor.toUpperCase().trim();
    const actual = vehiculos.find(v => v.id === vid)?.placa || '';
    if (placa === actual) return;
    await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ placa }),
    });
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, placa } : v));
    setPlacaMsg(m => ({ ...m, [vid]: '✓ Guardada' }));
    setTimeout(() => setPlacaMsg(m => { const c = { ...m }; delete c[vid]; return c; }), 1500);
  };

  const guardarPerfil = async () => {
    setGuardandoPerfil(true);
    setPerfilMsg('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(perfil),
      });
      if (res.ok) {
        setPerfilMsg('✓ Perfil actualizado correctamente.');
        setUser(u => u ? { ...u, ...perfil } : u);
      } else {
        const d = await res.json().catch(() => ({}));
        setPerfilMsg(d.error || 'No se pudo guardar el perfil.');
      }
    } catch {
      setPerfilMsg('Error de red al guardar.');
    } finally {
      setGuardandoPerfil(false);
    }
  };

  const fotosCompletas = Object.values(fotos).every(Boolean);

  const publicar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (!fotosCompletas) { setMsg('Debes subir todas las fotos obligatorias'); return; }
    if (diasDisponibles.length === 0) { setMsg('Debes marcar al menos un día de disponibilidad'); return; }

    setPublicando(true);
    const res = await fetch('/api/vehiculos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        anio: Number(form.anio),
        precio_dia: 0,
        placa: form.placa,
        fotos: JSON.stringify([fotos.frente]),
        fotos_detalle: JSON.stringify(fotos),
        dias_disponibles: JSON.stringify(diasDisponibles),
      }),
    });
    setPublicando(false);
    if (res.ok) {
      setMsg('✅ Vehículo publicado. El administrador asignará el precio pronto.');
      setForm(FORM_INICIAL);
      setFotos(FOTOS_VACIAS);
      setDiasDisponibles([]);
      if (user) cargarVehiculos(user.id);
      setTab('vehiculos');
    } else {
      const d = await res.json();
      setMsg(d.error || 'Error al publicar');
    }
  };

  const toggleDisponible = async (v: Vehiculo) => {
    await fetch(`/api/vehiculos/${v.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disponible: v.disponible ? 0 : 1 }),
    });
    if (user) cargarVehiculos(user.id);
  };

  const guardarDias = async (vid: number, dias: string[]) => {
    await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dias_disponibles: JSON.stringify(dias) }),
    });
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, dias_disponibles: JSON.stringify(dias) } : v));
  };

  const guardarDocumentos = async (vid: number, docs: Documentos) => {
    await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentos: JSON.stringify(docs) }),
    });
    // API auto-sets documentos_estado = 'en_revision' and clears nota
    setVehiculos(vs => vs.map(v => v.id === vid
      ? { ...v, documentos: JSON.stringify(docs), documentos_estado: 'en_revision', documentos_nota: '' }
      : v));
  };

  const reservasDatesVehiculo = (vid: number): string[] => {
    const set = new Set<string>();
    reservas
      .filter(r => r.vehiculo_id === vid && r.estado !== 'cancelada')
      .forEach(r => {
        const [sy, sm, sd] = r.fecha_inicio.slice(0, 10).split('-').map(Number);
        const [ey, em, ed] = r.fecha_fin.slice(0, 10).split('-').map(Number);
        const c = new Date(sy, sm - 1, sd);
        const f = new Date(ey, em - 1, ed);
        while (c < f) {
          set.add(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
          c.setDate(c.getDate() + 1);
        }
      });
    return [...set];
  };

  if (!user) return <div className="text-center py-20 text-ink/40">Cargando...</div>;

  const TABS = [
    { key: 'vehiculos', label: `Mis vehículos (${vehiculos.length})` },
    { key: 'reservas',  label: loadingReservas ? 'Reservas…' : `Reservas (${reservas.length})` },
    { key: 'nuevo',     label: '+ Publicar vehículo' },
    { key: 'perfil',    label: 'Mi perfil' },
  ] as const;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Panel Propietario</h1>
        <p className="text-ink/50 text-sm">{user.nombre} · {user.correo}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap ${
              tab === t.key
                ? 'border-accent text-accent'
                : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── MIS VEHÍCULOS ── */}
      {tab === 'vehiculos' && (
        <div className="space-y-4">
          {vehiculos.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/40">No tienes vehículos publicados.</p>
            </div>
          ) : vehiculos.map(v => {
            const dias = (() => { try { return JSON.parse(v.dias_disponibles || '[]'); } catch { return []; } })() as string[];
            const editando = calTab === v.id;
            const docsActuales: Documentos = (() => { try { return JSON.parse(v.documentos || '{}'); } catch { return {}; } })();
            return (
              <div key={v.id} className="bg-surface-2 rounded-2xl shadow-sm border border-border p-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                    <p className="text-sm text-ink/50 capitalize mt-0.5">
                      {v.tipo}
                      {v.precio_dia > 0
                        ? ` · $${v.precio_dia.toLocaleString('es-CO')}/día`
                        : ' · Precio pendiente de asignación'}
                    </p>
                    <p className="text-xs text-accent mt-0.5 font-medium">
                      {dias.length} día{dias.length !== 1 ? 's' : ''} disponibles
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-ink/40">Placa:</span>
                      <input
                        defaultValue={v.placa || ''}
                        onBlur={e => guardarPlaca(v.id, e.target.value)}
                        placeholder="Sin placa"
                        maxLength={7}
                        className="text-xs bg-surface border border-border rounded-lg px-2 py-0.5 w-24 text-ink uppercase placeholder:text-ink/30 focus:border-accent/50 outline-none" />
                      {!v.placa && <span className="text-[10px] text-warning">⚠ falta</span>}
                      {placaMsg[v.id] && <span className="text-[10px] text-success">{placaMsg[v.id]}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setCalTab(editando ? null : v.id)}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                        editando
                          ? 'bg-brand-muted border-brand/20 text-ink'
                          : 'border-accent/30 text-accent hover:bg-accent-light'
                      }`}>
                      <IconCalendar size={12} /> {editando ? 'Cerrar' : 'Disponibilidad'}
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setDocTab(docTab === v.id ? null : v.id)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                          docTab === v.id
                            ? 'bg-brand-muted border-brand/20 text-ink'
                            : v.documentos_estado === 'denegado'
                            ? 'border-danger/25 text-danger bg-danger/10 hover:bg-danger/15'
                            : 'border-border text-ink/60 hover:bg-surface'
                        }`}>
                        📄 {docTab === v.id ? 'Cerrar docs' : 'Documentos'}
                      </button>
                      {v.documentos_estado === 'en_revision' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 whitespace-nowrap">En revisión</span>
                      )}
                      {v.documentos_estado === 'aprobado' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30 whitespace-nowrap">✓ Aprobados</span>
                      )}
                      {v.documentos_estado === 'denegado' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25 whitespace-nowrap">✗ Denegados</span>
                      )}
                    </div>
                    <button onClick={() => toggleDisponible(v)}
                      className={`text-xs px-3 py-1.5 rounded-xl font-medium transition ${
                        v.disponible
                          ? 'bg-success/15 text-success hover:bg-success/15'
                          : 'bg-danger/15 text-danger hover:bg-danger/15'
                      }`}>
                      {v.disponible ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>
                </div>

                {editando && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-sm font-medium text-ink/70 mb-3">
                      Marca los días en que tu vehículo estará disponible:
                    </p>
                    <CalendarioDisponibilidad
                      value={dias}
                      onChange={nuevos => guardarDias(v.id, nuevos)}
                      placa={v.placa}
                      reservedDates={reservasDatesVehiculo(v.id)}
                    />
                  </div>
                )}

                {docTab === v.id && (() => {
                  const docs = docsEditando[v.id] ?? docsActuales;
                  const upd = (patch: Partial<Documentos>) =>
                    setDocsEditando(d => ({ ...d, [v.id]: { ...(d[v.id] ?? docsActuales), ...patch } }));
                  return (
                    <div className="mt-4 pt-4 border-t border-border space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-xs font-bold text-ink/50 uppercase tracking-widest">Documentos del vehículo</p>
                        {v.documentos_estado === 'aprobado' && (
                          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-success/15 text-success border border-success/30">
                            ✓ Documentos aprobados por DrivePass
                          </span>
                        )}
                        {v.documentos_estado === 'en_revision' && (
                          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-warning/15 text-warning border border-warning/25">
                            ⏳ En revisión por DrivePass
                          </span>
                        )}
                      </div>

                      {/* Nota de denegación */}
                      {v.documentos_estado === 'denegado' && v.documentos_nota && (
                        <div className="bg-danger/10 border border-danger/25 rounded-xl p-3">
                          <p className="text-xs font-bold text-danger mb-1">✗ Documentos denegados por DrivePass</p>
                          <p className="text-sm text-danger">{v.documentos_nota}</p>
                          <p className="text-[11px] text-danger mt-2">Corrige los documentos señalados y vuelve a guardar para enviarlos nuevamente a revisión.</p>
                        </div>
                      )}

                      {/* Per-document review status */}
                    {(() => {
                      let revs: Record<string, DocRevision> = {};
                      try { revs = JSON.parse(v.documentos_revisiones || '{}'); } catch { /* */ }
                      const hasFeedback = Object.values(revs).some(r => r.estado === 'aprobado' || r.estado === 'denegado');
                      if (!hasFeedback) return null;
                      const DOC_KEYS_P = ['soat', 'tecno', 'tarjeta', 'todo_riesgo'];
                      const DOC_LABELS_P: Record<string, string> = { soat: 'SOAT', tecno: 'Tecno-mecánica', tarjeta: 'Tarjeta de propiedad', todo_riesgo: 'Seguro todo riesgo' };
                      return (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">Estado por documento</p>
                          <div className="grid grid-cols-2 gap-2">
                            {DOC_KEYS_P.map(k => {
                              const r = revs[k];
                              if (!r || r.estado === 'pendiente') return null;
                              return (
                                <div key={k} className={`rounded-xl px-3 py-2 border text-xs ${
                                  r.estado === 'aprobado' ? 'bg-success/10 border-success/30' : 'bg-danger/10 border-danger/25'
                                }`}>
                                  <p className="font-bold text-ink">{DOC_LABELS_P[k]}</p>
                                  {r.estado === 'aprobado' && <p className="text-success font-semibold mt-0.5">✓ Aprobado</p>}
                                  {r.estado === 'denegado' && (
                                    <>
                                      <p className="text-danger font-semibold mt-0.5">✗ Rechazado</p>
                                      {r.nota && <p className="text-danger text-[11px] mt-0.5">{r.nota}</p>}
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* SOAT */}
                        <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                          <p className="text-xs font-semibold text-ink">SOAT</p>
                          <DocUpload label="Documento SOAT" value={docs.soat?.url || ''} onChange={url => upd({ soat: { ...docs.soat, url } })} />
                          <div>
                            <label className="text-[11px] text-ink/50 block mb-1">Fecha de vencimiento</label>
                            <input type="date" value={docs.soat?.vence || ''}
                              onChange={e => upd({ soat: { ...docs.soat, url: docs.soat?.url || '', vence: e.target.value } })}
                              className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                          </div>
                        </div>

                        {/* Tecno-mecánica */}
                        <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                          <p className="text-xs font-semibold text-ink">Tecno-mecánica</p>
                          <DocUpload label="Revisión tecno-mecánica" value={docs.tecno?.url || ''} onChange={url => upd({ tecno: { ...docs.tecno, url } })} />
                          <div>
                            <label className="text-[11px] text-ink/50 block mb-1">Fecha de vencimiento</label>
                            <input type="date" value={docs.tecno?.vence || ''}
                              onChange={e => upd({ tecno: { ...docs.tecno, url: docs.tecno?.url || '', vence: e.target.value } })}
                              className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                          </div>
                        </div>

                        {/* Tarjeta de propiedad */}
                        <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                          <p className="text-xs font-semibold text-ink">Tarjeta de propiedad</p>
                          <DocUpload label="Tarjeta de propiedad" value={docs.tarjeta?.url || ''} onChange={url => upd({ tarjeta: { url } })} />
                        </div>

                        {/* Todo riesgo */}
                        <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                          <p className="text-xs font-semibold text-ink">Seguro todo riesgo</p>
                          <DocUpload label="Póliza todo riesgo" value={docs.todo_riesgo?.url || ''} onChange={url => upd({ todo_riesgo: { ...docs.todo_riesgo, url } })} />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] text-ink/50 block mb-1">Aseguradora</label>
                              <input type="text" placeholder="Ej: Sura" value={docs.todo_riesgo?.aseguradora || ''}
                                onChange={e => upd({ todo_riesgo: { ...docs.todo_riesgo, url: docs.todo_riesgo?.url || '', aseguradora: e.target.value } })}
                                className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                            </div>
                            <div>
                              <label className="text-[11px] text-ink/50 block mb-1">N° Póliza</label>
                              <input type="text" placeholder="Número" value={docs.todo_riesgo?.poliza || ''}
                                onChange={e => upd({ todo_riesgo: { ...docs.todo_riesgo, url: docs.todo_riesgo?.url || '', poliza: e.target.value } })}
                                className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                            </div>
                          </div>
                          <div>
                            <label className="text-[11px] text-ink/50 block mb-1">Vencimiento</label>
                            <input type="date" value={docs.todo_riesgo?.vence || ''}
                              onChange={e => upd({ todo_riesgo: { ...docs.todo_riesgo, url: docs.todo_riesgo?.url || '', vence: e.target.value } })}
                              className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => guardarDocumentos(v.id, docsEditando[v.id] ?? docsActuales)}
                        className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-sm">
                        Guardar documentos
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* ── RESERVAS ── */}
      {tab === 'reservas' && (
        <div className="space-y-6">
          {/* Header con botón de recarga */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink/50">
              {reservas.length > 0
                ? `${reservas.length} reserva${reservas.length !== 1 ? 's' : ''} para tus vehículos`
                : 'Reservas de tus vehículos'}
            </p>
            <button
              onClick={cargarReservas}
              disabled={loadingReservas}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-accent/30 text-accent rounded-xl hover:bg-accent-light transition disabled:opacity-50 font-medium">
              <IconCalendar size={12} />
              {loadingReservas ? 'Cargando…' : 'Actualizar'}
            </button>
          </div>

          {/* Error de carga */}
          {errorReservas && (
            <div className="bg-danger/10 border border-danger/25 text-danger text-sm px-4 py-3 rounded-xl flex items-center justify-between gap-3">
              <span>{errorReservas}</span>
              <button onClick={cargarReservas} className="font-semibold hover:text-danger transition">Reintentar</button>
            </div>
          )}

          {/* Skeleton de carga */}
          {loadingReservas ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="bg-surface-2 rounded-2xl border border-border h-20 animate-pulse" />
              ))}
            </div>
          ) : !errorReservas && (
            <>
              {/* Calendario visual */}
              <div className="bg-surface rounded-2xl border border-border p-4">
                <h3 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
                  <IconCalendar size={15} className="text-accent" /> Vista de calendario — mis vehículos
                </h3>
                <CalendarioReservas reservas={reservas} />
              </div>

              {/* Lista de reservas */}
              <div>
                <h3 className="font-bold text-ink text-sm mb-3">Lista de reservas</h3>
                {reservas.length === 0 ? (
                  <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
                    <IconCalendar size={40} className="text-ink/15 mx-auto mb-3" />
                    <p className="text-ink/40 font-medium">No hay reservas para tus vehículos aún.</p>
                    <p className="text-ink/30 text-xs mt-1">Las reservas aparecerán aquí cuando los clientes reserven tus vehículos.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reservas.map(r => (
                      <div key={r.id} className="bg-surface-2 rounded-2xl shadow-sm border border-border p-5">
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <p className="font-bold text-ink">{r.marca} {r.modelo} {r.anio}</p>
                            <p className="text-sm text-ink/60">Cliente: {r.usuario_nombre}</p>
                            <p className="text-sm text-ink/50">{r.fecha_inicio} → {r.fecha_fin}</p>
                          </div>
                          <div className="text-right flex flex-col items-end gap-1.5">
                            <p className="font-bold text-accent">${r.total.toLocaleString('es-CO')}</p>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${estadoColor[r.estado] || 'bg-surface'}`}>
                              {r.estado}
                            </span>
                            <ChatLink propietarioId={user!.id} usuarioId={r.usuario_id} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── PUBLICAR NUEVO VEHÍCULO ── */}
      {tab === 'nuevo' && (
        <div className="bg-surface-2 rounded-2xl shadow-sm border border-border p-6">
          <h2 className="font-bold text-ink mb-1">Publicar nuevo vehículo</h2>
          <p className="text-sm text-ink/50 mb-5">
            Completa todos los campos y sube las 7 fotos requeridas. El administrador asignará el precio.
          </p>
          {msg && (
            <div className={`text-sm px-4 py-2.5 rounded-xl mb-4 border ${
              msg.startsWith('✅')
                ? 'bg-success/10 text-success border-success/30'
                : 'bg-danger/10 text-danger border-danger/25'
            }`}>{msg}</div>
          )}
          <form onSubmit={publicar} className="space-y-6">

            {/* Datos básicos */}
            <div>
              <h3 className="text-xs font-bold text-ink/50 mb-3 uppercase tracking-widest">Datos del vehículo</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Marca <span className="text-accent">*</span></label>
                  <input required
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.marca} onChange={e => setForm(f => ({ ...f, marca: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Modelo <span className="text-accent">*</span></label>
                  <input required
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.modelo} onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Año <span className="text-accent">*</span></label>
                  <input type="number" required min="2000" max="2030"
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.anio} onChange={e => setForm(f => ({ ...f, anio: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Placa <span className="text-accent">*</span></label>
                  <input required placeholder="ABC-123"
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 uppercase"
                    value={form.placa} onChange={e => setForm(f => ({ ...f, placa: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Tipo <span className="text-accent">*</span></label>
                  <select
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                    <option value="sedan">Sedán</option>
                    <option value="suv">SUV</option>
                    <option value="compacto">Compacto</option>
                    <option value="pickup">Pickup</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Ubicación</label>
                  <input
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.ubicacion} onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Descripción</label>
                  <textarea rows={2}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
                    value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Fotos obligatorias */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-ink/50 uppercase tracking-widest">Fotos del vehículo</h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                  fotosCompletas ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                }`}>
                  {Object.values(fotos).filter(Boolean).length}/7 subidas
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {(Object.keys(FOTOS_LABELS) as (keyof Fotos)[]).map(key => (
                  <FotoUpload
                    key={key}
                    label={FOTOS_LABELS[key]}
                    value={fotos[key]}
                    onChange={url => setFotos(f => ({ ...f, [key]: url }))}
                    required
                  />
                ))}
              </div>
            </div>

            {/* Calendario */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-ink/50 uppercase tracking-widest">Disponibilidad</h3>
                {diasDisponibles.length === 0 && (
                  <span className="text-xs text-accent font-medium">Debes marcar al menos un día</span>
                )}
              </div>
              <p className="text-sm text-ink/50 mb-4">Selecciona los días en que tu vehículo estará disponible para alquilar.</p>
              <CalendarioDisponibilidad value={diasDisponibles} onChange={setDiasDisponibles} />
            </div>

            <button type="submit" disabled={publicando}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm">
              <IconCheck size={16} />
              {publicando ? 'Publicando…' : 'Publicar vehículo'}
            </button>
          </form>
        </div>
      )}

      {/* ── MI PERFIL ── */}
      {tab === 'perfil' && (
        <div className="max-w-xl space-y-5">
          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink mb-1">Datos del propietario</h2>
            <p className="text-xs text-ink/50 mb-4">
              Estos datos y tu cédula se usan para verificar que la tarjeta de propiedad de tus
              vehículos esté realmente a tu nombre.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[11px] text-ink/50 block mb-1">Tipo de documento</label>
                <select
                  value={perfil.tipo_documento}
                  onChange={e => setPerfil(p => ({ ...p, tipo_documento: e.target.value }))}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
                  <option value="cedula">Cédula de ciudadanía</option>
                  <option value="extranjeria">Cédula de extranjería</option>
                  <option value="pasaporte">Pasaporte</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-ink/50 block mb-1">Número de documento</label>
                <input
                  value={perfil.documento_identidad}
                  onChange={e => setPerfil(p => ({ ...p, documento_identidad: e.target.value }))}
                  placeholder="Ej. 1.234.567.890"
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/30" />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[11px] text-ink/50 block mb-1">Celular</label>
              <input
                value={perfil.celular}
                onChange={e => setPerfil(p => ({ ...p, celular: e.target.value }))}
                placeholder="Ej. 300 123 4567"
                className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/30" />
            </div>

            <div className="mb-4">
              <DocUpload
                label="Foto de tu cédula (frente)"
                value={perfil.cedula_url}
                onChange={url => setPerfil(p => ({ ...p, cedula_url: url }))} />
              <p className="text-[11px] text-ink/40 mt-1">
                Imagen o PDF claro y legible. Solo la vemos para validar tus documentos; no se muestra a los arrendatarios.
              </p>
            </div>

            <button
              onClick={guardarPerfil}
              disabled={guardandoPerfil}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm">
              <IconCheck size={16} />
              {guardandoPerfil ? 'Guardando…' : 'Guardar perfil'}
            </button>
            {perfilMsg && (
              <p className={`text-xs mt-2 ${perfilMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{perfilMsg}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatLink({ propietarioId, usuarioId }: { propietarioId: number; usuarioId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const abrir = async () => {
    setLoading(true);
    const res = await fetch('/api/chat/conversaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propietario_id: propietarioId, usuario_id: usuarioId }),
    });
    const data = await res.json();
    setLoading(false);
    router.push(`/chat/${data.id}`);
  };
  return (
    <button onClick={abrir} disabled={loading}
      className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition disabled:opacity-50 font-medium">
      <IconChat size={11} /> {loading ? '...' : 'Chat'}
    </button>
  );
}
