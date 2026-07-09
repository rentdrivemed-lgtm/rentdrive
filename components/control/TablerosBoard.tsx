'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Board = { id: number; titulo: string; created_by: number; created_by_nombre: string; elementos: number; colaboradores: number };
type Colab = { id: number; nombre: string };
type El = { id: number; tipo: string; x: number; y: number; w: number; h: number; contenido: string; color: string };
type Miembro = { id: number; nombre: string };
type Props = { pushToast: (t: string) => void; onEvento: () => void };

const HERRAMIENTAS: { key: string; label: string }[] = [
  { key: 'select', label: 'Mover' }, { key: 'pen', label: 'Lápiz' }, { key: 'text', label: 'Texto' },
  { key: 'sticky', label: 'Nota' }, { key: 'rect', label: 'Rectángulo' }, { key: 'circle', label: 'Círculo' },
];
const iniciales = (n: string) => n.trim().slice(0, 2).toUpperCase();

export default function TablerosBoard({ pushToast, onEvento }: Props) {
  const [vista, setVista] = useState<'galeria' | 'lienzo'>('galeria');
  const [tableros, setTableros] = useState<Board[]>([]);
  const [equipo, setEquipo] = useState<Miembro[]>([]);
  const [cargando, setCargando] = useState(true);

  const [bid, setBid] = useState<number | null>(null);
  const [titulo, setTitulo] = useState('');
  const [colabs, setColabs] = useState<Colab[]>([]);
  const [els, setEls] = useState<El[]>([]);
  const [tool, setTool] = useState('select');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inter = useRef<{ mode: null | 'pan' | 'draw' | 'pinch'; sx: number; sy: number; px: number; py: number; pts: { x: number; y: number }[]; pinchDist: number; pinchScale: number }>({ mode: null, sx: 0, sy: 0, px: 0, py: 0, pts: [], pinchDist: 0, pinchScale: 1 });
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragEl = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const editando = useRef(false);

  // ── Galería ──────────────────────────────────────────────
  const cargarGaleria = useCallback(async () => {
    setCargando(true);
    try {
      const [rt, re] = await Promise.all([fetch('/api/control/tableros', { cache: 'no-store' }), fetch('/api/control/equipo', { cache: 'no-store' })]);
      const dt = await rt.json().catch(() => ({}));
      const de = await re.json().catch(() => ({}));
      setTableros(dt.tableros || []);
      setEquipo((de.equipo || []).map((m: Miembro) => ({ id: m.id, nombre: m.nombre })));
    } catch { /* */ } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargarGaleria(); }, [cargarGaleria]);

  const crearTablero = async () => {
    const t = window.prompt('Nombre del nuevo tablero:', 'Estrategia');
    if (!t) return;
    const r = await fetch('/api/control/tableros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: t }) });
    const d = await r.json().catch(() => ({}));
    if (d.tablero) { pushToast('Tablero creado'); await cargarGaleria(); abrir(d.tablero.id); onEvento(); }
  };

  // ── Lienzo ───────────────────────────────────────────────
  const abrir = async (id: number) => {
    const r = await fetch(`/api/control/tableros/${id}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { pushToast(d.error || 'No se pudo abrir'); return; }
    setBid(id); setTitulo(d.tablero.titulo); setColabs(d.colaboradores || []); setEls(d.elementos || []);
    setPan({ x: 0, y: 0 }); setScale(1); setTool('select'); setVista('lienzo');
  };
  const cerrar = () => { setVista('galeria'); setBid(null); cargarGaleria(); };

  // Refresco suave mientras esté abierto (colaborativo) — solo si nadie está interactuando.
  useEffect(() => {
    if (vista !== 'lienzo' || bid == null) return;
    const t = setInterval(async () => {
      if (inter.current.mode || dragEl.current || editando.current) return;
      try {
        const r = await fetch(`/api/control/tableros/${bid}`, { cache: 'no-store' });
        const d = await r.json().catch(() => ({}));
        if (d.elementos) { setEls(d.elementos); setColabs(d.colaboradores || []); }
      } catch { /* */ }
    }, 7000);
    return () => clearInterval(t);
  }, [vista, bid]);

  const screenToWorld = useCallback((cx: number, cy: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: (cx - rect.left - pan.x) / scale, y: (cy - rect.top - pan.y) / scale };
  }, [pan, scale]);

  const guardarTitulo = async () => {
    if (bid == null) return;
    await fetch(`/api/control/tableros/${bid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: titulo.trim() || 'Tablero' }) });
  };

  const addEl = async (tipo: string, x: number, y: number, extra: Partial<El> = {}) => {
    if (bid == null) return;
    const body = { tipo, x, y, w: extra.w || 0, h: extra.h || 0, contenido: extra.contenido || '', color: extra.color || '' };
    const r = await fetch(`/api/control/tableros/${bid}/elementos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (d.elemento) setEls(es => [...es, d.elemento]);
    return d.elemento as El | undefined;
  };
  const putEl = async (id: number, campos: Partial<El>) => {
    if (bid == null) return;
    await fetch(`/api/control/tableros/${bid}/elementos`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...campos }) });
  };
  const delEl = async (id: number) => {
    if (bid == null) return;
    setEls(es => es.filter(e => e.id !== id));
    await fetch(`/api/control/tableros/${bid}/elementos?el=${id}`, { method: 'DELETE' });
  };

  const addLink = async () => {
    const url = window.prompt('Pega un enlace o URL de imagen:');
    if (!url) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const p = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await addEl('link', p.x, p.y, { contenido: url });
    pushToast('Elemento anexado');
  };

  const invitar = async () => {
    if (bid == null) return;
    const disponibles = equipo.filter(m => !colabs.some(c => c.id === m.id));
    if (!disponibles.length) { pushToast('Ya están todos invitados'); return; }
    const nombre = window.prompt(`Invitar a (escribe el nombre):\n${disponibles.map(m => '· ' + m.nombre).join('\n')}`);
    if (!nombre) return;
    const m = disponibles.find(x => x.nombre.toLowerCase().includes(nombre.trim().toLowerCase()));
    if (!m) { pushToast('No encontré esa persona'); return; }
    const r = await fetch(`/api/control/tableros/${bid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario_id: m.id }) });
    const d = await r.json().catch(() => ({}));
    if (d.colaboradores) { setColabs(d.colaboradores); pushToast(`${m.nombre} invitado`); onEvento(); }
  };

  // ── Pointer / gestos ─────────────────────────────────────
  const onWrapPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.bel')) return; // el elemento maneja su propio drag
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    wrapRef.current?.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      inter.current.mode = 'pinch';
      inter.current.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      inter.current.pinchScale = scale;
      return;
    }
    if (tool === 'select') {
      inter.current = { ...inter.current, mode: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      wrapRef.current?.classList.add('panning');
    } else if (tool === 'pen') {
      const p = screenToWorld(e.clientX, e.clientY);
      inter.current = { ...inter.current, mode: 'draw', pts: [p] };
    } else if (['text', 'sticky', 'rect', 'circle'].includes(tool)) {
      const p = screenToWorld(e.clientX, e.clientY);
      addEl(tool, p.x, p.y, { contenido: tool === 'sticky' ? 'Nueva nota…' : tool === 'text' ? 'Texto' : '' });
      setTool('select');
    }
  };

  const [drawPath, setDrawPath] = useState<string>('');
  const onWrapPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = inter.current.mode;
    if (m === 'pinch' && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (inter.current.pinchDist > 0) setScale(Math.min(2.5, Math.max(0.35, inter.current.pinchScale * (dist / inter.current.pinchDist))));
    } else if (m === 'pan') {
      setPan({ x: inter.current.px + (e.clientX - inter.current.sx), y: inter.current.py + (e.clientY - inter.current.sy) });
    } else if (m === 'draw') {
      const p = screenToWorld(e.clientX, e.clientY);
      inter.current.pts.push(p);
      setDrawPath('M ' + inter.current.pts.map(pt => `${pt.x},${pt.y}`).join(' L '));
    }
  };

  const onWrapPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const m = inter.current.mode;
    if (m === 'draw' && inter.current.pts.length > 1) {
      addEl('path', 0, 0, { contenido: JSON.stringify(inter.current.pts) });
      setDrawPath('');
    }
    if (pointers.current.size === 0) { inter.current.mode = null; wrapRef.current?.classList.remove('panning'); }
    else if (pointers.current.size === 1 && m === 'pinch') { inter.current.mode = null; }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.08 : 0.92;
    setScale(s => Math.min(2.5, Math.max(0.35, s * delta)));
  };

  // Drag de un elemento
  const onElPointerDown = (e: React.PointerEvent, el: El) => {
    if (tool !== 'select' || editando.current) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragEl.current = { id: el.id, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y };
  };
  const onElPointerMove = (e: React.PointerEvent, el: El) => {
    if (!dragEl.current || dragEl.current.id !== el.id) return;
    const dx = (e.clientX - dragEl.current.sx) / scale;
    const dy = (e.clientY - dragEl.current.sy) / scale;
    setEls(es => es.map(x => x.id === el.id ? { ...x, x: dragEl.current!.ox + dx, y: dragEl.current!.oy + dy } : x));
  };
  const onElPointerUp = (el: El) => {
    if (!dragEl.current || dragEl.current.id !== el.id) return;
    dragEl.current = null;
    const cur = els.find(x => x.id === el.id);
    if (cur) putEl(el.id, { x: cur.x, y: cur.y });
  };

  const editarContenido = (el: El, texto: string) => {
    setEls(es => es.map(x => x.id === el.id ? { ...x, contenido: texto } : x));
    putEl(el.id, { contenido: texto });
  };

  // ── Render ───────────────────────────────────────────────
  if (vista === 'galeria') {
    return (
      <>
        <div className="section-head">
          <div><div className="section-title">Tableros</div><div className="section-sub">Espacios infinitos para estrategia e ideas · invita solo a quien quieras a cada tablero</div></div>
          <button className="btn-primary" onClick={crearTablero}>+ Nuevo tablero</button>
        </div>
        {cargando ? <div className="loading">Cargando…</div> : tableros.length === 0 ? (
          <div className="empty-state">Aún no tienes tableros. Crea el primero para lluvia de ideas o roadmap.</div>
        ) : (
          <div className="board-gallery-grid">
            {tableros.map(b => (
              <div key={b.id} className="board-card" onClick={() => abrir(b.id)}>
                <div className="board-thumb" />
                <div className="board-card-body">
                  <div className="board-card-title">{b.titulo}</div>
                  <div className="board-card-meta"><span>{b.elementos} elementos</span><span>{b.colaboradores} 👥</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="board-topbar">
        <button className="btn-ghost" onClick={cerrar}>← Tableros</button>
        <input className="board-title-in" value={titulo} onChange={e => setTitulo(e.target.value)} onBlur={guardarTitulo} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="avatars">{colabs.map(c => <div key={c.id} className="avatar" title={c.nombre}>{iniciales(c.nombre)}</div>)}</div>
          <button className="btn-ghost" onClick={invitar} title="Invitar colaborador">+ Invitar</button>
        </div>
      </div>
      <div className="board-tools">
        {HERRAMIENTAS.map(h => <button key={h.key} className={`tool-btn ${tool === h.key ? 'active' : ''}`} onClick={() => setTool(h.key)}>{h.label}</button>)}
        <button className="tool-btn" onClick={addLink}>Link / Imagen</button>
        <span className="zoom-ind">{Math.round(scale * 100)}% · rueda o pellizca para zoom</span>
      </div>
      <div ref={wrapRef} className="canvas-wrap" onPointerDown={onWrapPointerDown} onPointerMove={onWrapPointerMove} onPointerUp={onWrapPointerUp} onPointerCancel={onWrapPointerUp} onWheel={onWheel}>
        <div className="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
          <svg className="world-svg">
            {els.filter(e => e.tipo === 'path').map(e => <path key={e.id} d={puntosAD(e.contenido)} stroke="#1B2027" strokeWidth={2.5} fill="none" strokeLinecap="round" />)}
            {drawPath && <path d={drawPath} stroke="#1B2027" strokeWidth={2.5} fill="none" strokeLinecap="round" />}
          </svg>
          {els.filter(e => e.tipo !== 'path').map(el => (
            <div key={el.id} className={`bel ${el.tipo} ${tool === 'select' ? 'select-mode' : ''}`}
              style={{ left: el.x, top: el.y }}
              onPointerDown={e => onElPointerDown(e, el)} onPointerMove={e => onElPointerMove(e, el)} onPointerUp={() => onElPointerUp(el)}
              contentEditable={(el.tipo === 'sticky' || el.tipo === 'text')}
              suppressContentEditableWarning
              onFocus={() => { editando.current = true; }}
              onBlur={e => { editando.current = false; if (el.tipo === 'sticky' || el.tipo === 'text') { const t = e.currentTarget.textContent || ''; if (t !== el.contenido) editarContenido(el, t); } }}>
              <button className="bel-del" onPointerDown={e => e.stopPropagation()} onClick={() => delEl(el.id)} contentEditable={false}>×</button>
              {el.tipo === 'link' ? <LinkContenido url={el.contenido} /> : (el.tipo === 'sticky' || el.tipo === 'text') ? el.contenido : null}
            </div>
          ))}
        </div>
      </div>
      <div className="note">Arrastra el fondo para moverte, rueda/pellizca para zoom. Elige una herramienta y toca el lienzo para crear. Pasa el cursor sobre un elemento para borrarlo (×). Todo se guarda solo.</div>
    </>
  );
}

function puntosAD(json: string): string {
  try { const pts = JSON.parse(json) as { x: number; y: number }[]; return 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L '); }
  catch { return ''; }
}
function LinkContenido({ url }: { url: string }) {
  const esImg = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
  return (
    <div>
      {esImg && <img src={url} alt="" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
      <a href={url} target="_blank" rel="noopener noreferrer" onPointerDown={e => e.stopPropagation()}>🔗 {url}</a>
    </div>
  );
}
