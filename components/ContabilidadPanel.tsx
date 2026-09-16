'use client';
import { useEffect, useRef, useState } from 'react';
import { IconCoin, IconCheck, IconExport, IconUpload, IconPhoto, IconX } from '@/components/Icons';
import { descargarCotizacionPDF, descargarFacturaPDF, descargarRemisionPDF, descargarGastoPDF } from '@/lib/contabilidad-pdf';
import { descargarGastosExcel } from '@/lib/contabilidad-excel';
import { calcularDiasAlquiler, calcularTotalAlquiler } from '@/lib/lugares';
// Misma fórmula que usa el servidor para guardar (lib/liquidacion-calculo.ts, módulo puro):
// la vista previa del modal no puede diferir ni en un peso de lo que se va a grabar.
import { calcularTotalesLiquidacion } from '@/lib/liquidacion-calculo';

type SubTab = 'resumen' | 'gastos' | 'cotizaciones' | 'facturas' | 'liquidaciones' | 'config';

type Resumen = {
  periodo: { desde: string; hasta: string };
  reservas: { n: number; bruto: number };
  comision_pct_actual: number;
  comision_total: number;
  pagado_propietarios: number;
  pendiente_propietarios: number;
  gastos: Array<{ categoria: string; n: number; total: number }>;
  gastos_total: number;
  utilidad_estimada: number;
  facturas: Array<{ estado: string; n: number; total: number }>;
  cotizaciones: Array<{ estado: string; n: number }>;
  dataico_activo: boolean;
};

type CategoriaGasto = 'fijo' | 'variable' | 'servicio' | 'producto' | 'otro';
type PagoLinea = { metodo: string; valor: number };
type Gasto = {
  id: number; categoria: CategoriaGasto; proveedor: string; nit_proveedor: string; descripcion: string;
  numero_factura: string; fecha: string; subtotal: number; iva: number; total: number;
  metodo_pago: string; pagos: PagoLinea[]; abonado: number;
  recurrente: number; comprobante_url: string; comprobante_pago_url: string; extraido_ia: number; notas: string;
  estado: string; anulado_en: string; motivo_anulacion: string; created_at: string;
};
type Proveedor = {
  id: number; nombre: string; nit: string; categoria_habitual: string; notas: string;
  created_at: string; updated_at: string;
};
type PagoLineaForm = { metodo: string; valor: string };
type GastoForm = {
  categoria: CategoriaGasto; proveedor: string; nit_proveedor: string; numero_factura: string;
  fecha: string; subtotal: string; iva: string; total: string; pagos: PagoLineaForm[];
  recurrente: boolean; descripcion: string; notas: string; comprobante_url: string; comprobante_pago_url: string; extraido_ia: boolean;
};

type Cotizacion = {
  id: number; reserva_id: number | null; numero: string; cliente_nombre: string; cliente_correo: string;
  cliente_celular?: string; vehiculo_id?: number | null;
  vehiculo_descripcion: string; fecha_inicio?: string; fecha_fin?: string;
  dias: number; precio_dia: number; recargo: number; total: number;
  estado: string; reserva_estado: string | null; pago_estado: string | null; created_at: string;
};

// Vehículo del inventario, para el selector del cotizador de venta (usa /api/vehiculos,
// el mismo listado público que ya usa la vitrina — mismo precio/día vigente).
type VehiculoInventario = { id: number; marca: string; modelo: string; anio: number; precio_dia: number };

type CotizacionManualForm = {
  cliente_nombre: string; cliente_correo: string; cliente_celular: string;
  vehiculo_id: string; vehiculo_descripcion: string;
  fecha_inicio: string; fecha_fin: string; recargo: string; total_override: string;
};
const COT_MANUAL_INICIAL: CotizacionManualForm = {
  cliente_nombre: '', cliente_correo: '', cliente_celular: '',
  vehiculo_id: '', vehiculo_descripcion: '',
  fecha_inicio: '', fecha_fin: '', recargo: '', total_override: '',
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

type TipoConceptoLiq = 'descuento' | 'adicional';
type ConceptoLiq = {
  id: number; liquidacion_id: number; tipo: TipoConceptoLiq; concepto: string; monto: number;
  motivo: string; origen_ajuste_id: number | null; created_by_nombre: string; created_at: string;
};
type LiquidacionFila = {
  id: number;
  reserva_id: number; bruto: number; comision_pct: number; comision_valor: number; neto: number;
  marca: string; modelo: string; anio: number; fecha_inicio: string; fecha_fin: string; usuario_nombre: string;
  remision_numero: string; propietario_documento: string; placa: string; firmada_en: string;
  remision_version: number;
  comprobante: string; comprobante_url: string; pagado_en: string;
  conceptos: ConceptoLiq[];
};
type LiquidacionGrupo = {
  propietario_id: number; propietario_nombre: string; propietario_correo: string;
  banco: string; numero_cuenta: string; total_neto: number; liquidaciones: LiquidacionFila[];
};
// Costo/adicional que quedó pendiente de aplicar porque la liquidación de ese servicio ya
// se pagó: lo consume la SIGUIENTE liquidación del propietario.
type AjustePendiente = {
  id: number; propietario_id: number; propietario_nombre?: string; tipo: TipoConceptoLiq;
  concepto: string; monto: number; motivo: string; reserva_origen_id: number | null;
  created_by_nombre: string; created_at: string;
};

// Formulario de edición de UNA liquidación (modal). `bruto`/`comision_pct` se envían solo
// si el admin los tocó; cada cambio lleva su motivo obligatorio.
type LineaNueva = { tipo: TipoConceptoLiq; concepto: string; monto: string; motivo: string };
const LINEA_NUEVA_VACIA: LineaNueva = { tipo: 'descuento', concepto: '', monto: '', motivo: '' };
type EdicionState = {
  grupo: LiquidacionGrupo;
  fila: LiquidacionFila;
  bruto: string; motivoBruto: string;
  comisionPct: string; motivoComision: string;
  nuevas: LineaNueva[];
  quitar: Record<number, string>; // id del concepto → motivo para quitarlo
  confirmarNegativo: boolean;
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

const CAT_GASTO: Record<CategoriaGasto, { label: string; badge: string }> = {
  fijo:     { label: 'Fijo',      badge: 'bg-brand-muted text-ink border-border' },
  variable: { label: 'Variable',  badge: 'bg-warning/15 text-warning border-warning/25' },
  servicio: { label: 'Servicios', badge: 'bg-accent-light text-accent border-accent/20' },
  producto: { label: 'Productos', badge: 'bg-success/15 text-success border-success/30' },
  otro:     { label: 'Otro',      badge: 'bg-surface text-ink/60 border-border' },
};
const CATS_GASTO = Object.keys(CAT_GASTO) as CategoriaGasto[];

const METODOS_PAGO: Array<{ v: string; label: string }> = [
  { v: 'efectivo', label: 'Efectivo' },
  { v: 'tarjeta', label: 'Tarjeta' },
  { v: 'transferencia', label: 'Transferencia' },
  { v: 'PSE', label: 'PSE' },
  { v: 'nequi', label: 'Nequi' },
  { v: 'daviplata', label: 'Daviplata' },
  { v: 'otro', label: 'Otro' },
];
function metodoLabel(v: string) { return METODOS_PAGO.find(m => m.v === v)?.label || v; }

// Cloudinary: inserta una transformación en la URL de imagen para servir versiones
// ligeras/optimizadas (evita descargar la foto original de varios MB en la lista).
// Los PDF (/raw/upload/) no se transforman: se devuelven tal cual.
function esPdfUrl(url: string) { return /\.pdf($|\?)/i.test(url) || url.includes('/raw/upload/'); }
function cldTransform(url: string, t: string) {
  return url.includes('/image/upload/') ? url.replace('/image/upload/', `/image/upload/${t}/`) : url;
}
function thumbUrl(url: string) { return cldTransform(url, 'w_120,h_120,c_fill,q_auto,f_auto'); }
function verUrl(url: string) { return esPdfUrl(url) ? url : cldTransform(url, 'w_1600,q_auto,f_auto,c_limit'); }

function cop(n: number) { return `$${Math.round(n || 0).toLocaleString('es-CO')}`; }
function primerDiaAnio() { return `${new Date().getFullYear()}-01-01`; }
function hoy() { return new Date().toISOString().slice(0, 10); }
function sumaPagos(pagos: Array<{ valor: string | number }>) {
  return pagos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
}

const GFORM_INICIAL: GastoForm = {
  categoria: 'variable', proveedor: '', nit_proveedor: '', numero_factura: '',
  fecha: hoy(), subtotal: '', iva: '', total: '', pagos: [],
  recurrente: false, descripcion: '', notas: '', comprobante_url: '', comprobante_pago_url: '', extraido_ia: false,
};

export default function ContabilidadPanel() {
  const [subTab, setSubTab] = useState<SubTab>('resumen');

  // Resumen
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [desde, setDesde] = useState(primerDiaAnio());
  const [hasta, setHasta] = useState(hoy());
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [errorResumen, setErrorResumen] = useState('');

  // Cotizaciones
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [reservasSinCotizacion, setReservasSinCotizacion] = useState<ReservaPendiente[]>([]);
  const [cargandoCot, setCargandoCot] = useState(false);
  const [errorCot, setErrorCot] = useState('');
  const [reenviandoId, setReenviandoId] = useState<number | null>(null);
  // Cotizador de venta (cotización manual, sin reserva ni cuenta del prospecto)
  const [vehiculosInventario, setVehiculosInventario] = useState<VehiculoInventario[]>([]);
  const [mostrarCotManual, setMostrarCotManual] = useState(false);
  const [cotManual, setCotManual] = useState<CotizacionManualForm>(COT_MANUAL_INICIAL);
  const [guardandoCotManual, setGuardandoCotManual] = useState(false);
  const [cotManualMsg, setCotManualMsg] = useState('');

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
  const [comprobanteUrl, setComprobanteUrl] = useState('');
  const [subiendoComprobante, setSubiendoComprobante] = useState(false);
  const [liqMsg, setLiqMsg] = useState('');
  const inputComprobanteRef = useRef<HTMLInputElement>(null);
  // Edición de liquidaciones + ajustes pendientes por propietario
  const [ajustesPendientes, setAjustesPendientes] = useState<AjustePendiente[]>([]);
  const [edicion, setEdicion] = useState<EdicionState | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [edicionMsg, setEdicionMsg] = useState('');
  const [ajusteNuevo, setAjusteNuevo] = useState<{ grupo: LiquidacionGrupo; fila: LiquidacionFila; tipo: TipoConceptoLiq; concepto: string; monto: string; motivo: string } | null>(null);
  const [guardandoAjuste, setGuardandoAjuste] = useState(false);

  // Config
  const [config, setConfig] = useState({
    comision_plataforma_pct: '', empresa_nombre: '', empresa_nit: '',
    referido_habilitado: '', referido_recompensa_referrer: '', referido_recompensa_referido: '',
    iva_activo: '', iva_pct: '',
  });
  const [cargandoConfig, setCargandoConfig] = useState(false);
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState('');

  // Gastos
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [gastosPorCategoria, setGastosPorCategoria] = useState<Array<{ categoria: string; n: number; total: number }>>([]);
  const [gastosTotal, setGastosTotal] = useState(0);
  const [gastosAbonado, setGastosAbonado] = useState(0);
  const [gastosPendiente, setGastosPendiente] = useState(0);
  const [gDesde, setGDesde] = useState(primerDiaAnio());
  const [gHasta, setGHasta] = useState(hoy());
  const [gCategoria, setGCategoria] = useState('');
  const [gQueryInput, setGQueryInput] = useState('');
  const [gQuery, setGQuery] = useState('');
  const [gPagina, setGPagina] = useState(1);
  const [gastosTotalFilas, setGastosTotalFilas] = useState(0);
  const [gastosPorPagina, setGastosPorPagina] = useState(15);
  const [exportandoExcel, setExportandoExcel] = useState(false);

  // Proveedores (catálogo — se llenan solos al registrar gastos, o a mano en Config)
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [provForm, setProvForm] = useState({ nombre: '', nit: '', categoria_habitual: '', notas: '' });
  const [editandoProvId, setEditandoProvId] = useState<number | null>(null);
  const [guardandoProv, setGuardandoProv] = useState(false);
  const [provMsg, setProvMsg] = useState('');
  const [cargandoGastos, setCargandoGastos] = useState(false);
  const [errorGastos, setErrorGastos] = useState('');
  const [gForm, setGForm] = useState<GastoForm>(GFORM_INICIAL);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [subiendoPago, setSubiendoPago] = useState(false);
  const [extrayendo, setExtrayendo] = useState(false);
  const [guardandoGasto, setGuardandoGasto] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<number | null>(null);
  const [gastoMsg, setGastoMsg] = useState('');
  const [gEstado, setGEstado] = useState<'activo' | 'anulado'>('activo');
  const [anuladosCount, setAnuladosCount] = useState(0);
  const [verGasto, setVerGasto] = useState<Gasto | null>(null);
  const [anularGasto, setAnularGasto] = useState<Gasto | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [procesandoAnular, setProcesandoAnular] = useState(false);
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  const inputCamaraRef = useRef<HTMLInputElement>(null);
  const inputPagoRef = useRef<HTMLInputElement>(null);

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

  // Vehículos del inventario (listado público, mismo que usa la vitrina) — para elegir un
  // carro real en el cotizador de venta y tomar su precio/día vigente automáticamente.
  const cargarVehiculosInventario = async () => {
    try {
      const res = await fetch('/api/vehiculos', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setVehiculosInventario((d.vehiculos || []).map((v: Record<string, unknown>) => ({
        id: v.id, marca: v.marca, modelo: v.modelo, anio: v.anio, precio_dia: v.precio_dia,
      })));
    } catch { /* el selector simplemente queda vacío; se puede describir el carro a mano */ }
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
      setAjustesPendientes(d.ajustes_pendientes || []);
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
          iva_activo: d.config?.iva_activo || '',
          iva_pct: d.config?.iva_pct || '',
        });
      }
    } catch { /* silencioso — se puede reintentar cambiando de pestaña */ }
    finally { setCargandoConfig(false); }
  };

  const cargarProveedores = async () => {
    try {
      const res = await fetch('/api/contabilidad/proveedores', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setProveedores(d.proveedores || []);
    } catch { /* silencioso — el catálogo es solo una ayuda, no bloquea nada */ }
  };

  // Al elegir/tipear un proveedor ya guardado en el gasto, completa el NIT si estaba vacío.
  const onProveedorGastoChange = (nombre: string) => {
    setGForm(f => {
      if (f.nit_proveedor) return { ...f, proveedor: nombre };
      const match = proveedores.find(p => p.nombre.toLowerCase() === nombre.trim().toLowerCase());
      return { ...f, proveedor: nombre, nit_proveedor: match?.nit || f.nit_proveedor };
    });
  };

  const provFormVacio = () => setProvForm({ nombre: '', nit: '', categoria_habitual: '', notas: '' });
  const abrirEditarProveedor = (p: Proveedor) => {
    setEditandoProvId(p.id);
    setProvForm({ nombre: p.nombre, nit: p.nit || '', categoria_habitual: p.categoria_habitual || '', notas: p.notas || '' });
    setProvMsg('');
  };
  const cancelarEdicionProveedor = () => { setEditandoProvId(null); provFormVacio(); setProvMsg(''); };

  const guardarProveedor = async () => {
    if (!provForm.nombre.trim()) { setProvMsg('Falta el nombre del proveedor.'); return; }
    setGuardandoProv(true); setProvMsg('');
    try {
      const res = await fetch('/api/contabilidad/proveedores', {
        method: editandoProvId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(editandoProvId ? { id: editandoProvId } : {}), ...provForm }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setProvMsg(d.error || 'No se pudo guardar el proveedor.'); return; }
      setProvMsg(editandoProvId ? '✓ Proveedor actualizado.' : '✓ Proveedor guardado.');
      cancelarEdicionProveedor();
      cargarProveedores();
      setTimeout(() => setProvMsg(''), 3000);
    } catch {
      setProvMsg('Sin conexión al guardar el proveedor.');
    } finally {
      setGuardandoProv(false);
    }
  };

  const eliminarProveedor = async (p: Proveedor) => {
    if (typeof window !== 'undefined' && !window.confirm(`¿Quitar "${p.nombre}" del catálogo de proveedores? Los gastos ya registrados con este nombre no se ven afectados.`)) return;
    const res = await fetch(`/api/contabilidad/proveedores?id=${p.id}`, { method: 'DELETE' });
    if (res.ok) cargarProveedores();
  };

  const cargarGastos = async () => {
    setCargandoGastos(true); setErrorGastos('');
    try {
      const q = new URLSearchParams({ desde: gDesde, hasta: gHasta, estado: gEstado, pagina: String(gPagina) });
      if (gCategoria) q.set('categoria', gCategoria);
      if (gQuery.trim()) q.set('q', gQuery.trim());
      const res = await fetch(`/api/contabilidad/gastos?${q.toString()}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorGastos('No pudimos cargar los gastos.'); return; }
      setGastos(d.gastos || []);
      setGastosPorCategoria(d.por_categoria || []);
      setGastosTotal(d.total_general || 0);
      setGastosAbonado(d.abonado_general || 0);
      setGastosPendiente(d.pendiente_general || 0);
      setAnuladosCount(d.anulados_count || 0);
      setGastosTotalFilas(d.total_filas || 0);
      setGastosPorPagina(d.por_pagina || 15);
    } catch {
      setErrorGastos('Sin conexión — intenta de nuevo.');
    } finally {
      setCargandoGastos(false);
    }
  };

  // Excel con TODO lo que cumple los filtros actuales (ignora la paginación).
  const exportarGastosExcel = async () => {
    setExportandoExcel(true); setGastoMsg('');
    try {
      const q = new URLSearchParams({ desde: gDesde, hasta: gHasta, estado: gEstado, todo: '1' });
      if (gCategoria) q.set('categoria', gCategoria);
      if (gQuery.trim()) q.set('q', gQuery.trim());
      const res = await fetch(`/api/contabilidad/gastos?${q.toString()}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.gastos) { setGastoMsg('No se pudo generar el Excel.'); return; }
      const catLabel = gCategoria ? CAT_GASTO[gCategoria as CategoriaGasto]?.label : 'Todas';
      const filtrosLabel = `${gDesde} a ${gHasta} · Categoría: ${catLabel}${gQuery ? ` · Búsqueda: "${gQuery}"` : ''} · ${gEstado === 'anulado' ? 'Anulados' : 'Activos'}`;
      await descargarGastosExcel(d.gastos, filtrosLabel);
    } catch {
      setGastoMsg('Sin conexión al generar el Excel.');
    } finally {
      setExportandoExcel(false);
    }
  };

  useEffect(() => { cargarResumen(); cargarConfig(); cargarProveedores(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (subTab === 'cotizaciones' && cotizaciones.length === 0) cargarCotizaciones();
    if (subTab === 'cotizaciones' && vehiculosInventario.length === 0) cargarVehiculosInventario();
    if (subTab === 'facturas' && facturas.length === 0) cargarFacturas();
    if (subTab === 'liquidaciones') cargarLiquidaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, estadoLiq]);
  // Debounce del buscador por nombre (proveedor/descripción/N° factura) — no dispara una
  // consulta por cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setGQuery(gQueryInput), 400);
    return () => clearTimeout(t);
  }, [gQueryInput]);
  // Cualquier cambio de filtro (no de página) vuelve a la página 1.
  useEffect(() => { setGPagina(1); }, [gDesde, gHasta, gCategoria, gEstado, gQuery]);
  useEffect(() => {
    if (subTab === 'gastos') cargarGastos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, gDesde, gHasta, gCategoria, gEstado, gQuery, gPagina]);

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

  // Total estimado en vivo mientras se llena el formulario (misma fórmula que el servidor:
  // días × precio/día del vehículo elegido + recargo) — el admin puede seguir ajustándolo
  // manualmente en "Precio final" antes de guardar (ej. descuento comercial).
  const cotManualPreview = (() => {
    if (!cotManual.fecha_inicio || !cotManual.fecha_fin) return null;
    const dias = calcularDiasAlquiler(cotManual.fecha_inicio, cotManual.fecha_fin);
    const veh = vehiculosInventario.find(v => String(v.id) === cotManual.vehiculo_id);
    const precioDia = veh?.precio_dia || 0;
    const recargo = Number(cotManual.recargo) || 0;
    return { dias, precioDia, recargo, total: calcularTotalAlquiler(dias, precioDia, recargo) };
  })();

  const guardarCotizacionManual = async () => {
    setCotManualMsg('');
    if (!cotManual.cliente_nombre.trim()) { setCotManualMsg('Falta el nombre del cliente/prospecto.'); return; }
    if (!cotManual.fecha_inicio || !cotManual.fecha_fin) { setCotManualMsg('Faltan las fechas del alquiler.'); return; }
    if (!cotManual.vehiculo_id && !cotManual.vehiculo_descripcion.trim()) { setCotManualMsg('Elige un vehículo del inventario o descríbelo.'); return; }

    setGuardandoCotManual(true);
    try {
      const res = await fetch('/api/contabilidad/cotizaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nombre: cotManual.cliente_nombre.trim(),
          cliente_correo: cotManual.cliente_correo.trim(),
          cliente_celular: cotManual.cliente_celular.trim(),
          vehiculo_id: cotManual.vehiculo_id || undefined,
          vehiculo_descripcion: cotManual.vehiculo_descripcion.trim(),
          fecha_inicio: cotManual.fecha_inicio,
          fecha_fin: cotManual.fecha_fin,
          recargo: cotManual.recargo,
          total_override: cotManual.total_override,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setCotManualMsg(d.error || 'No se pudo crear la cotización.'); return; }
      setMostrarCotManual(false);
      setCotManual(COT_MANUAL_INICIAL);
      cargarCotizaciones();
    } catch {
      setCotManualMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setGuardandoCotManual(false);
    }
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

  const subirComprobanteLiq = async (file: File | null) => {
    if (!file) return;
    setSubiendoComprobante(true); setLiqMsg('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/upload/documento', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setLiqMsg(d.error || 'No se pudo subir el comprobante.'); return; }
      setComprobanteUrl(d.url);
      setLiqMsg('✓ Comprobante adjuntado. Ahora marca el pago como realizado.');
    } catch {
      setLiqMsg('Sin conexión al subir el comprobante.');
    } finally {
      setSubiendoComprobante(false);
    }
  };

  const marcarLiquidacionPagada = async (reservaIds: number[]) => {
    setPagandoIds(prev => new Set([...prev, ...reservaIds]));
    setLiqMsg('');
    try {
      const res = await fetch('/api/contabilidad/liquidaciones', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reserva_ids: reservaIds, comprobante, comprobante_url: comprobanteUrl }),
      });
      const d = await res.json().catch(() => ({})) as {
        error?: string; actualizados?: number;
        omitidos?: Array<{ reserva_id: number; marca: string; modelo: string; motivo: string }>;
      };
      const omitidos = d.omitidos || [];
      if (res.ok) {
        const detalleOmitidos = omitidos.length > 0
          ? ` ⚠ ${omitidos.length} quedaron sin pagar: ${omitidos.map(o => `${o.marca} ${o.modelo} (${o.motivo})`).join('; ')}`
          : '';
        setLiqMsg(`✓ ${d.actualizados ?? reservaIds.length} pago(s) registrado(s) y propietario notificado.${detalleOmitidos}`);
        setComprobante(''); setComprobanteUrl('');
        cargarLiquidaciones();
        if (omitidos.length === 0) setTimeout(() => setLiqMsg(''), 4000);
      } else {
        const detalleOmitidos = omitidos.length > 0
          ? ` (${omitidos.map(o => `${o.marca} ${o.modelo}: ${o.motivo}`).join('; ')})`
          : '';
        setLiqMsg(`${d.error || 'Error al registrar el pago.'}${detalleOmitidos}`);
      }
    } catch {
      setLiqMsg('Sin conexión al registrar el pago.');
    } finally {
      setPagandoIds(prev => { const n = new Set(prev); reservaIds.forEach(id => n.delete(id)); return n; });
    }
  };

  // ── Edición de liquidaciones ──────────────────────────────────────────────
  const abrirEdicion = (grupo: LiquidacionGrupo, fila: LiquidacionFila) => {
    setEdicionMsg('');
    setEdicion({
      grupo, fila,
      bruto: String(Math.round(fila.bruto)),
      motivoBruto: '',
      comisionPct: String(fila.comision_pct),
      motivoComision: '',
      nuevas: [],
      quitar: {},
      confirmarNegativo: false,
    });
  };

  // Vista previa del neto con los cambios del modal aplicados, calculada con la MISMA
  // función del servidor. Lo que el admin ve antes de guardar es lo que se guarda.
  const previewEdicion = (e: EdicionState) => {
    const conceptos = [
      ...e.fila.conceptos.filter(c => e.quitar[c.id] === undefined).map(c => ({ tipo: c.tipo, monto: c.monto })),
      ...e.nuevas.filter(n => Number(n.monto) > 0).map(n => ({ tipo: n.tipo, monto: Number(n.monto) })),
    ];
    const bruto = e.bruto.trim() === '' ? e.fila.bruto : Number(e.bruto);
    const pct = e.comisionPct.trim() === '' ? e.fila.comision_pct : Number(e.comisionPct);
    return calcularTotalesLiquidacion(bruto, pct, conceptos);
  };

  const guardarEdicion = async () => {
    if (!edicion) return;
    const e = edicion;
    const brutoNum = Number(e.bruto);
    const pctNum = Number(e.comisionPct);
    const cambiaBruto = e.bruto.trim() !== '' && Math.round(brutoNum) !== Math.round(e.fila.bruto);
    const cambiaPct = e.comisionPct.trim() !== '' && pctNum !== e.fila.comision_pct;
    const nuevas = e.nuevas.filter(n => n.concepto.trim() || n.monto.trim() || n.motivo.trim());
    const quitarIds = Object.keys(e.quitar).map(Number);

    if (!cambiaBruto && !cambiaPct && nuevas.length === 0 && quitarIds.length === 0) {
      setEdicionMsg('No hay cambios para guardar.'); return;
    }
    if (cambiaBruto && !e.motivoBruto.trim()) { setEdicionMsg('Escribe el motivo del cambio de base de liquidación.'); return; }
    if (cambiaPct && !e.motivoComision.trim()) { setEdicionMsg('Escribe el motivo del cambio de comisión.'); return; }
    for (const n of nuevas) {
      if (!n.concepto.trim()) { setEdicionMsg('Cada línea necesita una descripción (ej. "Lavada").'); return; }
      if (!(Number(n.monto) > 0)) { setEdicionMsg(`El monto de "${n.concepto}" debe ser mayor que cero.`); return; }
      if (!n.motivo.trim()) { setEdicionMsg(`Falta el motivo de "${n.concepto}". Es obligatorio.`); return; }
    }
    for (const id of quitarIds) {
      if (!(e.quitar[id] || '').trim()) { setEdicionMsg('Falta el motivo para quitar uno de los conceptos.'); return; }
    }

    setGuardandoEdicion(true); setEdicionMsg('');
    try {
      const res = await fetch('/api/contabilidad/liquidaciones', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reserva_id: e.fila.reserva_id,
          ...(cambiaBruto ? { bruto: Math.round(brutoNum), motivo_bruto: e.motivoBruto.trim() } : {}),
          ...(cambiaPct ? { comision_pct: pctNum, motivo_comision: e.motivoComision.trim() } : {}),
          agregar: nuevas.map(n => ({ tipo: n.tipo, concepto: n.concepto.trim(), monto: Number(n.monto), motivo: n.motivo.trim() })),
          quitar: quitarIds.map(id => ({ id, motivo: e.quitar[id].trim() })),
          confirmar_neto_negativo: e.confirmarNegativo,
        }),
      });
      const d = await res.json().catch(() => ({})) as {
        error?: string; requiere_confirmacion?: boolean;
        cuenta_cobro?: { accion: string; numero: string; neto: number; anulada: { numero: string; neto: number } | null };
      };
      if (!res.ok) {
        setEdicionMsg(d.error || 'No se pudo guardar la edición.');
        return;
      }
      const cc = d.cuenta_cobro;
      setLiqMsg(cc?.anulada
        ? `✓ Liquidación actualizada. Se anuló la cuenta ${cc.anulada.numero} (${cop(cc.anulada.neto)}) y se emitió ${cc.numero} por ${cop(cc.neto)}. El propietario ya fue avisado; el pago queda bloqueado hasta su nueva firma.`
        : `✓ Liquidación actualizada. Cuenta de cobro ${cc?.numero || ''} regenerada por ${cop(cc?.neto || 0)}.`);
      setEdicion(null);
      cargarLiquidaciones();
    } catch {
      setEdicionMsg('Sin conexión al guardar la edición.');
    } finally {
      setGuardandoEdicion(false);
    }
  };

  // ── Ajustes pendientes (liquidación YA PAGADA: no se toca, se cobra en la siguiente) ──
  const guardarAjuste = async () => {
    if (!ajusteNuevo) return;
    if (!ajusteNuevo.concepto.trim()) { setLiqMsg('El ajuste necesita una descripción.'); return; }
    if (!(Number(ajusteNuevo.monto) > 0)) { setLiqMsg('El monto del ajuste debe ser mayor que cero.'); return; }
    if (!ajusteNuevo.motivo.trim()) { setLiqMsg('El motivo del ajuste es obligatorio.'); return; }
    setGuardandoAjuste(true);
    try {
      const res = await fetch('/api/contabilidad/ajustes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propietario_id: ajusteNuevo.grupo.propietario_id,
          tipo: ajusteNuevo.tipo,
          concepto: ajusteNuevo.concepto.trim(),
          monto: Number(ajusteNuevo.monto),
          motivo: ajusteNuevo.motivo.trim(),
          reserva_origen_id: ajusteNuevo.fila.reserva_id,
        }),
      });
      const d = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setLiqMsg(d.error || 'No se pudo registrar el ajuste.'); return; }
      setLiqMsg(`✓ Ajuste registrado. Se aplicará automáticamente a la próxima liquidación de ${ajusteNuevo.grupo.propietario_nombre}.`);
      setAjusteNuevo(null);
      cargarLiquidaciones();
    } catch {
      setLiqMsg('Sin conexión al registrar el ajuste.');
    } finally {
      setGuardandoAjuste(false);
    }
  };

  const anularAjuste = async (a: AjustePendiente) => {
    const motivo = window.prompt(`¿Por qué anulas el ajuste "${a.concepto}" (${cop(a.monto)})? El motivo queda en la bitácora.`);
    if (motivo === null) return;
    if (!motivo.trim()) { setLiqMsg('El motivo de anulación es obligatorio.'); return; }
    try {
      const res = await fetch('/api/contabilidad/ajustes', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, motivo: motivo.trim() }),
      });
      const d = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setLiqMsg(d.error || 'No se pudo anular el ajuste.'); return; }
      setLiqMsg('✓ Ajuste anulado.');
      cargarLiquidaciones();
    } catch {
      setLiqMsg('Sin conexión al anular el ajuste.');
    }
  };

  const guardarConfig = async () => {
    setGuardandoConfig(true); setConfigMsg('');
    try {
      const pct = Number(config.comision_plataforma_pct);
      if (config.comision_plataforma_pct && (!Number.isFinite(pct) || pct <= 0 || pct >= 1)) {
        setConfigMsg('La comisión debe ser un número entre 0 y 1 (ej. 0.35 para 35%).');
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
      // La tarifa va en PORCENTAJE ENTERO (19 = 19%), no en fracción: sale impresa
      // en letras dentro del contrato y un decimal no se podría escribir.
      const ivaPct = Number(config.iva_pct);
      if (config.iva_pct && (!Number.isFinite(ivaPct) || !Number.isInteger(ivaPct) || ivaPct < 0 || ivaPct > 100)) {
        setConfigMsg('La tarifa de IVA debe ser un número entero entre 0 y 100 (ej. 19).');
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

  const extraerDeComprobante = async (url: string) => {
    setExtrayendo(true); setGastoMsg('');
    try {
      const res = await fetch('/api/contabilidad/gastos/extraer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setGastoMsg(d.error || 'No se pudo leer el documento — complétalo a mano.'); return; }
      const x = d.datos as {
        proveedor: string | null; nit_proveedor: string | null; numero_factura: string | null; fecha: string | null;
        subtotal: number | null; iva: number | null; total: number | null; abonado: number | null;
        categoria_sugerida: CategoriaGasto | null; descripcion: string | null; metodo_pago: string | null;
        confianza: string; nota_ia: string | null;
      };
      setGForm(f => {
        // Si la IA detectó un abono ya realizado, lo pre-carga como un medio de pago (el usuario ajusta).
        const pagos = x.abonado != null && x.abonado > 0
          ? [{ metodo: x.metodo_pago ?? '', valor: String(x.abonado) }]
          : f.pagos;
        return {
          ...f,
          proveedor: x.proveedor ?? f.proveedor,
          nit_proveedor: x.nit_proveedor ?? f.nit_proveedor,
          numero_factura: x.numero_factura ?? f.numero_factura,
          fecha: x.fecha ?? f.fecha,
          subtotal: x.subtotal != null ? String(x.subtotal) : f.subtotal,
          iva: x.iva != null ? String(x.iva) : f.iva,
          total: x.total != null ? String(x.total) : f.total,
          categoria: x.categoria_sugerida ?? f.categoria,
          descripcion: x.descripcion ?? f.descripcion,
          pagos,
          extraido_ia: true,
        };
      });
      setGastoMsg(`✓ Datos leídos por la IA (confianza ${x.confianza}). Revisa el TOTAL y los abonos, y guarda.${x.nota_ia ? ' Nota: ' + x.nota_ia : ''}`);
    } catch {
      setGastoMsg('Sin conexión al leer el documento.');
    } finally {
      setExtrayendo(false);
    }
  };

  const manejarArchivo = async (file: File | null) => {
    if (!file) return;
    setGastoMsg(''); setSubiendo(true); setMostrarForm(true); setEditandoId(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/upload/documento', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setGastoMsg(d.error || 'No se pudo subir el archivo.'); return; }
      setGForm(f => ({ ...f, comprobante_url: d.url }));
      await extraerDeComprobante(d.url);
    } catch {
      setGastoMsg('Sin conexión al subir el archivo.');
    } finally {
      setSubiendo(false);
    }
  };

  const subirComprobantePago = async (file: File | null) => {
    if (!file) return;
    setGastoMsg(''); setSubiendoPago(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/upload/documento', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setGastoMsg(d.error || 'No se pudo subir el comprobante de pago.'); return; }
      setGForm(f => ({ ...f, comprobante_pago_url: d.url }));
      setGastoMsg('✓ Comprobante de pago adjuntado.');
    } catch {
      setGastoMsg('Sin conexión al subir el comprobante de pago.');
    } finally {
      setSubiendoPago(false);
    }
  };

  const abrirEditar = (g: Gasto) => {
    setVerGasto(null);
    setEditandoId(g.id);
    setGForm({
      categoria: g.categoria,
      proveedor: g.proveedor || '',
      nit_proveedor: g.nit_proveedor || '',
      numero_factura: g.numero_factura || '',
      fecha: g.fecha || hoy(),
      subtotal: g.subtotal ? String(g.subtotal) : '',
      iva: g.iva ? String(g.iva) : '',
      total: g.total ? String(g.total) : '',
      pagos: (g.pagos || []).map(p => ({ metodo: p.metodo, valor: String(p.valor) })),
      recurrente: !!g.recurrente,
      descripcion: g.descripcion || '',
      notas: g.notas || '',
      comprobante_url: g.comprobante_url || '',
      comprobante_pago_url: g.comprobante_pago_url || '',
      extraido_ia: !!g.extraido_ia,
    });
    setMostrarForm(true);
    setGastoMsg('');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmarAnular = async () => {
    if (!anularGasto) return;
    setProcesandoAnular(true);
    try {
      const res = await fetch('/api/contabilidad/gastos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: anularGasto.id, accion: 'anular', motivo: motivoAnular }),
      });
      if (res.ok) {
        setAnularGasto(null); setMotivoAnular(''); setVerGasto(null);
        cargarGastos(); cargarResumen();
      }
    } catch { /* reintentar */ }
    finally { setProcesandoAnular(false); }
  };

  const restaurarGasto = async (id: number) => {
    try {
      const res = await fetch('/api/contabilidad/gastos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, accion: 'restaurar' }),
      });
      if (res.ok) { cargarGastos(); cargarResumen(); }
    } catch { /* reintentar */ }
  };

  const cerrarForm = () => { setMostrarForm(false); setEditandoId(null); setGForm(GFORM_INICIAL); setGastoMsg(''); };

  const guardarGasto = async () => {
    const total = Number(gForm.total);
    if (!Number.isFinite(total) || total <= 0) { setGastoMsg('El total del gasto debe ser un número mayor a 0.'); return; }
    const pagos = gForm.pagos
      .map(p => ({ metodo: p.metodo, valor: Number(p.valor) || 0 }))
      .filter(p => p.valor > 0);
    const abonado = pagos.reduce((s, p) => s + p.valor, 0);
    if (abonado > total + 0.5) { setGastoMsg('Los abonos por medio de pago no pueden superar el total del gasto.'); return; }
    setGuardandoGasto(true); setGastoMsg('');
    try {
      const res = await fetch('/api/contabilidad/gastos', {
        method: editandoId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editandoId ? { id: editandoId } : {}),
          ...gForm,
          subtotal: Number(gForm.subtotal) || 0,
          iva: Number(gForm.iva) || 0,
          total,
          pagos,
        }),
      });
      if (res.ok) {
        setGastoMsg(editandoId ? '✓ Cambios guardados.' : '✓ Gasto registrado.');
        setGForm(GFORM_INICIAL);
        setMostrarForm(false);
        setEditandoId(null);
        cargarGastos();
        cargarResumen();
        setTimeout(() => setGastoMsg(''), 4000);
      } else {
        const d = await res.json().catch(() => ({}));
        setGastoMsg(d.error || 'Error al guardar el gasto.');
      }
    } catch {
      setGastoMsg('Sin conexión al guardar.');
    } finally {
      setGuardandoGasto(false);
    }
  };

  const eliminarGasto = async (id: number) => {
    if (typeof window !== 'undefined' && !window.confirm('¿Eliminar este gasto DEFINITIVAMENTE? Esta acción no se puede deshacer. (Para conservarlo, mejor déjalo en Anulados.)')) return;
    setEliminandoId(id);
    try {
      const res = await fetch(`/api/contabilidad/gastos?id=${id}`, { method: 'DELETE' });
      if (res.ok) { cargarGastos(); cargarResumen(); }
    } catch { /* el usuario puede reintentar */ }
    finally { setEliminandoId(null); }
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
          { key: 'gastos', label: 'Gastos' },
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

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-accent-light rounded-2xl border border-accent/20 p-4">
                  <p className="text-[11px] text-accent uppercase tracking-wide">Comisión DrivePass (ingreso empresa)</p>
                  <p className="text-xl font-black text-accent mt-1">{cop(resumen.comision_total)}</p>
                </div>
                <div className="bg-danger/10 rounded-2xl border border-danger/25 p-4">
                  <p className="text-[11px] text-danger uppercase tracking-wide">Gastos del período</p>
                  <p className="text-xl font-black text-danger mt-1">{cop(resumen.gastos_total)}</p>
                  <button onClick={() => setSubTab('gastos')} className="text-[11px] text-accent hover:underline mt-0.5">Ver / agregar →</button>
                </div>
                <div className={`rounded-2xl border p-4 ${resumen.utilidad_estimada >= 0 ? 'bg-success/10 border-success/25' : 'bg-danger/10 border-danger/25'}`}>
                  <p className={`text-[11px] uppercase tracking-wide ${resumen.utilidad_estimada >= 0 ? 'text-success' : 'text-danger'}`}>Utilidad estimada</p>
                  <p className={`text-xl font-black mt-1 ${resumen.utilidad_estimada >= 0 ? 'text-success' : 'text-danger'}`}>{cop(resumen.utilidad_estimada)}</p>
                  <p className="text-[11px] text-ink/40 mt-0.5">Comisión − gastos</p>
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

      {/* ── GASTOS ── */}
      {subTab === 'gastos' && (
        <div className="space-y-4">
          {/* Inputs ocultos: archivo (PDF/foto de galería), cámara y comprobante de pago */}
          <input ref={inputArchivoRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={e => { manejarArchivo(e.target.files?.[0] || null); e.target.value = ''; }} />
          <input ref={inputCamaraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { manejarArchivo(e.target.files?.[0] || null); e.target.value = ''; }} />
          <input ref={inputPagoRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={e => { subirComprobantePago(e.target.files?.[0] || null); e.target.value = ''; }} />

          {/* Captura */}
          <div className="bg-accent-light border border-accent/20 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-bold text-ink">Agregar un gasto</p>
              <p className="text-[11px] text-ink/50">Sube la factura o recibo (PDF o foto) y la IA extrae proveedor, fecha y montos. O regístralo a mano.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => inputArchivoRef.current?.click()} disabled={subiendo || extrayendo}
                className="flex items-center gap-2 text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2.5 rounded-xl transition disabled:opacity-60">
                <IconUpload size={15} /> Subir archivo / PDF
              </button>
              <button onClick={() => inputCamaraRef.current?.click()} disabled={subiendo || extrayendo}
                className="flex items-center gap-2 text-sm font-semibold bg-surface border border-accent/30 text-accent hover:bg-accent-light px-4 py-2.5 rounded-xl transition disabled:opacity-60">
                <IconPhoto size={15} /> Tomar foto
              </button>
              <button onClick={() => { setEditandoId(null); setGForm(GFORM_INICIAL); setMostrarForm(true); setGastoMsg(''); }}
                className="flex items-center gap-2 text-sm font-medium border border-border text-ink/70 hover:bg-surface px-4 py-2.5 rounded-xl transition">
                + Registrar manual
              </button>
            </div>
            {(subiendo || extrayendo) && (
              <p className="text-xs text-accent flex items-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                {subiendo ? 'Subiendo comprobante…' : 'Leyendo el documento con IA…'}
              </p>
            )}
          </div>

          {gastoMsg && (
            <div className={`text-sm px-4 py-2.5 rounded-xl border ${gastoMsg.startsWith('✓') ? 'bg-success/10 text-success border-success/30' : 'bg-danger/10 text-danger border-danger/25'}`}>{gastoMsg}</div>
          )}

          {/* Formulario */}
          {mostrarForm && (
            <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-ink">{editandoId ? 'Editar gasto' : 'Datos del gasto'} {gForm.extraido_ia && <span className="text-[10px] font-semibold text-accent bg-accent-light border border-accent/20 rounded-full px-2 py-0.5 ml-1">IA</span>}</p>
                <button onClick={cerrarForm} className="text-ink/40 hover:text-ink"><IconX size={16} /></button>
              </div>
              {gForm.comprobante_url && (
                <a href={verUrl(gForm.comprobante_url)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                  <IconExport size={12} /> Ver factura/soporte subido
                </a>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">Categoría</label>
                  <select value={gForm.categoria} onChange={e => setGForm(f => ({ ...f, categoria: e.target.value as CategoriaGasto }))}
                    className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
                    {CATS_GASTO.map(c => <option key={c} value={c}>{CAT_GASTO[c].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">Fecha</label>
                  <input type="date" value={gForm.fecha} onChange={e => setGForm(f => ({ ...f, fecha: e.target.value }))}
                    className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">Proveedor</label>
                  <input value={gForm.proveedor} onChange={e => onProveedorGastoChange(e.target.value)} list="lista-proveedores"
                    placeholder="Ej. EPM, Terpel, Automax…" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                  <datalist id="lista-proveedores">
                    {proveedores.map(p => <option key={p.id} value={p.nombre} />)}
                  </datalist>
                  <p className="text-[10px] text-ink/40 mt-0.5">Se guarda solo en tu catálogo — la próxima vez te aparece sugerido.</p>
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">NIT / documento del proveedor</label>
                  <input value={gForm.nit_proveedor} onChange={e => setGForm(f => ({ ...f, nit_proveedor: e.target.value }))}
                    placeholder="900.000.000-0" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">N° de factura / recibo</label>
                  <input value={gForm.numero_factura} onChange={e => setGForm(f => ({ ...f, numero_factura: e.target.value }))}
                    className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">Subtotal (base)</label>
                  <input value={gForm.subtotal} onChange={e => setGForm(f => ({ ...f, subtotal: e.target.value.replace(/[^0-9.]/g, '') }))}
                    placeholder="0" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">IVA / impuestos</label>
                  <input value={gForm.iva} onChange={e => setGForm(f => ({ ...f, iva: e.target.value.replace(/[^0-9.]/g, '') }))}
                    placeholder="0" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">Total del gasto *</label>
                  <input value={gForm.total} onChange={e => setGForm(f => ({ ...f, total: e.target.value.replace(/[^0-9.]/g, '') }))}
                    placeholder="0" className="w-full bg-surface border border-accent/40 rounded-xl px-3 py-2 text-sm text-ink font-semibold" />
                  <p className="text-[10px] text-ink/40 mt-0.5">Valor total del bien o servicio (no lo que abonaste).</p>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer text-ink/70">
                    <input type="checkbox" checked={gForm.recurrente} onChange={e => setGForm(f => ({ ...f, recurrente: e.target.checked }))} />
                    Gasto recurrente (mensual)
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[11px] text-ink/50 block mb-1">Descripción</label>
                  <input value={gForm.descripcion} onChange={e => setGForm(f => ({ ...f, descripcion: e.target.value }))}
                    placeholder="Qué se compró o pagó" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[11px] text-ink/50 block mb-1">Notas (opcional)</label>
                  <textarea value={gForm.notas} onChange={e => setGForm(f => ({ ...f, notas: e.target.value }))} rows={2}
                    className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink resize-none" />
                </div>
              </div>

              {/* Pago mixto: un campo por medio de pago */}
              <div className="border-t border-border pt-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">Medios de pago / abonos</p>
                    <p className="text-[11px] text-ink/50">Pago mixto: agrega cuánto pagaste con cada medio. Déjalo vacío si aún no has pagado nada.</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {gForm.pagos.length === 0 && (
                      <button type="button"
                        onClick={() => setGForm(f => ({ ...f, pagos: [...f.pagos, { metodo: '', valor: f.total || '' }] }))}
                        disabled={!Number(gForm.total)}
                        className="text-xs font-semibold border border-success/40 text-success px-3 py-1.5 rounded-xl hover:bg-success/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Agrega un abono con el valor total del gasto">
                        ✓ Pago completo
                      </button>
                    )}
                    <button type="button" onClick={() => setGForm(f => ({ ...f, pagos: [...f.pagos, { metodo: '', valor: '' }] }))}
                      className="text-xs font-semibold border border-accent/30 text-accent px-3 py-1.5 rounded-xl hover:bg-accent-light transition">
                      + Agregar medio
                    </button>
                  </div>
                </div>
                {gForm.pagos.length === 0 ? (
                  <p className="text-xs text-ink/40 italic">Sin abonos — el gasto queda 100% pendiente por pagar.</p>
                ) : (
                  <div className="space-y-2">
                    {gForm.pagos.map((p, i) => {
                      const saldoRestante = Math.max(0, (Number(gForm.total) || 0) - sumaPagos(gForm.pagos.filter((_, j) => j !== i)));
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <select value={p.metodo} onChange={e => setGForm(f => ({ ...f, pagos: f.pagos.map((pp, j) => j === i ? { ...pp, metodo: e.target.value } : pp) }))}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink flex-shrink-0 min-w-[130px]">
                            <option value="">Medio…</option>
                            {METODOS_PAGO.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                          </select>
                          <input value={p.valor} onChange={e => setGForm(f => ({ ...f, pagos: f.pagos.map((pp, j) => j === i ? { ...pp, valor: e.target.value.replace(/[^0-9.]/g, '') } : pp) }))}
                            placeholder="Valor abonado" className="flex-1 min-w-0 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                          <button type="button"
                            onClick={() => setGForm(f => ({ ...f, pagos: f.pagos.map((pp, j) => j === i ? { ...pp, valor: String(saldoRestante) } : pp) }))}
                            disabled={!Number(gForm.total)}
                            className="text-[11px] font-semibold text-accent border border-accent/30 rounded-lg px-2 py-2 hover:bg-accent-light transition flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Rellenar con el saldo pendiente del total">
                            Todo
                          </button>
                          <button type="button" onClick={() => setGForm(f => ({ ...f, pagos: f.pagos.filter((_, j) => j !== i) }))}
                            className="text-danger/70 hover:text-danger flex-shrink-0"><IconX size={15} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(() => {
                  const abonado = sumaPagos(gForm.pagos);
                  const totalN = Number(gForm.total) || 0;
                  const saldo = totalN - abonado;
                  return (
                    <div className="flex flex-wrap gap-2 mt-3 text-xs">
                      <span className="bg-surface border border-border rounded-lg px-2.5 py-1 text-ink/70">Total: <strong>{cop(totalN)}</strong></span>
                      <span className="bg-surface border border-border rounded-lg px-2.5 py-1 text-ink/70">Abonado: <strong>{cop(abonado)}</strong></span>
                      <span className={`rounded-lg px-2.5 py-1 border ${saldo <= 0 && totalN > 0 ? 'bg-success/15 text-success border-success/30' : 'bg-warning/15 text-warning border-warning/25'}`}>
                        {saldo <= 0 && totalN > 0 ? '✓ Pagado en su totalidad' : `Saldo pendiente: ${cop(saldo)}`}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Comprobante de pago (foto/PDF de la transferencia o recibo de pago) */}
              <div className="border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">Comprobante de pago</p>
                    <p className="text-[11px] text-ink/50">Foto o PDF del pago (transferencia, recibo). Es distinto de la factura del proveedor.</p>
                  </div>
                  <button type="button" onClick={() => inputPagoRef.current?.click()} disabled={subiendoPago}
                    className="flex items-center gap-2 text-sm font-medium border border-accent/30 text-accent hover:bg-accent-light px-4 py-2 rounded-xl transition disabled:opacity-60">
                    <IconUpload size={14} /> {subiendoPago ? 'Subiendo…' : gForm.comprobante_pago_url ? 'Cambiar' : 'Adjuntar'}
                  </button>
                </div>
                {gForm.comprobante_pago_url && (
                  <p className="text-xs text-success flex items-center gap-2 mt-2">
                    ✓ Adjuntado — <a href={verUrl(gForm.comprobante_pago_url)} target="_blank" rel="noopener noreferrer" className="underline">ver</a>
                    <button type="button" onClick={() => setGForm(f => ({ ...f, comprobante_pago_url: '' }))} className="text-ink/40 hover:text-danger underline">quitar</button>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button onClick={guardarGasto} disabled={guardandoGasto || subiendo || extrayendo}
                  className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-60">
                  {guardandoGasto ? 'Guardando…' : editandoId ? 'Guardar cambios' : 'Guardar gasto'}
                </button>
                <button onClick={cerrarForm}
                  className="text-sm text-ink/50 hover:text-ink px-3 py-2.5">Cancelar</button>
              </div>
            </div>
          )}

          {/* Vista: activos / anulados */}
          <div className="flex gap-2">
            <button onClick={() => setGEstado('activo')}
              className={`text-sm font-medium px-3.5 py-2 rounded-xl border transition ${gEstado === 'activo' ? 'bg-accent-light text-accent border-accent/30' : 'border-border text-ink/50 hover:text-ink'}`}>
              Activos
            </button>
            <button onClick={() => setGEstado('anulado')}
              className={`text-sm font-medium px-3.5 py-2 rounded-xl border transition ${gEstado === 'anulado' ? 'bg-danger/10 text-danger border-danger/30' : 'border-border text-ink/50 hover:text-ink'}`}>
              Anulados{anuladosCount > 0 ? ` (${anuladosCount})` : ''}
            </button>
          </div>

          {/* Filtros + total */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Desde</label>
              <input type="date" value={gDesde} onChange={e => setGDesde(e.target.value)}
                className="border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Hasta</label>
              <input type="date" value={gHasta} onChange={e => setGHasta(e.target.value)}
                className="border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface" />
            </div>
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Categoría</label>
              <select value={gCategoria} onChange={e => setGCategoria(e.target.value)}
                className="border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface">
                <option value="">Todas</option>
                {CATS_GASTO.map(c => <option key={c} value={c}>{CAT_GASTO[c].label}</option>)}
              </select>
            </div>
            <div className="min-w-[180px]">
              <label className="text-[11px] text-ink/50 block mb-1">Buscar por nombre</label>
              <input value={gQueryInput} onChange={e => setGQueryInput(e.target.value)}
                placeholder="Proveedor, descripción o N° factura…"
                className="border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface w-full" />
            </div>
            <button onClick={exportarGastosExcel} disabled={exportandoExcel || gastosTotalFilas === 0}
              className="flex items-center gap-2 text-sm font-medium border border-border text-ink/70 hover:bg-surface px-3.5 py-2 rounded-xl transition disabled:opacity-50">
              <IconExport size={14} /> {exportandoExcel ? 'Generando…' : 'Descargar Excel'}
            </button>
            <div className="ml-auto flex flex-wrap gap-2">
              <div className="bg-surface-2 border border-border rounded-2xl px-4 py-2.5 text-right">
                <p className="text-[11px] text-ink/50 font-medium">Total gastos ({gastosTotalFilas})</p>
                <p className="text-xl font-black text-danger">{cop(gastosTotal)}</p>
              </div>
              <div className="bg-surface-2 border border-border rounded-2xl px-4 py-2.5 text-right">
                <p className="text-[11px] text-ink/50 font-medium">Abonado</p>
                <p className="text-xl font-black text-success">{cop(gastosAbonado)}</p>
              </div>
              <div className="bg-surface-2 border border-border rounded-2xl px-4 py-2.5 text-right">
                <p className="text-[11px] text-ink/50 font-medium">Pendiente</p>
                <p className="text-xl font-black text-warning">{cop(gastosPendiente)}</p>
              </div>
            </div>
          </div>

          {/* Desglose por categoría */}
          {gastosPorCategoria.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {gastosPorCategoria.map(c => (
                <span key={c.categoria} className={`text-xs px-3 py-1.5 rounded-full border ${CAT_GASTO[c.categoria as CategoriaGasto]?.badge || 'bg-surface border-border text-ink/60'}`}>
                  {CAT_GASTO[c.categoria as CategoriaGasto]?.label || c.categoria}: <strong>{cop(c.total)}</strong> ({c.n})
                </span>
              ))}
            </div>
          )}

          {/* Lista */}
          {errorGastos ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">{errorGastos}</p>
              <button onClick={cargarGastos} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : cargandoGastos ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="bg-surface-2 rounded-xl border border-border h-16 animate-pulse" />)}</div>
          ) : gastos.length === 0 ? (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <p className="text-ink/40">{gEstado === 'anulado' ? 'No hay gastos anulados.' : 'No hay gastos registrados en este período.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {gastos.map(g => (
                <div key={g.id} className={`bg-surface-2 rounded-xl border p-3.5 flex items-center justify-between gap-3 flex-wrap ${g.estado === 'anulado' ? 'border-danger/25 opacity-70' : 'border-border'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    {g.comprobante_url ? (
                      esPdfUrl(g.comprobante_url) ? (
                        <a href={g.comprobante_url} target="_blank" rel="noopener noreferrer" title="Ver factura/soporte"
                          className="flex-shrink-0 w-11 h-11 rounded-lg border border-border bg-surface flex items-center justify-center text-[10px] font-bold text-ink/50">PDF</a>
                      ) : (
                        <a href={verUrl(g.comprobante_url)} target="_blank" rel="noopener noreferrer" title="Ver factura/soporte" className="flex-shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumbUrl(g.comprobante_url)} alt="comprobante" loading="lazy" className="w-11 h-11 rounded-lg border border-border object-cover" />
                        </a>
                      )
                    ) : (
                      <div className="flex-shrink-0 w-11 h-11 rounded-lg border border-dashed border-border flex items-center justify-center text-ink/25 text-lg">—</div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">
                        {g.proveedor || g.descripcion || 'Gasto'}
                        {g.numero_factura ? ` · ${g.numero_factura}` : ''}
                        {g.estado === 'anulado' ? <span className="text-[10px] font-semibold text-danger bg-danger/10 border border-danger/25 rounded-full px-1.5 py-0.5 ml-1">ANULADO</span> : null}
                      </p>
                      <p className="text-xs text-ink/50 truncate">
                        {g.fecha}{g.descripcion && g.proveedor ? ` · ${g.descripcion}` : ''}
                        {g.pagos && g.pagos.length > 0 ? ` · ${g.pagos.map(p => `${metodoLabel(p.metodo)} ${cop(p.valor)}`).join(' + ')}` : ''}
                        {g.recurrente ? ' · 🔁 recurrente' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${CAT_GASTO[g.categoria]?.badge || ''}`}>{CAT_GASTO[g.categoria]?.label || g.categoria}</span>
                    {g.extraido_ia ? <span className="text-[10px] font-semibold text-accent bg-accent-light border border-accent/20 rounded-full px-1.5 py-0.5">IA</span> : null}
                    <div className="text-right mr-1">
                      <p className="text-sm font-bold text-ink">{cop(g.total)}</p>
                      {(() => {
                        const saldo = g.total - (g.abonado || 0);
                        if (saldo <= 0.5) return <p className="text-[10px] font-semibold text-success">✓ pagado</p>;
                        if ((g.abonado || 0) > 0) return <p className="text-[10px] text-warning">abona {cop(g.abonado)} · falta {cop(saldo)}</p>;
                        return <p className="text-[10px] text-warning">pendiente</p>;
                      })()}
                    </div>
                    <button onClick={() => setVerGasto(g)}
                      className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                      Ver
                    </button>
                    {g.estado === 'anulado' ? (
                      <>
                        <button onClick={() => restaurarGasto(g.id)}
                          className="text-xs border border-success/40 text-success px-2.5 py-1.5 rounded-xl hover:bg-success/10 transition font-medium">
                          Restaurar
                        </button>
                        <button onClick={() => eliminarGasto(g.id)} disabled={eliminandoId === g.id}
                          className="text-xs border border-danger/30 text-danger px-2 py-1.5 rounded-xl hover:bg-danger/10 transition disabled:opacity-50" title="Eliminar definitivamente">
                          {eliminandoId === g.id ? '…' : <IconX size={13} />}
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => abrirEditar(g)}
                          className="text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                          Editar
                        </button>
                        <button onClick={() => descargarGastoPDF(empresaParaPdf, g)}
                          className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium flex items-center gap-1">
                          <IconExport size={12} /> PDF
                        </button>
                        <button onClick={() => { setAnularGasto(g); setMotivoAnular(''); }}
                          className="text-xs border border-danger/30 text-danger px-2.5 py-1.5 rounded-xl hover:bg-danger/10 transition font-medium">
                          Anular
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paginación (15 por página) */}
          {!errorGastos && !cargandoGastos && gastosTotalFilas > gastosPorPagina && (() => {
            const totalPaginas = Math.max(1, Math.ceil(gastosTotalFilas / gastosPorPagina));
            const desdeN = (gPagina - 1) * gastosPorPagina + 1;
            const hastaN = Math.min(gastosTotalFilas, gPagina * gastosPorPagina);
            return (
              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                <p className="text-xs text-ink/50">Mostrando {desdeN}–{hastaN} de {gastosTotalFilas}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setGPagina(p => Math.max(1, p - 1))} disabled={gPagina <= 1}
                    className="text-xs font-medium border border-border text-ink/70 px-3 py-1.5 rounded-xl hover:bg-surface transition disabled:opacity-40 disabled:cursor-not-allowed">
                    ← Anterior
                  </button>
                  <span className="text-xs text-ink/50">Página {gPagina} de {totalPaginas}</span>
                  <button onClick={() => setGPagina(p => Math.min(totalPaginas, p + 1))} disabled={gPagina >= totalPaginas}
                    className="text-xs font-medium border border-border text-ink/70 px-3 py-1.5 rounded-xl hover:bg-surface transition disabled:opacity-40 disabled:cursor-not-allowed">
                    Siguiente →
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Modal: ver detalle del gasto (solo lectura) */}
          {verGasto && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setVerGasto(null)}>
              <div className="bg-surface rounded-2xl border border-border max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-ink">{verGasto.proveedor || 'Gasto'}</p>
                    <p className="text-xs text-ink/50">GTO-{String(verGasto.id).padStart(6, '0')} · {verGasto.fecha} · {CAT_GASTO[verGasto.categoria]?.label || verGasto.categoria}
                      {verGasto.estado === 'anulado' ? ' · ANULADO' : ''}</p>
                  </div>
                  <button onClick={() => setVerGasto(null)} className="text-ink/40 hover:text-ink"><IconX size={18} /></button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {verGasto.nit_proveedor && <div><p className="text-[11px] text-ink/50">NIT/Doc</p><p className="text-ink">{verGasto.nit_proveedor}</p></div>}
                  {verGasto.numero_factura && <div><p className="text-[11px] text-ink/50">N° factura</p><p className="text-ink">{verGasto.numero_factura}</p></div>}
                  <div><p className="text-[11px] text-ink/50">Total del gasto</p><p className="text-ink font-bold">{cop(verGasto.total)}</p></div>
                  <div><p className="text-[11px] text-ink/50">Abonado</p><p className="text-success font-semibold">{cop(verGasto.abonado)}</p></div>
                  <div><p className="text-[11px] text-ink/50">Saldo pendiente</p><p className="text-warning font-semibold">{cop(verGasto.total - (verGasto.abonado || 0))}</p></div>
                  {verGasto.recurrente ? <div><p className="text-[11px] text-ink/50">Recurrente</p><p className="text-ink">🔁 mensual</p></div> : null}
                </div>

                {verGasto.descripcion && <div><p className="text-[11px] text-ink/50">Descripción</p><p className="text-sm text-ink">{verGasto.descripcion}</p></div>}

                {verGasto.pagos && verGasto.pagos.length > 0 && (
                  <div>
                    <p className="text-[11px] text-ink/50 mb-1">Medios de pago</p>
                    <div className="space-y-1">
                      {verGasto.pagos.map((p, i) => (
                        <div key={i} className="flex justify-between text-sm bg-surface-2 border border-border rounded-lg px-3 py-1.5">
                          <span className="text-ink/70">{metodoLabel(p.metodo)}</span><span className="font-semibold text-ink">{cop(p.valor)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {verGasto.notas && <div><p className="text-[11px] text-ink/50">Notas</p><p className="text-sm text-ink/80">{verGasto.notas}</p></div>}
                {verGasto.motivo_anulacion && <div><p className="text-[11px] text-danger">Motivo de anulación</p><p className="text-sm text-danger/80">{verGasto.motivo_anulacion}</p></div>}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  {verGasto.comprobante_url && (
                    <a href={verUrl(verGasto.comprobante_url)} target="_blank" rel="noopener noreferrer"
                      className="text-xs border border-border text-ink/70 px-3 py-2 rounded-xl hover:bg-surface-2 transition font-medium flex items-center gap-1"><IconExport size={12} /> Factura/soporte</a>
                  )}
                  {verGasto.comprobante_pago_url && (
                    <a href={verUrl(verGasto.comprobante_pago_url)} target="_blank" rel="noopener noreferrer"
                      className="text-xs border border-success/40 text-success px-3 py-2 rounded-xl hover:bg-success/10 transition font-medium flex items-center gap-1"><IconExport size={12} /> Comprobante de pago</a>
                  )}
                  <button onClick={() => descargarGastoPDF(empresaParaPdf, verGasto)}
                    className="text-xs border border-border text-ink/70 px-3 py-2 rounded-xl hover:bg-surface-2 transition font-medium flex items-center gap-1"><IconExport size={12} /> Descargar PDF</button>
                  {verGasto.estado !== 'anulado' && (
                    <button onClick={() => abrirEditar(verGasto)}
                      className="text-xs border border-accent/30 text-accent px-3 py-2 rounded-xl hover:bg-accent-light transition font-medium ml-auto">Editar</button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Modal: confirmar anulación */}
          {anularGasto && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setAnularGasto(null)}>
              <div className="bg-surface rounded-2xl border border-border max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div>
                  <p className="text-base font-bold text-ink">¿Anular este gasto?</p>
                  <p className="text-sm text-ink/60 mt-1">{anularGasto.proveedor || 'Gasto'} · {cop(anularGasto.total)} · {anularGasto.fecha}</p>
                  <p className="text-xs text-ink/50 mt-2">No se elimina: pasa a la vista <strong>Anulados</strong> y deja de sumar en los totales. Podrás restaurarlo después.</p>
                </div>
                <div>
                  <label className="text-[11px] text-ink/50 block mb-1">Motivo (opcional)</label>
                  <input value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)}
                    placeholder="Ej. duplicado, error de digitación…" className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => setAnularGasto(null)} className="text-sm text-ink/60 hover:text-ink px-3 py-2">Cancelar</button>
                  <button onClick={confirmarAnular} disabled={procesandoAnular}
                    className="text-sm font-semibold bg-danger hover:bg-danger/85 text-white px-4 py-2 rounded-xl transition disabled:opacity-60">
                    {procesandoAnular ? 'Anulando…' : 'Anular gasto'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── COTIZACIONES ── */}
      {subTab === 'cotizaciones' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-ink/50">Cotizaciones automáticas (de una reserva real) y manuales (prospectos que aún no reservan).</p>
            <button onClick={() => { setCotManual(COT_MANUAL_INICIAL); setCotManualMsg(''); setMostrarCotManual(true); }}
              className="text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2.5 rounded-xl transition flex-shrink-0">
              + Nueva cotización
            </button>
          </div>

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
                    <p className="text-xs text-ink/50">{c.vehiculo_descripcion} · {c.dias} día{c.dias !== 1 ? 's' : ''} · {cop(c.total)}
                      {!c.reserva_id && <span className="ml-1.5 text-accent">· cotización directa (sin reserva)</span>}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${ESTADO_BADGE[c.estado] || ''}`}>{c.estado}</span>
                    <button onClick={() => descargarCotizacionPDF(empresaParaPdf, c)}
                      className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium flex items-center gap-1">
                      <IconExport size={12} /> PDF
                    </button>
                    {c.reserva_id && (
                      <button onClick={() => reenviarCotizacion(c.reserva_id!)} disabled={reenviandoId === c.reserva_id}
                        className="text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium disabled:opacity-50">
                        {reenviandoId === c.reserva_id ? 'Enviando…' : 'Reenviar'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Modal: cotizador de venta (prospecto sin cuenta ni reserva) */}
          {mostrarCotManual && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !guardandoCotManual && setMostrarCotManual(false)}>
              <div className="bg-surface rounded-2xl border border-border max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-ink">Nueva cotización</p>
                    <p className="text-xs text-ink/50">Para un prospecto que todavía no tiene cuenta ni reserva — herramienta de venta.</p>
                  </div>
                  <button onClick={() => setMostrarCotManual(false)} className="text-ink/40 hover:text-ink"><IconX size={18} /></button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-ink/50 block mb-1">Nombre del cliente/prospecto *</label>
                    <input value={cotManual.cliente_nombre} onChange={e => setCotManual(f => ({ ...f, cliente_nombre: e.target.value }))}
                      placeholder="Ej. Juan Pérez" className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Correo (opcional)</label>
                    <input type="email" value={cotManual.cliente_correo} onChange={e => setCotManual(f => ({ ...f, cliente_correo: e.target.value }))}
                      placeholder="cliente@correo.com" className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                    <p className="text-[10px] text-ink/40 mt-0.5">Si lo dejas vacío, no se envía correo — igual queda guardada y descargable en PDF.</p>
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Celular (opcional)</label>
                    <input value={cotManual.cliente_celular} onChange={e => setCotManual(f => ({ ...f, cliente_celular: e.target.value }))}
                      placeholder="300 000 0000" className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-ink/50 block mb-1">Vehículo del inventario</label>
                    <select value={cotManual.vehiculo_id} onChange={e => setCotManual(f => ({ ...f, vehiculo_id: e.target.value }))}
                      className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink">
                      <option value="">— Describir a mano (no es del inventario) —</option>
                      {vehiculosInventario.map(v => (
                        <option key={v.id} value={v.id}>{v.marca} {v.modelo} {v.anio} · {cop(v.precio_dia)}/día</option>
                      ))}
                    </select>
                  </div>
                  {!cotManual.vehiculo_id && (
                    <div className="sm:col-span-2">
                      <label className="text-[11px] text-ink/50 block mb-1">Descripción del vehículo</label>
                      <input value={cotManual.vehiculo_descripcion} onChange={e => setCotManual(f => ({ ...f, vehiculo_descripcion: e.target.value }))}
                        placeholder="Ej. Camioneta 4x4 automática (fuera de inventario)" className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                    </div>
                  )}
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Fecha inicio</label>
                    <input type="date" value={cotManual.fecha_inicio} onChange={e => setCotManual(f => ({ ...f, fecha_inicio: e.target.value }))}
                      className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Fecha fin</label>
                    <input type="date" value={cotManual.fecha_fin} onChange={e => setCotManual(f => ({ ...f, fecha_fin: e.target.value }))}
                      className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Recargo (opcional)</label>
                    <input value={cotManual.recargo} onChange={e => setCotManual(f => ({ ...f, recargo: e.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder="0" className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 block mb-1">Precio final (ajustable)</label>
                    <input value={cotManual.total_override} onChange={e => setCotManual(f => ({ ...f, total_override: e.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder={cotManualPreview ? String(cotManualPreview.total) : '0'} className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                    <p className="text-[10px] text-ink/40 mt-0.5">Déjalo vacío para usar el calculado. Escribe un valor para descuento/ajuste manual.</p>
                  </div>
                </div>

                {cotManualPreview && (
                  <div className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm space-y-0.5">
                    <p className="text-ink/60">{cotManualPreview.dias} día{cotManualPreview.dias !== 1 ? 's' : ''} × {cop(cotManualPreview.precioDia)}/día
                      {cotManualPreview.recargo > 0 ? ` + ${cop(cotManualPreview.recargo)} recargo` : ''}</p>
                    <p className="font-bold text-ink">Total calculado: {cop(cotManualPreview.total)}
                      {cotManual.total_override && Number(cotManual.total_override) !== cotManualPreview.total && (
                        <span className="text-accent"> → ajustado a {cop(Number(cotManual.total_override))}</span>
                      )}</p>
                  </div>
                )}

                {cotManualMsg && <p className="text-xs text-danger font-medium">{cotManualMsg}</p>}

                <div className="flex items-center gap-2 justify-end pt-2 border-t border-border">
                  <button onClick={() => setMostrarCotManual(false)} disabled={guardandoCotManual} className="text-sm text-ink/60 hover:text-ink px-3 py-2">Cancelar</button>
                  <button onClick={guardarCotizacionManual} disabled={guardandoCotManual}
                    className="text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2.5 rounded-xl transition disabled:opacity-60">
                    {guardandoCotManual ? 'Guardando…' : 'Crear cotización'}
                  </button>
                </div>
              </div>
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
            <div className="bg-surface-2 rounded-2xl border border-border p-4 space-y-3">
              <input ref={inputComprobanteRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={e => { subirComprobanteLiq(e.target.files?.[0] || null); e.target.value = ''; }} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs font-medium text-ink/60 block mb-1">Número de comprobante / referencia (opcional)</label>
                  <input placeholder="Ej. TXN-20260630-001" value={comprobante} onChange={e => setComprobante(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
                <button onClick={() => inputComprobanteRef.current?.click()} disabled={subiendoComprobante}
                  className="flex items-center gap-2 text-sm font-medium border border-accent/30 text-accent hover:bg-accent-light px-4 py-2 rounded-xl transition disabled:opacity-60">
                  <IconUpload size={14} /> {subiendoComprobante ? 'Subiendo…' : comprobanteUrl ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
                </button>
              </div>
              {comprobanteUrl ? (
                <p className="text-xs text-success flex items-center gap-2">
                  ✓ Comprobante adjuntado — <a href={comprobanteUrl} target="_blank" rel="noopener noreferrer" className="underline">ver</a>
                  <button onClick={() => setComprobanteUrl('')} className="text-ink/40 hover:text-danger underline">quitar</button>
                </p>
              ) : (
                <p className="text-xs text-ink/50">El número y el comprobante (foto o PDF de la transferencia) se guardan como soporte del pago y se incluyen en la notificación al propietario.</p>
              )}
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
                const sinFirmar = grupo.liquidaciones.filter(l => !l.firmada_en).length;
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
                          <>
                            <button onClick={() => marcarLiquidacionPagada(ids)} disabled={cargando || sinFirmar === grupo.liquidaciones.length}
                              className="mt-2 flex items-center gap-2 bg-success hover:bg-success/80 text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
                              <IconCheck size={14} /> {cargando ? 'Procesando…' : `Marcar todo pagado (${grupo.liquidaciones.length})`}
                            </button>
                            {sinFirmar > 0 && (
                              <p className="text-[11px] text-warning mt-1">⚠ {sinFirmar} sin firmar — se pagarán solo las firmadas</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-border pt-3 space-y-2">
                      {grupo.liquidaciones.map(l => {
                        const enCurso = pagandoIds.has(l.reserva_id);
                        return (
                          <div key={l.reserva_id} className="flex items-center justify-between gap-3 bg-surface rounded-xl px-3 py-2.5 border border-border flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink truncate">{l.marca} {l.modelo} {l.anio}{l.placa ? ` · ${l.placa}` : ''}</p>
                              <p className="text-xs text-ink/50">{l.fecha_inicio} → {l.fecha_fin} · {l.usuario_nombre}</p>
                              <p className="text-[11px] text-ink/40">Bruto {cop(l.bruto)} − comisión {(l.comision_pct * 100).toFixed(0)}% ({cop(l.comision_valor)})</p>
                              {l.conceptos.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {l.conceptos.map(c => (
                                    <p key={c.id} className={`text-[11px] ${c.tipo === 'descuento' ? 'text-danger' : 'text-success'}`}>
                                      {c.tipo === 'descuento' ? '−' : '+'} {cop(c.monto)} · {c.concepto}
                                      <span className="text-ink/40"> ({c.motivo}{c.created_by_nombre ? ` — ${c.created_by_nombre}` : ''})</span>
                                    </p>
                                  ))}
                                </div>
                              )}
                              {l.neto < 0 && (
                                <p className="text-[11px] text-danger font-semibold">⚠ Neto negativo: no hay nada que transferir — el propietario queda debiendo {cop(Math.abs(l.neto))}</p>
                              )}
                              {estadoLiq === 'pendiente' && (
                                l.firmada_en
                                  ? <p className="text-[11px] text-success/80">✓ Cuenta de cobro {l.remision_numero} firmada {l.firmada_en.slice(0, 10)}</p>
                                  : <p className="text-[11px] text-warning">⚠ Falta la firma del propietario{(l.remision_version || 1) > 1 ? ` de la cuenta reemitida ${l.remision_numero}` : ''} — no se puede pagar todavía</p>
                              )}
                              {estadoLiq === 'pagado' && (l.pagado_en || l.comprobante) && (
                                <p className="text-[11px] text-success/80">✓ Pagado{l.pagado_en ? ` ${l.pagado_en.slice(0, 10)}` : ''}{l.comprobante ? ` · ref: ${l.comprobante}` : ''}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-sm font-bold text-ink">{cop(l.neto)}</span>
                              <button onClick={() => descargarRemisionPDF(empresaParaPdf, {
                                numero: l.remision_numero || `REM-${String(l.reserva_id).padStart(6, '0')}`, created_at: hoy(),
                                propietario_nombre: grupo.propietario_nombre, propietario_documento: l.propietario_documento,
                                vehiculo_descripcion: `${l.marca} ${l.modelo} ${l.anio}`, placa: l.placa,
                                fecha_inicio: l.fecha_inicio, fecha_fin: l.fecha_fin,
                                dias: Math.max(1, Math.ceil((new Date(l.fecha_fin).getTime() - new Date(l.fecha_inicio).getTime()) / 86400000)),
                                bruto: l.bruto, comision_pct: l.comision_pct, comision_valor: l.comision_valor, neto: l.neto,
                                conceptos: l.conceptos.map(c => ({ tipo: c.tipo, concepto: c.concepto, monto: c.monto, motivo: c.motivo })),
                              })}
                                className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium flex items-center gap-1">
                                <IconExport size={12} /> Remisión
                              </button>
                              {estadoLiq === 'pagado' && l.comprobante_url && (
                                <a href={l.comprobante_url} target="_blank" rel="noopener noreferrer"
                                  className="text-xs border border-success/40 text-success px-2.5 py-1.5 rounded-xl hover:bg-success/10 transition font-medium flex items-center gap-1">
                                  <IconExport size={12} /> Comprobante
                                </a>
                              )}
                              {estadoLiq === 'pendiente' ? (
                                <>
                                  <button onClick={() => abrirEdicion(grupo, l)} disabled={enCurso}
                                    title="Agregar o quitar costos, corregir la base o la comisión de esta liquidación"
                                    className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition disabled:opacity-50 font-medium">
                                    ✎ Editar
                                  </button>
                                  <button onClick={() => marcarLiquidacionPagada([l.reserva_id])} disabled={enCurso || !l.firmada_en || l.neto < 0}
                                    title={!l.firmada_en ? 'El propietario todavía no ha firmado su cuenta de cobro' : l.neto < 0 ? 'El neto quedó negativo: no hay nada que transferir' : undefined}
                                    className="text-xs border border-success/40 text-success px-2.5 py-1.5 rounded-xl hover:bg-success/10 transition disabled:opacity-50 font-medium">
                                    {enCurso ? '…' : '✓ Pagar'}
                                  </button>
                                </>
                              ) : (
                                // Regla C: lo pagado es constancia histórica y no se toca. Si aparece
                                // un costo después, se cobra en la SIGUIENTE liquidación del propietario.
                                <button onClick={() => setAjusteNuevo({ grupo, fila: l, tipo: 'descuento', concepto: '', monto: '', motivo: '' })}
                                  title="Lo pagado no se modifica: el costo se aplicará a la próxima liquidación de este propietario"
                                  className="text-xs border border-border text-ink/70 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                                  + Ajuste para la próxima
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

          {/* Ajustes pendientes: costos detectados DESPUÉS de pagar una liquidación. Se
              muestran siempre (aunque el propietario no tenga liquidaciones en el filtro
              actual) para que ninguno quede olvidado si deja de tener reservas. */}
          {ajustesPendientes.length > 0 && (
            <div className="bg-warning/5 border border-warning/25 rounded-2xl p-5 space-y-3">
              <div>
                <p className="font-bold text-ink text-sm">Ajustes pendientes por aplicar ({ajustesPendientes.length})</p>
                <p className="text-xs text-ink/50">
                  Costos/adicionales de liquidaciones que ya estaban pagadas. Se aplican solos —una sola vez— a la PRÓXIMA liquidación de cada propietario.
                  Un descuento que dejaría el neto en negativo espera a la siguiente. Si ya se cobró por fuera, anúlalo con su motivo.
                </p>
              </div>
              <div className="space-y-2">
                {ajustesPendientes.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-3 bg-surface rounded-xl px-3 py-2.5 border border-border flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">
                        {a.propietario_nombre || `Propietario #${a.propietario_id}`} · {a.concepto}
                      </p>
                      <p className="text-xs text-ink/50">
                        {a.motivo}{a.reserva_origen_id ? ` · reserva #${a.reserva_origen_id}` : ''}{a.created_by_nombre ? ` · registrado por ${a.created_by_nombre}` : ''} · {(a.created_at || '').slice(0, 10)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-sm font-bold ${a.tipo === 'descuento' ? 'text-danger' : 'text-success'}`}>
                        {a.tipo === 'descuento' ? '−' : '+'} {cop(a.monto)}
                      </span>
                      <button onClick={() => anularAjuste(a)}
                        className="text-xs border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface-2 transition font-medium">
                        Anular
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Modal: editar una liquidación pendiente */}
          {edicion && (() => {
            const e = edicion;
            const prev = previewEdicion(e);
            const hayCambios =
              (e.bruto.trim() !== '' && Math.round(Number(e.bruto)) !== Math.round(e.fila.bruto)) ||
              (e.comisionPct.trim() !== '' && Number(e.comisionPct) !== e.fila.comision_pct) ||
              e.nuevas.length > 0 || Object.keys(e.quitar).length > 0;
            const firmada = !!e.fila.firmada_en;
            return (
              <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !guardandoEdicion && setEdicion(null)}>
                <div className="bg-surface rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={ev => ev.stopPropagation()}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-ink">Editar liquidación · {e.fila.marca} {e.fila.modelo} {e.fila.anio}</p>
                      <p className="text-xs text-ink/50">
                        {e.grupo.propietario_nombre} · {e.fila.fecha_inicio} → {e.fila.fecha_fin} · cuenta {e.fila.remision_numero || '—'}
                      </p>
                    </div>
                    <button onClick={() => setEdicion(null)} className="text-ink/40 hover:text-ink"><IconX size={18} /></button>
                  </div>

                  {/* Conceptos existentes */}
                  {e.fila.conceptos.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-ink/60">Costos y adicionales actuales</p>
                      {e.fila.conceptos.map(c => {
                        const quitando = e.quitar[c.id] !== undefined;
                        return (
                          <div key={c.id} className={`rounded-xl border p-3 space-y-2 ${quitando ? 'border-danger/30 bg-danger/5' : 'border-border bg-surface-2'}`}>
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="min-w-0">
                                <p className={`text-sm font-semibold ${quitando ? 'text-ink/40 line-through' : 'text-ink'}`}>
                                  {c.tipo === 'descuento' ? 'Descuento' : 'Adicional'}: {c.concepto}
                                </p>
                                <p className="text-[11px] text-ink/50">{c.motivo}{c.created_by_nombre ? ` · ${c.created_by_nombre}` : ''}{c.origen_ajuste_id ? ` · viene del ajuste pendiente #${c.origen_ajuste_id}` : ''}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-bold ${c.tipo === 'descuento' ? 'text-danger' : 'text-success'}`}>
                                  {c.tipo === 'descuento' ? '−' : '+'} {cop(c.monto)}
                                </span>
                                <button
                                  onClick={() => setEdicion(st => st && ({
                                    ...st,
                                    quitar: quitando
                                      ? Object.fromEntries(Object.entries(st.quitar).filter(([k]) => Number(k) !== c.id))
                                      : { ...st.quitar, [c.id]: '' },
                                  }))}
                                  className="text-xs border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                                  {quitando ? 'Conservar' : 'Quitar'}
                                </button>
                              </div>
                            </div>
                            {quitando && (
                              <input value={e.quitar[c.id]} onChange={ev => setEdicion(st => st && ({ ...st, quitar: { ...st.quitar, [c.id]: ev.target.value } }))}
                                placeholder="Motivo para quitarlo (obligatorio)"
                                className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Nuevas líneas */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-ink/60">Agregar costo o adicional</p>
                      <button onClick={() => setEdicion(st => st && ({ ...st, nuevas: [...st.nuevas, { ...LINEA_NUEVA_VACIA }] }))}
                        className="text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                        + Agregar línea
                      </button>
                    </div>
                    {e.nuevas.map((n, i) => (
                      <div key={i} className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <select value={n.tipo}
                            onChange={ev => setEdicion(st => st && ({ ...st, nuevas: st.nuevas.map((x, j) => j === i ? { ...x, tipo: ev.target.value as TipoConceptoLiq } : x) }))}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
                            <option value="descuento">Descuento (baja el neto)</option>
                            <option value="adicional">Adicional (sube el neto)</option>
                          </select>
                          <input value={n.concepto} placeholder="Concepto (ej. Lavada)"
                            onChange={ev => setEdicion(st => st && ({ ...st, nuevas: st.nuevas.map((x, j) => j === i ? { ...x, concepto: ev.target.value } : x) }))}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                          <input value={n.monto} inputMode="numeric" placeholder="Monto"
                            onChange={ev => setEdicion(st => st && ({ ...st, nuevas: st.nuevas.map((x, j) => j === i ? { ...x, monto: ev.target.value.replace(/[^0-9]/g, '') } : x) }))}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                        </div>
                        <div className="flex gap-2">
                          <input value={n.motivo} placeholder="Motivo (obligatorio) — queda en la bitácora"
                            onChange={ev => setEdicion(st => st && ({ ...st, nuevas: st.nuevas.map((x, j) => j === i ? { ...x, motivo: ev.target.value } : x) }))}
                            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                          <button onClick={() => setEdicion(st => st && ({ ...st, nuevas: st.nuevas.filter((_, j) => j !== i) }))}
                            className="text-xs border border-border text-ink/50 px-2.5 py-1.5 rounded-xl hover:bg-surface transition">Quitar</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Valores */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-ink/50 block mb-1">Base de liquidación (bruto)</label>
                      <input value={e.bruto} inputMode="numeric"
                        onChange={ev => setEdicion(st => st && ({ ...st, bruto: ev.target.value.replace(/[^0-9]/g, '') }))}
                        className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                      <p className="text-[10px] text-ink/40 mt-0.5">
                        NO cambia lo que pagó el cliente ni su factura: es solo la base sobre la que se le liquida al propietario.
                      </p>
                      {e.bruto.trim() !== '' && Math.round(Number(e.bruto)) !== Math.round(e.fila.bruto) && (
                        <input value={e.motivoBruto} onChange={ev => setEdicion(st => st && ({ ...st, motivoBruto: ev.target.value }))}
                          placeholder="Motivo del cambio (obligatorio)"
                          className="w-full mt-2 bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                      )}
                    </div>
                    <div>
                      <label className="text-[11px] text-ink/50 block mb-1">Comisión de esta liquidación (0 a 1)</label>
                      <input value={e.comisionPct} inputMode="decimal"
                        onChange={ev => setEdicion(st => st && ({ ...st, comisionPct: ev.target.value.replace(/[^0-9.]/g, '') }))}
                        className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                      <p className="text-[10px] text-ink/40 mt-0.5">Solo esta liquidación — la comisión global de la plataforma no cambia.</p>
                      {e.comisionPct.trim() !== '' && Number(e.comisionPct) !== e.fila.comision_pct && (
                        <input value={e.motivoComision} onChange={ev => setEdicion(st => st && ({ ...st, motivoComision: ev.target.value }))}
                          placeholder="Motivo del cambio (obligatorio)"
                          className="w-full mt-2 bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                      )}
                    </div>
                  </div>

                  {/* Vista previa */}
                  <div className="bg-surface-2 border border-border rounded-xl p-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-ink/60">Bruto</span><span className="font-semibold text-ink">{cop(prev.bruto)}</span></div>
                    <div className="flex justify-between"><span className="text-ink/60">Comisión ({(prev.comision_pct * 100).toFixed(1)}%)</span><span className="font-semibold text-ink">− {cop(prev.comision_valor)}</span></div>
                    {prev.total_descuentos > 0 && <div className="flex justify-between"><span className="text-ink/60">Descuentos</span><span className="font-semibold text-danger">− {cop(prev.total_descuentos)}</span></div>}
                    {prev.total_adicionales > 0 && <div className="flex justify-between"><span className="text-ink/60">Adicionales</span><span className="font-semibold text-success">+ {cop(prev.total_adicionales)}</span></div>}
                    <div className="flex justify-between border-t border-border pt-1.5">
                      <span className="font-bold text-ink">Neto {e.fila.neto !== prev.neto ? `(antes ${cop(e.fila.neto)})` : ''}</span>
                      <span className={`font-black ${prev.neto < 0 ? 'text-danger' : 'text-success'}`}>{cop(prev.neto)}</span>
                    </div>
                  </div>

                  {prev.neto < 0 && (
                    <div className="bg-danger/10 border border-danger/30 rounded-xl p-3 space-y-2">
                      <p className="text-sm text-danger font-semibold">⚠ El neto queda NEGATIVO ({cop(prev.neto)}).</p>
                      <p className="text-xs text-ink/70">
                        Los descuentos superan el bruto menos la comisión: el propietario quedaría debiéndole {cop(Math.abs(prev.neto))} a DrivePass y esta liquidación NO se podrá pagar.
                        Normalmente conviene dejar el excedente como ajuste pendiente para la próxima liquidación.
                      </p>
                      <label className="flex items-center gap-2 text-xs text-ink">
                        <input type="checkbox" checked={e.confirmarNegativo} onChange={ev => setEdicion(st => st && ({ ...st, confirmarNegativo: ev.target.checked }))} />
                        Entiendo y quiero guardar el neto en negativo.
                      </label>
                    </div>
                  )}

                  {/* Advertencia de anulación de la cuenta firmada (regla B) */}
                  {firmada && hayCambios && (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-1">
                      <p className="text-sm font-semibold text-warning">Esta cuenta de cobro YA está firmada. Al guardar:</p>
                      <ul className="text-xs text-ink/70 list-disc pl-4 space-y-0.5">
                        <li>La cuenta <strong>{e.fila.remision_numero}</strong> por <strong>{cop(e.fila.neto)}</strong>, firmada el {e.fila.firmada_en.slice(0, 10)}, queda <strong>ANULADA</strong> (se conserva como constancia).</li>
                        <li>Se emite una cuenta <strong>nueva, con número nuevo</strong>, por <strong>{cop(prev.neto)}</strong>.</li>
                        <li>Se le avisa a {e.grupo.propietario_nombre} para que la firme.</li>
                        <li><strong>No se podrá pagar</strong> hasta que firme la nueva.</li>
                      </ul>
                    </div>
                  )}

                  {edicionMsg && <div className="text-sm px-4 py-2.5 rounded-xl border bg-danger/10 text-danger border-danger/25">{edicionMsg}</div>}

                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEdicion(null)} disabled={guardandoEdicion}
                      className="text-sm border border-border text-ink/60 px-4 py-2 rounded-xl hover:bg-surface-2 transition font-medium">Cancelar</button>
                    <button onClick={guardarEdicion} disabled={guardandoEdicion || !hayCambios || (prev.neto < 0 && !e.confirmarNegativo)}
                      className="bg-accent text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-50">
                      {guardandoEdicion ? 'Guardando…' : firmada ? 'Guardar, anular y reemitir' : 'Guardar y regenerar cuenta'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Modal: ajuste pendiente sobre una liquidación YA PAGADA */}
          {ajusteNuevo && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !guardandoAjuste && setAjusteNuevo(null)}>
              <div className="bg-surface rounded-2xl border border-border max-w-lg w-full p-5 space-y-4" onClick={ev => ev.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-ink">Ajuste para la próxima liquidación</p>
                    <p className="text-xs text-ink/50">
                      La liquidación del {ajusteNuevo.fila.marca} {ajusteNuevo.fila.modelo} ({ajusteNuevo.fila.fecha_inicio} → {ajusteNuevo.fila.fecha_fin}) ya fue pagada y no se modifica.
                      Este ajuste se aplicará, una sola vez, a la próxima liquidación de {ajusteNuevo.grupo.propietario_nombre}.
                    </p>
                  </div>
                  <button onClick={() => setAjusteNuevo(null)} className="text-ink/40 hover:text-ink"><IconX size={18} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select value={ajusteNuevo.tipo} onChange={ev => setAjusteNuevo(a => a && ({ ...a, tipo: ev.target.value as TipoConceptoLiq }))}
                    className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink">
                    <option value="descuento">Descuento</option>
                    <option value="adicional">Adicional</option>
                  </select>
                  <input value={ajusteNuevo.concepto} placeholder="Concepto (ej. Multa)"
                    onChange={ev => setAjusteNuevo(a => a && ({ ...a, concepto: ev.target.value }))}
                    className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                  <input value={ajusteNuevo.monto} inputMode="numeric" placeholder="Monto"
                    onChange={ev => setAjusteNuevo(a => a && ({ ...a, monto: ev.target.value.replace(/[^0-9]/g, '') }))}
                    className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                </div>
                <input value={ajusteNuevo.motivo} placeholder="Motivo (obligatorio) — queda en la bitácora"
                  onChange={ev => setAjusteNuevo(a => a && ({ ...a, motivo: ev.target.value }))}
                  className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setAjusteNuevo(null)} disabled={guardandoAjuste}
                    className="text-sm border border-border text-ink/60 px-4 py-2 rounded-xl hover:bg-surface-2 transition font-medium">Cancelar</button>
                  <button onClick={guardarAjuste} disabled={guardandoAjuste}
                    className="bg-accent text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-50">
                    {guardandoAjuste ? 'Guardando…' : 'Registrar ajuste'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CONFIGURACIÓN ── */}
      {subTab === 'config' && (
        <div className="max-w-lg space-y-4">
          <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-4">
            <div>
              <label className="text-[11px] text-ink/50 block mb-1">Comisión de la plataforma (0 a 1, ej. 0.35 = 35%)</label>
              <input value={config.comision_plataforma_pct} onChange={e => setConfig(c => ({ ...c, comision_plataforma_pct: e.target.value.replace(/[^0-9.]/g, '') }))}
                placeholder="0.35" className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
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
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-ink/50">IVA sobre el alquiler</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={config.iva_activo === 'true'}
                    onChange={e => setConfig(c => ({ ...c, iva_activo: e.target.checked ? 'true' : 'false' }))} />
                  <span className="text-ink/70">Cobrar IVA</span>
                </label>
              </div>
              <input value={config.iva_pct} inputMode="numeric" disabled={config.iva_activo !== 'true'}
                onChange={e => setConfig(c => ({ ...c, iva_pct: e.target.value.replace(/[^0-9]/g, '') }))}
                placeholder="19" className="w-full mt-2 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink disabled:opacity-50" />
              <p className="text-[11px] text-ink/40 mt-1">
                Tarifa en porcentaje entero (19 = 19%). Con el IVA apagado, el contrato y el otrosí dicen expresamente
                que el canon no se adiciona con el impuesto — no queda ninguna línea de &quot;IVA $0&quot;.
              </p>
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

          <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-4">
            <div>
              <p className="text-xs font-bold text-ink/60 uppercase tracking-wide">📇 Proveedores guardados</p>
              <p className="text-[11px] text-ink/40 mt-0.5">Se guardan solos al registrar un gasto — aquí puedes precargarlos, corregir un nombre/NIT o quitar uno.</p>
            </div>

            {proveedores.length === 0 ? (
              <p className="text-xs text-ink/40 italic">Aún no hay proveedores guardados.</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {proveedores.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-2 bg-surface border border-border rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{p.nombre}</p>
                      <p className="text-[11px] text-ink/40 truncate">
                        {p.nit || 'sin NIT'}{p.categoria_habitual ? ` · ${CAT_GASTO[p.categoria_habitual as CategoriaGasto]?.label || p.categoria_habitual}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => abrirEditarProveedor(p)} className="text-xs border border-accent/30 text-accent px-2 py-1 rounded-lg hover:bg-accent-light transition">
                        Editar
                      </button>
                      <button onClick={() => eliminarProveedor(p)} className="text-xs border border-danger/30 text-danger px-2 py-1 rounded-lg hover:bg-danger/10 transition">
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs font-semibold text-ink">{editandoProvId ? 'Editar proveedor' : '+ Nuevo proveedor'}</p>
              <div className="grid grid-cols-2 gap-2">
                <input value={provForm.nombre} onChange={e => setProvForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre" className="col-span-2 sm:col-span-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                <input value={provForm.nit} onChange={e => setProvForm(f => ({ ...f, nit: e.target.value }))}
                  placeholder="NIT (opcional)" className="col-span-2 sm:col-span-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
                <select value={provForm.categoria_habitual} onChange={e => setProvForm(f => ({ ...f, categoria_habitual: e.target.value }))}
                  className="col-span-2 sm:col-span-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
                  <option value="">Categoría habitual (opcional)</option>
                  {CATS_GASTO.map(c => <option key={c} value={c}>{CAT_GASTO[c].label}</option>)}
                </select>
                <input value={provForm.notas} onChange={e => setProvForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Notas (opcional)" className="col-span-2 sm:col-span-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={guardarProveedor} disabled={guardandoProv}
                  className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition disabled:opacity-60">
                  {guardandoProv ? 'Guardando…' : editandoProvId ? 'Guardar cambios' : 'Agregar proveedor'}
                </button>
                {editandoProvId && (
                  <button onClick={cancelarEdicionProveedor} className="text-sm text-ink/50 hover:text-ink">Cancelar</button>
                )}
                {provMsg && <span className={`text-xs ${provMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{provMsg}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
