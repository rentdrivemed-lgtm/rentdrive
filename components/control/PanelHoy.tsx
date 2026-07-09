'use client';
import { useEffect, useState } from 'react';

type Flota = { id: number; placa: string; vehiculo: string; estado: string; estado_key: string; responsable: string };
type Pendiente = { tipo: string; titulo: string; meta: string; solo_socios: number };
type Resumen = { fecha: string; stats: { vehiculos: number; disponibles: number; en_uso: number; pendientes: number }; flota: Flota[]; pendientes: Pendiente[] };

const PEND_COLOR: Record<string, string> = {
  entrega: 'role-mensajero', devolucion: 'role-socio', tarea: 'role-secretaria',
  vencimiento: 'role-none', reunion: 'role-secretaria', general: 'role-none',
};
const PEND_LABEL: Record<string, string> = {
  entrega: 'Entrega', devolucion: 'Devolución', tarea: 'Tarea', vencimiento: 'Vencimiento', reunion: 'Reunión', general: 'Evento',
};

export default function PanelHoy() {
  const [data, setData] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    const cargar = () => fetch('/api/control/resumen', { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (vivo && d.stats) setData(d); }).catch(() => {}).finally(() => { if (vivo) setCargando(false); });
    cargar();
    const t = setInterval(cargar, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  if (cargando) return <div className="loading">Cargando el panel…</div>;
  if (!data) return <div className="empty-state">No pudimos cargar el resumen.</div>;

  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Panel de hoy</div>
          <div className="section-sub" style={{ textTransform: 'capitalize' }}>{hoy}</div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat"><b>{data.stats.vehiculos}</b><span>Vehículos en flota</span></div>
        <div className="stat"><b style={{ color: 'var(--sage)' }}>{data.stats.disponibles}</b><span>Disponibles</span></div>
        <div className="stat"><b style={{ color: 'var(--amber-dark)' }}>{data.stats.en_uso}</b><span>En uso / operación</span></div>
        <div className="stat"><b style={{ color: 'var(--coral)' }}>{data.stats.pendientes}</b><span>Pendientes hoy</span></div>
      </div>

      <div className="fleet-board">
        <div className="fleet-head">
          <div className="fleet-head-title">Flota · Estado en vivo</div>
          <div className="fleet-head-clock">{hora}</div>
        </div>
        <div className="fleet-row head"><div>Placa</div><div>Vehículo</div><div>Estado</div><div>Responsable</div></div>
        {data.flota.map(f => (
          <div className="fleet-row" key={f.id}>
            <div className="plate">{f.placa}</div>
            <div>{f.vehiculo}</div>
            <div><span className={`status-chip status-${f.estado_key}`}><span className="cdot" />{f.estado}</span></div>
            <div>{f.responsable}</div>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ fontSize: 15, marginBottom: 12 }}>Pendientes de hoy</div>
      {data.pendientes.length === 0 ? (
        <div className="empty-state">Nada urgente para hoy. 👌</div>
      ) : (
        <div className="pend-list">
          {data.pendientes.map((p, i) => (
            <div className="pend-card" key={i}>
              <span className={`pend-tag ${PEND_COLOR[p.tipo] || 'role-none'}`}>{PEND_LABEL[p.tipo] || p.tipo}</span>
              {p.solo_socios ? <span className="kcard-lock"> 🔒</span> : null}
              <div>{p.titulo}</div>
              <div className="pend-meta">{p.meta}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
