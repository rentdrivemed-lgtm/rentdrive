'use client';
import { useEffect, useState } from 'react';
import { esSocio, type AdminNivel } from '@/lib/permisos';

type Tarea = {
  id: number; titulo: string; descripcion: string; estado: 'todo' | 'proceso' | 'hecho';
  rol_destino: string; asignado_id: number | null; asignado_nombre: string; solo_socios: number;
  vence: string; orden: number; created_by_nombre: string;
};
type Miembro = { id: number; nombre: string; admin_nivel: string };
type Props = { nivel: AdminNivel; onEvento: () => void; pushToast: (t: string) => void };

const COLS: { key: Tarea['estado']; label: string }[] = [
  { key: 'todo', label: 'Por hacer' }, { key: 'proceso', label: 'En proceso' }, { key: 'hecho', label: 'Hecho' },
];
const ROL_LABEL: Record<string, string> = { mensajero: 'Mensajero', secretaria: 'Secretaria', socio: 'Socio', '': 'General' };
const vacia = () => ({ titulo: '', descripcion: '', rol_destino: '', asignado_id: '', vence: '', solo_socios: false });

export default function TareasBoard({ nivel, onEvento, pushToast }: Props) {
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [equipo, setEquipo] = useState<Miembro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vacia());
  const [drag, setDrag] = useState<number | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const socio = esSocio(nivel);

  const cargar = async () => {
    try {
      const [rt, re] = await Promise.all([
        fetch('/api/control/tareas', { cache: 'no-store' }),
        fetch('/api/control/equipo', { cache: 'no-store' }),
      ]);
      const dt = await rt.json().catch(() => ({}));
      const de = await re.json().catch(() => ({}));
      setTareas(dt.tareas || []);
      setEquipo(de.equipo || []);
    } catch { /* */ } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, []);

  const abrirNueva = () => { setEditId(null); setForm(vacia()); setModal(true); };
  const abrirEditar = (t: Tarea) => {
    setEditId(t.id);
    setForm({ titulo: t.titulo, descripcion: t.descripcion, rol_destino: t.rol_destino, asignado_id: t.asignado_id ? String(t.asignado_id) : '', vence: t.vence, solo_socios: !!t.solo_socios });
    setModal(true);
  };

  const guardar = async () => {
    if (!form.titulo.trim()) { pushToast('La tarea necesita un título'); return; }
    const payload = { ...form, asignado_id: form.asignado_id || null };
    try {
      if (editId) {
        await fetch('/api/control/tareas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editId, ...payload }) });
        pushToast('Tarea actualizada');
      } else {
        await fetch('/api/control/tareas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        pushToast('Tarea creada');
      }
      setModal(false); await cargar(); onEvento();
    } catch { pushToast('No se pudo guardar'); }
  };

  const eliminar = async (t: Tarea) => {
    if (!window.confirm(`¿Eliminar la tarea "${t.titulo}"?`)) return;
    await fetch(`/api/control/tareas?id=${t.id}`, { method: 'DELETE' });
    setTareas(ts => ts.filter(x => x.id !== t.id)); onEvento();
  };

  const mover = async (t: Tarea, estado: Tarea['estado']) => {
    if (t.estado === estado) return;
    setTareas(ts => ts.map(x => x.id === t.id ? { ...x, estado } : x));
    await fetch('/api/control/tareas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, estado }) });
    onEvento();
  };

  const soltar = (estado: Tarea['estado']) => {
    setDragCol(null);
    if (drag == null) return;
    const t = tareas.find(x => x.id === drag);
    setDrag(null);
    if (t) mover(t, estado);
  };

  if (cargando) return <div className="loading">Cargando tareas…</div>;

  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Tareas</div>
          <div className="section-sub">Kanban del equipo · arrastra entre columnas o usa las flechas</div>
        </div>
        <button className="btn-primary" onClick={abrirNueva}>+ Nueva tarea</button>
      </div>

      <div className="kanban">
        {COLS.map(col => {
          const items = tareas.filter(t => t.estado === col.key);
          return (
            <div key={col.key}
              className={`kcol ${dragCol === col.key ? 'dragover' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragCol(col.key); }}
              onDragLeave={() => setDragCol(c => c === col.key ? null : c)}
              onDrop={() => soltar(col.key)}>
              <div className="kcol-title"><span>{col.label}</span><span>{items.length}</span></div>
              {items.map(t => (
                <div key={t.id} className={`kcard ${drag === t.id ? 'dragging' : ''}`}
                  draggable onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setDragCol(null); }}>
                  <span className={`kcard-role role-${t.rol_destino || 'none'}`}>{ROL_LABEL[t.rol_destino] || 'General'}</span>
                  {t.solo_socios ? <span className="kcard-lock"> 🔒 socios</span> : null}
                  <div className="kcard-title">{t.titulo}</div>
                  {t.descripcion && <div className="kcard-desc">{t.descripcion}</div>}
                  <div className="kcard-meta">
                    <span>{t.vence || 'Sin fecha'}</span>
                    <span>{t.asignado_nombre || '—'}</span>
                  </div>
                  <div className="kcard-actions">
                    <div className="move-btns">
                      {col.key !== 'todo' && <button title="Atrás" onClick={() => mover(t, prevEstado(col.key))}>◀</button>}
                      {col.key !== 'hecho' && <button title="Avanzar" onClick={() => mover(t, nextEstado(col.key))}>▶</button>}
                    </div>
                    <button onClick={() => abrirEditar(t)}>Editar</button>
                    <button onClick={() => eliminar(t)} style={{ color: 'var(--coral)' }}>Eliminar</button>
                  </div>
                </div>
              ))}
              {items.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12, padding: '6px 2px' }}>—</div>}
            </div>
          );
        })}
      </div>

      {modal && (
        <div className="dpc-modal-back" onClick={e => { if (e.target === e.currentTarget) setModal(false); }}>
          <div className="dpc-modal">
            <div className="dpc-modal-head">{editId ? 'Editar tarea' : 'Nueva tarea'}<button className="x-btn" onClick={() => setModal(false)}>×</button></div>
            <div className="dpc-modal-body">
              <div><label className="lbl">Título</label><input className="field" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="¿Qué hay que hacer?" /></div>
              <div><label className="lbl">Descripción (opcional)</label><textarea className="field" rows={2} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} /></div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}><label className="lbl">Rol</label>
                  <select className="field" value={form.rol_destino} onChange={e => setForm(f => ({ ...f, rol_destino: e.target.value }))}>
                    <option value="">General</option><option value="mensajero">Mensajero</option><option value="secretaria">Secretaria</option><option value="socio">Socio</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}><label className="lbl">Responsable</label>
                  <select className="field" value={form.asignado_id} onChange={e => setForm(f => ({ ...f, asignado_id: e.target.value }))}>
                    <option value="">Sin asignar</option>
                    {equipo.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="lbl">Vence (opcional)</label><input className="field" value={form.vence} onChange={e => setForm(f => ({ ...f, vence: e.target.value }))} placeholder="Ej. Hoy 2pm, viernes…" /></div>
              {socio && (
                <label className="checkline"><input type="checkbox" checked={form.solo_socios} onChange={e => setForm(f => ({ ...f, solo_socios: e.target.checked }))} /> Solo visible para socios (oculto a secretaría)</label>
              )}
            </div>
            <div className="dpc-modal-foot">
              <button className="btn-ghost" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardar}>{editId ? 'Guardar' : 'Crear tarea'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function nextEstado(e: Tarea['estado']): Tarea['estado'] { return e === 'todo' ? 'proceso' : 'hecho'; }
function prevEstado(e: Tarea['estado']): Tarea['estado'] { return e === 'hecho' ? 'proceso' : 'todo'; }
