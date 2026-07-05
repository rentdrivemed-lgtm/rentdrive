'use client';
import { useEffect, useState } from 'react';
import { IconCoin, IconCheck, IconExport } from '@/components/Icons';
import { descargarCotizacionPDF, descargarFacturaPDF } from '@/lib/contabilidad-pdf';

type SubTab = 'resumen' | 'cotizaciones' | 'facturas' | 'liquidaciones' | 'config';

type Resumen = {
  periodo: { desde: string; hasta: string };
  reservas: { n: number; bruto: number };
  comision_pct_actual: number;
  comision_total: number;
  pagado_propietarios: number;
  pendiente_propietarios: number;
  facturas: Array<{ estado: string; n: number; total: number }>;
  cotizaciones: Array<{ estado: string; n: number }>;
  dataico_activo: boolean;
};

type Cotizacion = {
  id: number; reserva_id: number; numero: string; cliente_nombre: string; cliente_correo: string;
  vehiculo_descripcion: string; dias: number; precio_dia: number; recargo: number; total: number;
  estado: string; reserva_estado: string; pago_estado: string; created_at: string;
};

type Factura = {
  id: number; reserva_id: number; numero: string; cliente_nombre: string; cliente_documento: string; cliente_correo: string;
  subtotal: number; total: number; estado: string; dataico_cufe: string; dataico_error: string; created_at: string;
  marca: string; modelo: string; anio: number; fecha_inicio: string; fecha_fin: string;
};

type ReservaPendiente = {
  id: number; fecha_inicio: string; fecha_fin: string; total: number;
  usuario_nombre: string; marca: string; modelo: string; anio: number;
  estado?: string; pago_estado?: string;
};

type LiquidacionFila = {
  reserva_id: number; bruto: number; comision_pct: number; comision_valor: number; neto: number;
  marca: string; modelo: string; anio: number; fecha_inicio: string; fecha_fin: string; usuario_nombre: string;
};
type LiquidacionGrupo = {
  propietario_id: number; propietario_nombre: string; propietario_correo: string;
  banco: string; numero_cuenta: string; total_neto: number; liquidaciones: LiquidacionFila[];
};

const ESTADO_BADGE: Record<string, string> = {
  enviada: 'bg-brand-muted text-ink border-border',
  aceptada: 'bg-success/15 text-success border-success/30',
  vencida: 'bg-warning/15 text-warning border-warning/25',
  cancelada: 'bg-danger/15 text-danger border-danger/25',
  borrador: 'bg-warning/15 text-warning border-warning/25',
  emitida: 'bg-success/15 text-success border-success/30',
  error: 'bg-danger/15 text-danger border-danger/25',
  anulada: 'bg-danger/15 text-danger border-danger/25',
};

function cop(n: number) { return `$${Math.round(n || 0).toLocaleString('es-CO')}`; }
function primerDiaMes() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function hoy() { return new Date().toISOString().slice(0, 10); }

export default function ContabilidadPanel() {
  const [subTab, setSubTab] = useState<SubTab>('resumen');

  // Resumen
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoy());
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [errorResumen, setErrorResumen] = useState('');

  // Cotizaciones
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [reservasSinCotizacion, setReservasSinCotizacion] = useState<ReservaPendiente[]>([]);
  const [cargandoCot, setCargandoCot] = useState(false);
  const [errorCot, setErrorCot] = useState('');
  const [reenviandoId, setReenviandoId] = useState<number | null>(null);

  // Facturas
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [reservasSinFactura, setReservasSinFactura] = useState<ReservaPendiente[]>([]);
  const [cargandoFac, setCargandoFac] = useState(false);
  const [errorFac, setErrorFac] = useState('');
  const [emitiendoId, setEmitiendoId] = useState<number | null>(null);

  // Liquidaciones
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionGrupo[]>([]);
  const [totalLiquidaciones, setTotalLiquidaciones] = useState(0);
  const [estadoLiq, setEstadoLiq] = useState<'pendiente' | 'pagado'>('pendiente');
  const [cargandoLiq, setCargandoLiq] = useState(false);
  const [errorLiq, setErrorLiq] = useState('');
  const [pagandoIds, setPagandoIds] = useState<Set<number>>(new Set());
  const [comprobante, setComprobante] = useState('');
  const [liqMsg, setLiqMsg] = useState('');

  // Config
  const [config, setConfig] = useState({
    comision_plataforma_pct: '', empresa_nombre: '', empresa_nit: '',
    referido_habilitado: '', referido_recompensa_referrer: '', referido_recompensa_referido: '',
  });
  const [cargandoConfig, setCargandoConfig] = useState(false);
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState('');

  const cargarResumen = async () => {
    setCargandoResumen(true); setErrorResumen('');
    try {
      const res = await fetch(`/api/contabilidad/resumen?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorResumen('No pudimos cargar el resumen.'); return; }
      setResumen(d);
    } catch {
      setErrorResumen('Sin conexión — intenta de nuevo.');
    } finally {
      setCargandoResumen(false);
    }
  };

  const cargarCotizaciones = async () => {
    setCargandoCot(true); setErrorCot('');
    try {
      const res = await fetch('/api/contabilidad/cotizaciones', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorCot('No pudimos cargar las cotizaciones.'); return; }
      setCotizaciones(d.cotizaciones || []);
      setReservasSinCotizacion(d.reservas_sin_cotizacion || []);
    } catch {
      setErrorCot('Sin conexión — intenta de nuevo.');
    } finally {
      setCargandoCot(false);
    }
  };

  const cargarFacturas = async () => {
    setCargandoFac(true); setErrorFac('');
    try {
      const res = await fetch('/api/contabilidad/facturas', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorFac('No pudimos cargar las facturas.'); return; }
      setFacturas(d.facturas || []);
      setReservasSinFactura(d.reservas_sin_factura || []);
    } catch {
      setErrorFac('Sin conexión — intenta de nuevo.');
    } finally {
      setCargandoFac(false);
    }
  };

  const cargarLiquidaciones = async () => {
    setCargandoLiq(true); setErrorLiq('');
    try {
      const res = await fetch(`/api/contabilidad/liquidaciones?estado=${estadoLiq}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorLiq('No pudimos cargar las liquidaciones.'); return; }
      setLiquidaciones(d.por_propietario || []);
      setTotalLiquidaciones(d.total_general || 0);
    } catch {
      setErrorLiq('Sin conexión — intenta de nuevo.');
    } finally {
      setCargandoLiq(false);
    }
  };

  const cargarConfig = async () => {
    setCargandoConfig(true);
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfig({
          comision_plataforma_pct: d.config?.comision_plataforma_pct || '',
          empresa_nombre: d.config?.empresa_nombre || '',
          empresa_nit: d.config?.empresa_nit || '',
          referido_habilitado: d.config?.referido_habilitado || '',
          referido_recompensa_referrer: d.config?.referido_recompensa_referrer || '',
          referido_recompensa_referido: d.config?.referido_recompensa_referido || '',
        });
      }
    } catch { /* silencioso — se puede reintentar cambiando de pestaña */ }
    finally { setCargandoConfig(false); }
  };

  useEffect(() => { cargarResumen(); cargarConfig(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (subTab === 'cotizaciones' && cotizaciones.length === 0) cargarCotizaciones();
    if (subTab === 'facturas' && facturas.length === 0) cargarFacturas();
    if (subTab === 'liquidaciones') cargarLiquidaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, estadoLiq]);

  const reenviarCotizacion = async (reservaId: number) => {
    setReenviandoId(reservaId);
    try {
      const res = await fetch('/api/contabilidad/cotizaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reserva_id: reservaId }),
      });
      if (res.ok) cargarCotizaciones();
    } catch { /* el usuario puede reintentar el clic */ }
    finally { setReenviandoId(null); }
  };

  const emitirFacturaClick = async (reservaId: number) => {
    setEmitiendoId(reservaId);
    try {
      const res = await fetch('/api/contabilidad/facturas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reserva_id: reservaId }),
      });
      if (res.ok) cargarFacturas();
    } catch { /* el usuario puede reintentar el clic */ }
    finally { setEmitiendoId(null); }
  };

  const marcarLiquidacionPagada = async (reservaIds: number[]) => {
    setPagandoIds(prev => new Set([...prev, ...reservaIds]));
    setLiqMsg('');
    try {
      const res = await fetch('/api/contabilidad/liquidaciones', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reserva_ids: reservaIds, comprobante }),
      });
      if (res.ok) {
        setLiqMsg('✓ Pago registrado y propietario notificado.');
        cargarLiquidaciones();
        setTimeout(() => setLiqMsg(''), 4000);
      } else {
        const d = await res.json().catch(() => ({}));
        setLiqMsg((d as { error?: string }).error || 'Error al registrar el pago.');
      }
    } catch {
      setLiqMsg('Sin conexión al registrar el pago.');
    } finally {
      setPagandoIds(prev => { const n = new Set(prev); reservaIds.forEach(id => n.delete(id)); return n; });
    }
  };

  const guardarConfig = async () => {
    setGuardandoConfig(true); setConfigMsg('');
    try {
      const pct = Number(config.comision_plataforma_pct);
      if (config.comision_plataforma_pct && (!Number.isFinite(pct) || pct <= 0 || pct >= 1)) {
        setConfigMsg('La comisión debe ser un número entre 0 y 1 (ej. 0.33 para 33%).');
        return;
      }
      const rRef = Number(config.referido_recompensa_referrer);
      const rInv = Number(config.referido_recompensa_referido);
      if (config.referido_recompensa_referrer && (!Number.isFinite(rRef) || rRef < 0)) {
        setConfigMsg('La recompensa para quien invita debe ser un número mayor o igual a 0.');
        return;
      }
      if (config.referido_recompensa_referido && (!Number.isFinite(rInv) || rInv < 0)) {
        setConfigMsg('La recompensa para el invitado debe ser un número mayor o igual a 0.');
        return;
      }
      const res = await fetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
      });
      setConfigMsg(res.ok ? '✓ Guardado' : 'Error al guardar');
    } catch {
      setConfigMsg('Sin conexión');
    } finally {
      setGuardandoConfig(false);
    }
  };

  const empresaParaPdf = { nombre: config.empresa_nombre || 'DrivePass', nit: config.empresa_nit };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-bold text-ink text-lg flex items-center gap-2"><IconCoin size={20} className="text-accent" /> Contabilidad</h2>
        <p className="text-sm text-ink/50">Cotizaciones, facturación electrónica y liquidaciones a propietarios</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border flex-wrap">
        {([
          { key: 'resumen', label: 'Resumen' },
          { key: 'cotizaciones', label: 'Cotizaciones' },
          { key: 'facturas', label: 'Facturas' },
          { key: 'liquidaciones', label: 'Liquidaciones a propietarios' },
          { key: 'config', label: 'Configuración' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              subTab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink/50 hover:text-ink'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── RESUMEN ── */}
      {subTab === 'resumen' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Desde</label>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                className="border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Hasta</label>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                className="border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface" />
            </div>
            <button onClick={cargarResumen} disabled={cargandoResumen}
              className="text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl transition disabled:opacity-60">
              {cargandoResumen ? 'Cargando…' : 'Actualizar'}
            </button>
            {!resumen?.dataico_activo && (
              <span className="text-xs text-warning bg-warning/10 border border-warning/25 rounded-xl px-3 py-2">
                ⚠ DataICO no está configurado — las facturas salen como borrador local, sin validez DIAN.
              </span>
            )}
          </div>

          {errorResumen ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">{errorResumen}</p>
              <button onClick={cargarResumen} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : cargandoResumen ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="bg-surface-2 rounded-2xl border border-border h-24 animate-pulse" />)}
            </div>
          ) : resumen && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-surface-2 rounded-2xl border border-border p-4">
                  <p className="text-[11px] text-ink/50 uppercase tracking-wide">Ingresos brutos</p>
                  <p className="text-xl font-black text-ink mt-1">{cop(resumen.reservas.bruto)}</p>
                  <p className="text-[11px] text-ink/40 mt-0.5">{resumen.reservas.n} reserva{resumen.reservas.n !== 1 ? 's' : ''}</p>
                </div>
                <div className="bg-accent-light rounded-2xl border border-accent/20 p-4">
                  <p className="text-[11px] text-accent uppercase tracking-wide">Comisión DrivePass</p>
                  <p className="text-xl font-black text-accent mt-1">{cop(resumen.comision_total)}</p>
                  <p className="text-[11px] text-ink/40 mt-0.5">{(resumen.comision_pct_actual * 100).toFixed(0)}% actual</p>
                </div>
                <div className="bg-success/10 rounded-2xl border border-success/25 p-4">
                  <p className="text-[11px] text-success uppercase tracking-wide">Pagado a propietarios</p>
                  <p className="text-xl font-black text-success mt-1">{cop(resumen.pagado_propietarios)}</p>
                </div>
                <div className="bg-warning/10 rounded-2xl border border-warning/25 p-4">
                  <p className="text-[11px] text-warning uppercase tracking-wide">Pendiente por pagar</p>
                  <p className="text-xl font-black text-warning mt-1">{cop(resumen.pendiente_propietarios)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-surface-2 rounded-2xl border border-border p-4">
                  <p className="text-xs font-bold text-ink/60 uppercase tracking-wide mb-2">Facturas</p>
                  {resumen.facturas.length === 0 ? <p className="text-sm text-ink/40">Sin facturas en el período.</p> : (
                    <div className="space-y-1.5">
                      {resumen.facturas.map(f => (
                        <div key={f.estado} className="flex items-center justify-between text-sm">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${ESTADO_BADGE[f.estado] || ''}`}>{f.estado} ({f.n})</span>
                          <span className="font-semibold text-ink">{cop(f.total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-surface-2 rounded-2xl border border-border p-4">
                  <p className="text-xs font-bold text-ink/60 uppercase tracking-wide mb-2">Cotizaciones</p>
                  {resumen.cotizaciones.length === 0 ? <p className="text-sm text-ink/40">Sin cotizaciones en el período.</p> : (
                    <div className="space-y-1.5">
                      {resumen.cotizaciones.map(c => (
                        <div key={c.estado} className="flex items-center justify-between text-sm">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${ESTADO_BADGE[c.estado] || ''}`}>{c.estado}</span>
                          <span className="font-semibold text-ink">{c.n}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── COTIZACIONES ── */}
      {subTab === 'cotizaciones' && (
        <div className="space-y-3">
          {!errorCot && !cargandoCot && reservasSinCotizacion.length > 0 && (
            <div className="bg-warning/10 border border-warning/25 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-bold text-warning uppercase tracking-wide">Reservas sin cotización ({reservasSinCotizacion.length})</p>
              <p className="text-[11px] text-ink/50 -mt-1">Reservas de antes de este módulo, o donde no se generó automáticamente. Genérala manualmente aquí.</p>
              <div className="space-y-2">
                {reservasSinCotizacion.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 bg-surface rounded-xl px-3 py-2.5 border border-border flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">#{r.id} · {r.marca} {r.modelo} {r.anio} · {r.usuario_nombre}</p>
                      <p className="text-xs text-ink/50">{r.fecha_inicio} → {r.fecha_fin} · {cop(r.total)} · {r.estado}</p>
                    </div>
                    <button onClick={() => reenviarCotizacion(r.id)} disabled={reenviandoId === r.id}
                      className="text-xs font-semibold bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-xl transition disabled:opacity-60 flex-shrink-0">
                      {reenviandoId === r.id ? 'Generando…' : 'Generar y enviar'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {errorCot ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">{errorCot}</p>
              <button onClick={cargarCotizaciones} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : cargandoCot ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="bg-surface-2 rounded-xl border border-border h-16 animate-pulse" />)}</div>
          ) : cotizaciones.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <p className="text-ink/40">Todavía no hay cotizaciones generadas.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cotizaciones.map(c => (
                <div key={c.id} className="bg-surface-2 rounded-xl border border-border p-3.5 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{c.numero} · {c.cliente_nombre}</p>
                    <p className="text-xs text-ink/50">{c.vehiculo_descripcion} · {c.dias} día{c.dias !== 1 ? 's' : ''} · {cop(c.total)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${ESTADO_BADGE[c.estado] || ''}`}>{c.estado}</span>
                    <button onClick={() => descargarCotizacionPDF(empresaParaPdf, c)}
                      className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium flex items-center gap-1">
                      <IconExport size={12} /> PDF
                    </button>
                    <button onClick={() => reenviarCotizacion(c.reserva_id)} disabled={reenviandoId === c.reserva_id}
                      className="text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium disabled:opacity-50">
                      {reenviandoId === c.reserva_id ? 'Enviando…' : 'Reenviar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── FACTURAS ── */}
      {subTab === 'facturas' && (
        <div className="space-y-3">
          {!errorFac && !cargandoFac && reservasSinFactura.length > 0 && (
            <div className="bg-warning/10 border border-warning/25 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-bold text-warning uppercase tracking-wide">Reservas pagadas sin factura ({reservasSinFactura.length})</p>
              <p className="text-[11px] text-ink/50 -mt-1">Ya tienen el pago confirmado pero no se les generó factura (respaldo manual, esto debería pasar solo).</p>
              <div className="space-y-2">
                {reservasSinFactura.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 bg-surface rounded-xl px-3 py-2.5 border border-border flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">#{r.id} · {r.marca} {r.modelo} {r.anio} · {r.usuario_nombre}</p>
                      <p className="text-xs text-ink/50">{r.fecha_inicio} → {r.fecha_fin} · {cop(r.total)}</p>
                    </div>
                    <button onClick={() => emitirFacturaClick(r.id)} disabled={emitiendoId === r.id}
                      className="text-xs font-semibold bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-xl transition disabled:opacity-60 flex-shrink-0">
                      {emitiendoId === r.id ? 'Emitiendo…' : 'Emitir factura'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {errorFac ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">{errorFac}</p>
              <button onClick={cargarFacturas} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : cargandoFac ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="bg-surface-2 rounded-xl border border-border h-16 animate-pulse" />)}</div>
          ) : facturas.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <p className="text-ink/40">Todavía no hay facturas — se generan automáticamente al confirmar el pago de una reserva.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {facturas.map(f => (
                <div key={f.id} className="bg-surface-2 rounded-xl border border-border p-3.5 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{f.numero || '(sin número)'} · {f.cliente_nombre}</p>
                    <p className="text-xs text-ink/50">{f.marca} {f.modelo} {f.anio} · {f.fecha_inicio} → {f.fecha_fin} · {cop(f.total)}</p>
                    {f.estado === 'error' && f.dataico_error && <p className="text-[11px] text-danger mt-0.5">{f.dataico_error}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${ESTADO_BADGE[f.estado] || ''}`}>{f.estado}</span>
                    <button onClick={() => descargarFacturaPDF(empresaParaPdf, f)}
                      className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium flex items-center gap-1">
                      <IconExport size={12} /> PDF
                    </button>
                    {f.estado === 'error' && (
                      <button onClick={() => emitirFacturaClick(f.reserva_id)} disabled={emitiendoId === f.reserva_id}
                        className="text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium disabled:opacity-50">
                        {emitiendoId === f.reserva_id ? 'Reintentando…' : 'Reintentar'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LIQUIDACIONES A PROPIETARIOS ── */}
      {subTab === 'liquidaciones' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex gap-2">
              <button onClick={() => setEstadoLiq('pendiente')}
                className={`text-sm font-medium px-3.5 py-2 rounded-xl border transition ${estadoLiq === 'pendiente' ? 'bg-warning/15 text-warning border-warning/30' : 'border-border text-ink/50'}`}>
                Pendientes
              </button>
              <button onClick={() => setEstadoLiq('pagado')}
                className={`text-sm font-medium px-3.5 py-2 rounded-xl border transition ${estadoLiq === 'pagado' ? 'bg-success/15 text-success border-success/30' : 'border-border text-ink/50'}`}>
                Pagadas
              </button>
            </div>
            <div className="bg-surface-2 border border-border rounded-2xl px-5 py-3 text-right">
              <p className="text-xs text-ink/50 font-medium">Total {estadoLiq === 'pendiente' ? 'pendiente' : 'pagado'} (neto)</p>
              <p className="text-2xl font-black text-ink">{cop(totalLiquidaciones)}</p>
            </div>
          </div>

          {estadoLiq === 'pendiente' && (
            <div className="bg-surface-2 rounded-2xl border border-border p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs font-medium text-ink/60 block mb-1">Número de comprobante / referencia (opcional)</label>
                <input placeholder="Ej. TXN-20260630-001" value={comprobante} onChange={e => setComprobante(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <p className="text-xs text-ink/50 flex-shrink-0">Se incluye en la notificación al propietario.</p>
            </div>
          )}

          {liqMsg && (
            <div className={`text-sm px-4 py-2.5 rounded-xl border ${liqMsg.startsWith('✓') ? 'bg-success/10 text-success border-success/30' : 'bg-danger/10 text-danger border-danger/25'}`}>{liqMsg}</div>
          )}

          {errorLiq ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">{errorLiq}</p>
              <button onClick={cargarLiquidaciones} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : cargandoLiq ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="bg-surface-2 rounded-2xl border border-border h-28 animate-pulse" />)}</div>
          ) : liquidaciones.length === 0 ? (
            <div className="text-center py-16 bg-surface-2 rounded-2xl border border-border">
              <p className="text-4xl mb-3">{estadoLiq === 'pendiente' ? '✅' : '📄'}</p>
              <p className="font-semibold text-ink">{estadoLiq === 'pendiente' ? 'Sin liquidaciones pendientes' : 'Sin liquidaciones pagadas todavía'}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {liquidaciones.map(grupo => {
                const ids = grupo.liquidaciones.map(l => l.reserva_id);
                const cargando = ids.some(id => pagandoIds.has(id));
                return (
                  <div key={grupo.propietario_id} className="bg-surface-2 rounded-2xl border border-border p-5">
                    <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                      <div>
                        <p className="font-bold text-ink text-base">{grupo.propietario_nombre}</p>
                        <p className="text-xs text-ink/50">{grupo.propietario_correo}</p>
                        {grupo.banco ? (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            <span className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1 text-ink/70">🏦 {grupo.banco}</span>
                            <span className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1 font-mono text-ink/70">{grupo.numero_cuenta}</span>
                          </div>
                        ) : (
                          <p className="text-xs text-danger mt-1">⚠ Datos bancarios no registrados</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-ink/50 mb-1">Total neto</p>
                        <p className="text-xl font-black text-success">{cop(grupo.total_neto)}</p>
                        {estadoLiq === 'pendiente' && (
                          <button onClick={() => marcarLiquidacionPagada(ids)} disabled={cargando}
                            className="mt-2 flex items-center gap-2 bg-success hover:bg-success/80 text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
                            <IconCheck size={14} /> {cargando ? 'Procesando…' : `Marcar todo pagado (${grupo.liquidaciones.length})`}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-border pt-3 space-y-2">
                      {grupo.liquidaciones.map(l => {
                        const enCurso = pagandoIds.has(l.reserva_id);
                        return (
                          <div key={l.reserva_id} className="flex items-center justify-between gap-3 bg-surface rounded-xl px-3 py-2.5 border border-border flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink truncate">{l.marca} {l.modelo} {l.anio}</p>
                              <p className="text-xs text-ink/50">{l.fecha_inicio} → {l.fecha_fin} · {l.usuario_nombre}</p>
                              <p className="text-[11px] text-ink/40">Bruto {cop(l.bruto)} − comisión {(l.comision_pct * 100).toFixed(0)}% ({cop(l.comision_valor)})</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-sm font-bold text-ink">{cop(l.neto)}</span>
                              {estadoLiq === 'pendiente' && (
                                <button onClick={() => marcarLiquidacionPagada([l.reserva_id])} disabled={enCurso}
                                  className="text-xs border border-success/40 text-success px-2.5 py-1.5 rounded-xl hover:bg-success/10 transition disabled:opacity-50 font-medium">
                                  {enCurso ? '…' : '✓ Pagar'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CONFIGURACIÓN ── */}
      {subTab === 'config' && (
        <div className="max-w-lg space-y-4">
          <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-4">
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Comisión de la plataforma (0 a 1, ej. 0.33 = 33%)</label>
              <input value={config.comision_plataforma_pct} onChange={e => setConfig(c => ({ ...c, comision_plataforma_pct: e.target.value.replace(/[^0-9.]/g, '') }))}
                placeholder="0.33" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
              <p className="text-[11px] text-ink/40 mt-1">Se aplica a las nuevas reservas que se confirmen a partir de ahora — no cambia liquidaciones ya generadas.</p>
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Nombre de la empresa (aparece en cotizaciones y facturas)</label>
              <input value={config.empresa_nombre} onChange={e => setConfig(c => ({ ...c, empresa_nombre: e.target.value }))}
                placeholder="DrivePass" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">NIT</label>
              <input value={config.empresa_nit} onChange={e => setConfig(c => ({ ...c, empresa_nit: e.target.value }))}
                placeholder="900.000.000-0" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={guardarConfig} disabled={guardandoConfig || cargandoConfig}
                className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition disabled:opacity-60">
                {guardandoConfig ? 'Guardando…' : 'Guardar'}
              </button>
              {configMsg && <span className={`text-xs ${configMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{configMsg}</span>}
            </div>
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <p className="text-xs font-bold text-ink/60 uppercase tracking-wide mb-2">Facturación electrónica (DataICO)</p>
            <p className="text-sm text-ink/60">
              {resumen?.dataico_activo
                ? '✅ Configurado — las facturas se emiten de verdad ante la DIAN.'
                : '⚠ No configurado — faltan las variables DATAICO_ACCOUNT_ID y DATAICO_AUTH_TOKEN en el servidor. Mientras tanto, las facturas se generan como borrador local (sin validez tributaria).'}
            </p>
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-ink/60 uppercase tracking-wide">🎁 Programa de referidos</p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={config.referido_habilitado === 'true'}
                  onChange={e => setConfig(c => ({ ...c, referido_habilitado: e.target.checked ? 'true' : 'false' }))} />
                <span className="text-ink/70">Activo</span>
              </label>
            </div>
            <p className="text-[11px] text-ink/40 -mt-2">
              Quien invita gana su recompensa solo cuando su referido completa su primera reserva pagada (evita premiar cuentas falsas). El invitado gana su descuento apenas se registra con el código.
            </p>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Recompensa para quien invita (COP)</label>
              <input value={config.referido_recompensa_referrer} onChange={e => setConfig(c => ({ ...c, referido_recompensa_referrer: e.target.value.replace(/\D/g, '') }))}
                placeholder="30000" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Descuento de bienvenida para el invitado (COP)</label>
              <input value={config.referido_recompensa_referido} onChange={e => setConfig(c => ({ ...c, referido_recompensa_referido: e.target.value.replace(/\D/g, '') }))}
                placeholder="30000" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={guardarConfig} disabled={guardandoConfig || cargandoConfig}
                className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition disabled:opacity-60">
                {guardandoConfig ? 'Guardando…' : 'Guardar'}
              </button>
              {configMsg && <span className={`text-xs ${configMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{configMsg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
