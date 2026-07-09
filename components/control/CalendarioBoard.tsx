'use client';
import { useEffect, useMemo, useState } from 'react';
import { esSocio, type AdminNivel } from '@/lib/permisos';

type Evento = {
  id: string; titulo: string; tipo: string; fecha: string; hora: string; nota: string;
  fuente: 'manual' | 'reserva'; referencia_id: number | null; solo_socios: number;
};
type Props = { nivel: AdminNivel; onEvento: () => void; pushToast: (t: string) => void };

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TIPO_LABEL: Record<string, string> = { entrega: 'Entrega', devolucion: 'Devolución', vencimiento: 'Vencimiento', reunion: 'Reunión', general: 'General' };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function CalendarioBoard({ nivel, onEvento, pushToast }: Props) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ titulo: '', tipo: 'general', fecha: '', hora: '', nota: '', solo_socios: false });
  const socio = esSocio(nivel);
  const hoyIso = iso(now);

  // Grid de 42 celdas empezando el lunes.
  const celdas = useMemo(() => {
    const primero = new Date(cursor.y, cursor.m, 1);
    const offset = (primero.getDay() + 6) % 7; // Lun=0
    const inicio = new Date(cursor.y, cursor.m, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
      return { fecha: iso(d), dia: d.getDate(), delMes: d.getMonth() === cursor.m };
    });
  }, [cursor]);

  const cargar = async () => {
    setCargando(true);
    const desde = celdas[0].fecha, hasta = celdas[41].fecha;
    try {
      const r = await fetch(`/api/control/calendario?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      setEventos(d.eventos || []);
    } catch { /* */ } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  const porDia = useMemo(() => {
    const map: Record<string, Evento[]> = {};
    for (const e of eventos) (map[e.fecha] ||= []).push(e);
    return map;
  }, [eventos]);

  const abrirDia = (fecha: string) => { setForm({ titulo: '', tipo: 'general', fecha, hora: '', nota: '', solo_socios: false }); setModal(true); };

  const guardar = async () => {
    if (!form.titulo.trim() || !form.fecha) { pushToast('Falta título o fecha'); return; }
    try {
      await fetch('/api/control/calendario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      pushToast('Evento agregado'); setModal(false); await cargar(); onEvento();
    } catch { pushToast('No se pudo guardar'); }
  };

  const eliminar = async (e: Evento) => {
    if (e.fuente !== 'manual' || e.referencia_id == null) return;
    if (!window.confirm(`¿Eliminar "${e.titulo}"?`)) return;
    await fetch(`/api/control/calendario?id=${e.referencia_id}`, { method: 'DELETE' });
    await cargar(); onEvento();
  };

  const mover = (delta: number) => setCursor(c => {
    const d = new Date(c.y, c.m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Calendario</div>
          <div className="section-sub">Entregas y devoluciones (de reservas) + eventos y vencimientos que agregues</div>
        </div>
        <button className="btn-primary" onClick={() => abrirDia(hoyIso)}>+ Nuevo evento</button>
      </div>

      <div className="cal-toolbar">
        <button className="btn-ghost" onClick={() => mover(-1)}>‹</button>
        <span className="mono">{MESES[cursor.m]} {cursor.y}</span>
        <button className="btn-ghost" onClick={() => mover(1)}>›</button>
        {cargando && <span style={{ color: 'var(--muted)', fontSize: 12 }}>actualizando…</span>}
      </div>

      <div className="cal-grid">
        {DIAS.map(d => <div key={d} className="cal-day-label">{d}</div>)}
        {celdas.map(c => (
          <div key={c.fecha} className={`cal-cell ${c.delMes ? '' : 'other'} ${c.fecha === hoyIso ? 'today' : ''}`} onClick={() => abrirDia(c.fecha)}>
            <div className="cal-num">{c.dia}</div>
            {(porDia[c.fecha] || []).slice(0, 4).map(e => (
              <div key={e.id} className={`cal-event ${e.tipo}`} title={`${e.titulo}${e.nota ? ' · ' + e.nota : ''}`}
                onClick={ev => { ev.stopPropagation(); eliminar(e); }}>
                {e.hora ? `${e.hora} ` : ''}{e.titulo}
              </div>
            ))}
            {(porDia[c.fecha]?.length || 0) > 4 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>+{(porDia[c.fecha]!.length - 4)} más</div>}
          </div>
        ))}
      </div>
      <div className="note">Consejo: haz clic en un día para agregar un evento. Los eventos manuales se pueden borrar con clic; entregas y devoluciones se generan solas desde las reservas.</div>

      {modal && (
        <div className="dpc-modal-back" onClick={e => { if (e.target === e.currentTarget) setModal(false); }}>
          <div className="dpc-modal">
            <div className="dpc-modal-head">Nuevo evento<button className="x-btn" onClick={() => setModal(false)}>×</button></div>
            <div className="dpc-modal-body">
              <div><label className="lbl">Título</label><input className="field" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Vence SOAT Spark" /></div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}><label className="lbl">Fecha</label><input type="date" className="field" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} /></div>
                <div style={{ flex: 1 }}><label className="lbl">Hora (opcional)</label><input className="field" value={form.hora} onChange={e => setForm(f => ({ ...f, hora: e.target.value }))} placeholder="9:00 am" /></div>
              </div>
              <div><label className="lbl">Tipo</label>
                <select className="field" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                  {Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><label className="lbl">Nota (opcional)</label><textarea className="field" rows={2} value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} /></div>
              {socio && <label className="checkline"><input type="checkbox" checked={form.solo_socios} onChange={e => setForm(f => ({ ...f, solo_socios: e.target.checked }))} /> Solo socios</label>}
            </div>
            <div className="dpc-modal-foot">
              <button className="btn-ghost" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardar}>Agregar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
