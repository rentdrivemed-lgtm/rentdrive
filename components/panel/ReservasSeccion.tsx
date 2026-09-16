'use client';
// ── Reservas: solicitudes de la app y reservas del punto de atención ────────
//
// La pestaña «Reservas» del panel de siempre, extraída TAL CUAL de
// app/dashboard/admin/page.tsx (3.356 líneas) para que las DOS pantallas monten el
// mismo componente: /dashboard/admin y /panel (sección Reservas, grupo Operación).
// Una sola copia, sin riesgo de que las dos se desincronicen.
//
// QUÉ TRAE (todo igual que antes): el resumen, el calendario de todos los vehículos,
// los filtros, aprobar/rechazar con motivo, iniciar/completar/cancelar, el no-show a
// las 3 horas, los documentos del cliente con su paquete .zip, la verificación del
// arrendatario con IA y la reserva de mostrador (cliente presencial).
//
// DE DÓNDE SALEN LOS DATOS: de `useDatosAdmin()` (components/panel/DatosAdmin.tsx). La
// lista de VEHÍCULOS se asegura desde acá porque el modal de reserva de mostrador
// necesita elegir carro.
//
// OJO: aprobar una reserva NO es solo cambiar un estado — manda correos y crea el
// servicio logístico (ver PUT /api/reservas/[id]). Es el mismo endpoint y el mismo
// cuerpo que usa la acción rápida de la vista HOY: una sola vía de aprobación.
import { useEffect, useState } from 'react';
import { rutaDocumento, type DocumentoDisponible, type MapaDocumentos } from '@/lib/documentos-ref';
import CalendarioReservas, { type ReservaCalendario } from '@/components/CalendarioReservas';
import ReservaMostradorModal from '@/components/ReservaMostradorModal';
import BotonPaqueteDocumentos from '@/components/BotonPaqueteDocumentos';
import ResultadoIA from '@/components/ResultadoIA';
import { useDatosAdmin } from '@/components/panel/DatosAdmin';
import { fechaHoraRecogida, esNoShowAplicable } from '@/lib/cancelacion';
import { IconCalendar, IconCheck, IconShield, IconX } from '@/components/Icons';
import type { VerificacionResultado } from '@/lib/verificacion-docs';

const estadoColor: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning',
  confirmada: 'bg-brand-muted text-ink',
  en_curso:   'bg-success/15 text-success',
  completada: 'bg-surface text-ink/50',
  cancelada:  'bg-danger/15 text-danger',
};

export default function ReservasSeccion() {
  const {
    reservas, setReservas, vehiculos, errorListas,
    cargarReservas, asegurarReservas, asegurarVehiculos,
  } = useDatosAdmin();

  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroBusq, setFiltroBusq] = useState('');
  const [accionando, setAccionando] = useState<number | null>(null);
  const [rechazando, setRechazando] = useState<{ id: number; nota: string } | null>(null);
  const [clienteDocs, setClienteDocs] = useState<{ r: ReservaCalendario & {
    documento_es_pasaporte?: number;
    // Documentos de identidad del cliente: GET /api/reservas ya NO devuelve sus
    // direcciones, solo el mapa de los que están subidos con su referencia
    // (`reserva/<id>/<clave>`). Verlos pasa por /api/documentos/..., que comprueba
    // el permiso y deja el acceso en la Bitácora.
    documentos_id?: MapaDocumentos;
    // Llega en el `SELECT r.*` de GET /api/reservas; el tipo compartido
    // `ReservaCalendario` no lo declara porque el calendario no lo usa. Acá hace
    // falta para armar el enlace al paquete de documentos de ESE cliente.
    usuario_id?: number;
  } } | null>(null);
  // Reserva creada en el punto de atención (cliente presencial) — ver
  // components/ReservaMostradorModal.tsx y POST /api/admin/reservas.
  const [nuevaReservaAbierta, setNuevaReservaAbierta] = useState(false);
  const [reservaMostradorMsg, setReservaMostradorMsg] = useState('');
  // La reserva se creó bien pero quedó algo que el empleado tiene que atender (hoy:
  // el correo con el enlace de activación no salió) → el aviso se pinta en tono de
  // advertencia, no de éxito.
  const [reservaMostradorAviso, setReservaMostradorAviso] = useState(false);
  const [arrIa, setArrIa] = useState<{ rid: number; nombre: string; res?: VerificacionResultado; error?: string } | null>(null);
  const [arrIaCargando, setArrIaCargando] = useState(false);

  useEffect(() => {
    asegurarReservas();
    // El modal de reserva de mostrador elige entre los vehículos de la flota.
    asegurarVehiculos();
  }, [asegurarReservas, asegurarVehiculos]);

  const verificarArrendatario = async (rid: number, nombre: string) => {
    setArrIa({ rid, nombre });
    setArrIaCargando(true);
    try {
      const res = await fetch('/api/verificar-documentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reserva_id: rid }),
      });
      const data = await res.json() as { error?: string; verificacion?: VerificacionResultado };
      if (!res.ok || !data.verificacion) {
        setArrIa({ rid, nombre, error: data.error || 'No se pudo completar la verificación.' });
        return;
      }
      setArrIa({ rid, nombre, res: data.verificacion });
    } catch {
      setArrIa({ rid, nombre, error: 'No se pudo conectar con el verificador de IA.' });
    } finally {
      setArrIaCargando(false);
    }
  };
  const aprobarReserva = async (id: number) => {
    setAccionando(id);
    try {
      const res = await fetch(`/api/reservas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'confirmada', pago_estado: 'pagado' }),
      });
      if (res.ok) setReservas(rs => rs.map(r => r.id === id ? { ...r, estado: 'confirmada', pago_estado: 'pagado' } : r));
    } finally {
      setAccionando(null);
    }
  };

  const rechazarReserva = async (id: number, motivo: string) => {
    setAccionando(id);
    try {
      const res = await fetch(`/api/reservas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'cancelada', pago_estado: 'cancelado', motivo_rechazo: motivo }),
      });
      if (res.ok) setReservas(rs => rs.map(r => r.id === id ? { ...r, estado: 'cancelada', pago_estado: 'cancelado' } : r));
    } finally {
      setRechazando(null);
      setAccionando(null);
    }
  };

  const cambiarEstadoReserva = async (id: number, estado: string) => {
    await fetch(`/api/reservas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    });
    setReservas(rs => rs.map(r => r.id === id ? { ...r, estado } : r));
  };

  const marcarNoShow = async (id: number) => {
    setAccionando(id);
    const res = await fetch(`/api/reservas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marcar_no_show: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setReservas(rs => rs.map(r => r.id === id ? { ...r, estado: 'cancelada', cancelacion_pct: data.cancelacion_pct ?? 100 } : r));
    }
    setAccionando(null);
  };
  const reservaStats = {
    total:       reservas.length,
    confirmadas: reservas.filter(r => r.estado === 'confirmada').length,
    en_curso:    reservas.filter(r => r.estado === 'en_curso').length,
    canceladas:  reservas.filter(r => r.estado === 'cancelada').length,
    ingresos:    reservas.filter(r => r.estado !== 'cancelada').reduce((s, r) => s + r.total, 0),
  };
  const pendientesCount = reservas.filter(r => r.estado === 'pendiente').length;
  const reservasFiltradas = reservas
    .filter(r => {
      if (filtroEstado && r.estado !== filtroEstado) return false;
      if (filtroBusq) {
        const q = filtroBusq.toLowerCase();
        return (
          r.marca.toLowerCase().includes(q) ||
          r.modelo.toLowerCase().includes(q) ||
          r.usuario_nombre.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      // Pending reservations always first
      if (a.estado === 'pendiente' && b.estado !== 'pendiente') return -1;
      if (b.estado === 'pendiente' && a.estado !== 'pendiente') return 1;
      return 0;
    });

  return (
    <>
      <div className="space-y-6">
        {/* Reserva en el punto de atención (cliente presencial) */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-ink text-lg">Reservas</h2>
            <p className="text-sm text-ink/50">
              Solicitudes que llegan por la app y reservas hechas en el punto de atención.
            </p>
          </div>
          <button
            onClick={() => { setReservaMostradorMsg(''); setReservaMostradorAviso(false); setNuevaReservaAbierta(true); }}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-4 py-2.5 rounded-xl transition text-sm">
            ＋ Nueva reserva (cliente presencial)
          </button>
        </div>

        {reservaMostradorMsg && (
          <div className={`${reservaMostradorAviso ? 'bg-warning/10 border-warning/25' : 'bg-success/10 border-success/25'} border rounded-2xl px-4 py-3 flex items-start gap-3`}>
            <span className="text-lg">{reservaMostradorAviso ? '⚠️' : '✅'}</span>
            <p className={`text-sm font-medium ${reservaMostradorAviso ? 'text-warning' : 'text-success'}`}>{reservaMostradorMsg}</p>
          </div>
        )}

        {/* Alerta de pendientes */}
        {pendientesCount > 0 && (
          <div className="bg-warning/10 border border-warning/25 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl">⏳</span>
            <div>
              <p className="font-bold text-warning text-sm">
                {pendientesCount} reserva{pendientesCount !== 1 ? 's' : ''} pendiente{pendientesCount !== 1 ? 's' : ''} de aprobación
              </p>
              <p className="text-xs text-warning">Revísalas y aprueba o rechaza cada solicitud.</p>
            </div>
          </div>
        )}

        {/* Stats de reservas */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total',        value: reservaStats.total,                               color: 'bg-brand-muted text-ink'   },
            { label: 'Confirmadas',  value: reservaStats.confirmadas,                          color: 'bg-brand-muted text-ink'   },
            { label: 'En curso',     value: reservaStats.en_curso,                             color: 'bg-success/10 text-success'  },
            { label: 'Canceladas',   value: reservaStats.canceladas,                           color: 'bg-danger/10 text-danger'      },
            { label: 'Ingresos',     value: `$${Math.round(reservaStats.ingresos / 1000)}k`,   color: 'bg-accent-light text-accent' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-3 border border-border ${s.color}`}>
              <p className="text-xl font-black">{s.value}</p>
              <p className="text-xs opacity-70 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Calendario visual */}
        <div className="bg-surface rounded-2xl border border-border p-4">
          <h3 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
            <IconCalendar size={15} className="text-accent" /> Vista de calendario — todos los vehículos
          </h3>
          <CalendarioReservas reservas={reservas} />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-40">
            <label className="text-xs font-medium text-ink/60 block mb-1">Buscar</label>
            <input
              type="text" placeholder="Vehículo o cliente…"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={filtroBusq}
              onChange={e => setFiltroBusq(e.target.value)}
            />
          </div>
          <div className="min-w-36">
            <label className="text-xs font-medium text-ink/60 block mb-1">Estado</label>
            <select
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="confirmada">Confirmada</option>
              <option value="en_curso">En curso</option>
              <option value="completada">Completada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
        </div>

        {/* Lista de reservas */}
        <div className="space-y-3">
          {errorListas.reservas ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">No pudimos cargar las reservas. Revisa tu conexión.</p>
              <button onClick={cargarReservas} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : reservasFiltradas.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCalendar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">No hay reservas con esos filtros.</p>
            </div>
          ) : reservasFiltradas.map(r => (
            <div key={r.id} className={`bg-surface-2 rounded-2xl shadow-sm border p-4 ${
              r.estado === 'pendiente' ? 'border-warning/30 ring-1 ring-warning/40' : 'border-border'
            }`}>
              {r.estado === 'pendiente' && (
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-warning/30">
                  <span className="text-xs font-bold text-warning bg-warning/15 px-2.5 py-1 rounded-full border border-warning/25">
                    ⏳ Pendiente de aprobación
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-4 items-start justify-between">
                <div className="min-w-0">
                  <p className="font-bold text-ink">{r.marca} {r.modelo} {r.anio}</p>
                  <p className="text-sm text-ink/60 mt-0.5">
                    Cliente: <span className="font-medium text-ink">{r.usuario_nombre}</span>
                  </p>
                  {r.propietario_nombre && (
                    <p className="text-xs text-ink/50 mt-0.5">Propietario: {r.propietario_nombre}</p>
                  )}
                  <p className="text-sm text-ink/50 mt-1">
                    {r.fecha_inicio} → {r.fecha_fin}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <p className="font-bold text-accent">${r.total.toLocaleString('es-CO')}</p>
                  {r.estado !== 'pendiente' && (
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${estadoColor[r.estado] || 'bg-surface'}`}>
                      {r.estado}
                    </span>
                  )}

                  {/* Acciones para pendiente */}
                  {r.estado === 'pendiente' && (
                    <div className="w-full">
                      {rechazando?.id === r.id ? (
                        <div className="space-y-2">
                          <textarea
                            rows={2}
                            placeholder="Motivo del rechazo (opcional)…"
                            value={rechazando.nota}
                            onChange={e => setRechazando({ id: r.id, nota: e.target.value })}
                            className="w-full border border-danger/25 rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-danger/40 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              disabled={accionando === r.id}
                              onClick={() => rechazarReserva(r.id, rechazando.nota)}
                              className="flex-1 text-xs font-bold bg-danger/100 hover:bg-danger text-white px-3 py-2 rounded-xl transition disabled:opacity-50">
                              {accionando === r.id ? 'Rechazando…' : 'Confirmar rechazo'}
                            </button>
                            <button
                              onClick={() => setRechazando(null)}
                              className="text-xs border border-border text-ink/60 px-3 py-2 rounded-xl hover:bg-surface transition">
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            disabled={accionando === r.id}
                            onClick={() => aprobarReserva(r.id)}
                            className="flex items-center gap-1.5 text-xs font-bold bg-success hover:bg-success text-white px-3 py-2 rounded-xl transition disabled:opacity-50">
                            <IconCheck size={12} />
                            {accionando === r.id ? 'Aprobando…' : 'Aprobar'}
                          </button>
                          <button
                            onClick={() => setRechazando({ id: r.id, nota: '' })}
                            className="flex items-center gap-1.5 text-xs font-bold border border-danger/25 text-danger hover:bg-danger/10 px-3 py-2 rounded-xl transition">
                            <IconX size={12} /> Rechazar
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Acciones para confirmada / en_curso */}
                  {r.estado === 'confirmada' && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => cambiarEstadoReserva(r.id, 'en_curso')}
                        className="text-[11px] px-2 py-1 bg-success/15 text-success rounded-lg hover:bg-success/15 transition font-medium">
                        Iniciar
                      </button>
                      <button
                        onClick={() => cambiarEstadoReserva(r.id, 'cancelada')}
                        className="text-[11px] px-2 py-1 bg-danger/15 text-danger rounded-lg hover:bg-danger/15 transition font-medium">
                        Cancelar
                      </button>
                    </div>
                  )}
                  {r.estado === 'en_curso' && (
                    <button
                      onClick={() => cambiarEstadoReserva(r.id, 'completada')}
                      className="text-[11px] px-2 py-1 bg-brand-muted text-ink rounded-lg hover:bg-brand/10 transition font-medium">
                      Completar
                    </button>
                  )}
                  {(r.estado === 'confirmada' || r.estado === 'en_curso') && (() => {
                    let recogidaObj: { hora?: string } = {};
                    try { recogidaObj = JSON.parse(r.recogida || '{}'); } catch { recogidaObj = {}; }
                    const pickup = fechaHoraRecogida(r.fecha_inicio, recogidaObj);
                    if (!esNoShowAplicable(pickup)) return null;
                    return (
                      <button
                        disabled={accionando === r.id}
                        onClick={() => marcarNoShow(r.id)}
                        title="Ya pasaron 3h de la hora de recogida sin que el cliente llegara"
                        className="text-[11px] px-2 py-1 bg-danger text-white rounded-lg hover:bg-danger/90 transition font-bold disabled:opacity-50">
                        {accionando === r.id ? 'Marcando…' : '🚫 Marcar no-show (100%)'}
                      </button>
                    );
                  })()}
                  <button
                    onClick={() => setClienteDocs({ r })}
                    className="text-[11px] px-2 py-1 inline-flex items-center gap-1 bg-surface text-ink/60 rounded-lg hover:text-ink transition font-medium">
                    📄 Documentos del cliente
                  </button>
                  <button
                    onClick={() => verificarArrendatario(r.id, r.usuario_nombre)}
                    className="text-[11px] px-2 py-1 inline-flex items-center gap-1 bg-accent/15 text-accent rounded-lg hover:bg-accent/20 transition font-medium">
                    <IconShield size={12} /> Verificar arrendatario (IA)
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal: nueva reserva en el punto de atención (cliente presencial) */}
      {nuevaReservaAbierta && (
        <ReservaMostradorModal
          vehiculos={vehiculos}
          onClose={() => setNuevaReservaAbierta(false)}
          onCreada={info => {
            setNuevaReservaAbierta(false);
            setReservaMostradorAviso(info.activacion_pendiente);
            setReservaMostradorMsg(
              `Reserva #${info.id} creada, confirmada y pagada.` +
              (info.cuenta_creada ? ' Se creó la cuenta del cliente.' : '') +
              (info.activacion_enviada ? ' Le enviamos a su correo el enlace para crear su contraseña.' : '') +
              // El servidor solo marca `activacion_enviada` si el correo SALIÓ de verdad.
              // Si falló, se le dice al empleado en vez de prometerle al cliente un
              // correo que nunca llegó (el cliente puede pedirlo solo desde
              // "¿Olvidaste tu contraseña?"; nadie del equipo ve ni toca el enlace).
              (info.activacion_pendiente
                ? ' OJO: no se pudo enviar el correo con el enlace para crear su contraseña. Dile que entre a "¿Olvidaste tu contraseña?" con su correo.'
                : '')
            );
            cargarReservas();
          }}
        />
      )}


      {/* Modal documentos del cliente (arrendatario) */}
      {clienteDocs && (() => {
        const r = clienteDocs.r;
        const dId = r.documentos_id || {};
        const docs: { label: string; doc?: DocumentoDisponible }[] = [
          { label: r.documento_es_pasaporte ? 'Pasaporte' : 'Documento de identidad (frente)', doc: dId.documento_frente },
          ...(r.documento_es_pasaporte ? [] : [{ label: 'Documento de identidad (dorso)', doc: dId.documento_dorso }]),
          { label: 'Licencia de conducción (frente)', doc: dId.licencia_frente },
          { label: 'Licencia de conducción (dorso)', doc: dId.licencia_dorso },
        ];
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setClienteDocs(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h3 className="font-bold text-ink">Documentos del cliente</h3>
                  <p className="text-xs text-ink/50 mt-0.5">{r.usuario_nombre} · {r.marca} {r.modelo}</p>
                </div>
                <button onClick={() => setClienteDocs(null)} aria-label="Cerrar" className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                  <IconX size={18} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {docs.map(d => {
                  // La dirección es siempre del propio sitio y la resuelve el servidor.
                  const src = d.doc ? rutaDocumento(d.doc.ambito, d.doc.id, d.doc.clave) : '';
                  return (
                    <div key={d.label} className="bg-surface rounded-2xl p-3 border border-border">
                      <p className="text-[11px] font-semibold text-ink/50 uppercase tracking-wide mb-2">{d.label}</p>
                      {d.doc && src ? (
                        d.doc.pdf ? (
                          <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-accent hover:underline">📄 Ver PDF</a>
                        ) : (
                          <a href={src} target="_blank" rel="noopener noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={d.label} className="w-full max-h-56 object-contain rounded-lg border border-border hover:opacity-90 transition" />
                            <span className="text-[11px] text-ink/50 mt-1 inline-block">Clic para ampliar</span>
                          </a>
                        )
                      ) : (
                        <p className="text-sm text-ink/50">No subido.</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Paquete completo del CLIENTE: además de los documentos de esta reserva,
                  trae los de su perfil y los de sus otras reservas en un solo .zip. */}
              {r.usuario_id ? (
                <div className="mt-4 pt-4 border-t border-border">
                  <BotonPaqueteDocumentos
                    endpoint={`/api/admin/usuarios/${r.usuario_id}/paquete`}
                    autoInfo
                    nota="Todos los documentos de este cliente (perfil y reservas). Queda registrado en la Bitácora."
                  />
                </div>
              ) : null}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => { setClienteDocs(null); verificarArrendatario(r.id, r.usuario_nombre); }}
                  className="text-sm inline-flex items-center gap-1.5 bg-accent/15 text-accent px-3.5 py-2 rounded-xl font-semibold hover:bg-accent/20 transition">
                  <IconShield size={15} /> Verificar con IA
                </button>
              </div>
            </div>
          </div>
        );
      })()}


      {/* Modal verificación del arrendatario con IA */}
      {arrIa && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !arrIaCargando && setArrIa(null)}>
          <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="font-bold text-ink flex items-center gap-2"><IconShield size={18} /> Verificación del arrendatario</h3>
                <p className="text-xs text-ink/50 mt-0.5">{arrIa.nombre} · Cédula y licencia de conducción</p>
              </div>
              <button onClick={() => !arrIaCargando && setArrIa(null)} aria-label="Cerrar" className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                <IconX size={18} />
              </button>
            </div>

            {arrIaCargando ? (
              <div className="text-center py-12 text-ink/50">
                <span className="inline-block w-7 h-7 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
                <p className="text-sm">Analizando cédula y licencia con IA…</p>
              </div>
            ) : arrIa.error ? (
              <div className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">{arrIa.error}</div>
            ) : arrIa.res ? (
              <>
                <ResultadoIA res={arrIa.res} />
                <p className="text-[11px] text-ink/50 leading-relaxed mt-3">
                  Verifica vigencia de la licencia, categoría apta para automóvil y que el nombre de la licencia coincida con la cédula. La decisión final es humana.
                </p>
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
