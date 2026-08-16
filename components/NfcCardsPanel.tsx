'use client';
import { useEffect, useRef, useState } from 'react';
import { IconNfc, IconX, IconCheck } from '@/components/Icons';

type AudioItem = { nombre: string; url: string; public_id: string };

type Tarjeta = {
  id: number;
  slug: string;
  tipo: 'embajador' | 'cliente';
  creador_nombre: string;
  creador_handle: string;
  estado: 'borrador' | 'activa' | 'inactiva';
  audio_manifest: string;
  visitas: number;
  notas: string;
  created_at: string;
  updated_at: string;
};

const ESTADO_BADGE: Record<string, string> = {
  borrador: 'bg-surface text-ink/50 border-border',
  activa:   'bg-success/15 text-success border-success/30',
  inactiva: 'bg-danger/15 text-danger border-danger/25',
};
const ESTADO_LABEL: Record<string, string> = { borrador: 'Borrador', activa: 'Activa', inactiva: 'Inactiva' };

function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseAudios(s: string): AudioItem[] {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

export default function NfcCardsPanel() {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState<'nueva' | Tarjeta | null>(null);
  const [copiado, setCopiado] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [origen, setOrigen] = useState('');

  useEffect(() => { setOrigen(window.location.origin); }, []);

  const cargar = async () => {
    const res = await fetch('/api/admin/nfc-cards', { cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    setTarjetas(d.tarjetas || []);
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const copiarEnlace = (t: Tarjeta) => {
    const url = `${origen}/tarjeta/${t.slug}`;
    navigator.clipboard?.writeText(url);
    setCopiado(t.id);
    setTimeout(() => setCopiado(c => c === t.id ? null : c), 1500);
  };

  const cambiarEstado = async (t: Tarjeta, estado: string) => {
    await fetch(`/api/admin/nfc-cards/${t.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado }),
    });
    setTarjetas(list => list.map(x => x.id === t.id ? { ...x, estado: estado as Tarjeta['estado'] } : x));
  };

  const eliminar = async (t: Tarjeta) => {
    if (!confirm(`¿Eliminar la tarjeta de ${t.creador_nombre}? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/admin/nfc-cards/${t.id}`, { method: 'DELETE' });
    setTarjetas(list => list.filter(x => x.id !== t.id));
  };

  if (cargando) return <div className="text-center py-16 text-ink/40">Cargando tarjetas…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-ink flex items-center gap-2"><IconNfc size={18} /> Tarjetas de presentación virtual (NFC)</h3>
          <p className="text-xs text-ink/50 mt-0.5">Una tarjeta por creador/embajador — la URL corta se programa en el tag NFC físico.</p>
        </div>
        <button onClick={() => setModal('nueva')} className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition">
          + Nueva tarjeta
        </button>
      </div>

      {tarjetas.length === 0 ? (
        <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
          <IconNfc size={40} className="text-ink/20 mx-auto mb-3" />
          <p className="text-ink/40">Aún no hay tarjetas NFC creadas.</p>
        </div>
      ) : (
        <div className="bg-surface-2 rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-muted">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Creador</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide hidden sm:table-cell">@handle</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide hidden md:table-cell">Creada</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Visitas</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tarjetas.map(t => (
                  <tr key={t.id} className="hover:bg-surface transition">
                    <td className="px-4 py-3 font-semibold text-ink">
                      {t.creador_nombre}
                      <span className="block text-[11px] font-normal text-ink/40 sm:hidden">@{t.creador_handle || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-ink/60 hidden sm:table-cell">{t.creador_handle ? `@${t.creador_handle}` : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${ESTADO_BADGE[t.estado]}`}>{ESTADO_LABEL[t.estado]}</span>
                    </td>
                    <td className="px-4 py-3 text-ink/50 hidden md:table-cell">{(t.created_at || '').slice(0, 10)}</td>
                    <td className="px-4 py-3 text-ink/70 font-medium">{t.visitas}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap">
                        <button onClick={() => setPreviewId(t.id)}
                          className="text-xs border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                          Ver
                        </button>
                        <button onClick={() => copiarEnlace(t)}
                          className="text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                          {copiado === t.id ? '✓ Copiado' : '🔗 Copiar enlace'}
                        </button>
                        <button onClick={() => setModal(t)}
                          className="text-xs border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                          Editar
                        </button>
                        {t.estado === 'activa' ? (
                          <button onClick={() => cambiarEstado(t, 'inactiva')}
                            className="text-xs px-2.5 py-1.5 rounded-xl border border-danger/25 text-danger hover:bg-danger/10 transition font-medium">
                            Desactivar
                          </button>
                        ) : (
                          <button onClick={() => cambiarEstado(t, 'activa')}
                            className="text-xs px-2.5 py-1.5 rounded-xl border border-success/30 text-success hover:bg-success/10 transition font-medium">
                            {t.estado === 'borrador' ? 'Publicar' : 'Reactivar'}
                          </button>
                        )}
                        <button onClick={() => eliminar(t)}
                          className="text-xs px-2.5 py-1.5 rounded-xl text-danger hover:bg-danger/10 transition font-medium">
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <TarjetaModal
          tarjeta={modal === 'nueva' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={t => {
            setTarjetas(list => modal === 'nueva' ? [t, ...list] : list.map(x => x.id === t.id ? t : x));
            setModal(null);
            setPreviewId(t.id);
          }}
        />
      )}

      {previewId !== null && (() => {
        const t = tarjetas.find(x => x.id === previewId);
        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPreviewId(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink truncate">Vista previa</p>
                  <p className="text-[11px] text-ink/40 truncate">{origen}/tarjeta/{t?.slug}</p>
                </div>
                <button onClick={() => setPreviewId(null)} className="p-1.5 rounded-xl text-ink/40 hover:text-ink hover:bg-surface transition shrink-0">
                  <IconX size={18} />
                </button>
              </div>
              <div className="bg-black" style={{ aspectRatio: '9 / 16', maxHeight: '75vh' }}>
                <iframe src={`/api/admin/nfc-cards/${previewId}/preview`} className="w-full h-full border-0" allow="autoplay" />
              </div>
              {t && t.estado !== 'activa' && (
                <div className="p-3 text-center">
                  <p className="text-[11px] text-ink/40 mb-2">Esta vista previa siempre funciona; la URL pública solo carga si la tarjeta está <b>activa</b>.</p>
                  <button onClick={() => cambiarEstado(t, 'activa')} className="w-full bg-accent hover:bg-accent-hover text-white py-2 rounded-xl font-semibold text-sm transition">
                    Publicar tarjeta
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function TarjetaModal({ tarjeta, onClose, onSaved }: {
  tarjeta: Tarjeta | null;
  onClose: () => void;
  onSaved: (t: Tarjeta) => void;
}) {
  const esNueva = !tarjeta;
  const [nombre, setNombre] = useState(tarjeta?.creador_nombre || '');
  const [handle, setHandle] = useState(tarjeta?.creador_handle || '');
  const [tipo, setTipo] = useState<'embajador' | 'cliente'>(tarjeta?.tipo || 'embajador');
  const [slug, setSlug] = useState(tarjeta?.slug || '');
  const [slugTocado, setSlugTocado] = useState(!esNueva);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const htmlRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const [htmlNombre, setHtmlNombre] = useState('');
  const [audioNombres, setAudioNombres] = useState<string[]>([]);

  const audiosExistentes = tarjeta ? parseAudios(tarjeta.audio_manifest) : [];

  const onNombreChange = (v: string) => {
    setNombre(v);
    if (!slugTocado) setSlug(slugify(v));
  };

  const guardar = async () => {
    setError('');
    if (!nombre.trim()) return setError('Falta el nombre del creador');
    if (esNueva && !slug.trim()) return setError('Falta el slug');
    if (esNueva && !htmlRef.current?.files?.length) return setError('Falta el archivo .html de la tarjeta');

    setGuardando(true);
    try {
      const fd = new FormData();
      fd.append('creador_nombre', nombre.trim());
      fd.append('creador_handle', handle.trim());
      fd.append('tipo', tipo);
      if (esNueva) {
        fd.append('slug', slug.trim());
        fd.append('estado', 'borrador');
      }
      if (htmlRef.current?.files?.[0]) fd.append('html', htmlRef.current.files[0]);
      if (audioRef.current?.files?.length) {
        Array.from(audioRef.current.files).forEach(f => fd.append('audio', f));
      }

      const res = await fetch(esNueva ? '/api/admin/nfc-cards' : `/api/admin/nfc-cards/${tarjeta!.id}`, {
        method: esNueva ? 'POST' : 'PUT',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No se pudo guardar la tarjeta'); return; }
      onSaved(data.tarjeta as Tarjeta);
    } catch {
      setError('No se pudo conectar con el servidor');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-5">
          <h3 className="font-bold text-ink">{esNueva ? 'Nueva tarjeta NFC' : `Editar tarjeta — ${tarjeta!.creador_nombre}`}</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl text-ink/40 hover:text-ink hover:bg-surface transition">
            <IconX size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Nombre del creador</label>
              <input value={nombre} onChange={e => onNombreChange(e.target.value)} placeholder="Marlon Solórzano"
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">@handle</label>
              <input value={handle} onChange={e => setHandle(e.target.value.replace(/^@/, ''))} placeholder="marlonsolorzano"
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value as 'embajador' | 'cliente')}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                <option value="embajador">Embajador / creador</option>
                <option value="cliente">Cliente</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Slug (URL corta)</label>
              <input
                value={slug}
                disabled={!esNueva}
                onChange={e => { setSlugTocado(true); setSlug(slugify(e.target.value)); }}
                placeholder="marlon-solorzano"
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed" />
            </div>
          </div>
          {slug && <p className="text-[11px] text-ink/40 -mt-2">URL pública: <span className="text-accent">drivepasscol.com/tarjeta/{slug}</span></p>}

          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">
              Archivo .html de la tarjeta {esNueva && <span className="text-danger">*</span>}
              {!esNueva && <span className="text-ink/30 font-normal"> (opcional — deja vacío para conservar el actual)</span>}
            </label>
            <input ref={htmlRef} type="file" accept=".html,text/html"
              onChange={e => setHtmlNombre(e.target.files?.[0]?.name || '')}
              className="w-full text-sm text-ink/70 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-accent/15 file:text-accent file:font-semibold file:text-xs hover:file:bg-accent/20" />
            {htmlNombre && <p className="text-[11px] text-ink/40 mt-1">{htmlNombre}</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">
              Audios (.mp3) — voz, efectos, música
              {!esNueva && <span className="text-ink/30 font-normal"> (se agregan a los que ya existen)</span>}
            </label>
            <input ref={audioRef} type="file" accept=".mp3,audio/*" multiple
              onChange={e => setAudioNombres(Array.from(e.target.files || []).map(f => f.name))}
              className="w-full text-sm text-ink/70 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-accent/15 file:text-accent file:font-semibold file:text-xs hover:file:bg-accent/20" />
            {audioNombres.length > 0 && <p className="text-[11px] text-ink/40 mt-1">{audioNombres.join(', ')}</p>}
            {!esNueva && audiosExistentes.length > 0 && (
              <p className="text-[11px] text-ink/40 mt-1">Ya subidos: {audiosExistentes.map(a => a.nombre).join(', ')}</p>
            )}
          </div>

          {error && <div className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">{error}</div>}

          <button onClick={guardar} disabled={guardando}
            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50 transition">
            {guardando
              ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Guardando…</>
              : <><IconCheck size={14} /> {esNueva ? 'Crear tarjeta (borrador)' : 'Guardar cambios'}</>}
          </button>
          {esNueva && <p className="text-[11px] text-ink/40 text-center">Se crea como borrador. Podrás previsualizarla y publicarla después.</p>}
        </div>
      </div>
    </div>
  );
}
