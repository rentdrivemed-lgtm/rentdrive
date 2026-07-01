'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CalendarioReservas, { type ReservaCalendario } from '@/components/CalendarioReservas';
import OperacionesPanel from '@/components/OperacionesPanel';
import PicoPlacaConfig from '@/components/PicoPlacaConfig';
import { parsePicoPlaca, picoPlacaVacio, placaRestringida, type PicoPlaca } from '@/lib/pico-placa';
import { IconUser, IconCar, IconX, IconCheck, IconCalendar, IconShield } from '@/components/Icons';
import type { VerificacionResultado } from '@/lib/verificacion-docs';

type Usuario = {
  id: number; nombre: string; correo: string;
  rol: string; estado_cuenta: string; created_at: string;
  tipo_documento?: string; documento_identidad?: string;
  fecha_nacimiento?: string; celular?: string;
  direccion?: string; ciudad?: string;
  numero_licencia?: string; contacto_emergencia?: string;
  cedula_url?: string;
};
type DocItem = { url: string; vence?: string };
type Documentos = {
  soat?: DocItem;
  tecno?: DocItem;
  tarjeta?: { url: string };
  todo_riesgo?: { url: string; aseguradora?: string; poliza?: string; vence?: string };
};

type DocRevision = { estado: string; nota: string };

type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number; tipo: string;
  precio_dia: number; propietario_id: number; propietario_nombre: string; disponible: number;
  fotos: string; fotos_detalle: string; placa?: string; documentos?: string;
  documentos_estado?: string; documentos_nota?: string; documentos_revisiones?: string;
};

const rolColor: Record<string, string> = {
  admin:       'bg-accent/10 text-accent',
  propietario: 'bg-brand-muted text-ink',
  usuario:     'bg-surface text-ink/60',
};
const estadoColor: Record<string, string> = {
  pendiente:  'bg-warning/15 text-warning',
  confirmada: 'bg-brand-muted text-ink',
  en_curso:   'bg-success/15 text-success',
  completada: 'bg-surface text-ink/50',
  cancelada:  'bg-danger/15 text-danger',
};
const FOTOS_LABELS: Record<string, string> = {
  lado_izquierdo: 'Lado izq.', lado_derecho: 'Lado der.',
  frente: 'Frente', trasera: 'Trasera',
  cojineria: 'Cojinería', baul: 'Baúl', tablero: 'Tablero',
};

const DOC_KEYS = ['soat', 'tecno', 'tarjeta', 'todo_riesgo'] as const;
const DOC_LABELS: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad', todo_riesgo: 'Seguro todo riesgo',
};

function computeDocEstado(docs: Record<string, { url?: string } | undefined>, revs: Record<string, DocRevision>): string {
  const uploaded = DOC_KEYS.filter(k => (docs[k] as { url?: string } | undefined)?.url);
  if (uploaded.length === 0) return 'sin_documentos';
  if (uploaded.some(k => revs[k]?.estado === 'denegado')) return 'denegado';
  if (uploaded.every(k => revs[k]?.estado === 'aprobado')) return 'aprobado';
  return 'en_revision';
}

function calcularEdad(fechaNac: string) {
  if (!fechaNac) return null;
  const hoy = new Date();
  const nac = new Date(fechaNac);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

const TIPO_DOC_LABELS: Record<string, string> = {
  cedula: 'Cédula de ciudadanía',
  pasaporte: 'Pasaporte',
  extranjeria: 'Cédula de extranjería',
};

// ── Verificador con IA: mapas y render reutilizable ──────────────────
const VEREDICTO_BADGE: Record<string, string> = {
  aprobado:  'bg-success/15 text-success border-success/30',
  rechazado: 'bg-danger/15 text-danger border-danger/25',
  revision:  'bg-warning/15 text-warning border-warning/25',
};
const VEREDICTO_LABEL: Record<string, string> = {
  aprobado: 'Aprobado', rechazado: 'Rechazado', revision: 'Requiere revisión',
};
const CONFIANZA_LABEL: Record<string, string> = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' };
const CHEQUEO_ICON: Record<string, string> = { pasa: '✓', falla: '✕', no_aplica: '–' };
const CHEQUEO_COLOR: Record<string, string> = { pasa: 'text-success', falla: 'text-danger', no_aplica: 'text-ink/40' };

function ResultadoIA({ res, auto }: { res: VerificacionResultado; auto?: string[] }) {
  return (
    <div className="space-y-3">
      {/* Resumen global */}
      <div className="glass rounded-2xl p-4 border border-border/60">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">Veredicto de la IA</span>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${VEREDICTO_BADGE[res.veredicto_global] || VEREDICTO_BADGE.revision}`}>
            {VEREDICTO_LABEL[res.veredicto_global] || res.veredicto_global}
          </span>
        </div>
        <p className="text-sm text-ink/70 leading-relaxed">{res.resumen}</p>
        {auto && auto.length > 0 && (
          <p className="text-xs text-success mt-2 flex items-center gap-1.5">
            <IconCheck size={14} /> Auto-aprobados por alta confianza: {auto.map(k => DOC_LABELS[k] || k).join(', ')}
          </p>
        )}
      </div>

      {/* Documentos analizados */}
      {res.documentos.map((doc, i) => {
        const datos = doc.datos_extraidos;
        const filasDatos: [string, string | null][] = [
          ['Placa', datos.placa],
          ['Documento', datos.numero_documento],
          ['Titular', datos.nombre_titular],
          ['Expedición', datos.fecha_expedicion],
          ['Vencimiento', datos.fecha_vencimiento],
          ['Entidad', datos.entidad_emisora],
          ['Categoría', datos.categoria_licencia],
        ];
        return (
          <div key={i} className="bg-surface rounded-2xl p-4 border border-border/60">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <p className="text-sm font-semibold text-ink">{doc.etiqueta}</p>
                {doc.tipo_detectado && <p className="text-[11px] text-ink/40">Detectado: {doc.tipo_detectado}{!doc.es_legible && ' · ilegible'}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-ink/40">{CONFIANZA_LABEL[doc.confianza] || doc.confianza}</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${VEREDICTO_BADGE[doc.veredicto] || VEREDICTO_BADGE.revision}`}>
                  {VEREDICTO_LABEL[doc.veredicto] || doc.veredicto}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2.5">
              {filasDatos.filter(([, val]) => val).map(([et, val]) => (
                <div key={et} className="text-[11px] flex gap-1.5 min-w-0">
                  <span className="text-ink/40 shrink-0">{et}:</span>
                  <span className="text-ink/80 truncate">{val}</span>
                </div>
              ))}
            </div>

            {doc.verificaciones.length > 0 && (
              <ul className="space-y-1 mb-2">
                {doc.verificaciones.map((c, j) => (
                  <li key={j} className="text-xs flex items-start gap-1.5">
                    <span className={`${CHEQUEO_COLOR[c.resultado] || 'text-ink/40'} font-bold leading-5`}>{CHEQUEO_ICON[c.resultado] || '·'}</span>
                    <span className="text-ink/70"><span className="text-ink/90">{c.regla}.</span> {c.detalle}</span>
                  </li>
                ))}
              </ul>
            )}
            {doc.motivo && <p className="text-[11px] text-ink/50 italic">{doc.motivo}</p>}
          </div>
        );
      })}

      {/* Cruces entre documentos */}
      {res.cruces.length > 0 && (
        <div className="bg-surface rounded-2xl p-4 border border-border/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-2">Cruces entre documentos</p>
          <ul className="space-y-1">
            {res.cruces.map((c, j) => (
              <li key={j} className="text-xs flex items-start gap-1.5">
                <span className={`${CHEQUEO_COLOR[c.resultado] || 'text-ink/40'} font-bold leading-5`}>{CHEQUEO_ICON[c.resultado] || '·'}</span>
                <span className="text-ink/70"><span className="text-ink/90">{c.regla}.</span> {c.detalle}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function DashboardAdmin() {
  const [tab, setTab] = useState<'usuarios' | 'vehiculos' | 'reservas' | 'operaciones' | 'pagos' | 'config'>('usuarios');
  const [picoPlaca, setPicoPlaca] = useState<PicoPlaca>(picoPlacaVacio());
  const [usuarios, setUsuarios]   = useState<Usuario[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [reservas, setReservas]   = useState<ReservaCalendario[]>([]);
  const [precioEdit, setPrecioEdit] = useState<Record<number, string>>({});
  const [fotoModal, setFotoModal] = useState<{ v: Vehiculo } | null>(null);
  const [docModal, setDocModal] = useState<{ v: Vehiculo } | null>(null);
  const [docNota, setDocNota] = useState('');
  const [docGuardando, setDocGuardando] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroBusq, setFiltroBusq] = useState('');
  const [perfilModal, setPerfilModal] = useState<{ u: Usuario } | null>(null);
  const [clienteDocs, setClienteDocs] = useState<{ r: ReservaCalendario & { documento_id_url?: string; licencia_url?: string } } | null>(null);
  const [rechazando, setRechazando] = useState<{ id: number; nota: string } | null>(null);
  const [accionando, setAccionando] = useState<number | null>(null);
  const [docRevisiones, setDocRevisiones] = useState<Record<string, DocRevision>>({});
  const [iaVerif, setIaVerif] = useState<{ vid: number; res: VerificacionResultado; auto: string[] } | null>(null);
  const [iaCargando, setIaCargando] = useState(false);
  const [iaError, setIaError] = useState('');
  const [arrIa, setArrIa] = useState<{ rid: number; nombre: string; res?: VerificacionResultado; error?: string } | null>(null);
  const [arrIaCargando, setArrIaCargando] = useState(false);
  const [revisandoDoc, setRevisandoDoc] = useState<{ key: string; nota: string } | null>(null);
  const [docAccionando, setDocAccionando] = useState<string | null>(null);

  // ── Pagos ──────────────────────────────────────────────────────────────────
  type PagoGrupo = {
    propietario_id: number; propietario_nombre: string; propietario_correo: string;
    banco: string; numero_cuenta: string; total_pendiente: number;
    reservas: Array<{ reserva_id: number; marca: string; modelo: string; anio: number; fecha_inicio: string; fecha_fin: string; total: number; usuario_nombre: string }>;
  };
  const [pagos, setPagos] = useState<PagoGrupo[]>([]);
  const [pagosTotalGeneral, setPagosTotalGeneral] = useState(0);
  const [pagosLoading, setPagosLoading] = useState(false);
  const [pagandoIds, setPagandoIds] = useState<Set<number>>(new Set());
  const [pagoMsg, setPagoMsg] = useState('');
  const [pagoComprobante, setPagoComprobante] = useState('');

  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.rol !== 'admin') { router.push('/login'); return; }
    });
    cargarUsuarios();
    cargarVehiculos();
    cargarReservas();
    fetch('/api/config').then(r => r.json()).then(d => setPicoPlaca(parsePicoPlaca(d.config?.pico_placa || ''))).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (tab === 'pagos') cargarPagos();
  }, [tab]);

  const cargarUsuarios = () =>
    fetch('/api/admin/usuarios').then(r => r.json()).then(d => setUsuarios(d.usuarios || []));

  const cargarVehiculos = () =>
    fetch('/api/vehiculos').then(r => r.json()).then(d => setVehiculos(d.vehiculos || []));

  const cargarReservas = () =>
    fetch('/api/reservas').then(r => r.json()).then(d => setReservas(d.reservas || []));

  const cargarPagos = () => {
    setPagosLoading(true);
    fetch('/api/pagos?pago_estado=pendiente')
      .then(r => r.json())
      .then(d => {
        setPagos(d.por_propietario || []);
        setPagosTotalGeneral(d.total_general || 0);
      })
      .catch(() => {})
      .finally(() => setPagosLoading(false));
  };

  const toggleEstado = async (u: Usuario) => {
    const nuevo = u.estado_cuenta === 'activa' ? 'inactiva' : 'activa';
    await fetch('/api/admin/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, estado_cuenta: nuevo }),
    });
    setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, estado_cuenta: nuevo } : x));
  };

  const guardarPrecio = async (vid: number) => {
    const precio = Number(precioEdit[vid]);
    if (!precio || precio <= 0) return;
    await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ precio_dia: precio }),
    });
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, precio_dia: precio } : v));
    setPrecioEdit(p => { const n = { ...p }; delete n[vid]; return n; });
  };

  const abrirDocModal = (v: Vehiculo) => {
    setDocNota(v.documentos_nota || '');
    let revs: Record<string, DocRevision> = {};
    try { revs = JSON.parse(v.documentos_revisiones || '{}'); } catch { /* */ }
    setDocRevisiones(revs);
    setRevisandoDoc(null);
    setDocAccionando(null);
    setIaVerif(null);
    setIaError('');
    setIaCargando(false);
    setDocModal({ v });
  };

  const revisarDocIndividual = async (vid: number, key: string, estado: string, nota: string) => {
    setDocAccionando(key);
    const res = await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisar_documento: { key, estado, nota } }),
    });
    const data = await res.json() as { documentos_estado?: string; documentos_nota?: string; documentos_revisiones?: string };
    setDocAccionando(null);
    setRevisandoDoc(null);

    const nuevasRevs = { ...docRevisiones, [key]: { estado, nota } };
    setDocRevisiones(nuevasRevs);

    const newEstado = data.documentos_estado;
    const newNota   = data.documentos_nota ?? '';
    const newRevsStr = data.documentos_revisiones ?? JSON.stringify(nuevasRevs);
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, documentos_estado: newEstado, documentos_nota: newNota, documentos_revisiones: newRevsStr } : v));
    if (docModal?.v.id === vid) {
      setDocModal(d => d ? { v: { ...d.v, documentos_estado: newEstado, documentos_nota: newNota, documentos_revisiones: newRevsStr } } : null);
    }
  };

  const revisarDocumentos = async (vid: number, estado: string) => {
    setDocGuardando(true);
    await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentos_estado: estado, documentos_nota: estado === 'denegado' ? docNota : '' }),
    });
    setDocGuardando(false);
    const nota = estado === 'denegado' ? docNota : '';
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, documentos_estado: estado, documentos_nota: nota } : v));
    if (docModal?.v.id === vid) {
      setDocModal(d => d ? { v: { ...d.v, documentos_estado: estado, documentos_nota: nota } } : null);
    }
  };

  const verificarConIA = async (vid: number) => {
    setIaCargando(true);
    setIaError('');
    setIaVerif(null);
    try {
      const res = await fetch('/api/verificar-documentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculo_id: vid }),
      });
      const data = await res.json() as {
        error?: string;
        verificacion?: VerificacionResultado;
        auto_aprobados?: string[];
        documentos_estado?: string;
        documentos_revisiones?: string;
      };
      if (!res.ok || !data.verificacion) {
        setIaError(data.error || 'No se pudo completar la verificación.');
        return;
      }
      setIaVerif({ vid, res: data.verificacion, auto: data.auto_aprobados || [] });
      // Reflejar auto-aprobaciones híbridas (estado + revisiones) en la UI.
      if (data.documentos_estado) {
        const nuevoEstado = data.documentos_estado;
        const nuevasRevs = data.documentos_revisiones;
        setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, documentos_estado: nuevoEstado, documentos_revisiones: nuevasRevs } : v));
        if (docModal?.v.id === vid) {
          setDocModal(d => d ? { v: { ...d.v, documentos_estado: nuevoEstado, documentos_revisiones: nuevasRevs } } : null);
        }
        if (nuevasRevs) {
          try { setDocRevisiones(JSON.parse(nuevasRevs)); } catch { /* */ }
        }
      }
    } catch {
      setIaError('No se pudo conectar con el verificador de IA.');
    } finally {
      setIaCargando(false);
    }
  };

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
    await fetch(`/api/reservas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'confirmada', pago_estado: 'pagado' }),
    });
    setReservas(rs => rs.map(r => r.id === id ? { ...r, estado: 'confirmada', pago_estado: 'pagado' } : r));
    setAccionando(null);
  };

  const rechazarReserva = async (id: number, motivo: string) => {
    setAccionando(id);
    await fetch(`/api/reservas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'cancelada', pago_estado: 'cancelado', motivo_rechazo: motivo }),
    });
    setReservas(rs => rs.map(r => r.id === id ? { ...r, estado: 'cancelada', pago_estado: 'cancelado' } : r));
    setRechazando(null);
    setAccionando(null);
  };

  const cambiarEstadoReserva = async (id: number, estado: string) => {
    await fetch(`/api/reservas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    });
    setReservas(rs => rs.map(r => r.id === id ? { ...r, estado } : r));
  };

  const marcarPagado = async (reservaIds: number[]) => {
    setPagandoIds(prev => new Set([...prev, ...reservaIds]));
    setPagoMsg('');
    try {
      const res = await fetch('/api/pagos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reserva_ids: reservaIds, comprobante: pagoComprobante }),
      });
      if (res.ok) {
        setPagoMsg('✓ Pago registrado y propietario notificado.');
        cargarPagos();
        setTimeout(() => setPagoMsg(''), 4000);
      } else {
        const d = await res.json();
        setPagoMsg((d as { error?: string }).error || 'Error al registrar el pago.');
      }
    } catch {
      setPagoMsg('Error de red al registrar el pago.');
    }
    setPagandoIds(prev => { const n = new Set(prev); reservaIds.forEach(id => n.delete(id)); return n; });
  };

  const stats = {
    total:         usuarios.length,
    propietarios:  usuarios.filter(u => u.rol === 'propietario').length,
    usuariosCount: usuarios.filter(u => u.rol === 'usuario').length,
    activos:       usuarios.filter(u => u.estado_cuenta === 'activa').length,
  };

  const reservaStats = {
    total:       reservas.length,
    confirmadas: reservas.filter(r => r.estado === 'confirmada').length,
    en_curso:    reservas.filter(r => r.estado === 'en_curso').length,
    canceladas:  reservas.filter(r => r.estado === 'cancelada').length,
    ingresos:    reservas.filter(r => r.estado !== 'cancelada').reduce((s, r) => s + r.total, 0),
  };

  const sinPrecio = vehiculos.filter(v => !v.precio_dia || v.precio_dia === 0).length;
  const pendientesCount = reservas.filter(r => r.estado === 'pendiente').length;
  const propietariosConDocsEnRevision = new Set(
    vehiculos.filter(v => v.documentos_estado === 'en_revision').map(v => v.propietario_id)
  );

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
    <div className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-ink mb-1">Panel Administrador</h1>
      <p className="text-ink/50 text-sm mb-6">Gestión total del sistema DrivePass</p>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total usuarios',      value: stats.total,          color: 'bg-brand-muted text-ink'   },
          { label: 'Propietarios',        value: stats.propietarios,   color: 'bg-accent-light text-accent' },
          { label: 'Alquiladores',        value: stats.usuariosCount,  color: 'bg-success/10 text-success'  },
          { label: 'Sin precio asignado', value: sinPrecio,            color: sinPrecio > 0 ? 'bg-danger/10 text-danger' : 'bg-surface text-ink/50' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 border border-border ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs opacity-70 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border flex-wrap">
        {([
          { key: 'usuarios',  label: `Usuarios (${usuarios.length})` },
          { key: 'vehiculos', label: `Vehículos (${vehiculos.length})` },
          { key: 'reservas',  label: `Reservas (${reservas.length})`, badge: pendientesCount },
          { key: 'operaciones', label: 'Operaciones' },
          { key: 'pagos', label: `💰 Pagos${pagos.length > 0 ? ` (${pagos.length})` : ''}`, badge: pagos.length },
          { key: 'config', label: 'Configuración' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition ${
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink/50 hover:text-ink'
            }`}>
            {t.label}
            {'badge' in t && t.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── USUARIOS ── */}
      {tab === 'usuarios' && (
        <div className="bg-surface-2 rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-muted">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Nombre</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide hidden sm:table-cell">Correo</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Rol</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {usuarios.map(u => (
                  <tr key={u.id} className="hover:bg-surface transition">
                    <td className="px-4 py-3 font-semibold text-ink">
                      <span className="flex items-center gap-2">
                        {u.nombre}
                        {u.rol === 'propietario' && propietariosConDocsEnRevision.has(u.id) && (
                          <span title="Tiene documentos pendientes de revisión" className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 whitespace-nowrap">📄 Docs pendientes</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink/60 hidden sm:table-cell">{u.correo}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${rolColor[u.rol] || 'bg-surface'}`}>{u.rol}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        u.estado_cuenta === 'activa' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
                      }`}>
                        {u.estado_cuenta}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => setPerfilModal({ u })}
                          className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                          <IconUser size={11} /> Perfil
                        </button>
                        {u.rol !== 'admin' && (
                          <button onClick={() => toggleEstado(u)}
                            className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                              u.estado_cuenta === 'activa'
                                ? 'border-danger/25 text-danger hover:bg-danger/10'
                                : 'border-success/30 text-success hover:bg-success/10'
                            }`}>
                            {u.estado_cuenta === 'activa' ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VEHÍCULOS ── */}
      {tab === 'vehiculos' && (
        <div className="space-y-3">
          {vehiculos.length === 0 && (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/40">No hay vehículos publicados aún.</p>
            </div>
          )}
          {vehiculos.map(v => {
            let portada = '';
            try { portada = (JSON.parse(v.fotos) as string[])[0] || ''; } catch { portada = ''; }
            const sinPrecioV = !v.precio_dia || v.precio_dia === 0;
            const editandoPrecio = (vid: number) => vid in precioEdit;
            const enPP = placaRestringida(picoPlaca, v.placa ?? '', new Date());
            const leftBorder = enPP ? 'border-danger' : sinPrecioV ? 'border-accent' : 'border-transparent';

            return (
              <div key={v.id} className={`bg-surface-2 rounded-2xl shadow-sm p-4 border-l-4 ${leftBorder} ${enPP ? 'ring-1 ring-danger/30 bg-danger/5' : ''} ${!enPP && !sinPrecioV ? 'border' : ''}`}
                style={!enPP && !sinPrecioV ? { borderWidth: '1px', borderColor: 'var(--color-border)' } : {}}>
                <div className="flex gap-4 items-start flex-wrap">
                  {portada && (
                    <img src={portada} alt={v.marca} className="w-20 h-14 object-cover rounded-xl flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                      <span className="text-xs bg-brand-muted text-ink/60 px-2 py-0.5 rounded-full capitalize">{v.tipo}</span>
                      {sinPrecioV && (
                        <span className="text-xs bg-accent-light text-accent px-2 py-0.5 rounded-full font-semibold">Sin precio</span>
                      )}
                      {enPP && (
                        <span className="text-xs bg-danger/15 text-danger px-2 py-0.5 rounded-full font-bold border border-danger/30">🚦 Pico y placa hoy</span>
                      )}
                    </div>
                    <p className="text-sm text-ink/50 mt-0.5">Propietario: {v.propietario_nombre}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {v.placa && <span className="text-xs text-ink/40">Placa: {v.placa}</span>}
                      {v.documentos_estado === 'en_revision' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25">📄 En revisión</span>
                      )}
                      {v.documentos_estado === 'aprobado' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">✓ Docs aprobados</span>
                      )}
                      {v.documentos_estado === 'denegado' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25">✗ Docs denegados</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {sinPrecioV || editandoPrecio(v.id) ? (
                      <>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40 text-xs">$</span>
                          <input
                            type="number" min="1" placeholder="Precio/día"
                            className="border border-border rounded-xl pl-6 pr-2 py-2 text-sm text-ink bg-surface w-32 focus:outline-none focus:ring-2 focus:ring-accent/40"
                            value={precioEdit[v.id] ?? (v.precio_dia > 0 ? String(v.precio_dia) : '')}
                            onChange={e => setPrecioEdit(p => ({ ...p, [v.id]: e.target.value }))}
                          />
                        </div>
                        <button onClick={() => guardarPrecio(v.id)}
                          className="flex items-center gap-1 bg-accent hover:bg-accent-hover text-white px-3 py-2 rounded-xl text-xs font-semibold transition">
                          <IconCheck size={12} /> Guardar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-accent font-bold">${v.precio_dia.toLocaleString('es-CO')}/día</span>
                        <button onClick={() => setPrecioEdit(p => ({ ...p, [v.id]: String(v.precio_dia) }))}
                          className="text-xs border border-border text-ink/50 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                          Editar
                        </button>
                      </>
                    )}
                    <button onClick={() => setFotoModal({ v })}
                      className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                      Fotos
                    </button>
                    <button onClick={() => abrirDocModal(v)}
                      className={`flex items-center gap-1 text-xs border px-2.5 py-1.5 rounded-xl transition font-medium ${
                        v.documentos_estado === 'en_revision'
                          ? 'border-warning/30 text-warning bg-warning/10 hover:bg-warning/15'
                          : v.documentos_estado === 'aprobado'
                          ? 'border-success/30 text-success bg-success/10 hover:bg-success/15'
                          : v.documentos_estado === 'denegado'
                          ? 'border-danger/30 text-danger bg-danger/10 hover:bg-danger/15'
                          : 'border-border text-ink/60 hover:bg-surface'
                      }`}>
                      📄 Docs
                      {v.documentos_estado === 'en_revision' && <span className="w-1.5 h-1.5 rounded-full bg-warning/100 ml-0.5" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── RESERVAS ── */}
      {tab === 'reservas' && (
        <div className="space-y-6">
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
            {reservasFiltradas.length === 0 ? (
              <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
                <IconCalendar size={48} className="text-ink/20 mx-auto mb-3" />
                <p className="text-ink/40">No hay reservas con esos filtros.</p>
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
                      <p className="text-xs text-ink/40 mt-0.5">Propietario: {r.propietario_nombre}</p>
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
      )}

      {/* ── OPERACIONES / LOGÍSTICA ── */}
      {tab === 'operaciones' && <OperacionesPanel />}

      {/* ── PAGOS A PROPIETARIOS ── */}
      {tab === 'pagos' && (
        <div className="space-y-5">
          {/* Header + totales */}
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h2 className="font-bold text-ink text-lg">Pagos pendientes a propietarios</h2>
              <p className="text-sm text-ink/50">Reservas completadas cuyo pago al dueño aún no se ha transferido</p>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-2xl px-5 py-3 text-right">
              <p className="text-xs text-warning/80 font-medium">Total pendiente</p>
              <p className="text-2xl font-black text-warning">${pagosTotalGeneral.toLocaleString('es-CO')}</p>
            </div>
          </div>

          {/* Comprobante global */}
          <div className="bg-surface-2 rounded-2xl border border-border p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-ink/60 block mb-1">Número de comprobante / referencia (opcional)</label>
              <input
                placeholder="Ej. TXN-20260630-001"
                value={pagoComprobante}
                onChange={e => setPagoComprobante(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <p className="text-xs text-ink/40 flex-shrink-0">Se incluye en la notificación al propietario.</p>
          </div>

          {pagoMsg && (
            <div className={`text-sm px-4 py-2.5 rounded-xl border ${
              pagoMsg.startsWith('✓') ? 'bg-success/10 text-success border-success/30' : 'bg-danger/10 text-danger border-danger/25'
            }`}>{pagoMsg}</div>
          )}

          {pagosLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="bg-surface-2 rounded-2xl border border-border h-28 animate-pulse" />)}
            </div>
          ) : pagos.length === 0 ? (
            <div className="text-center py-16 bg-surface-2 rounded-2xl border border-border">
              <p className="text-4xl mb-3">✅</p>
              <p className="font-semibold text-ink">Sin pagos pendientes</p>
              <p className="text-sm text-ink/40 mt-1">Todos los propietarios tienen sus pagos al día.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pagos.map(grupo => {
                const todasIds = grupo.reservas.map(r => r.reserva_id);
                const cargando = todasIds.some(id => pagandoIds.has(id));
                return (
                  <div key={grupo.propietario_id} className="bg-surface-2 rounded-2xl border border-border p-5">
                    {/* Propietario header */}
                    <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                      <div>
                        <p className="font-bold text-ink text-base">{grupo.propietario_nombre}</p>
                        <p className="text-xs text-ink/50">{grupo.propietario_correo}</p>
                        {grupo.banco ? (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            <span className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1 text-ink/70">
                              🏦 {grupo.banco}
                            </span>
                            <span className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1 font-mono text-ink/70">
                              {grupo.numero_cuenta}
                            </span>
                          </div>
                        ) : (
                          <p className="text-xs text-danger mt-1">⚠ Datos bancarios no registrados</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-ink/50 mb-1">Total a transferir</p>
                        <p className="text-xl font-black text-success">${grupo.total_pendiente.toLocaleString('es-CO')}</p>
                        <button
                          onClick={() => marcarPagado(todasIds)}
                          disabled={cargando}
                          className="mt-2 flex items-center gap-2 bg-success hover:bg-success/80 text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
                          <IconCheck size={14} />
                          {cargando ? 'Procesando…' : `Marcar todo pagado (${grupo.reservas.length})`}
                        </button>
                      </div>
                    </div>

                    {/* Lista de reservas del propietario */}
                    <div className="border-t border-border pt-3 space-y-2">
                      {grupo.reservas.map(r => {
                        const enCurso = pagandoIds.has(r.reserva_id);
                        return (
                          <div key={r.reserva_id} className="flex items-center justify-between gap-3 bg-surface rounded-xl px-3 py-2.5 border border-border">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink truncate">{r.marca} {r.modelo} {r.anio}</p>
                              <p className="text-xs text-ink/50">{r.fecha_inicio} → {r.fecha_fin} · {r.usuario_nombre}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-sm font-bold text-ink">${r.total.toLocaleString('es-CO')}</span>
                              <button
                                onClick={() => marcarPagado([r.reserva_id])}
                                disabled={enCurso}
                                className="text-xs border border-success/40 text-success px-2.5 py-1.5 rounded-xl hover:bg-success/10 transition disabled:opacity-50 font-medium">
                                {enCurso ? '…' : '✓ Pagar'}
                              </button>
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

          {/* Botón refrescar */}
          <button onClick={cargarPagos} disabled={pagosLoading}
            className="text-xs text-accent border border-accent/30 px-4 py-2 rounded-xl hover:bg-accent-light transition disabled:opacity-50 font-medium">
            {pagosLoading ? 'Cargando…' : '↻ Actualizar lista'}
          </button>
        </div>
      )}

      {/* ── CONFIGURACIÓN (pico y placa) ── */}
      {tab === 'config' && <PicoPlacaConfig />}

      {/* Modal documentos del cliente (arrendatario) */}
      {clienteDocs && (() => {
        const r = clienteDocs.r;
        const docs: { label: string; url?: string }[] = [
          { label: 'Documento de identidad (cédula)', url: r.documento_id_url },
          { label: 'Licencia de conducción', url: r.licencia_url },
        ];
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setClienteDocs(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h3 className="font-bold text-ink">Documentos del cliente</h3>
                  <p className="text-xs text-ink/50 mt-0.5">{r.usuario_nombre} · {r.marca} {r.modelo}</p>
                </div>
                <button onClick={() => setClienteDocs(null)} className="p-1.5 rounded-xl text-ink/40 hover:text-ink hover:bg-surface transition">
                  <IconX size={18} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {docs.map(d => (
                  <div key={d.label} className="bg-surface rounded-2xl p-3 border border-border">
                    <p className="text-[11px] font-semibold text-ink/50 uppercase tracking-wide mb-2">{d.label}</p>
                    {d.url ? (
                      d.url.toLowerCase().endsWith('.pdf') ? (
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-accent hover:underline">📄 Ver PDF</a>
                      ) : (
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={d.url} alt={d.label} className="w-full max-h-56 object-contain rounded-lg border border-border hover:opacity-90 transition" />
                          <span className="text-[11px] text-ink/40 mt-1 inline-block">Clic para ampliar</span>
                        </a>
                      )
                    ) : (
                      <p className="text-sm text-ink/40">No subido.</p>
                    )}
                  </div>
                ))}
              </div>
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
              <button onClick={() => !arrIaCargando && setArrIa(null)} className="p-1.5 rounded-xl text-ink/40 hover:text-ink hover:bg-surface transition">
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
                <p className="text-[11px] text-ink/40 leading-relaxed mt-3">
                  Verifica vigencia de la licencia, categoría apta para automóvil y que el nombre de la licencia coincida con la cédula. La decisión final es humana.
                </p>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Modal fotos */}
      {fotoModal && (() => {
        let detalle: Record<string, string> = {};
        try { detalle = JSON.parse(fotoModal.v.fotos_detalle || '{}'); } catch { detalle = {}; }
        const tieneDetalle = Object.keys(detalle).length > 0;
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setFotoModal(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-5">
                <h3 className="font-bold text-ink">{fotoModal.v.marca} {fotoModal.v.modelo} — Fotos</h3>
                <button onClick={() => setFotoModal(null)}
                  className="p-1.5 rounded-xl text-ink/40 hover:text-ink hover:bg-surface transition">
                  <IconX size={18} />
                </button>
              </div>
              {tieneDetalle ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(FOTOS_LABELS).map(([key, label]) => (
                    <div key={key}>
                      <p className="text-xs text-ink/50 mb-1 font-medium">{label}</p>
                      {detalle[key] ? (
                        <img src={detalle[key]} alt={label} className="w-full h-28 object-cover rounded-xl border border-border" />
                      ) : (
                        <div className="w-full h-28 bg-surface rounded-xl flex items-center justify-center text-ink/25 text-xs border border-border">
                          Sin foto
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
                  <p className="text-ink/40">Este vehículo no tiene fotos detalladas.</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Modal documentos */}
      {docModal && (() => {
        const v = docModal.v;
        let docs: Documentos = {};
        try { docs = JSON.parse(v.documentos || '{}'); } catch { docs = {}; }

        const docItems: { key: string; label: string; data: DocItem | { url: string } | { url: string; aseguradora?: string; poliza?: string; vence?: string } | undefined }[] = [
          { key: 'soat',       label: 'SOAT',                  data: docs.soat },
          { key: 'tecno',      label: 'Tecno-mecánica',         data: docs.tecno },
          { key: 'tarjeta',    label: 'Tarjeta de propiedad',   data: docs.tarjeta },
          { key: 'todo_riesgo',label: 'Seguro todo riesgo',     data: docs.todo_riesgo },
        ];

        const tieneDocs = docItems.some(d => d.data && 'url' in d.data && d.data.url);
        const estado = v.documentos_estado || 'sin_documentos';

        const ESTADO_BADGE: Record<string, string> = {
          sin_documentos: 'bg-surface text-ink/50 border-border',
          en_revision:    'bg-warning/15 text-warning border-warning/25',
          aprobado:       'bg-success/15 text-success border-success/30',
          denegado:       'bg-danger/15 text-danger border-danger/25',
        };
        const ESTADO_LABEL: Record<string, string> = {
          sin_documentos: 'Sin documentos',
          en_revision:    'En revisión',
          aprobado:       'Aprobado',
          denegado:       'Denegado',
        };

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDocModal(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h3 className="font-bold text-ink">{v.marca} {v.modelo} {v.anio} — Documentos</h3>
                  {v.placa && <p className="text-xs text-ink/50 mt-0.5">Placa: {v.placa}</p>}
                  <p className="text-xs text-ink/40 mt-0.5">Propietario: {v.propietario_nombre}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ESTADO_BADGE[estado] || ESTADO_BADGE.sin_documentos}`}>
                    {ESTADO_LABEL[estado] || estado}
                  </span>
                  <button onClick={() => setDocModal(null)} className="p-1.5 rounded-xl text-ink/40 hover:text-ink hover:bg-surface transition">
                    <IconX size={18} />
                  </button>
                </div>
              </div>

              {/* Verificador con IA */}
              {tieneDocs && (
                <div className="mb-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <button
                      onClick={() => verificarConIA(v.id)}
                      disabled={iaCargando}
                      className="inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-xl gradient-accent text-white shadow hover:opacity-90 transition disabled:opacity-60"
                    >
                      {iaCargando
                        ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Analizando documentos…</>
                        : <><IconShield size={16} /> Verificar con IA</>}
                    </button>
                    <span className="text-xs text-ink/40">Lee SOAT, tecno, tarjeta y seguro; valida fechas, placa y propietario.</span>
                  </div>

                  {iaError && (
                    <div className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">{iaError}</div>
                  )}

                  {iaVerif && iaVerif.vid === v.id && (
                    <div className="space-y-3">
                      <ResultadoIA res={iaVerif.res} auto={iaVerif.auto} />
                      <p className="text-[11px] text-ink/40 leading-relaxed">
                        La IA auto-aprueba solo documentos limpios de alta confianza; los marcados como revisión quedan a tu criterio abajo. Decisión final humana.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Documentos — revisión individual */}
              {!tieneDocs ? (
                <div className="text-center py-10 text-ink/40">
                  <p className="text-3xl mb-3">📄</p>
                  <p>Este vehículo no tiene documentos cargados aún.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {docItems.map(({ key, label, data }) => {
                    if (!data || !('url' in data) || !data.url) return null;
                    const isPdf = data.url.toLowerCase().endsWith('.pdf');
                    const rev = docRevisiones[key] || { estado: 'pendiente', nota: '' };
                    const isReviewing = revisandoDoc?.key === key;
                    const isLoading = docAccionando === key;

                    return (
                      <div key={key} className={`rounded-xl p-3 border ${
                        rev.estado === 'aprobado' ? 'bg-success/10 border-success/30' :
                        rev.estado === 'denegado' ? 'bg-danger/10 border-danger/25' :
                        'bg-surface border-border'
                      }`}>
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <p className="text-xs font-bold text-ink">{label}</p>
                          {rev.estado === 'aprobado' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30 whitespace-nowrap">✓ Aprobado</span>}
                          {rev.estado === 'denegado' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25 whitespace-nowrap">✗ Denegado</span>}
                          {rev.estado === 'pendiente' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 whitespace-nowrap">⏳ Pendiente</span>}
                        </div>

                        {/* Preview */}
                        {isPdf ? (
                          <a href={data.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 text-accent hover:text-accent-hover text-sm font-medium mb-2">
                            <span className="text-xl">📄</span> Ver PDF
                          </a>
                        ) : (
                          <img src={data.url} alt={label} className="w-full h-24 object-cover rounded-lg border border-border mb-2" />
                        )}
                        {'vence' in data && data.vence && <p className="text-[11px] text-ink/50 mb-1">Vence: {(data as { vence?: string }).vence}</p>}
                        {'aseguradora' in data && (data as { aseguradora?: string }).aseguradora && <p className="text-[11px] text-ink/60">Aseg: {(data as { aseguradora?: string }).aseguradora}</p>}
                        {'poliza' in data && (data as { poliza?: string }).poliza && <p className="text-[11px] text-ink/60">Póliza: {(data as { poliza?: string }).poliza}</p>}

                        {/* Denial note */}
                        {rev.estado === 'denegado' && rev.nota && (
                          <p className="text-[11px] text-danger bg-danger/10 border border-danger/25 rounded-lg px-2.5 py-1.5 mt-1.5">{rev.nota}</p>
                        )}

                        {/* Inline denial textarea */}
                        {isReviewing && (
                          <div className="mt-2 space-y-1.5">
                            <textarea
                              rows={2}
                              placeholder="Motivo del rechazo (opcional)…"
                              value={revisandoDoc.nota}
                              onChange={e => setRevisandoDoc(r => r ? { ...r, nota: e.target.value } : null)}
                              className="w-full border border-danger/25 rounded-xl px-3 py-2 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-danger/40 resize-none"
                            />
                            <div className="flex gap-1.5">
                              <button disabled={isLoading} onClick={() => revisarDocIndividual(v.id, key, 'denegado', revisandoDoc.nota)}
                                className="flex-1 text-xs font-bold bg-danger/100 hover:bg-danger text-white px-3 py-1.5 rounded-xl transition disabled:opacity-50">
                                {isLoading ? 'Guardando…' : 'Confirmar rechazo'}
                              </button>
                              <button onClick={() => setRevisandoDoc(null)}
                                className="text-xs border border-border text-ink/60 px-3 py-1.5 rounded-xl hover:bg-surface-2 transition">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        {!isReviewing && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {rev.estado !== 'aprobado' && (
                              <button disabled={isLoading} onClick={() => revisarDocIndividual(v.id, key, 'aprobado', '')}
                                className="flex items-center gap-1 text-[11px] font-bold bg-success hover:bg-success text-white px-2.5 py-1.5 rounded-xl transition disabled:opacity-50">
                                <IconCheck size={11}/> {isLoading ? '…' : 'Aprobar'}
                              </button>
                            )}
                            {rev.estado !== 'denegado' && !isReviewing && (
                              <button onClick={() => setRevisandoDoc({ key, nota: '' })}
                                className="flex items-center gap-1 text-[11px] font-bold border border-danger/25 text-danger hover:bg-danger/10 px-2.5 py-1.5 rounded-xl transition">
                                <IconX size={11}/> Denegar
                              </button>
                            )}
                            {(rev.estado === 'aprobado' || rev.estado === 'denegado') && (
                              <button disabled={isLoading} onClick={() => revisarDocIndividual(v.id, key, 'pendiente', '')}
                                className="text-[11px] border border-border text-ink/50 hover:bg-surface-2 px-2.5 py-1.5 rounded-xl transition disabled:opacity-50">
                                Resetear
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Modal perfil usuario */}
      {perfilModal && (() => {
        const u = perfilModal.u;
        let emergencia = { nombre: '', telefono: '' };
        try { emergencia = JSON.parse(u.contacto_emergencia || '{}'); } catch { /* */ }
        const edad = calcularEdad(u.fecha_nacimiento || '');

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPerfilModal(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex justify-between items-start mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center flex-shrink-0">
                    <IconUser size={20} className="text-ink" />
                  </div>
                  <div>
                    <h3 className="font-bold text-ink">{u.nombre}</h3>
                    <p className="text-xs text-ink/50">{u.correo}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${rolColor[u.rol] || 'bg-surface'}`}>{u.rol}</span>
                  <button onClick={() => setPerfilModal(null)} className="p-1.5 rounded-xl text-ink/40 hover:text-ink hover:bg-surface transition">
                    <IconX size={18} />
                  </button>
                </div>
              </div>

              {/* Sección: Identidad */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">Documento de identidad</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Tipo</p>
                    <p className="text-sm font-semibold text-ink">{TIPO_DOC_LABELS[u.tipo_documento || ''] || u.tipo_documento || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Número</p>
                    <p className="text-sm font-semibold text-ink font-mono">{u.documento_identidad || '—'}</p>
                  </div>
                </div>

                {/* Foto de la cédula */}
                <div className="bg-surface rounded-xl p-3 border border-border">
                  <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-1.5">Foto de la cédula</p>
                  {u.cedula_url ? (
                    u.cedula_url.toLowerCase().endsWith('.pdf') ? (
                      <a href={u.cedula_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-accent hover:underline">
                        📄 Ver cédula (PDF)
                      </a>
                    ) : (
                      <a href={u.cedula_url} target="_blank" rel="noopener noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u.cedula_url} alt="Cédula" className="max-h-44 w-auto rounded-lg border border-border hover:opacity-90 transition" />
                        <span className="text-[11px] text-ink/40 mt-1 inline-block">Clic para ampliar</span>
                      </a>
                    )
                  ) : (
                    <p className="text-sm text-ink/40">El propietario aún no ha subido su cédula.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Fecha de nacimiento</p>
                    <p className="text-sm font-semibold text-ink">{u.fecha_nacimiento || '—'}</p>
                    {edad !== null && <p className="text-[11px] text-ink/40 mt-0.5">{edad} años</p>}
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Celular</p>
                    <p className="text-sm font-semibold text-ink font-mono">{u.celular || '—'}</p>
                  </div>
                </div>

                {/* Sección: Licencia */}
                <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest pt-1">Licencia de conducción</p>
                <div className="bg-surface rounded-xl p-3 border border-border">
                  <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Número de licencia</p>
                  <p className="text-sm font-semibold text-ink font-mono">{u.numero_licencia || '—'}</p>
                </div>

                {/* Sección: Dirección */}
                <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest pt-1">Dirección</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border col-span-2">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Dirección</p>
                    <p className="text-sm font-semibold text-ink">{u.direccion || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Ciudad</p>
                    <p className="text-sm font-semibold text-ink">{u.ciudad || '—'}</p>
                  </div>
                </div>

                {/* Sección: Contacto de emergencia */}
                <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest pt-1">Contacto de emergencia</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Nombre</p>
                    <p className="text-sm font-semibold text-ink">{emergencia.nombre || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-0.5">Teléfono</p>
                    <p className="text-sm font-semibold text-ink font-mono">{emergencia.telefono || '—'}</p>
                  </div>
                </div>

                {/* Estado de cuenta */}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <div>
                    <p className="text-xs text-ink/50">Registrado el {u.created_at?.split('T')[0] || u.created_at}</p>
                    <p className="text-xs text-ink/40">Estado: <span className={u.estado_cuenta === 'activa' ? 'text-success font-semibold' : 'text-danger font-semibold'}>{u.estado_cuenta}</span></p>
                  </div>
                  {u.rol !== 'admin' && (
                    <button onClick={() => { toggleEstado(u); setPerfilModal(p => p ? { u: { ...p.u, estado_cuenta: p.u.estado_cuenta === 'activa' ? 'inactiva' : 'activa' } } : null); }}
                      className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                        u.estado_cuenta === 'activa'
                          ? 'border-danger/25 text-danger hover:bg-danger/10'
                          : 'border-success/30 text-success hover:bg-success/10'
                      }`}>
                      {u.estado_cuenta === 'activa' ? 'Desactivar cuenta' : 'Activar cuenta'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
