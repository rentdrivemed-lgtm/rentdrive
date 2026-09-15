'use client';
// Reserva en el PUNTO DE ATENCIÓN ("mostrador").
//
// El cliente llega físicamente a la oficina: el empleado lo busca (o le crea la
// cuenta), elige el carro y las fechas, le escanea cédula y licencia, registra el
// pago recibido y la reserva nace confirmada y pagada.
//
// Consume dos endpoints nuevos:
//   · GET  /api/admin/clientes?q=  → buscar al titular por cédula o correo
//   · POST /api/admin/reservas     → crear la reserva (y la cuenta, si hace falta)
// Ambos exigen la sección "reservas" (nivel secretaria incluido). Este formulario
// NO valida nada que el servidor no revalide: lo de acá es solo para dar feedback.
//
// Solo importa módulos puros (lib/lugares, lib/validacion): lib/reserva-core.ts es
// server-only (toca better-sqlite3/fs) y no puede entrar a un componente 'use client'.
import { useEffect, useState } from 'react';
import CalendarioReserva from '@/components/CalendarioReserva';
import LugarSelector from '@/components/LugarSelector';
import DocUploadDoble from '@/components/DocUploadDoble';
import TelefonoInput from '@/components/TelefonoInput';
import { IconX, IconUser, IconCheck } from '@/components/Icons';
import { LUGAR_VACIO, calcularRecargo, calcularDiasAlquiler, calcularTotalAlquiler, type Lugar } from '@/lib/lugares';
import { PAIS_TEL_DEFAULT } from '@/lib/validacion';

export type VehiculoMostrador = {
  id: number; marca: string; modelo: string; anio: number;
  precio_dia: number; disponible: number; placa?: string;
  combustible?: string; exencion_pico_placa_inscrita?: number;
};

// Lo que devuelve GET /api/admin/clientes. Del cliente encontrado NO llega el nombre
// ni el correo completos a propósito (ver el comentario de esa ruta): con la persona
// enfrente, iniciales + últimos 4 del documento y del celular confirman de sobra que
// la cuenta es la suya, y el endpoint deja de servir para traducir una lista de
// cédulas filtradas en identidades con buzón.
type ClienteEncontrado = {
  id: number;
  nombre_iniciales: string; correo_pista: string;
  documento_pista: string; celular_pista: string;
  motivo_no_reservable: string;
  faltan_perfil: string[];
  sin_contrasena: boolean;
  faltan_datos_operacion: boolean;
};

// Espejo de METODOS_PAGO (lib/reserva-core.ts). La fuente de verdad es el servidor,
// que rechaza cualquier valor fuera de esta lista; acá solo se pintan las opciones.
const METODOS_PAGO: { valor: string; label: string }[] = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'transferencia', label: 'Transferencia / Nequi / Bancolombia' },
  { valor: 'datafono', label: 'Datáfono (tarjeta)' },
  { valor: 'otro', label: 'Otro' },
];

const TIPOS_DOC = [
  { valor: 'cedula', label: 'Cédula de ciudadanía' },
  { valor: 'cedula_ext', label: 'Cédula de extranjería' },
  { valor: 'pasaporte', label: 'Pasaporte' },
];

const inputCls = 'w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40';
const labelCls = 'text-[11px] font-semibold text-ink/60 block mb-1 uppercase tracking-wide';

function Seccion({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface rounded-2xl border border-border p-4">
      <h4 className="font-bold text-ink text-sm mb-3 flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-accent/15 text-accent text-[11px] font-black flex items-center justify-center">{n}</span>
        {titulo}
      </h4>
      {children}
    </section>
  );
}

export default function ReservaMostradorModal({
  vehiculos, onClose, onCreada,
}: {
  vehiculos: VehiculoMostrador[];
  onClose: () => void;
  onCreada: (info: { id: number; cuenta_creada: boolean; activacion_enviada: boolean; activacion_pendiente: boolean }) => void;
}) {
  // ── Cliente ──
  const [busqueda, setBusqueda] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [cliente, setCliente] = useState<ClienteEncontrado | null>(null);

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const [nuevoTipoDoc, setNuevoTipoDoc] = useState('cedula');
  const [nuevoDoc, setNuevoDoc] = useState('');
  const [nuevoNacimiento, setNuevoNacimiento] = useState('');
  const [nuevoIndicativo, setNuevoIndicativo] = useState(PAIS_TEL_DEFAULT);
  const [nuevoCelular, setNuevoCelular] = useState('');

  // ── Vehículo y fechas ──
  const [vehiculoId, setVehiculoId] = useState('');
  const [ocupadas, setOcupadas] = useState<string[]>([]);
  const [diasDisponibles, setDiasDisponibles] = useState<string[]>([]);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [recogida, setRecogida] = useState<Lugar>({ ...LUGAR_VACIO });
  const [entrega, setEntrega] = useState<Lugar>({ ...LUGAR_VACIO });

  // ── Datos de la operación ──
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('Medellín');
  const [emNombre, setEmNombre] = useState('');
  const [emTel, setEmTel] = useState('');

  // ── Documentos ──
  const [docIdUrl, setDocIdUrl] = useState('');
  const [docIdUrlDorso, setDocIdUrlDorso] = useState('');
  const [esPasaporte, setEsPasaporte] = useState(false);
  const [licenciaUrl, setLicenciaUrl] = useState('');
  const [licenciaUrlDorso, setLicenciaUrlDorso] = useState('');

  // ── Pago y contrato ──
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [pagoReferencia, setPagoReferencia] = useState('');
  const [contratoAceptado, setContratoAceptado] = useState(false);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const vehiculo = vehiculos.find(v => String(v.id) === vehiculoId) || null;

  // Calendario del vehículo elegido: días ya ocupados por otras reservas y días que
  // el propietario dejó abiertos. Es exactamente lo que valida el servidor (409),
  // así que mostrarlo acá evita que el empleado elija fechas que van a ser rechazadas.
  // (el reseteo al cambiar de vehículo se hace en el onChange del <select>, no aquí:
  // llamar setState de forma síncrona en el cuerpo del efecto dispara renders en cascada)
  useEffect(() => {
    if (!vehiculoId) return;
    let vivo = true;
    fetch(`/api/vehiculos/${vehiculoId}`)
      .then(r => r.json())
      .then(d => {
        if (!vivo) return;
        setOcupadas(d.ocupadas || []);
        let dd: string[] = [];
        try { dd = JSON.parse(d.vehiculo?.dias_disponibles || '[]'); } catch { dd = []; }
        setDiasDisponibles(dd);
      })
      .catch(() => { if (vivo) { setOcupadas([]); setDiasDisponibles([]); } });
    return () => { vivo = false; };
  }, [vehiculoId]);

  const buscarCliente = async () => {
    setError(''); setBuscando(true); setBuscado(false); setCliente(null);
    try {
      const res = await fetch(`/api/admin/clientes?q=${encodeURIComponent(busqueda.trim())}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'No se pudo buscar al cliente.'); return; }
      setBuscado(true);
      if (d.encontrado) {
        setCliente(d.cliente);
      } else {
        // Precarga lo que el empleado ya escribió: si buscó por correo, ese es el
        // correo; si buscó por cédula, ese es el documento.
        if (busqueda.includes('@')) setNuevoCorreo(busqueda.trim().toLowerCase());
        else setNuevoDoc(busqueda.trim());
      }
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setBuscando(false);
    }
  };

  const reiniciarCliente = () => {
    setCliente(null); setBuscado(false); setBusqueda('');
    setNuevoNombre(''); setNuevoCorreo(''); setNuevoDoc(''); setNuevoNacimiento(''); setNuevoCelular('');
  };

  // Al cliente nuevo siempre hay que pedirle los datos de la operación; al existente,
  // solo si no los tiene (o los tiene inválidos según las reglas de hoy).
  const esClienteNuevo = buscado && !cliente;
  const pedirDatosOperacion = esClienteNuevo || !!cliente?.faltan_datos_operacion;
  const faltaPerfil = cliente?.faltan_perfil ?? [];

  const dias = fechaInicio && fechaFin ? calcularDiasAlquiler(fechaInicio, fechaFin) : 0;
  const recargo = calcularRecargo(recogida, entrega);
  const total = vehiculo && dias > 0 ? calcularTotalAlquiler(dias, vehiculo.precio_dia, recargo) : 0;

  const crear = async () => {
    setError(''); setGuardando(true);
    try {
      const payload: Record<string, unknown> = {
        vehiculo_id: Number(vehiculoId),
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        documento_id_url: docIdUrl,
        documento_id_url_dorso: docIdUrlDorso,
        documento_es_pasaporte: esPasaporte,
        licencia_url: licenciaUrl,
        licencia_url_dorso: licenciaUrlDorso,
        recogida, entrega,
        direccion, ciudad, emergencia_nombre: emNombre, emergencia_tel: emTel,
        contrato_aceptado_presencial: contratoAceptado,
        metodo_pago: metodoPago,
        pago_referencia: pagoReferencia,
      };
      if (cliente) {
        payload.usuario_id = cliente.id;
        if (faltaPerfil.length > 0) {
          payload.cliente_datos = {
            tipo_documento: nuevoTipoDoc,
            documento_identidad: nuevoDoc,
            fecha_nacimiento: nuevoNacimiento,
          };
        }
      } else {
        payload.cliente_nuevo = {
          nombre: nuevoNombre, correo: nuevoCorreo,
          tipo_documento: nuevoTipoDoc, documento_identidad: nuevoDoc,
          fecha_nacimiento: nuevoNacimiento,
          celular: nuevoCelular, celular_indicativo: nuevoIndicativo,
        };
      }
      const res = await fetch('/api/admin/reservas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'No se pudo crear la reserva.'); return; }
      onCreada({
        id: d.id, cuenta_creada: !!d.cuenta_creada,
        activacion_enviada: !!d.activacion_enviada, activacion_pendiente: !!d.activacion_pendiente,
      });
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const clienteListo = !!cliente ? !cliente.motivo_no_reservable : (esClienteNuevo && !!nuevoNombre && !!nuevoCorreo && !!nuevoDoc && !!nuevoNacimiento && !!nuevoCelular);
  const docsListos = !!docIdUrl && (esPasaporte || !!docIdUrlDorso) && !!licenciaUrl && !!licenciaUrlDorso;
  const puedeCrear = clienteListo && !!vehiculoId && !!fechaInicio && !!fechaFin && docsListos && contratoAceptado && !guardando;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !guardando && onClose()}>
      <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-2xl w-full p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-5">
          <div>
            <h3 className="font-bold text-ink">Nueva reserva en el punto de atención</h3>
            <p className="text-xs text-ink/50 mt-0.5">
              Para un cliente que está en la oficina. Queda confirmada y pagada de inmediato.
            </p>
          </div>
          <button onClick={() => !guardando && onClose()} aria-label="Cerrar"
            className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
            <IconX size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* ── 1. Cliente ── */}
          <Seccion n={1} titulo="Cliente titular">
            {!cliente && !esClienteNuevo && (
              <>
                <label className={labelCls}>Buscar por cédula o correo</label>
                <div className="flex gap-2">
                  <input
                    className={inputCls} value={busqueda}
                    placeholder="1036… o cliente@correo.com"
                    onChange={e => setBusqueda(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarCliente(); } }}
                  />
                  <button
                    onClick={buscarCliente} disabled={buscando || busqueda.trim().length < 4}
                    className="bg-accent hover:bg-accent-hover text-white font-bold px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-50 flex-shrink-0">
                    {buscando ? 'Buscando…' : 'Buscar'}
                  </button>
                </div>
                <p className="text-[11px] text-ink/45 mt-1.5">
                  La búsqueda es exacta: escribe el número de documento completo o el correo tal cual.
                </p>
              </>
            )}

            {cliente && (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3 bg-surface-2 border border-border rounded-2xl p-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink text-sm flex items-center gap-1.5">
                      <IconUser size={13} className="text-accent" /> {cliente.nombre_iniciales || 'Cuenta encontrada'}
                    </p>
                    <p className="text-xs text-ink/60 mt-0.5 break-all">{cliente.correo_pista}</p>
                    <p className="text-[11px] text-ink/45 mt-0.5">
                      Documento {cliente.documento_pista || '—'} · Celular {cliente.celular_pista || '—'}
                    </p>
                    <p className="text-[11px] text-ink/40 mt-1">
                      Los datos van enmascarados: confírmalos contra el documento físico del cliente.
                    </p>
                  </div>
                  <button onClick={reiniciarCliente}
                    className="text-[11px] border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface transition flex-shrink-0">
                    Cambiar
                  </button>
                </div>
                {cliente.motivo_no_reservable && (
                  <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
                    {cliente.motivo_no_reservable}
                  </p>
                )}
                {cliente.sin_contrasena && !cliente.motivo_no_reservable && (
                  <p className="text-[11px] text-ink/55 bg-surface-2 border border-border rounded-xl px-3 py-2">
                    Esta cuenta aún no tiene contraseña. Al confirmar, le enviamos al cliente un enlace a su correo para que la cree.
                  </p>
                )}
                {faltaPerfil.length > 0 && !cliente.motivo_no_reservable && (
                  <div className="space-y-2 pt-1">
                    <p className="text-[11px] text-warning bg-warning/10 border border-warning/25 rounded-xl px-3 py-2">
                      A esta cuenta le faltan datos obligatorios para facturar. Complétalos con el documento del cliente a la vista.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Tipo de documento</label>
                        <select className={inputCls} value={nuevoTipoDoc} onChange={e => setNuevoTipoDoc(e.target.value)}>
                          {TIPOS_DOC.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Número de documento</label>
                        <input className={inputCls} value={nuevoDoc} onChange={e => setNuevoDoc(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelCls}>Fecha de nacimiento</label>
                        <input type="date" className={inputCls} value={nuevoNacimiento} onChange={e => setNuevoNacimiento(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {esClienteNuevo && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-ink/60 bg-brand-muted border border-border rounded-xl px-3 py-2">
                    No existe una cuenta con ese dato. Se le crea ahora al cliente (rol cliente) y se le envía a su correo un enlace para que fije su contraseña.
                  </p>
                  <button onClick={reiniciarCliente}
                    className="text-[11px] border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface transition flex-shrink-0">
                    Buscar otro
                  </button>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nombre completo</label>
                    <input className={inputCls} value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} placeholder="Como aparece en la cédula" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Correo</label>
                    <input type="email" className={inputCls} value={nuevoCorreo} onChange={e => setNuevoCorreo(e.target.value)} placeholder="cliente@correo.com" />
                  </div>
                  <div>
                    <label className={labelCls}>Tipo de documento</label>
                    <select className={inputCls} value={nuevoTipoDoc} onChange={e => setNuevoTipoDoc(e.target.value)}>
                      {TIPOS_DOC.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Número de documento</label>
                    <input className={inputCls} value={nuevoDoc} onChange={e => setNuevoDoc(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Fecha de nacimiento</label>
                    <input type="date" className={inputCls} value={nuevoNacimiento} onChange={e => setNuevoNacimiento(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Celular</label>
                    <TelefonoInput
                      indicativo={nuevoIndicativo} numero={nuevoCelular}
                      onChangeIndicativo={setNuevoIndicativo} onChangeNumero={setNuevoCelular}
                    />
                  </div>
                </div>
              </div>
            )}
          </Seccion>

          {/* ── 2. Vehículo y fechas ── */}
          <Seccion n={2} titulo="Vehículo y fechas">
            <label className={labelCls}>Vehículo</label>
            <select className={inputCls} value={vehiculoId} onChange={e => {
              setVehiculoId(e.target.value);
              setFechaInicio(''); setFechaFin('');
              setOcupadas([]); setDiasDisponibles([]);
            }}>
              <option value="">Selecciona el vehículo…</option>
              {vehiculos.filter(v => v.disponible === 1).map(v => (
                <option key={v.id} value={v.id}>
                  {v.marca} {v.modelo} {v.anio}{v.placa ? ` · ${v.placa}` : ''} — ${v.precio_dia.toLocaleString('es-CO')}/día
                </option>
              ))}
            </select>

            {vehiculo && (
              <div className="mt-3">
                <CalendarioReserva
                  availableDates={diasDisponibles}
                  reservedDates={ocupadas}
                  placa={vehiculo.placa}
                  combustible={vehiculo.combustible}
                  exencionInscrita={vehiculo.exencion_pico_placa_inscrita}
                  inicio={fechaInicio}
                  fin={fechaFin}
                  onChange={(i, f) => { setFechaInicio(i); setFechaFin(f); setError(''); }}
                />
                <div className="mt-4 space-y-4 pt-3 border-t border-border">
                  <LugarSelector label="Recogida" value={recogida} onChange={setRecogida} />
                  <LugarSelector label="Entrega" value={entrega} onChange={setEntrega} tone="brand" />
                </div>
              </div>
            )}
          </Seccion>

          {/* ── 3. Datos de la operación ── */}
          {pedirDatosOperacion && (
            <Seccion n={3} titulo="Datos del cliente para la operación">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Dirección de residencia</label>
                  <input className={inputCls} value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Calle 10 # 43-20, apto 302" />
                </div>
                <div>
                  <label className={labelCls}>Ciudad</label>
                  <input className={inputCls} value={ciudad} onChange={e => setCiudad(e.target.value)} />
                </div>
                <div />
                <div>
                  <label className={labelCls}>Contacto de emergencia</label>
                  <input className={inputCls} value={emNombre} onChange={e => setEmNombre(e.target.value)} placeholder="Nombre" />
                </div>
                <div>
                  <label className={labelCls}>Teléfono de emergencia</label>
                  <input className={inputCls} inputMode="numeric" value={emTel} onChange={e => setEmTel(e.target.value)} placeholder="3001234567" />
                </div>
              </div>
            </Seccion>
          )}

          {/* ── 4. Documentos ── */}
          <Seccion n={pedirDatosOperacion ? 4 : 3} titulo="Documentos del cliente">
            <label className="flex items-center gap-2 mb-3 text-xs text-ink/60">
              <input type="checkbox" checked={esPasaporte} onChange={e => setEsPasaporte(e.target.checked)} className="accent-[var(--accent)]" />
              El documento de identidad es un pasaporte (no tiene dorso)
            </label>
            <div className="space-y-3">
              <DocUploadDoble
                label={esPasaporte ? 'Pasaporte' : 'Documento de identidad'}
                valueFrente={docIdUrl} valueDorso={docIdUrlDorso}
                onChangeFrente={setDocIdUrl} onChangeDorso={setDocIdUrlDorso}
                soloUnLado={esPasaporte} required soloImagen
              />
              <DocUploadDoble
                label="Licencia de conducción"
                valueFrente={licenciaUrl} valueDorso={licenciaUrlDorso}
                onChangeFrente={setLicenciaUrl} onChangeDorso={setLicenciaUrlDorso}
                required soloImagen
              />
            </div>
          </Seccion>

          {/* ── 5. Pago ── */}
          <Seccion n={pedirDatosOperacion ? 5 : 4} titulo="Pago recibido">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Medio de pago</label>
                <select className={inputCls} value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
                  {METODOS_PAGO.map(m => <option key={m.valor} value={m.valor}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Referencia / recibo (opcional)</label>
                <input className={inputCls} value={pagoReferencia} onChange={e => setPagoReferencia(e.target.value)} placeholder="N.º de aprobación, recibo…" />
              </div>
            </div>

            {vehiculo && dias > 0 && (
              <div className="mt-3 bg-surface-2 border border-border rounded-2xl p-3 text-sm">
                <div className="flex justify-between text-ink/60">
                  <span>{dias} día{dias !== 1 ? 's' : ''} × ${vehiculo.precio_dia.toLocaleString('es-CO')}</span>
                  <span>${(dias * vehiculo.precio_dia).toLocaleString('es-CO')}</span>
                </div>
                {recargo > 0 && (
                  <div className="flex justify-between text-ink/60 mt-1">
                    <span>Recargo por lugar</span>
                    <span>${recargo.toLocaleString('es-CO')}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-ink mt-2 pt-2 border-t border-border">
                  <span>Total a cobrar</span>
                  <span className="text-accent">${total.toLocaleString('es-CO')}</span>
                </div>
                <p className="text-[11px] text-ink/45 mt-1.5">
                  El total definitivo lo calcula el servidor (incluye créditos de referido si aplican).
                </p>
              </div>
            )}
          </Seccion>

          {/* ── 6. Contrato ── */}
          <Seccion n={pedirDatosOperacion ? 6 : 5} titulo="Contrato">
            <label className="flex items-start gap-2 text-xs text-ink/70">
              <input type="checkbox" checked={contratoAceptado} onChange={e => setContratoAceptado(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>
                Confirmo que el cliente <b>aceptó el contrato de alquiler</b> en el punto de atención.
                Queda registrado en la reserva con mi nombre y la fecha/hora.
              </span>
            </label>
          </Seccion>

          {error && (
            <p className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => !guardando && onClose()}
              className="px-4 py-2.5 border border-border rounded-xl text-sm text-ink/60 hover:bg-surface transition font-medium">
              Cancelar
            </button>
            <button onClick={crear} disabled={!puedeCrear}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white font-bold px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-50">
              {guardando ? 'Creando…' : <><IconCheck size={14} /> Crear reserva confirmada</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
