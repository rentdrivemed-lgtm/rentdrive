'use client';
import { useEffect, useRef, useState } from 'react';
import { esSocio, type AdminNivel } from '@/lib/permisos';

type Doc = {
  id: number; nombre: string; archivo_url: string; tipo: string; visible_para: string;
  subido_por_nombre: string; created_at: string; updated_at: string;
};
type Props = { nivel: AdminNivel; onEvento: () => void; pushToast: (t: string) => void };

const VIS_LABEL: Record<string, string> = { socios: 'Solo socios', socios_secretaria: 'Socios y secretaría', todos: 'Todo el equipo' };
const ICONO: Record<string, string> = { pdf: 'PDF', xls: 'XLS', img: 'IMG', link: '🔗', otro: 'DOC' };

export default function DocumentosBoard({ nivel, onEvento, pushToast }: Props) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [form, setForm] = useState({ nombre: '', visible_para: 'todos', link: '' });
  const [archivo, setArchivo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const socio = esSocio(nivel);

  const cargar = async () => {
    setCargando(true);
    try {
      const r = await fetch('/api/control/documentos', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      setDocs(d.documentos || []);
    } catch { /* */ } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, []);

  const abrir = async (doc: Doc) => {
    // Registrar apertura (auditoría) y abrir.
    fetch('/api/control/documentos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id }) }).catch(() => {});
    if (doc.archivo_url) window.open(doc.archivo_url, '_blank', 'noopener');
  };

  const subir = async () => {
    if (!archivo && !form.link.trim()) { pushToast('Sube un archivo o pega un enlace'); return; }
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('nombre', form.nombre);
      fd.append('visible_para', form.visible_para);
      if (archivo) fd.append('file', archivo);
      if (form.link.trim()) fd.append('link', form.link.trim());
      const r = await fetch('/api/control/documentos', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { pushToast(d.error || 'No se pudo subir'); return; }
      pushToast('Documento agregado');
      setModal(false); setForm({ nombre: '', visible_para: 'todos', link: '' }); setArchivo(null);
      await cargar(); onEvento();
    } catch { pushToast('No se pudo subir'); } finally { setSubiendo(false); }
  };

  const cambiarVisibilidad = async (doc: Doc, visible_para: string) => {
    await fetch('/api/control/documentos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, visible_para }) });
    await cargar(); onEvento();
  };

  const eliminar = async (doc: Doc) => {
    if (!window.confirm(`¿Archivar "${doc.nombre}"?`)) return;
    await fetch(`/api/control/documentos?id=${doc.id}`, { method: 'DELETE' });
    setDocs(ds => ds.filter(x => x.id !== doc.id)); onEvento();
  };

  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Documentos</div>
          <div className="section-sub">Repositorio con permisos por rol · queda registro de quién abre cada documento</div>
        </div>
        <button className="btn-primary" onClick={() => setModal(true)}>+ Subir documento</button>
      </div>

      {cargando ? <div className="loading">Cargando documentos…</div> : docs.length === 0 ? (
        <div className="empty-state">Todavía no hay documentos. Sube contratos, pólizas o checklists.</div>
      ) : (
        <div className="doc-list">
          <div className="doc-row head"><div></div><div>Nombre</div><div className="doc-hide-sm">Subido por</div><div>Visible para</div><div></div></div>
          {docs.map(doc => (
            <div key={doc.id} className="doc-row">
              <div className="doc-icon">{ICONO[doc.tipo] || 'DOC'}</div>
              <div className="doc-name" onClick={() => abrir(doc)}>{doc.nombre}</div>
              <div className="doc-hide-sm" style={{ color: 'var(--muted)', fontSize: 12 }}>{doc.subido_por_nombre || '—'}</div>
              <div>
                {socio ? (
                  <select className="field" style={{ padding: '5px 8px', fontSize: 12 }} value={doc.visible_para} onChange={e => cambiarVisibilidad(doc, e.target.value)}>
                    <option value="todos">Todo el equipo</option>
                    <option value="socios_secretaria">Socios y secretaría</option>
                    <option value="socios">Solo socios</option>
                  </select>
                ) : (
                  <span className={`doc-perm ${doc.visible_para === 'socios' ? 'locked' : ''}`}>{VIS_LABEL[doc.visible_para]}</span>
                )}
              </div>
              <button className="btn-danger" title="Archivar" onClick={() => eliminar(doc)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="dpc-modal-back" onClick={e => { if (e.target === e.currentTarget && !subiendo) setModal(false); }}>
          <div className="dpc-modal">
            <div className="dpc-modal-head">Subir documento<button className="x-btn" onClick={() => !subiendo && setModal(false)}>×</button></div>
            <div className="dpc-modal-body">
              <div><label className="lbl">Nombre</label><input className="field" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Contrato tipo propietario" /></div>
              <div>
                <label className="lbl">Archivo (PDF, imagen, Excel — máx 20 MB)</label>
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.csv,image/*,application/pdf" onChange={e => setArchivo(e.target.files?.[0] || null)} className="field" style={{ padding: 7 }} />
              </div>
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>— o —</div>
              <div><label className="lbl">Pega un enlace (Google Drive, etc.)</label><input className="field" value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} placeholder="https://…" /></div>
              <div><label className="lbl">¿Quién puede verlo?</label>
                <select className="field" value={form.visible_para} onChange={e => setForm(f => ({ ...f, visible_para: e.target.value }))}>
                  <option value="todos">Todo el equipo</option>
                  <option value="socios_secretaria">Socios y secretaría</option>
                  {socio && <option value="socios">Solo socios</option>}
                </select>
              </div>
            </div>
            <div className="dpc-modal-foot">
              <button className="btn-ghost" onClick={() => setModal(false)} disabled={subiendo}>Cancelar</button>
              <button className="btn-primary" onClick={subir} disabled={subiendo}>{subiendo ? 'Subiendo…' : 'Subir'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
