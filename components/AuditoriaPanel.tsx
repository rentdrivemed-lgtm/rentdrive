'use client';
import { useEffect, useState } from 'react';

type Evento = {
  id: number; usuario_id: number; usuario_nombre: string; usuario_correo: string; usuario_nivel: string;
  area: string; accion: string; detalle: string; entidad: string; entidad_id: number | null; created_at: string;
};

const AREA_LABEL: Record<string, string> = {
  contabilidad: '💰 Contabilidad', usuarios: '👤 Usuarios', config: '⚙️ Configuración', soporte: '💬 Soporte',
};
const ACCION_LABEL: Record<string, string> = {
  crear_gasto: 'Creó un gasto', editar_gasto: 'Editó un gasto', anular_gasto: 'Anuló un gasto',
  restaurar_gasto: 'Restauró un gasto', eliminar_gasto: 'Eliminó un gasto', pagar_liquidacion: 'Pagó liquidación(es)',
  editar_config: 'Cambió la configuración', crear_cuenta_equipo: 'Creó una cuenta de equipo',
  cambiar_nivel: 'Cambió el nivel de un usuario', desactivar_cuenta: 'Desactivó una cuenta',
  activar_cuenta: 'Activó una cuenta', resetear_clave: 'Reseteó una contraseña',
};

function formatHora(ts: string) {
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? ts : d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AuditoriaPanel() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [area, setArea] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = async () => {
    setCargando(true); setError('');
    try {
      const q = new URLSearchParams();
      if (area) q.set('area', area);
      const res = await fetch(`/api/admin/auditoria?${q.toString()}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError('No pudimos cargar la bitácora.'); return; }
      setEventos(d.eventos || []);
      setAreas(d.areas || []);
    } catch {
      setError('Sin conexión — intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, [area]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-ink text-lg flex items-center gap-2">🧾 Bitácora de auditoría</h2>
        <p className="text-sm text-ink/50">Registro de acciones sensibles: quién hizo qué y a qué hora.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setArea('')} className={`text-xs px-3 py-1.5 rounded-full border transition ${area === '' ? 'bg-accent-light text-accent border-accent/30' : 'border-border text-ink/60'}`}>Todas</button>
        {areas.map(a => (
          <button key={a} onClick={() => setArea(a)} className={`text-xs px-3 py-1.5 rounded-full border transition ${area === a ? 'bg-accent-light text-accent border-accent/30' : 'border-border text-ink/60'}`}>
            {AREA_LABEL[a] || a}
          </button>
        ))}
      </div>

      {error ? (
        <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
          <p className="text-danger mb-4">{error}</p>
          <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
        </div>
      ) : cargando ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="bg-surface-2 rounded-xl border border-border h-14 animate-pulse" />)}</div>
      ) : eventos.length === 0 ? (
        <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
          <p className="text-ink/40">Todavía no hay eventos registrados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {eventos.map(e => (
            <div key={e.id} className="bg-surface-2 rounded-xl border border-border p-3.5 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{e.usuario_nombre || 'Usuario'}</span>
                  {e.usuario_nivel ? <span className="text-[10px] text-ink/50"> ({e.usuario_nivel})</span> : null}
                  <span className="text-ink/70"> — {ACCION_LABEL[e.accion] || e.accion}</span>
                </p>
                {e.detalle && <p className="text-xs text-ink/60 mt-0.5">{e.detalle}</p>}
                <p className="text-[11px] text-ink/40 mt-0.5">{e.usuario_correo}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-surface text-ink/60">{AREA_LABEL[e.area] || e.area}</span>
                <p className="text-[11px] text-ink/40 mt-1">{formatHora(e.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
