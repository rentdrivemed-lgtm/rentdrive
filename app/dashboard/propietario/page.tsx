'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import FotoUpload from '@/components/FotoUpload';
import DocUpload from '@/components/DocUpload';
import DocUploadDoble from '@/components/DocUploadDoble';
import TelefonoInput from '@/components/TelefonoInput';
import { validarCelular, validarDocumentoIdentidad, PAIS_TEL_DEFAULT } from '@/lib/validacion';
import CalendarioDisponibilidad from '@/components/CalendarioDisponibilidad';
import DisponibilidadReglas from '@/components/DisponibilidadReglas';
import ReferidosCard from '@/components/ReferidosCard';
import CalendarioReservas, { type ReservaCalendario } from '@/components/CalendarioReservas';
import { IconCar, IconCalendar, IconChat, IconCheck, IconArrowL, IconExport } from '@/components/Icons';
import { TIPO_VEHICULO_LABELS, type TipoVehiculo } from '@/lib/rentabilidad';
import { precioMercadoSugerido, segmentoValido } from '@/lib/precioMercado';
import FirmaCanvas from '@/components/FirmaCanvas';
import { descargarCuentaCobroPDF } from '@/lib/contabilidad-pdf';

// Opciones de categoría (mismas 6 que la calculadora de mercado) para el selector.
const CATEGORIAS = Object.entries(TIPO_VEHICULO_LABELS) as [TipoVehiculo, string][];
const copCorto = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

// ─── Types ────────────────────────────────────────────────────────────────────
type DocItem = { url: string; vence?: string };
type Documentos = {
  soat?: DocItem;
  tecno?: DocItem;
  tarjeta?: { url: string; url_dorso?: string };
  todo_riesgo?: { url: string; aseguradora?: string; poliza?: string; vence?: string };
};
type DocRevision = { estado: string; nota: string };
type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number;
  tipo: string; precio_dia: number; disponible: number;
  valor_comercial?: number; precio_manual?: number; precio_ajuste_pct?: number;
  dias_disponibles: string; placa?: string;
  fotos?: string; fotos_detalle?: string;
  ubicacion?: string; descripcion?: string;
  documentos?: string; documentos_estado?: string;
  documentos_nota?: string; documentos_revisiones?: string;
};
type Reserva = ReservaCalendario & { usuario_id: number };
type User = {
  id: number; nombre: string; correo: string;
  tipo_documento?: string; documento_identidad?: string;
  celular?: string; celular_indicativo?: string; cedula_url?: string; cedula_url_dorso?: string;
  banco?: string; numero_cuenta?: string; certificado_bancario_url?: string;
};
type Fotos = {
  lado_izquierdo: string; lado_derecho: string;
  frente: string; trasera: string;
  cojineria: string; baul: string; tablero: string;
};
type NotifRaw = { id: number; tipo: string; titulo: string; mensaje: string; leida: number };
type CuentaCobro = {
  id: number; numero: string; propietario_nombre: string; propietario_documento: string;
  vehiculo_descripcion: string; placa: string;
  fecha_inicio: string; fecha_fin: string; dias: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  firmada_en: string; firma_ip: string; firma_imagen: string; firma_nombre_confirmado: string; created_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const FOTOS_VACIAS: Fotos = {
  lado_izquierdo: '', lado_derecho: '', frente: '', trasera: '',
  cojineria: '', baul: '', tablero: '',
};
const FOTOS_LABELS: Record<keyof Fotos, string> = {
  lado_izquierdo: 'Lado izquierdo', lado_derecho: 'Lado derecho',
  frente: 'Frente', trasera: 'Parte trasera',
  cojineria: 'Cojinería', baul: 'Baúl', tablero: 'Tablero',
};
const FORM_INICIAL = {
  marca: '', modelo: '', anio: '', tipo: 'sedan',
  ubicacion: 'Medellín', descripcion: '', placa: '', valor_comercial: '',
};
const DOC_KEYS = ['soat', 'tecno', 'tarjeta', 'todo_riesgo'] as const;
const DOC_LABELS_MAP: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad', todo_riesgo: 'Todo riesgo',
};
const estadoColor: Record<string, string> = {
  pendiente: 'bg-warning/15 text-warning',
  confirmada: 'bg-brand-muted text-ink',
  en_curso: 'bg-success/15 text-success',
  completada: 'bg-surface text-ink/50',
  cancelada: 'bg-danger/15 text-danger',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const parseJ = <T,>(s: string | undefined | null, fb: T): T => {
  try { return s ? JSON.parse(s) as T : fb; } catch { return fb; }
};

type ProgresoItem = { key: string; label: string; done: boolean };
function calcProgreso(v: Vehiculo): { pct: number; items: ProgresoItem[] } {
  const fDet = parseJ<Record<string, string>>(v.fotos_detalle, {});
  const nFotos = Object.values(fDet).filter(Boolean).length;
  const dias = parseJ<string[]>(v.dias_disponibles, []);
  const docs = parseJ<Record<string, { url?: string } | undefined>>(v.documentos, {});

  const items: ProgresoItem[] = [
    { key: 'placa',  label: 'Placa',                 done: !!v.placa?.trim() },
    { key: 'fotos',  label: `Fotos (${nFotos}/7)`,   done: nFotos >= 7 },
    { key: 'dias',   label: `Disponibilidad`,         done: dias.length > 0 },
    { key: 'soat',       label: 'SOAT',               done: !!(docs.soat as { url?: string } | undefined)?.url },
    { key: 'tecno',      label: 'Tecno-mecánica',     done: !!(docs.tecno as { url?: string } | undefined)?.url },
    { key: 'tarjeta',    label: 'Tarjeta propiedad (frente y dorso)',  done: !!((docs.tarjeta as { url?: string; url_dorso?: string } | undefined)?.url && (docs.tarjeta as { url?: string; url_dorso?: string } | undefined)?.url_dorso) },
    { key: 'todo_riesgo',label: 'Todo riesgo',        done: !!(docs.todo_riesgo as { url?: string } | undefined)?.url },
    { key: 'aprobacion', label: 'Aprobación DrivePass', done: v.documentos_estado === 'aprobado' },
  ];
  const done = items.filter(i => i.done).length;
  return { pct: Math.round(done / items.length * 100), items };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DashboardPropietario() {
  const [user, setUser] = useState<User | null>(null);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loadingReservas, setLoadingReservas] = useState(false);
  const [errorReservas, setErrorReservas] = useState('');
  const [tab, setTab] = useState<'vehiculos' | 'reservas' | 'cuentas_cobro' | 'nuevo' | 'perfil' | 'editar'>('vehiculos');

  // Nuevo vehículo
  const [form, setForm] = useState(FORM_INICIAL);
  const [fotos, setFotos] = useState<Fotos>(FOTOS_VACIAS);
  const [diasDisponibles, setDiasDisponibles] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [publicando, setPublicando] = useState(false);

  // Editar vehículo existente
  const [vehiculoEditandoId, setVehiculoEditandoId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(FORM_INICIAL);
  const [editFotos, setEditFotos] = useState<Fotos>(FOTOS_VACIAS);
  const [editDias, setEditDias] = useState<string[]>([]);
  const [editDocs, setEditDocs] = useState<Documentos>({});
  const [seccionMsg, setSeccionMsg] = useState<Record<string, string>>({});
  const [guardandoSeccion, setGuardandoSeccion] = useState<Record<string, boolean>>({});

  // Inline quick-edits in vehicle cards
  const [calTab, setCalTab] = useState<number | null>(null);
  const [placaMsg, setPlacaMsg] = useState<Record<number, string>>({});
  const [dispMsg, setDispMsg] = useState<Record<number, string>>({});

  // Perfil
  const [perfil, setPerfil] = useState({
    tipo_documento: 'cedula', documento_identidad: '', celular: '', celular_indicativo: PAIS_TEL_DEFAULT,
    cedula_url: '', cedula_url_dorso: '',
    banco: '', numero_cuenta: '', certificado_bancario_url: '',
  });
  const [perfilMsg, setPerfilMsg] = useState('');
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);

  // Cuentas de cobro (remisiones a firmar)
  const [cuentasPendientes, setCuentasPendientes] = useState<CuentaCobro[]>([]);
  const [cuentasFirmadas, setCuentasFirmadas] = useState<CuentaCobro[]>([]);
  const [empresaCuentaCobro, setEmpresaCuentaCobro] = useState({ nombre: 'DrivePass', nit: '' });
  const [cargandoCuentas, setCargandoCuentas] = useState(false);
  const [errorCuentas, setErrorCuentas] = useState('');
  const [firmaImagenPorId, setFirmaImagenPorId] = useState<Record<number, string>>({});
  const [nombreConfirmadoPorId, setNombreConfirmadoPorId] = useState<Record<number, string>>({});
  const [firmandoId, setFirmandoId] = useState<number | null>(null);
  const [cuentaMsg, setCuentaMsg] = useState('');

  // Popups
  const [popupCompleto, setPopupCompleto] = useState<string | null>(null); // vehicle name
  const [popupNotif, setPopupNotif] = useState<{ tipo: 'aprobado' | 'denegado' | 'pago'; titulo: string; mensaje: string } | null>(null);

  const router = useRouter();

  // ── Data loaders ──────────────────────────────────────────────────────────
  const cargarVehiculos = useCallback(async (uid: number): Promise<Vehiculo[]> => {
    const res = await fetch(`/api/vehiculos?propietarioId=${uid}`);
    const data = await res.json();
    const vs: Vehiculo[] = data.vehiculos || [];
    setVehiculos(vs);
    return vs;
  }, []);

  const cargarReservas = async () => {
    setLoadingReservas(true);
    setErrorReservas('');
    try {
      const res = await fetch('/api/reservas', { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorReservas((err as { error?: string }).error || `Error ${res.status}`);
        setLoadingReservas(false);
        return;
      }
      const data = await res.json();
      setReservas(data.reservas || []);
    } catch {
      setErrorReservas('Error de red al cargar reservas.');
    }
    setLoadingReservas(false);
  };

  const cargarCuentasCobro = async () => {
    setCargandoCuentas(true);
    setErrorCuentas('');
    try {
      const res = await fetch('/api/propietario/cuentas-cobro', { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorCuentas((err as { error?: string }).error || `Error ${res.status}`);
        setCargandoCuentas(false);
        return;
      }
      const data = await res.json();
      setCuentasPendientes(data.pendientes || []);
      setCuentasFirmadas(data.firmadas || []);
      if (data.empresa) setEmpresaCuentaCobro(data.empresa);
    } catch {
      setErrorCuentas('Error de red al cargar tus cuentas de cobro.');
    }
    setCargandoCuentas(false);
  };

  const firmarCuenta = async (remisionId: number) => {
    const nombreConfirmado = (nombreConfirmadoPorId[remisionId] || '').trim();
    const firmaImagen = firmaImagenPorId[remisionId] || '';
    if (!nombreConfirmado || !firmaImagen) return;

    setFirmandoId(remisionId);
    setCuentaMsg('');
    try {
      const res = await fetch('/api/propietario/cuentas-cobro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remision_id: remisionId, firma_imagen: firmaImagen, nombre_confirmado: nombreConfirmado }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setCuentaMsg('✓ Firmaste la cuenta de cobro. DrivePass ya puede procesar tu pago.');
        cargarCuentasCobro();
      } else {
        setCuentaMsg((d as { error?: string }).error || 'No se pudo registrar la firma.');
      }
    } catch {
      setCuentaMsg('Sin conexión al registrar la firma.');
    } finally {
      setFirmandoId(null);
    }
  };

  // ── Mount: load user + check notification popups ─────────────────────────
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.rol !== 'propietario') { router.push('/login'); return; }
      setUser(d.user);
      setPerfil({
        tipo_documento: d.user.tipo_documento || 'cedula',
        documento_identidad: d.user.documento_identidad || '',
        celular: d.user.celular || '',
        celular_indicativo: d.user.celular_indicativo || PAIS_TEL_DEFAULT,
        cedula_url: d.user.cedula_url || '',
        cedula_url_dorso: d.user.cedula_url_dorso || '',
        banco: d.user.banco || '',
        numero_cuenta: d.user.numero_cuenta || '',
        certificado_bancario_url: d.user.certificado_bancario_url || '',
      });
      cargarVehiculos(d.user.id);
      cargarReservas();
      cargarCuentasCobro(); // para el contador de pendientes en la pestaña, aunque no se abra
    }).catch(() => router.push('/login'));

    // Notification popups: check for unread doc / payment notifications
    fetch('/api/notificaciones')
      .then(r => r.json())
      .then(data => {
        const notifs: NotifRaw[] = data.notificaciones || [];
        const TIPOS_POPUP = ['documento_aprobado', 'documento_denegado', 'pago_realizado'];
        const pending = notifs.filter(n => !n.leida && TIPOS_POPUP.includes(n.tipo));
        if (pending.length > 0) {
          const first = pending[0];
          let tipo: 'aprobado' | 'denegado' | 'pago' = 'aprobado';
          if (first.tipo === 'documento_denegado') tipo = 'denegado';
          else if (first.tipo === 'pago_realizado') tipo = 'pago';
          setPopupNotif({ tipo, titulo: first.titulo, mensaje: first.mensaje });
          fetch('/api/notificaciones', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: pending.map(n => n.id) }),
          });
        }
      })
      .catch(() => {});
  }, [router, cargarVehiculos]);

  useEffect(() => {
    if (tab === 'reservas') cargarReservas();
    if (tab === 'cuentas_cobro') cargarCuentasCobro();
  }, [tab]);

  // ── Quick edits ────────────────────────────────────────────────────────────
  const guardarPlaca = async (vid: number, valor: string) => {
    const placa = valor.toUpperCase().trim();
    const actual = vehiculos.find(v => v.id === vid)?.placa || '';
    if (placa === actual) return;
    await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa }),
    });
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, placa } : v));
    setPlacaMsg(m => ({ ...m, [vid]: '✓ Guardada' }));
    setTimeout(() => setPlacaMsg(m => { const c = { ...m }; delete c[vid]; return c; }), 1500);
  };

  const toggleDisponible = async (v: Vehiculo) => {
    await fetch(`/api/vehiculos/${v.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disponible: v.disponible ? 0 : 1 }),
    });
    if (user) cargarVehiculos(user.id);
  };

  const guardarDias = async (vid: number, dias: string[]) => {
    setDispMsg(m => ({ ...m, [vid]: '' }));
    try {
      const res = await fetch(`/api/vehiculos/${vid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias_disponibles: JSON.stringify(dias) }),
      });
      if (res.ok) {
        setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, dias_disponibles: JSON.stringify(dias) } : v));
      } else {
        const d = await res.json().catch(() => ({}));
        const detalle = (d as { problemas?: { detalle: string }[] }).problemas?.[0]?.detalle;
        setDispMsg(m => ({ ...m, [vid]: detalle || (d as { error?: string }).error || 'No se pudo guardar ese calendario.' }));
      }
    } catch {
      setDispMsg(m => ({ ...m, [vid]: 'Sin conexión — intenta de nuevo.' }));
    }
  };

  // ── Open vehicle editor ────────────────────────────────────────────────────
  const abrirEditar = (v: Vehiculo) => {
    setEditForm({
      marca: v.marca, modelo: v.modelo, anio: String(v.anio),
      tipo: v.tipo, ubicacion: v.ubicacion || 'Medellín',
      descripcion: v.descripcion || '', placa: v.placa || '',
      valor_comercial: v.valor_comercial ? String(v.valor_comercial) : '',
    });
    setEditFotos({ ...FOTOS_VACIAS, ...parseJ<Partial<Fotos>>(v.fotos_detalle, {}) } as Fotos);
    setEditDias(parseJ<string[]>(v.dias_disponibles, []));
    setEditDocs(parseJ<Documentos>(v.documentos, {}));
    setVehiculoEditandoId(v.id);
    setSeccionMsg({});
    setTab('editar');
  };

  // ── Section savers in edit mode ────────────────────────────────────────────
  const guardarSeccion = async (seccion: string, body: Record<string, unknown>): Promise<boolean> => {
    if (!vehiculoEditandoId || !user) return false;
    setGuardandoSeccion(g => ({ ...g, [seccion]: true }));
    setSeccionMsg(m => ({ ...m, [seccion]: '' }));
    let exito = false;
    try {
      const res = await fetch(`/api/vehiculos/${vehiculoEditandoId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        exito = true;
        setSeccionMsg(m => ({ ...m, [seccion]: '✓ Guardado' }));
        const vs = await cargarVehiculos(user.id);
        const vAct = vs.find(v => v.id === vehiculoEditandoId);
        if (vAct) {
          const { pct } = calcProgreso(vAct);
          if (pct === 100) setPopupCompleto(`${vAct.marca} ${vAct.modelo} ${vAct.anio}`);
        }
      } else {
        const d = await res.json();
        setSeccionMsg(m => ({ ...m, [seccion]: (d as { error?: string }).error || 'Error al guardar' }));
      }
    } catch {
      setSeccionMsg(m => ({ ...m, [seccion]: 'Error de red' }));
    }
    setGuardandoSeccion(g => ({ ...g, [seccion]: false }));
    return exito;
  };

  // ── Publish new vehicle ────────────────────────────────────────────────────
  const publicar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (!form.marca || !form.modelo || !form.anio) { setMsg('Marca, modelo y año son obligatorios'); return; }
    if (!Number(form.valor_comercial)) { setMsg('El valor comercial es obligatorio — con él calculamos el precio de alquiler.'); return; }
    setPublicando(true);
    const res = await fetch('/api/vehiculos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form, anio: Number(form.anio), valor_comercial: Number(form.valor_comercial), placa: form.placa,
        fotos: JSON.stringify(fotos.frente ? [fotos.frente] : []),
        fotos_detalle: JSON.stringify(fotos),
        dias_disponibles: JSON.stringify(diasDisponibles),
      }),
    });
    setPublicando(false);
    if (res.ok) {
      const d = await res.json();
      setMsg('✅ Vehículo publicado. Ahora completa el perfil para activarlo.');
      setForm(FORM_INICIAL); setFotos(FOTOS_VACIAS); setDiasDisponibles([]);
      if (user) {
        const vs = await cargarVehiculos(user.id);
        const nuevo = vs.find(v => v.id === d.id);
        if (nuevo) { abrirEditar(nuevo); return; }
      }
      setTab('vehiculos');
    } else {
      const d = await res.json();
      setMsg((d as { error?: string }).error || 'Error al publicar');
    }
  };

  // ── Perfil ─────────────────────────────────────────────────────────────────
  const guardarPerfil = async () => {
    const errDoc = validarDocumentoIdentidad(perfil.tipo_documento, perfil.documento_identidad);
    if (errDoc) { setPerfilMsg(errDoc); return; }
    const errCel = validarCelular(perfil.celular_indicativo, perfil.celular);
    if (errCel) { setPerfilMsg(errCel); return; }
    if (!perfil.banco.trim() || !perfil.numero_cuenta.trim() || !perfil.certificado_bancario_url) {
      setPerfilMsg('Los datos bancarios son obligatorios para procesar pagos.');
      return;
    }
    setGuardandoPerfil(true); setPerfilMsg('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(perfil),
      });
      if (res.ok) {
        setPerfilMsg('✓ Perfil actualizado correctamente.');
        setUser(u => u ? { ...u, ...perfil } : u);
      } else {
        const d = await res.json().catch(() => ({}));
        setPerfilMsg((d as { error?: string }).error || 'No se pudo guardar el perfil.');
      }
    } catch { setPerfilMsg('Error de red al guardar.'); }
    finally { setGuardandoPerfil(false); }
  };

  // ── Reservas helper ────────────────────────────────────────────────────────
  const reservasDatesVehiculo = (vid: number): string[] => {
    const set = new Set<string>();
    reservas.filter(r => r.vehiculo_id === vid && r.estado !== 'cancelada').forEach(r => {
      const [sy, sm, sd] = r.fecha_inicio.slice(0, 10).split('-').map(Number);
      const [ey, em, ed] = r.fecha_fin.slice(0, 10).split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const f = new Date(ey, em - 1, ed);
      while (c < f) {
        set.add(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
        c.setDate(c.getDate() + 1);
      }
    });
    return [...set];
  };

  if (!user) return <div className="text-center py-20 text-ink/50">Cargando...</div>;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'vehiculos', label: `Mis vehículos (${vehiculos.length})` },
    { key: 'reservas',  label: loadingReservas ? 'Reservas…' : `Reservas (${reservas.length})` },
    { key: 'cuentas_cobro', label: cuentasPendientes.length > 0 ? `Cuentas de cobro (${cuentasPendientes.length})` : 'Cuentas de cobro' },
    { key: 'nuevo',     label: '+ Publicar vehículo' },
    { key: 'perfil',    label: 'Mi perfil' },
  ] as const;

  // ── Edited vehicle ref ────────────────────────────────────────────────────
  const vehiculoEditando = vehiculos.find(v => v.id === vehiculoEditandoId) ?? null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Popups */}
      {popupCompleto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-2 rounded-3xl shadow-2xl border border-border max-w-sm w-full p-8 text-center animate-[fadeIn_0.2s_ease]">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-bold text-ink mb-2">¡Inscripción completa!</h2>
            <p className="text-ink/60 text-sm mb-6">
              Tu vehículo <strong className="text-ink">{popupCompleto}</strong> fue verificado y
              aprobado por DrivePass. Ya está visible para los arrendatarios.
            </p>
            <button onClick={() => setPopupCompleto(null)}
              className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-3 rounded-xl transition">
              ¡Genial!
            </button>
          </div>
        </div>
      )}

      {popupNotif && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-2 rounded-3xl shadow-2xl border border-border max-w-sm w-full p-8 text-center animate-[fadeIn_0.2s_ease]">
            <div className="text-5xl mb-4">
              {popupNotif.tipo === 'aprobado' ? '✅' : popupNotif.tipo === 'pago' ? '💰' : '❌'}
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">{popupNotif.titulo}</h2>
            <p className="text-ink/60 text-sm mb-6">{popupNotif.mensaje}</p>
            <button
              onClick={() => { setPopupNotif(null); if (popupNotif.tipo === 'denegado') setTab('vehiculos'); }}
              className={`w-full text-white font-bold py-3 rounded-xl transition ${
                popupNotif.tipo === 'aprobado' ? 'bg-success hover:bg-success/80'
                : popupNotif.tipo === 'pago' ? 'bg-accent hover:bg-accent-hover'
                : 'bg-danger hover:bg-danger/80'
              }`}>
              {popupNotif.tipo === 'aprobado' ? '¡Excelente!' : popupNotif.tipo === 'pago' ? '¡Genial, gracias!' : 'Ver detalles'}
            </button>
          </div>
        </div>
      )}

      {/* Header (template App Dashboard: saludo grande + CTA en gradiente) */}
      {tab !== 'editar' && (
        <>
          <div className="mb-6 pb-6 border-b border-border flex items-end justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-ink tracking-[-0.02em]">Hola, {user.nombre.split(' ')[0]}</h1>
              <p className="text-ink-soft mt-1.5">
                {vehiculos.length > 0
                  ? `Gestionas ${vehiculos.length} ${vehiculos.length === 1 ? 'vehículo' : 'vehículos'} en DrivePass.`
                  : 'Publica tu primer vehículo y empieza a generar ingresos.'}
              </p>
            </div>
            <div className="flex gap-2.5 flex-wrap">
              <Link href="/soporte"
                className="inline-flex items-center gap-2 border border-border-strong text-ink font-semibold px-5 h-11 rounded-xl text-sm bg-surface-2 hover:bg-surface-3 transition">
                Soporte
              </Link>
              <button onClick={() => setTab('nuevo')}
                className="glow-accent inline-flex items-center gap-2 text-white font-semibold px-5 h-11 rounded-xl text-sm transition hover:-translate-y-0.5"
                style={{ background: 'var(--gradient-accent)' }}>
                <IconCheck size={16} /> Publicar vehículo
              </button>
            </div>
          </div>

          {/* StatCards del Design System */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
            {[
              { label: 'Vehículos',   value: vehiculos.length,                                    accent: false },
              { label: 'Disponibles', value: vehiculos.filter(v => v.disponible).length,          accent: true  },
              { label: 'Con precio',  value: vehiculos.filter(v => v.precio_dia > 0).length,       accent: false },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4 sm:p-5 border border-border bg-surface-2 shadow-[var(--shadow-card)]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{s.label}</p>
                <p className={`text-3xl font-black mt-2 font-mono ${s.accent ? 'text-accent' : 'text-ink'}`}
                  style={{ fontFeatureSettings: "'tnum' 1" }}>{s.value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {tab !== 'editar' && (
        <div className="mb-6">
          <ReferidosCard />
        </div>
      )}

      {/* Tabs (hide in edit mode) */}
      {tab !== 'editar' && (
        <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto scrollbar-none">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap ${
                tab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink/50 hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── MIS VEHÍCULOS ────────────────────────────────────────────────────── */}
      {tab === 'vehiculos' && (
        <div className="space-y-4">
          {vehiculos.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">No tienes vehículos publicados.</p>
            </div>
          ) : vehiculos.map(v => {
            const { pct, items } = calcProgreso(v);
            const faltantes = items.filter(i => !i.done).map(i => i.label);
            const dias = parseJ<string[]>(v.dias_disponibles, []);
            const editando = calTab === v.id;
            const docsEstado = v.documentos_estado;

            return (
              <div key={v.id} className="bg-surface-2 rounded-2xl shadow-sm border border-border p-5">
                {/* Header row */}
                <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                  <div>
                    <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                    <p className="text-sm text-ink/50 capitalize mt-0.5">
                      {v.tipo}
                      {v.precio_dia > 0
                        ? ` · $${v.precio_dia.toLocaleString('es-CO')}/día`
                        : ' · Precio pendiente'}
                    </p>
                    {/* Placa inline */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-xs text-ink/50">Placa:</span>
                      <input
                        defaultValue={v.placa || ''}
                        onBlur={e => guardarPlaca(v.id, e.target.value)}
                        placeholder="Sin placa"
                        maxLength={7}
                        className="text-xs bg-surface border border-border rounded-lg px-2 py-0.5 w-24 text-ink uppercase placeholder:text-ink/40 focus:border-accent/50 outline-none" />
                      {!v.placa && <span className="text-[10px] text-warning">⚠ falta</span>}
                      {placaMsg[v.id] && <span className="text-[10px] text-success">{placaMsg[v.id]}</span>}
                    </div>
                  </div>
                  {/* Status badges */}
                  <div className="flex gap-2 flex-wrap items-center">
                    {docsEstado === 'en_revision' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25">⏳ En revisión</span>
                    )}
                    {docsEstado === 'aprobado' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">✓ Aprobado</span>
                    )}
                    {docsEstado === 'denegado' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25">✗ Rechazado</span>
                    )}
                    <button onClick={() => toggleDisponible(v)}
                      className={`text-xs px-3 py-1.5 rounded-xl font-medium transition ${
                        v.disponible ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
                      }`}>
                      {v.disponible ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-ink/60">Perfil del vehículo</span>
                    <span className={`text-xs font-bold ${pct === 100 ? 'text-success' : pct >= 75 ? 'text-accent' : 'text-warning'}`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct === 100 ? 'bg-success' : pct >= 75 ? 'bg-accent' : 'bg-warning'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {faltantes.length > 0 && (
                    <p className="text-[11px] text-ink/50 mt-1">
                      Falta: {faltantes.join(' · ')}
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setCalTab(editando ? null : v.id)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                      editando ? 'bg-brand-muted border-brand/20 text-ink' : 'border-accent/30 text-accent hover:bg-accent-light'
                    }`}>
                    <IconCalendar size={12} /> {editando ? 'Cerrar' : 'Disponibilidad'}
                  </button>
                  <button onClick={() => abrirEditar(v)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-border text-ink/60 hover:border-accent/40 hover:text-accent transition font-medium">
                    {pct < 100 ? '📋 Completar perfil' : '✏️ Editar'}
                  </button>
                </div>

                {/* Inline calendar */}
                {editando && (
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    <p className="text-sm font-medium text-ink/70">
                      Marca los días en que tu vehículo estará disponible:
                    </p>
                    <DisponibilidadReglas dias={dias} />
                    {dispMsg[v.id] && (
                      <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">{dispMsg[v.id]}</p>
                    )}
                    <CalendarioDisponibilidad
                      value={dias}
                      onChange={nuevos => guardarDias(v.id, nuevos)}
                      placa={v.placa}
                      reservedDates={reservasDatesVehiculo(v.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── RESERVAS ─────────────────────────────────────────────────────────── */}
      {tab === 'reservas' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink/50">
              {reservas.length > 0
                ? `${reservas.length} reserva${reservas.length !== 1 ? 's' : ''} para tus vehículos`
                : 'Reservas de tus vehículos'}
            </p>
            <button onClick={cargarReservas} disabled={loadingReservas}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-accent/30 text-accent rounded-xl hover:bg-accent-light transition disabled:opacity-50 font-medium">
              <IconCalendar size={12} /> {loadingReservas ? 'Cargando…' : 'Actualizar'}
            </button>
          </div>
          {errorReservas && (
            <div className="bg-danger/10 border border-danger/25 text-danger text-sm px-4 py-3 rounded-xl flex items-center justify-between gap-3">
              <span>{errorReservas}</span>
              <button onClick={cargarReservas} className="font-semibold hover:text-danger">Reintentar</button>
            </div>
          )}
          {loadingReservas ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="bg-surface-2 rounded-2xl border border-border h-20 animate-pulse" />)}</div>
          ) : !errorReservas && (
            <>
              <div className="bg-surface rounded-2xl border border-border p-4">
                <h3 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
                  <IconCalendar size={15} className="text-accent" /> Vista de calendario
                </h3>
                <CalendarioReservas reservas={reservas} />
              </div>
              <div>
                <h3 className="font-bold text-ink text-sm mb-3">Lista de reservas</h3>
                {reservas.length === 0 ? (
                  <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
                    <IconCalendar size={40} className="text-ink/15 mx-auto mb-3" />
                    <p className="text-ink/50 font-medium">No hay reservas aún.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reservas.map(r => (
                      <div key={r.id} className="bg-surface-2 rounded-2xl shadow-sm border border-border p-5">
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <p className="font-bold text-ink">{r.marca} {r.modelo} {r.anio}</p>
                            <p className="text-sm text-ink/60">Cliente: {r.usuario_nombre}</p>
                            <p className="text-sm text-ink/50">{r.fecha_inicio} → {r.fecha_fin}</p>
                          </div>
                          <div className="text-right flex flex-col items-end gap-1.5">
                            <p className="font-bold text-accent">${r.total.toLocaleString('es-CO')}</p>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${estadoColor[r.estado] || 'bg-surface'}`}>
                              {r.estado}
                            </span>
                            <ChatLink propietarioId={user!.id} usuarioId={r.usuario_id} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CUENTAS DE COBRO (firma electrónica previa al pago) ──────────────── */}
      {tab === 'cuentas_cobro' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink/50">
              Firma tu cuenta de cobro para autorizar a DrivePass a transferirte el neto de cada alquiler.
            </p>
            <button onClick={cargarCuentasCobro} disabled={cargandoCuentas}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-accent/30 text-accent rounded-xl hover:bg-accent-light transition disabled:opacity-50 font-medium">
              <IconCalendar size={12} /> {cargandoCuentas ? 'Cargando…' : 'Actualizar'}
            </button>
          </div>

          {errorCuentas && (
            <div className="bg-danger/10 border border-danger/25 text-danger text-sm px-4 py-3 rounded-xl flex items-center justify-between gap-3">
              <span>{errorCuentas}</span>
              <button onClick={cargarCuentasCobro} className="font-semibold hover:text-danger">Reintentar</button>
            </div>
          )}

          {cuentaMsg && (
            <div className={`text-sm px-4 py-2.5 rounded-xl border ${cuentaMsg.startsWith('✓') ? 'bg-success/10 text-success border-success/30' : 'bg-danger/10 text-danger border-danger/25'}`}>
              {cuentaMsg}
            </div>
          )}

          {cargandoCuentas ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="bg-surface-2 rounded-2xl border border-border h-40 animate-pulse" />)}</div>
          ) : !errorCuentas && (
            <>
              <div>
                <h3 className="font-bold text-ink text-sm mb-3">Pendientes de firma</h3>
                {cuentasPendientes.length === 0 ? (
                  <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
                    <p className="text-3xl mb-2">✅</p>
                    <p className="text-ink/50 font-medium">No tienes cuentas de cobro pendientes de firma.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {cuentasPendientes.map(c => {
                      const dias = c.dias; // congelado en la remisión al momento de generarla — no se recalcula
                      const listoParaFirmar = !!firmaImagenPorId[c.id] && !!(nombreConfirmadoPorId[c.id] || '').trim();
                      const firmando = firmandoId === c.id;
                      return (
                        <div key={c.id} className="bg-surface-2 rounded-2xl border border-border p-5 space-y-4">
                          <div className="flex items-start justify-between flex-wrap gap-3">
                            <div>
                              <p className="font-bold text-ink text-base">{c.vehiculo_descripcion}{c.placa ? ` · ${c.placa}` : ''}</p>
                              <p className="text-xs text-ink/50">{c.fecha_inicio} → {c.fecha_fin} ({dias} día{dias !== 1 ? 's' : ''}) · Cuenta {c.numero}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-ink/50 mb-0.5">Neto a recibir</p>
                              <p className="text-xl font-black text-success">{copCorto(c.neto)}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-center bg-surface rounded-xl border border-border p-3">
                            <div>
                              <p className="text-[10px] text-ink/40 uppercase tracking-wide">Bruto</p>
                              <p className="text-sm font-bold text-ink">{copCorto(c.bruto)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-ink/40 uppercase tracking-wide">Comisión ({(c.comision_pct * 100).toFixed(0)}%)</p>
                              <p className="text-sm font-bold text-ink">- {copCorto(c.comision_valor)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-ink/40 uppercase tracking-wide">Neto</p>
                              <p className="text-sm font-bold text-success">{copCorto(c.neto)}</p>
                            </div>
                          </div>

                          <p className="text-sm text-ink/70 bg-accent-light border border-accent/20 rounded-xl px-3.5 py-2.5">
                            Al firmar, autorizas a DrivePass a transferirte {copCorto(c.neto)} por el alquiler de tu {c.vehiculo_descripcion} del {c.fecha_inicio} al {c.fecha_fin}, ya descontada la comisión de administración del {(c.comision_pct * 100).toFixed(0)}%.
                          </p>

                          <div>
                            <label className="text-xs font-medium text-ink/60 block mb-1">Tu firma</label>
                            <FirmaCanvas
                              disabled={firmando}
                              onChange={dataUrl => setFirmaImagenPorId(prev => ({ ...prev, [c.id]: dataUrl }))}
                            />
                          </div>

                          <div>
                            <label className="text-xs font-medium text-ink/60 block mb-1">Confirma tu nombre completo</label>
                            <input
                              value={nombreConfirmadoPorId[c.id] || ''}
                              onChange={e => setNombreConfirmadoPorId(prev => ({ ...prev, [c.id]: e.target.value }))}
                              disabled={firmando}
                              placeholder="Nombre y apellidos"
                              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
                            />
                          </div>

                          <button onClick={() => firmarCuenta(c.id)} disabled={!listoParaFirmar || firmando}
                            className="w-full flex items-center justify-center gap-2 bg-success hover:bg-success/80 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50">
                            <IconCheck size={14} /> {firmando ? 'Firmando…' : 'Firmar y autorizar el pago'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-bold text-ink text-sm mb-3">Firmadas</h3>
                {cuentasFirmadas.length === 0 ? (
                  <div className="text-center py-10 bg-surface-2 rounded-2xl border border-border">
                    <p className="text-ink/40 text-sm">Todavía no has firmado ninguna cuenta de cobro.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cuentasFirmadas.map(c => {
                      return (
                        <div key={c.id} className="flex items-center justify-between gap-3 bg-surface-2 rounded-xl px-4 py-3 border border-border flex-wrap">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink truncate">{c.vehiculo_descripcion}{c.placa ? ` · ${c.placa}` : ''}</p>
                            <p className="text-xs text-ink/50">{c.fecha_inicio} → {c.fecha_fin} · Cuenta {c.numero}</p>
                            <p className="text-[11px] text-success/80">✓ Firmada el {c.firmada_en.slice(0, 16).replace('T', ' ')}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm font-bold text-ink">{copCorto(c.neto)}</span>
                            <button onClick={() => descargarCuentaCobroPDF(empresaCuentaCobro, c)}
                              className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium flex items-center gap-1">
                              <IconExport size={12} /> PDF
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── PUBLICAR NUEVO ───────────────────────────────────────────────────── */}
      {tab === 'nuevo' && (
        <div className="bg-surface-2 rounded-2xl shadow-sm border border-border p-6">
          <h2 className="font-bold text-ink mb-1">Publicar nuevo vehículo</h2>
          <p className="text-sm text-ink/50 mb-5">
            Solo se requiere información básica. Podrás agregar fotos, disponibilidad y documentos luego.
          </p>
          {msg && (
            <div className={`text-sm px-4 py-2.5 rounded-xl mb-4 border ${
              msg.startsWith('✅') ? 'bg-success/10 text-success border-success/30' : 'bg-danger/10 text-danger border-danger/25'
            }`}>{msg}</div>
          )}
          <form onSubmit={publicar} className="space-y-6">
            <div>
              <h3 className="text-xs font-bold text-ink/50 mb-3 uppercase tracking-widest">Datos del vehículo</h3>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'marca',  label: 'Marca',   req: true },
                  { key: 'modelo', label: 'Modelo',  req: true },
                ] as const).map(f => (
                  <div key={f.key}>
                    <label className="text-xs font-semibold text-ink/60 block mb-1.5">{f.label} <span className="text-accent">*</span></label>
                    <input required={f.req}
                      className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                      value={form[f.key]} onChange={e => setForm(f2 => ({ ...f2, [f.key]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Año <span className="text-accent">*</span></label>
                  <input type="number" required min="2000" max="2030"
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.anio} onChange={e => setForm(f => ({ ...f, anio: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Placa</label>
                  <input placeholder="ABC-123"
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 uppercase"
                    value={form.placa} onChange={e => setForm(f => ({ ...f, placa: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Categoría <span className="text-accent">*</span></label>
                  <select className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                    {CATEGORIAS.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Valor comercial (COP) <span className="text-accent">*</span></label>
                  <input type="text" inputMode="numeric" placeholder="0"
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={form.valor_comercial ? Number(form.valor_comercial).toLocaleString('es-CO') : ''}
                    onChange={e => setForm(f => ({ ...f, valor_comercial: e.target.value.replace(/\D/g, '') }))} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-ink/60 block mb-1.5">Descripción</label>
                  <textarea rows={2}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
                    value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
                </div>
              </div>
              {/* Precio automático de mercado — se calcula de la categoría + valor comercial */}
              {(() => {
                const precioSug = precioMercadoSugerido(segmentoValido(form.tipo), Number(form.valor_comercial) || 0);
                return (
                  <div className="mt-4 flex items-center justify-between gap-3 bg-accent-light border border-accent/30 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold text-accent uppercase tracking-wide">Precio de alquiler estimado</p>
                      <p className="text-[11px] text-ink/60 mt-0.5">Lo calculamos automáticamente con datos de mercado. El equipo puede ajustarlo.</p>
                    </div>
                    <span className="text-xl font-black text-accent whitespace-nowrap">
                      {precioSug > 0 ? `${copCorto(precioSug)}/día` : '—'}
                    </span>
                  </div>
                );
              })()}
            </div>
            <button type="submit" disabled={publicando}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm">
              <IconCheck size={16} />
              {publicando ? 'Publicando…' : 'Publicar y completar perfil →'}
            </button>
          </form>
        </div>
      )}

      {/* ── EDITAR VEHÍCULO ──────────────────────────────────────────────────── */}
      {tab === 'editar' && vehiculoEditando && (() => {
        const { pct, items } = calcProgreso(vehiculoEditando);
        const faltantes = items.filter(i => !i.done).map(i => i.label);
        const fDet = parseJ<Record<string, { url?: string } | undefined>>(vehiculoEditando.documentos, {});

        return (
          <div className="space-y-5">
            {/* Back + title */}
            <div className="flex items-center gap-3">
              <button onClick={() => { setTab('vehiculos'); setVehiculoEditandoId(null); }}
                className="flex items-center gap-1.5 text-sm text-ink/60 hover:text-ink transition font-medium">
                <IconArrowL size={16} /> Mis vehículos
              </button>
              <span className="text-ink/40">/</span>
              <span className="text-sm font-semibold text-ink">
                {vehiculoEditando.marca} {vehiculoEditando.modelo} {vehiculoEditando.anio}
              </span>
            </div>

            {/* Progress bar */}
            <div className="bg-surface-2 rounded-2xl border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-ink">Perfil del vehículo</h3>
                <span className={`text-lg font-black ${pct === 100 ? 'text-success' : pct >= 75 ? 'text-accent' : 'text-warning'}`}>
                  {pct}%
                </span>
              </div>
              <div className="h-3 bg-surface rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    pct === 100 ? 'bg-success' : pct >= 75 ? 'bg-accent' : 'bg-warning'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {items.map(item => (
                  <div key={item.key} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border ${
                    item.done
                      ? 'bg-success/10 border-success/30 text-success'
                      : 'bg-surface border-border text-ink/50'
                  }`}>
                    <span>{item.done ? '✓' : '○'}</span>
                    <span className="truncate">{item.label}</span>
                  </div>
                ))}
              </div>
              {faltantes.length > 0 && (
                <p className="text-[11px] text-ink/50 mt-2">Pendiente: {faltantes.join(' · ')}</p>
              )}
            </div>

            {/* Section 1: Basic info */}
            <div className="bg-surface-2 rounded-2xl border border-border p-5">
              <h3 className="font-bold text-ink mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-black grid place-items-center">1</span>
                Datos básicos
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'marca',  label: 'Marca' },
                  { key: 'modelo', label: 'Modelo' },
                ] as const).map(f => (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-ink/60 block mb-1">{f.label}</label>
                    <input className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                      value={editForm[f.key]} onChange={e => setEditForm(ef => ({ ...ef, [f.key]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Año</label>
                  <input type="number" min="2000" max="2030"
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={editForm.anio} onChange={e => setEditForm(ef => ({ ...ef, anio: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Placa</label>
                  <input placeholder="ABC-123" maxLength={7}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 uppercase"
                    value={editForm.placa} onChange={e => setEditForm(ef => ({ ...ef, placa: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Categoría</label>
                  <select className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={editForm.tipo} onChange={e => setEditForm(ef => ({ ...ef, tipo: e.target.value }))}>
                    {CATEGORIAS.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Valor comercial (COP)</label>
                  <input type="text" inputMode="numeric" placeholder="0"
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={editForm.valor_comercial ? Number(editForm.valor_comercial).toLocaleString('es-CO') : ''}
                    onChange={e => setEditForm(ef => ({ ...ef, valor_comercial: e.target.value.replace(/\D/g, '') }))} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-ink/60 block mb-1">Descripción</label>
                  <textarea rows={2}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
                    value={editForm.descripcion} onChange={e => setEditForm(ef => ({ ...ef, descripcion: e.target.value }))} />
                </div>
              </div>
              {(() => {
                const precioSug = precioMercadoSugerido(segmentoValido(editForm.tipo), Number(editForm.valor_comercial) || 0);
                if (precioSug <= 0) return null;
                return (
                  <p className="text-[11px] text-ink/60 mt-3">
                    Precio de alquiler estimado con estos datos: <strong className="text-accent">{copCorto(precioSug)}/día</strong>.
                    Se recalcula al guardar (salvo que el equipo lo haya fijado a mano).
                  </p>
                );
              })()}
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => guardarSeccion('basico', {
                    marca: editForm.marca, modelo: editForm.modelo,
                    anio: Number(editForm.anio), tipo: editForm.tipo,
                    valor_comercial: Number(editForm.valor_comercial) || 0,
                    descripcion: editForm.descripcion, placa: editForm.placa,
                  })}
                  disabled={guardandoSeccion.basico}
                  className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
                  <IconCheck size={14} /> {guardandoSeccion.basico ? 'Guardando…' : 'Guardar datos'}
                </button>
                {seccionMsg.basico && (
                  <span className={`text-xs font-medium ${seccionMsg.basico.startsWith('✓') ? 'text-success' : 'text-danger'}`}>
                    {seccionMsg.basico}
                  </span>
                )}
              </div>
            </div>

            {/* Section 2: Photos */}
            <div className="bg-surface-2 rounded-2xl border border-border p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-ink flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-black grid place-items-center">2</span>
                  Fotos del vehículo
                </h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                  Object.values(editFotos).filter(Boolean).length >= 7
                    ? 'bg-success/15 text-success'
                    : 'bg-warning/15 text-warning'
                }`}>
                  {Object.values(editFotos).filter(Boolean).length}/7 subidas
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {(Object.keys(FOTOS_LABELS) as (keyof Fotos)[]).map(key => (
                  <FotoUpload
                    key={key}
                    label={FOTOS_LABELS[key]}
                    value={editFotos[key]}
                    onChange={url => setEditFotos(ef => ({ ...ef, [key]: url }))}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => guardarSeccion('fotos', {
                    fotos: JSON.stringify(editFotos.frente ? [editFotos.frente] : []),
                    fotos_detalle: JSON.stringify(editFotos),
                  })}
                  disabled={guardandoSeccion.fotos}
                  className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
                  <IconCheck size={14} /> {guardandoSeccion.fotos ? 'Guardando…' : 'Guardar fotos'}
                </button>
                {seccionMsg.fotos && (
                  <span className={`text-xs font-medium ${seccionMsg.fotos.startsWith('✓') ? 'text-success' : 'text-danger'}`}>
                    {seccionMsg.fotos}
                  </span>
                )}
              </div>
            </div>

            {/* Section 3: Availability */}
            <div className="bg-surface-2 rounded-2xl border border-border p-5">
              <h3 className="font-bold text-ink mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-black grid place-items-center">3</span>
                Disponibilidad
                {editDias.length > 0 && (
                  <span className="text-xs text-success font-normal">({editDias.length} días)</span>
                )}
              </h3>
              <div className="mb-3">
                <DisponibilidadReglas dias={editDias} />
              </div>
              <CalendarioDisponibilidad
                value={editDias}
                onChange={async (dias) => {
                  const anterior = editDias;
                  setEditDias(dias);
                  const ok = await guardarSeccion('dias', { dias_disponibles: JSON.stringify(dias) });
                  // Si el servidor rechazó el cambio, no dejamos el checkbox mostrando algo que no se guardó.
                  if (!ok) setEditDias(anterior);
                }}
                placa={editForm.placa}
                reservedDates={reservasDatesVehiculo(vehiculoEditandoId!)}
              />
              {seccionMsg.dias && (
                <span className={`text-xs font-medium mt-2 block ${seccionMsg.dias.startsWith('✓') ? 'text-success' : 'text-danger'}`}>
                  {seccionMsg.dias}
                </span>
              )}
            </div>

            {/* Section 4: Documents */}
            <div className="bg-surface-2 rounded-2xl border border-border p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="font-bold text-ink flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-black grid place-items-center">4</span>
                  Documentos del vehículo
                </h3>
                {vehiculoEditando.documentos_estado === 'aprobado' && (
                  <span className="text-xs font-semibold px-3 py-1 rounded-full bg-success/15 text-success border border-success/30">✓ Aprobados</span>
                )}
                {vehiculoEditando.documentos_estado === 'en_revision' && (
                  <span className="text-xs font-semibold px-3 py-1 rounded-full bg-warning/15 text-warning border border-warning/25">⏳ En revisión</span>
                )}
                {vehiculoEditando.documentos_estado === 'denegado' && (
                  <span className="text-xs font-semibold px-3 py-1 rounded-full bg-danger/15 text-danger border border-danger/25">✗ Requiere corrección</span>
                )}
              </div>

              {vehiculoEditando.documentos_estado === 'denegado' && vehiculoEditando.documentos_nota && (
                <div className="bg-danger/10 border border-danger/25 rounded-xl p-3 mb-4">
                  <p className="text-xs font-bold text-danger mb-1">✗ Documentos rechazados</p>
                  <p className="text-sm text-danger whitespace-pre-line">{vehiculoEditando.documentos_nota}</p>
                  <p className="text-[11px] text-danger mt-2">Corrige los documentos señalados y vuelve a guardar.</p>
                </div>
              )}

              {/* Per-doc review status */}
              {(() => {
                let revs: Record<string, DocRevision> = {};
                try { revs = JSON.parse(vehiculoEditando.documentos_revisiones || '{}'); } catch { /* */ }
                const hasFeedback = Object.values(revs).some(r => r.estado === 'aprobado' || r.estado === 'denegado');
                if (!hasFeedback) return null;
                return (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {DOC_KEYS.map(k => {
                      const r = revs[k];
                      if (!r || r.estado === 'pendiente') return null;
                      return (
                        <div key={k} className={`rounded-xl px-3 py-2 border text-xs ${
                          r.estado === 'aprobado' ? 'bg-success/10 border-success/30' : 'bg-danger/10 border-danger/25'
                        }`}>
                          <p className="font-bold text-ink">{DOC_LABELS_MAP[k]}</p>
                          {r.estado === 'aprobado' && <p className="text-success font-semibold mt-0.5">✓ Aprobado</p>}
                          {r.estado === 'denegado' && (
                            <>
                              <p className="text-danger font-semibold mt-0.5">✗ Rechazado</p>
                              {r.nota && <p className="text-danger text-[11px] mt-0.5">{r.nota}</p>}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* SOAT */}
                <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink">SOAT</p>
                    {fDet.soat && (fDet.soat as { url?: string }).url && <span className="text-[10px] text-success font-bold">✓ Subido</span>}
                  </div>
                  <DocUpload label="Documento SOAT" value={(editDocs.soat?.url) || ''} onChange={url => setEditDocs(d => ({ ...d, soat: { ...d.soat, url } }))} />
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Fecha de vencimiento</label>
                    <input type="date" value={editDocs.soat?.vence || ''}
                      onChange={e => setEditDocs(d => ({ ...d, soat: { ...d.soat, url: d.soat?.url || '', vence: e.target.value } }))}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                  </div>
                </div>

                {/* Tecno */}
                <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink">Tecno-mecánica</p>
                    {fDet.tecno && (fDet.tecno as { url?: string }).url && <span className="text-[10px] text-success font-bold">✓ Subido</span>}
                  </div>
                  <DocUpload label="Revisión tecno-mecánica" value={editDocs.tecno?.url || ''} onChange={url => setEditDocs(d => ({ ...d, tecno: { ...d.tecno, url } }))} />
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Fecha de vencimiento</label>
                    <input type="date" value={editDocs.tecno?.vence || ''}
                      onChange={e => setEditDocs(d => ({ ...d, tecno: { ...d.tecno, url: d.tecno?.url || '', vence: e.target.value } }))}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                  </div>
                </div>

                {/* Tarjeta */}
                <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink">Tarjeta de propiedad</p>
                    {(() => { const t = fDet.tarjeta as { url?: string; url_dorso?: string } | undefined; return t?.url && t?.url_dorso && <span className="text-[10px] text-success font-bold">✓ Subido</span>; })()}
                  </div>
                  <DocUploadDoble label="Tarjeta de propiedad"
                    valueFrente={editDocs.tarjeta?.url || ''} valueDorso={editDocs.tarjeta?.url_dorso || ''}
                    onChangeFrente={url => setEditDocs(d => ({ ...d, tarjeta: { url, url_dorso: d.tarjeta?.url_dorso || '' } }))}
                    onChangeDorso={url_dorso => setEditDocs(d => ({ ...d, tarjeta: { url: d.tarjeta?.url || '', url_dorso } }))} />
                </div>

                {/* Todo riesgo */}
                <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink">Seguro todo riesgo</p>
                    {fDet.todo_riesgo && (fDet.todo_riesgo as { url?: string }).url && <span className="text-[10px] text-success font-bold">✓ Subido</span>}
                  </div>
                  <DocUpload label="Póliza todo riesgo" value={editDocs.todo_riesgo?.url || ''} onChange={url => setEditDocs(d => ({ ...d, todo_riesgo: { ...d.todo_riesgo, url } }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-ink/50 block mb-1">Aseguradora</label>
                      <input type="text" placeholder="Ej: Sura" value={editDocs.todo_riesgo?.aseguradora || ''}
                        onChange={e => setEditDocs(d => ({ ...d, todo_riesgo: { ...d.todo_riesgo, url: d.todo_riesgo?.url || '', aseguradora: e.target.value } }))}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                    </div>
                    <div>
                      <label className="text-[11px] text-ink/50 block mb-1">N° Póliza</label>
                      <input type="text" placeholder="Número" value={editDocs.todo_riesgo?.poliza || ''}
                        onChange={e => setEditDocs(d => ({ ...d, todo_riesgo: { ...d.todo_riesgo, url: d.todo_riesgo?.url || '', poliza: e.target.value } }))}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Vencimiento</label>
                    <input type="date" value={editDocs.todo_riesgo?.vence || ''}
                      onChange={e => setEditDocs(d => ({ ...d, todo_riesgo: { ...d.todo_riesgo, url: d.todo_riesgo?.url || '', vence: e.target.value } }))}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => guardarSeccion('docs', { documentos: JSON.stringify(editDocs) })}
                  disabled={guardandoSeccion.docs}
                  className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
                  <IconCheck size={14} /> {guardandoSeccion.docs ? 'Guardando…' : 'Guardar documentos'}
                </button>
                {seccionMsg.docs && (
                  <span className={`text-xs font-medium ${seccionMsg.docs.startsWith('✓') ? 'text-success' : 'text-danger'}`}>
                    {seccionMsg.docs}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MI PERFIL ────────────────────────────────────────────────────────── */}
      {tab === 'perfil' && (
        <div className="max-w-xl space-y-5">
          {/* Datos personales */}
          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink mb-1">Datos del propietario</h2>
            <p className="text-xs text-ink/50 mb-4">
              Tus datos y cédula se usan para verificar que la tarjeta de propiedad de tus vehículos esté a tu nombre.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[11px] text-ink/50 block mb-1">Tipo de documento</label>
                <select value={perfil.tipo_documento}
                  onChange={e => setPerfil(p => ({ ...p, tipo_documento: e.target.value }))}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
                  <option value="cedula">Cédula de ciudadanía</option>
                  <option value="extranjeria">Cédula de extranjería</option>
                  <option value="pasaporte">Pasaporte</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-ink/50 block mb-1">Número de documento</label>
                <input value={perfil.documento_identidad}
                  onChange={e => {
                    const limpio = perfil.tipo_documento === 'pasaporte'
                      ? e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
                      : e.target.value.replace(/\D/g, '');
                    setPerfil(p => ({ ...p, documento_identidad: limpio }));
                  }}
                  placeholder={perfil.tipo_documento === 'pasaporte' ? 'AB1234567' : '1234567890'}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40" />
              </div>
            </div>
            <div className="mb-4">
              <label className="text-[11px] text-ink/50 block mb-1">Celular</label>
              <TelefonoInput
                indicativo={perfil.celular_indicativo}
                numero={perfil.celular}
                onChangeIndicativo={dial => setPerfil(p => ({ ...p, celular_indicativo: dial }))}
                onChangeNumero={num => setPerfil(p => ({ ...p, celular: num }))}
              />
            </div>
            <div className="mb-1">
              <DocUploadDoble label="Foto de tu cédula"
                valueFrente={perfil.cedula_url} valueDorso={perfil.cedula_url_dorso}
                onChangeFrente={url => setPerfil(p => ({ ...p, cedula_url: url }))}
                onChangeDorso={url => setPerfil(p => ({ ...p, cedula_url_dorso: url }))}
                soloUnLado={perfil.tipo_documento === 'pasaporte'} />
              <p className="text-[11px] text-ink/50 mt-1">
                Imagen o PDF claro y legible. Solo la vemos para validar tus documentos.
              </p>
            </div>
          </div>

          {/* Datos bancarios */}
          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink mb-1">Datos bancarios <span className="text-accent text-sm font-semibold">*</span></h2>
            <p className="text-xs text-ink/50 mb-4">
              Requeridos para procesar los pagos de tus alquileres. Solo los usa DrivePass para transferirte.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[11px] text-ink/50 block mb-1">Banco <span className="text-accent">*</span></label>
                <select value={perfil.banco}
                  onChange={e => setPerfil(p => ({ ...p, banco: e.target.value }))}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
                  <option value="">Selecciona un banco…</option>
                  <option value="Bancolombia">Bancolombia</option>
                  <option value="Davivienda">Davivienda</option>
                  <option value="Banco de Bogotá">Banco de Bogotá</option>
                  <option value="BBVA Colombia">BBVA Colombia</option>
                  <option value="Nequi">Nequi</option>
                  <option value="Daviplata">Daviplata</option>
                  <option value="Banco Agrario">Banco Agrario</option>
                  <option value="Scotiabank Colpatria">Scotiabank Colpatria</option>
                  <option value="Banco Popular">Banco Popular</option>
                  <option value="Banco de Occidente">Banco de Occidente</option>
                  <option value="Banco Caja Social">Banco Caja Social</option>
                  <option value="Bancamía">Bancamía</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-ink/50 block mb-1">Número de cuenta <span className="text-accent">*</span></label>
                <input value={perfil.numero_cuenta}
                  onChange={e => setPerfil(p => ({ ...p, numero_cuenta: e.target.value }))}
                  placeholder="Ej. 123-456789-00"
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40" />
              </div>
            </div>
            <div className="mb-1">
              <DocUpload label="Certificado bancario (PDF o imagen) *"
                value={perfil.certificado_bancario_url}
                onChange={url => setPerfil(p => ({ ...p, certificado_bancario_url: url }))} />
              <p className="text-[11px] text-ink/50 mt-1">
                Documento emitido por el banco. Máximo 3 meses de antigüedad.
              </p>
            </div>
          </div>

          {/* Save button */}
          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <button onClick={guardarPerfil} disabled={guardandoPerfil}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm">
              <IconCheck size={16} />
              {guardandoPerfil ? 'Guardando…' : 'Guardar perfil'}
            </button>
            {perfilMsg && (
              <p className={`text-xs mt-2 ${perfilMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{perfilMsg}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component ────────────────────────────────────────────────────────────
function ChatLink({ propietarioId, usuarioId }: { propietarioId: number; usuarioId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const abrir = async () => {
    setLoading(true);
    const res = await fetch('/api/chat/conversaciones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propietario_id: propietarioId, usuario_id: usuarioId }),
    });
    const data = await res.json();
    setLoading(false);
    router.push(`/chat/${data.id}`);
  };
  return (
    <button onClick={abrir} disabled={loading}
      className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition disabled:opacity-50 font-medium">
      <IconChat size={11} /> {loading ? '...' : 'Chat'}
    </button>
  );
}
