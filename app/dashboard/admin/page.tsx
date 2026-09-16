'use client';
import { Fragment, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import CalendarioReservas, { type ReservaCalendario } from '@/components/CalendarioReservas';
import CalendarioDisponibilidad from '@/components/CalendarioDisponibilidad';
import PicoPlacaConfig from '@/components/PicoPlacaConfig';
import ContabilidadPanel from '@/components/ContabilidadPanel';
import BusesPanel from '@/components/buses/BusesPanel';
import SoportePanel from '@/components/SoportePanel';
import LeadsPropietariosPanel from '@/components/LeadsPropietariosPanel';
import AuditoriaPanel from '@/components/AuditoriaPanel';
import CalculadoraPanel from '@/components/CalculadoraPanel';
import NfcCardsPanel from '@/components/NfcCardsPanel';
import ReservaMostradorModal from '@/components/ReservaMostradorModal';
import DocumentoVista from '@/components/DocumentoVista';
import BotonPaqueteDocumentos from '@/components/BotonPaqueteDocumentos';
import PolizaVehiculoAdmin from '@/components/PolizaVehiculoAdmin';
import VisorFotos, { type FotoVisor } from '@/components/VisorFotos';
import {
  FiltroCampo, BotonOrdenLlegada, ResumenFiltros, CLASE_CONTROL_FILTRO,
} from '@/components/FiltrosLista';
import {
  puede, normalizarNivel, NIVEL_LABEL, NIVELES, GRUPOS_AREAS, areaLabel,
  parsePermisosExtra, type AdminNivel, type PermisosExtra, type PermisosExtraDelta,
} from '@/lib/permisos';
import { parsePicoPlaca, picoPlacaVacio, placaRestringida, type PicoPlaca } from '@/lib/pico-placa';
import { conDiasOcupados, diasOcupadosPorReservas, parseDiasGuardados } from '@/lib/dias-disponibles';
import { tecnoRequerida } from '@/lib/tecnomecanica';
import { fechaHoraRecogida, esNoShowAplicable } from '@/lib/cancelacion';
import {
  fechaRegistroCorta, fechaRegistroLarga, ordenarPorLlegada, enRangoRegistro,
  type OrdenLlegada,
} from '@/lib/fecha-registro';
import { COMBUSTIBLE_LABELS, COMBUSTIBLES } from '@/lib/vehiculo-campos';
import { IconUser, IconCar, IconX, IconCheck, IconCalendar, IconShield, IconExport } from '@/components/Icons';
import type { VerificacionResultado } from '@/lib/verificacion-docs';
import { urlDescarga } from '@/lib/cloudinary-descarga';

type Usuario = {
  id: number; nombre: string; correo: string;
  rol: string; admin_nivel?: string; permisos_extra?: string; estado_cuenta: string; created_at: string;
  tipo_documento?: string; documento_identidad?: string;
  fecha_nacimiento?: string; celular?: string; celular_indicativo?: string;
  direccion?: string; ciudad?: string;
  numero_licencia?: string; contacto_emergencia?: string;
  cedula_url?: string; cedula_url_dorso?: string;
  // Documentos del perfil que antes no se mostraban en ninguna pantalla — en
  // particular el certificado bancario del propietario, que se pedía como
  // obligatorio y después no había forma de verlo (ver GET /api/admin/usuarios).
  licencia_url?: string; licencia_url_dorso?: string;
  certificado_bancario_url?: string;
  banco?: string; numero_cuenta?: string;
};
type DocItem = { url: string; vence?: string };
// `todo_riesgo` ya no aparece acá (sep-2026): DrivePass expide la póliza directamente, así
// que dejó de pedirse y de revisarse. Los vehículos que ya la tenían conservan la clave en
// `documentos` en la BD (nadie la borra), simplemente ya no se muestra en este panel.
type Documentos = {
  soat?: DocItem;
  tecno?: DocItem;
  tarjeta?: { url: string; url_dorso?: string };
};

type DocRevision = { estado: string; nota: string };

type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number; tipo: string;
  precio_dia: number; propietario_id: number; propietario_nombre: string; disponible: number;
  fotos: string; fotos_detalle: string; placa?: string; documentos?: string;
  // Calendario de disponibilidad (array JSON de fechas 'YYYY-MM-DD'). Llega en el
  // `SELECT v.*` del panel y NO está entre los campos sensibles de lib/vehiculo-publico.ts.
  // ⚠️ `'[]'` NO significa "cerrado": significa "abierto sin restricciones" (ver
  // lib/dias-disponibles.ts).
  dias_disponibles?: string;
  combustible?: string; clase_vehiculo?: string; exencion_pico_placa_inscrita?: number;
  documentos_estado?: string; documentos_nota?: string; documentos_revisiones?: string;
  en_vitrina?: number; archivado?: number;
  contenido_revision?: number; contenido_revision_motivo?: string;
  // Fecha de llegada del vehículo a la plataforma. Viaja en el `SELECT v.*` de
  // GET /api/vehiculos y no está entre los campos sensibles de lib/vehiculo-publico.ts.
  // ⚠️ Está guardada en UTC (lib/db.ts usa `datetime('now')` para esta tabla): se muestra
  // y se filtra SIEMPRE a través de lib/fecha-registro.ts, nunca en crudo.
  created_at?: string;
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

const DOC_KEYS = ['soat', 'tecno', 'tarjeta'] as const;
const DOC_LABELS: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad',
};

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

// ── Filtros de las listas (Usuarios y Vehículos) ────────────────────────────
//
// DÓNDE SE FILTRA: en el NAVEGADOR, sobre las listas que estas dos pestañas ya traen
// completas (`/api/admin/usuarios` y `/api/vehiculos?panelAdmin=1`). Dos razones:
//   1) el panel YA necesita la lista entera en memoria para los contadores de arriba
//      (`userStats`, `archivadasUsuariosCount`, `sinPrecio`, `propietariosConDocsEnRevision`):
//      filtrar en el servidor obligaría a una segunda petición solo para los totales;
//   2) `GET /api/vehiculos` es una ruta COMPARTIDA y pública — la consumen app/page.tsx,
//      components/HeroSlider.tsx, components/ContabilidadPanel.tsx y el dashboard del
//      propietario. Meterle parámetros de filtro nuevos es tocar el camino de cinco
//      pantallas ajenas para un filtro que hoy es de una sola.
// CUÁNDO HAY QUE MOVERLO AL SERVIDOR: hoy hay ~6 vehículos y pocos usuarios. El límite
// práctico de este enfoque está en el orden de las 500–1.000 filas por lista (a partir de
// ahí el JSON pesa y el re-render de la tabla completa en cada tecla empieza a notarse).
// Al pasar ese punto: paginar en el servidor y mover estos mismos filtros a la query,
// dejando los contadores en un endpoint de resumen aparte.
/**
 * Texto en minúsculas y SIN tildes, para que la búsqueda no obligue a escribirlas:
 * "gomez" encuentra a "Gómez" y "pena" encuentra a "Peña". Se aplica igual a lo que se
 * escribe y a lo que se compara, así que también funciona al revés (escribir con tilde
 * encuentra un dato guardado sin ella).
 */
function plano(texto: unknown): string {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const ROL_FILTRO_LABELS: Record<string, string> = {
  usuario: 'Cliente', propietario: 'Propietario', admin: 'Administrador',
};
const ESTADO_CUENTA_LABELS: Record<string, string> = {
  activa: 'Activa', inactiva: 'Inactiva', archivada: 'Archivada',
};
const DOC_ESTADO_FILTRO_LABELS: Record<string, string> = {
  sin_documentos: 'Sin documentos', en_revision: 'En revisión',
  aprobado: 'Aprobados', denegado: 'Denegados',
};

/**
 * ¿Esta cuenta tiene al día los documentos que el sistema le pide a su rol?
 *
 * No es un criterio inventado acá: es lo que cada flujo ya exige como obligatorio.
 *   · Todos (menos admin): tipo y número de documento — `perfilIncompleto` (lib/perfil.ts).
 *   · Cédula por frente Y dorso: la piden el registro y el perfil del propietario
 *     (app/dashboard/propietario/page.tsx, "es obligatoria para verificar que la tarjeta
 *     de propiedad esté a tu nombre").
 *   · Propietario, además: banco, número de cuenta y certificado bancario — los tres
 *     obligatorios para poder pagarle (mismo formulario de perfil).
 * Las cuentas del EQUIPO (rol 'admin') no tienen documentación que subir, así que nunca
 * salen como incompletas.
 */
function docsUsuarioCompletos(u: Usuario): boolean {
  if (u.rol === 'admin') return true;
  const lleno = (v?: string) => !!(v || '').trim();
  if (!lleno(u.tipo_documento) || !lleno(u.documento_identidad)) return false;
  if (!lleno(u.cedula_url) || !lleno(u.cedula_url_dorso)) return false;
  if (u.rol === 'propietario') {
    return lleno(u.banco) && lleno(u.numero_cuenta) && lleno(u.certificado_bancario_url);
  }
  return true;
}

/**
 * Miniatura de la tarjeta del vehículo. Es un BOTÓN: abre `components/VisorFotos.tsx`
 * (el mismo visor a pantalla completa de Operaciones y de la pantalla del mensajero,
 * con zoom, flechas y cierre con Escape) en vez de dejar la foto recortada por el
 * `object-cover`, que es justo lo que no deja ver un rayón o una placa.
 *
 * Si el vehículo no tiene ninguna foto abrible se pinta la imagen suelta, sin botón:
 * un botón que no hace nada es peor que no tenerlo.
 */
function MiniaturaVehiculo({ portada, alt, cantidad, onAbrir, atenuada }: {
  portada: string; alt: string; cantidad: number; onAbrir: () => void; atenuada?: boolean;
}) {
  if (!portada) return null;
  const clasesImg = `w-20 h-14 object-cover rounded-xl flex-shrink-0 ${atenuada ? 'opacity-70' : ''}`;
  /* eslint-disable-next-line @next/next/no-img-element */
  const img = <img src={portada} alt={alt} className={clasesImg} />;
  if (cantidad === 0) return img;
  return (
    <button type="button" onClick={onAbrir} title="Clic para ver las fotos en grande"
      aria-label={`Ver en grande ${cantidad === 1 ? 'la foto' : `las ${cantidad} fotos`} de ${alt}`}
      className="relative flex-shrink-0 rounded-xl group focus:outline-none focus:ring-2 focus:ring-accent/50">
      {img}
      <span aria-hidden="true"
        className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/35 transition flex items-center justify-center text-white text-[10px] font-bold opacity-0 group-hover:opacity-100">
        🔍 Ampliar
      </span>
      {cantidad > 1 && (
        <span aria-hidden="true"
          className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-ink text-white text-[9px] font-bold grid place-items-center">
          {cantidad}
        </span>
      )}
    </button>
  );
}

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
const CHEQUEO_COLOR: Record<string, string> = { pasa: 'text-success', falla: 'text-danger', no_aplica: 'text-ink/50' };

function ResultadoIA({ res, auto }: { res: VerificacionResultado; auto?: string[] }) {
  return (
    <div className="space-y-3">
      {/* Resumen global */}
      <div className="glass rounded-2xl p-4 border border-border/60">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Veredicto de la IA</span>
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
                {doc.tipo_detectado && <p className="text-[11px] text-ink/50">Detectado: {doc.tipo_detectado}{!doc.es_legible && ' · ilegible'}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-ink/50">{CONFIANZA_LABEL[doc.confianza] || doc.confianza}</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${VEREDICTO_BADGE[doc.veredicto] || VEREDICTO_BADGE.revision}`}>
                  {VEREDICTO_LABEL[doc.veredicto] || doc.veredicto}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2.5">
              {filasDatos.filter(([, val]) => val).map(([et, val]) => (
                <div key={et} className="text-[11px] flex gap-1.5 min-w-0">
                  <span className="text-ink/50 shrink-0">{et}:</span>
                  <span className="text-ink/80 truncate">{val}</span>
                </div>
              ))}
            </div>

            {doc.verificaciones.length > 0 && (
              <ul className="space-y-1 mb-2">
                {doc.verificaciones.map((c, j) => (
                  <li key={j} className="text-xs flex items-start gap-1.5">
                    <span className={`${CHEQUEO_COLOR[c.resultado] || 'text-ink/50'} font-bold leading-5`}>{CHEQUEO_ICON[c.resultado] || '·'}</span>
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
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-2">Cruces entre documentos</p>
          <ul className="space-y-1">
            {res.cruces.map((c, j) => (
              <li key={j} className="text-xs flex items-start gap-1.5">
                <span className={`${CHEQUEO_COLOR[c.resultado] || 'text-ink/50'} font-bold leading-5`}>{CHEQUEO_ICON[c.resultado] || '·'}</span>
                <span className="text-ink/70"><span className="text-ink/90">{c.regla}.</span> {c.detalle}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Firma estable de un mapa de excepciones, para saber si hay cambios sin guardar.
const firmaPermisos = (p: PermisosExtra) =>
  JSON.stringify(Object.entries(p).sort((a, b) => a[0].localeCompare(b[0])));

// Casillas de secciones por empleado. El NIVEL es la plantilla base; aquí solo se
// guardan las EXCEPCIONES (lo que se aparta de esa plantilla). Por eso, si vuelves a
// marcar/desmarcar hasta el valor del nivel, la excepción desaparece sola y la casilla
// vuelve a decir "nivel": así se ve de un vistazo qué es heredado y qué es a la medida.
function PermisosSecciones({ u, draft, baseline, onToggle, onReset, onGuardar, guardando, msg }: {
  u: Usuario;
  draft: PermisosExtra;
  // Snapshot que tenía este panel al abrirse (no necesariamente el u.permisos_extra
  // más reciente, que puede haber cambiado por otra sesión). Contra esto se calcula
  // el delta que se manda al guardar, para no pisar cambios ajenos.
  baseline: PermisosExtra;
  onToggle: (area: string) => void;
  onReset: () => void;
  onGuardar: () => void;
  guardando: boolean;
  msg: string;
}) {
  const nivelU = normalizarNivel(u.admin_nivel);
  const cambiado = firmaPermisos(draft) !== firmaPermisos(baseline);
  const nExcepciones = Object.keys(draft).length;

  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">🔐 Secciones de {u.nombre}</p>
          <p className="text-[11px] text-ink/50 max-w-2xl">
            Parte de <strong>{NIVEL_LABEL[nivelU]}</strong>: lo que dice <span className="text-ink/40 font-semibold">nivel</span> es lo que le toca por su rol.
            Al marcar o desmarcar, esa sección queda como <span className="text-warning font-semibold">excepción</span> solo para esta persona.
            Para devolverla a lo normal, vuelve a dejarla como estaba (o usa “Volver todo al nivel”).
            La <strong>gestión del equipo</strong> (esta pantalla) no se puede marcar: es exclusiva del administrador principal.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onReset} disabled={nExcepciones === 0}
            className="text-xs px-3 py-1.5 rounded-xl border border-border text-ink/70 hover:bg-surface transition font-medium disabled:opacity-40">
            ↺ Volver todo al nivel
          </button>
          <button onClick={onGuardar} disabled={!cambiado || guardando}
            className="bg-accent hover:bg-accent-hover text-white px-4 py-1.5 rounded-xl font-semibold text-xs transition disabled:opacity-40">
            {guardando ? 'Guardando…' : cambiado ? 'Guardar cambios' : 'Sin cambios'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
        {GRUPOS_AREAS.map(g => (
          <div key={g.titulo}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink/40 mb-1.5">{g.titulo}</p>
            <div className="space-y-0.5">
              {g.areas.map(area => {
                const base = puede(nivelU, area);
                const efectivo = puede(nivelU, area, draft);
                const esExcepcion = efectivo !== base;
                return (
                  <label key={area}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface transition cursor-pointer">
                    <input type="checkbox" checked={efectivo} onChange={() => onToggle(area)}
                      className="w-4 h-4 rounded accent-[var(--color-accent)] flex-shrink-0" />
                    <span className={`text-xs flex-1 truncate ${efectivo ? 'text-ink' : 'text-ink/40'}`}>{areaLabel(area)}</span>
                    {esExcepcion ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 flex-shrink-0">excepción</span>
                    ) : (
                      <span className="text-[9px] text-ink/30 flex-shrink-0">nivel</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink/40">
        Ojo: esto controla qué secciones ve y qué APIs puede usar. El contenido marcado
        “solo socios” (tareas, eventos y documentos reservados) sigue dependiendo del nivel, no de estas casillas.
      </p>
      {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{msg}</p>}
    </div>
  );
}

// useSearchParams exige un límite <Suspense> alrededor del componente que lo usa (mismo
// patrón que ya sigue app/pago/page.tsx) — se usa para preseleccionar pestaña/ítem cuando
// se llega desde una notificación clicable del Navbar (ver destinoDeNotificacion).
export default function DashboardAdmin() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-ink/50">Cargando…</div>}>
      <DashboardAdminInner />
    </Suspense>
  );
}

const TABS_ADMIN = ['usuarios', 'vehiculos', 'buses', 'reservas', 'contabilidad', 'mercado', 'calculadora', 'leads', 'soporte', 'nfc', 'config', 'auditoria'] as const;
type TabAdmin = typeof TABS_ADMIN[number];

function DashboardAdminInner() {
  const [tab, setTab] = useState<TabAdmin>('usuarios');
  const [miNivel, setMiNivel] = useState<AdminNivel>('principal');
  const [miId, setMiId] = useState<number | null>(null);
  // Excepciones de permisos de MI cuenta (solo para pintar pestañas; el gating real es del servidor).
  const [misPermisos, setMisPermisos] = useState<PermisosExtra>({});
  const [picoPlaca, setPicoPlaca] = useState<PicoPlaca>(picoPlacaVacio());
  const [usuarios, setUsuarios]   = useState<Usuario[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [reservas, setReservas]   = useState<ReservaCalendario[]>([]);
  const [errorListas, setErrorListas] = useState<{ usuarios?: boolean; vehiculos?: boolean; reservas?: boolean }>({});
  const [precioEdit, setPrecioEdit] = useState<Record<number, string>>({});
  const [fotoModal, setFotoModal] = useState<{ v: Vehiculo } | null>(null);
  const [docModal, setDocModal] = useState<{ v: Vehiculo } | null>(null);
  // Editor de calendario del admin (mismas capacidades que el propietario, ver modal abajo).
  const [dispModal, setDispModal] = useState<{ v: Vehiculo } | null>(null);
  const [dispDias, setDispDias] = useState<string[]>([]);
  // Copia de lo que hay GUARDADO en BD para este vehículo: el calendario del modal edita
  // `dispDias` en local y solo se persiste al tocar "Guardar", así que hace falta con qué
  // comparar para saber si quedan cambios pendientes (antes cada clic disparaba un PUT, y
  // cada PUT le mandaba una notificación al propietario).
  const [dispOriginal, setDispOriginal] = useState<string[]>([]);
  const [dispMsg, setDispMsg] = useState('');
  const [dispGuardando, setDispGuardando] = useState(false);
  // ¿Se pudieron cargar las reservas? GET /api/reservas está gateado por el área `reservas`,
  // NO por `vehiculos`: un admin con `vehiculos` pero sin `reservas` recibe 403 y vería el
  // calendario SIN los días bloqueados, pudiendo pisar reservas sin enterarse. `null` = aún
  // cargando; `false` = no se pudieron cargar -> el calendario se muestra en SOLO LECTURA.
  const [reservasOk, setReservasOk] = useState<boolean | null>(null);
  const [docNota, setDocNota] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroBusq, setFiltroBusq] = useState('');
  // ── Filtros de la lista de USUARIOS (todos en el navegador, ver el bloque de arriba) ──
  const [usrBusq, setUsrBusq] = useState('');
  const [usrRol, setUsrRol] = useState('');
  // '' = todas menos las archivadas; 'archivada' es la vista que antes abría el botón
  // "🗄️ Ver archivadas" (ese botón ahora escribe acá: una sola fuente de verdad).
  const [usrEstado, setUsrEstado] = useState('');
  const [usrDocs, setUsrDocs] = useState('');   // '' | completos | incompletos
  const [usrDesde, setUsrDesde] = useState('');
  const [usrHasta, setUsrHasta] = useState('');
  const [usrOrden, setUsrOrden] = useState<OrdenLlegada>('recientes');
  // ── Filtros de la lista de VEHÍCULOS ──
  const [vehBusq, setVehBusq] = useState('');
  const [vehPropietario, setVehPropietario] = useState('');   // id del propietario, como texto
  const [vehDocs, setVehDocs] = useState('');                 // documentos_estado
  const [vehDisponible, setVehDisponible] = useState('');     // '' | '1' | '0'
  const [vehCombustible, setVehCombustible] = useState('');   // '' | gasolina | … | 'sin'
  const [vehDesde, setVehDesde] = useState('');
  const [vehHasta, setVehHasta] = useState('');
  const [vehOrden, setVehOrden] = useState<OrdenLlegada>('recientes');
  const [perfilModal, setPerfilModal] = useState<{ u: Usuario } | null>(null);
  // Visor de fotos a pantalla completa (components/VisorFotos.tsx), el MISMO que usan
  // Operaciones y la pantalla del mensajero. Acá lo abren las miniaturas de la lista de
  // vehículos y las del modal de fotos.
  const [visorFotos, setVisorFotos] = useState<{ fotos: FotoVisor[]; indice: number; titulo: string } | null>(null);
  // ── Eliminar/archivar (usuarios y vehículos) ──
  const [verArchivadosVehiculos, setVerArchivadosVehiculos] = useState(false);
  const [vehiculosArchivados, setVehiculosArchivados] = useState<Vehiculo[]>([]);
  // ── Moderación de contenido: vehículos con fotos marcadas por la IA, pendientes de revisión manual ──
  const [verRevisionContenido, setVerRevisionContenido] = useState(false);
  const [vehiculosRevisionContenido, setVehiculosRevisionContenido] = useState<Vehiculo[]>([]);
  const [aprobandoContenido, setAprobandoContenido] = useState<number | null>(null);
  const [eliminandoUsuario, setEliminandoUsuario] = useState<number | null>(null);
  const [eliminandoVehiculo, setEliminandoVehiculo] = useState<number | null>(null);
  const [resetPass, setResetPass] = useState<{ uid: number; nueva: string; confirmar: string; guardando: boolean; ok: string } | null>(null);
  const [clienteDocs, setClienteDocs] = useState<{ r: ReservaCalendario & {
    documento_id_url?: string; documento_id_url_dorso?: string; documento_es_pasaporte?: number;
    licencia_url?: string; licencia_url_dorso?: string;
    // Llega en el `SELECT r.*` de GET /api/reservas; el tipo compartido
    // `ReservaCalendario` no lo declara porque el calendario no lo usa. Acá hace
    // falta para armar el enlace al paquete de documentos de ESE cliente.
    usuario_id?: number;
  } } | null>(null);
  const [rechazando, setRechazando] = useState<{ id: number; nota: string } | null>(null);
  // Reserva creada en el punto de atención (cliente presencial) — ver
  // components/ReservaMostradorModal.tsx y POST /api/admin/reservas.
  const [nuevaReservaAbierta, setNuevaReservaAbierta] = useState(false);
  const [reservaMostradorMsg, setReservaMostradorMsg] = useState('');
  // La reserva se creó bien pero quedó algo que el empleado tiene que atender (hoy:
  // el correo con el enlace de activación no salió) → el aviso se pinta en tono de
  // advertencia, no de éxito.
  const [reservaMostradorAviso, setReservaMostradorAviso] = useState(false);
  const [accionando, setAccionando] = useState<number | null>(null);
  const [docRevisiones, setDocRevisiones] = useState<Record<string, DocRevision>>({});
  const [iaVerif, setIaVerif] = useState<{ vid: number; res: VerificacionResultado; auto: string[] } | null>(null);
  const [iaCargando, setIaCargando] = useState(false);
  const [iaError, setIaError] = useState('');
  const [arrIa, setArrIa] = useState<{ rid: number; nombre: string; res?: VerificacionResultado; error?: string } | null>(null);
  const [arrIaCargando, setArrIaCargando] = useState(false);
  const [revisandoDoc, setRevisandoDoc] = useState<{ key: string; nota: string } | null>(null);
  const [docAccionando, setDocAccionando] = useState<string | null>(null);

  // ── Mercado ────────────────────────────────────────────────────────────────
  type PrecioRow = { sedan: number | null; suv: number | null; compacto: number | null; pickup: number | null; encontrado: number; nota: string; fecha: string };
  type CompetidorUI = { id: number; nombre: string; url: string; activo: number; ajuste_pct: number; auto_actualizar: number; ultimo_check: string | null; ultimo_precio: PrecioRow | null };
  const [competidores, setCompetidores] = useState<CompetidorUI[]>([]);
  const [mercadoLoading, setMercadoLoading] = useState(false);
  const [mercadoChecking, setMercadoChecking] = useState(false);
  const [mercadoMsg, setMercadoMsg] = useState('');
  const [nuevoComp, setNuevoComp] = useState({ nombre: '', url: '', ajuste_pct: '-5', auto_actualizar: false });
  const [confirmarElimComp, setConfirmarElimComp] = useState<number | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  // Preselección de pestaña al llegar desde una notificación clicable del Navbar (ver
  // destinoDeNotificacion en components/Navbar.tsx, ?tab=<clave>). Solo una vez al montar,
  // para no pelear con los clics manuales del usuario en las pestañas.
  const urlTabAplicado = useRef(false);
  useEffect(() => {
    if (urlTabAplicado.current) return;
    urlTabAplicado.current = true;
    const tabParam = searchParams.get('tab');
    if (tabParam && (TABS_ADMIN as readonly string[]).includes(tabParam)) setTab(tabParam as TabAdmin);
  }, [searchParams]);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.rol !== 'admin') { router.push('/login'); return; }
      setMiNivel(normalizarNivel(d.user.admin_nivel));
      setMiId(d.user.id ?? null);
      setMisPermisos(parsePermisosExtra(d.user.permisos_extra));
    }).catch(() => router.push('/login'));
    cargarUsuarios();
    cargarVehiculos();
    cargarReservas();
    // Carga silenciosa solo para el contador del badge (ver botón "🔞 Ver en revisión de
    // contenido" en la pestaña Vehículos) — inline en vez de llamar a la función declarada
    // más abajo en el componente, para no arrastrar otro caso del error preexistente de lint
    // react-hooks/immutability que ya tienen cargarUsuarios/cargarVehiculos/cargarReservas
    // (ver AGENTS.md/PROYECTO.md — no bloqueante hoy, pero no hace falta sumarle uno más).
    // Si el 403 llega por falta de permiso del área "vehiculos" simplemente no se muestra.
    fetch('/api/vehiculos?revisionContenido=1').then(r => r.json()).then(d => setVehiculosRevisionContenido(d.vehiculos || [])).catch(() => {});
    fetch('/api/config').then(r => r.json()).then(d => setPicoPlaca(parsePicoPlaca(d.config?.pico_placa || ''))).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (tab === 'mercado') cargarMercado();
  }, [tab]);

  // Si el nivel actual no puede ver la pestaña seleccionada, lo mandamos a la primera permitida.
  useEffect(() => {
    if (!puede(miNivel, tab, misPermisos)) {
      const orden = ['reservas', 'leads', 'soporte', 'usuarios', 'vehiculos', 'buses', 'contabilidad', 'mercado', 'calculadora', 'nfc', 'config', 'auditoria'] as const;
      const primera = orden.find(k => puede(miNivel, k, misPermisos));
      if (primera) setTab(primera);
    }
  }, [miNivel, misPermisos, tab]);

  const cargarMercado = () => {
    setMercadoLoading(true);
    fetch('/api/admin/mercado')
      .then(r => r.json())
      .then(d => setCompetidores(d.competidores || []))
      .catch(() => {})
      .finally(() => setMercadoLoading(false));
  };

  const agregarCompetidor = async () => {
    if (!nuevoComp.nombre || !nuevoComp.url) return;
    try {
      const res = await fetch('/api/admin/mercado', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nuevoComp, ajuste_pct: Number(nuevoComp.ajuste_pct), auto_actualizar: nuevoComp.auto_actualizar ? 1 : 0 }),
      });
      if (res.ok) { setNuevoComp({ nombre: '', url: '', ajuste_pct: '-5', auto_actualizar: false }); cargarMercado(); }
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const eliminarCompetidor = async (id: number) => {
    if (confirmarElimComp !== id) { setConfirmarElimComp(id); return; }
    setConfirmarElimComp(null);
    try {
      await fetch('/api/admin/mercado', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      cargarMercado();
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const toggleActivoComp = async (id: number, activo: number) => {
    try {
      await fetch('/api/admin/mercado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, activo: activo ? 0 : 1 }) });
      cargarMercado();
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const toggleAutoComp = async (id: number, auto: number) => {
    try {
      await fetch('/api/admin/mercado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, auto_actualizar: auto ? 0 : 1 }) });
      cargarMercado();
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const ejecutarCheck = async () => {
    setMercadoChecking(true);
    setMercadoMsg('');
    try {
      const res = await fetch('/api/admin/mercado/check', { method: 'POST' });
      const d = await res.json() as { mensaje?: string; cambios?: string[] };
      setMercadoMsg(d.mensaje || '✓ Verificación completada');
      cargarMercado();
      if ((d.cambios?.length ?? 0) > 0) cargarVehiculos();
    } catch { setMercadoMsg('Error al ejecutar la verificación'); }
    setMercadoChecking(false);
  };

  const cargarUsuarios = () =>
    fetch('/api/admin/usuarios').then(r => r.json()).then(d => setUsuarios(d.usuarios || [])).catch(() => setErrorListas(e => ({ ...e, usuarios: true })));

  const cargarVehiculos = () =>
    fetch('/api/vehiculos?panelAdmin=1').then(r => r.json()).then(d => setVehiculos(d.vehiculos || [])).catch(() => setErrorListas(e => ({ ...e, vehiculos: true })));

  // `reservasOk` se marca aparte de `errorListas.reservas` a propósito: `errorListas` solo
  // controla el recuadro de "Reintentar" de la pestaña Reservas (que un admin sin esa área ni
  // siquiera ve) y se deja exactamente como estaba; `reservasOk` es lo que consume el editor
  // de calendario para no dejar editar a ciegas cuando el 403 del área `reservas` nos dejó
  // sin saber qué días están reservados.
  const cargarReservas = () =>
    fetch('/api/reservas')
      .then(async r => {
        if (!r.ok) { setReservasOk(false); return; }
        const d = await r.json();
        setReservas(d.reservas || []);
        setReservasOk(true);
      })
      .catch(() => { setReservasOk(false); setErrorListas(e => ({ ...e, reservas: true })); });

  const toggleEstado = async (u: Usuario) => {
    const nuevo = u.estado_cuenta === 'activa' ? 'inactiva' : 'activa';
    const res = await fetch('/api/admin/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, estado_cuenta: nuevo }),
    });
    if (res.ok) setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, estado_cuenta: nuevo } : x));
  };

  // Eliminar cuenta (borrado inteligente, ver lib/eliminar.ts): el servidor decide solo
  // entre borrado real y archivado reversible según si la cuenta tiene historial de negocio.
  const eliminarUsuario = async (u: Usuario) => {
    if (!window.confirm(
      `¿Eliminar la cuenta de ${u.nombre} (${u.correo})?\n\n` +
      'Si nunca tuvo actividad (reservas, vehículos, pagos, chat…) se borra para siempre. ' +
      'Si sí tuvo, se archivará (queda oculta pero se puede recuperar).'
    )) return;
    setEliminandoUsuario(u.id);
    try {
      const res = await fetch(`/api/admin/usuarios?id=${u.id}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({})) as { resultado?: string; error?: string };
      if (!res.ok) { alert(d.error || 'No se pudo eliminar la cuenta.'); return; }
      if (d.resultado === 'borrado') {
        setUsuarios(prev => prev.filter(x => x.id !== u.id));
        alert(`✓ Se eliminó por completo la cuenta de ${u.nombre} (no tenía historial).`);
      } else {
        setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, estado_cuenta: 'archivada' } : x));
        alert(`✓ ${u.nombre} tenía historial de negocio, así que se archivó (no se borró) — puedes desarchivarla desde "Ver archivadas".`);
      }
    } catch {
      alert('Error de conexión, intenta de nuevo.');
    } finally {
      setEliminandoUsuario(null);
    }
  };

  const desarchivarUsuario = async (u: Usuario) => {
    const res = await fetch('/api/admin/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, accion: 'desarchivar' }),
    });
    if (res.ok) setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, estado_cuenta: 'inactiva' } : x));
    else alert('No se pudo desarchivar la cuenta.');
  };

  // ── Equipo y roles (solo nivel principal) ──────────────────────────────────
  const [nuevoEquipo, setNuevoEquipo] = useState<{ nombre: string; correo: string; password: string; admin_nivel: AdminNivel }>({ nombre: '', correo: '', password: '', admin_nivel: 'secretaria' });
  const [creandoEquipo, setCreandoEquipo] = useState(false);
  const [equipoMsg, setEquipoMsg] = useState('');

  const crearEquipo = async () => {
    setCreandoEquipo(true); setEquipoMsg('');
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nuevoEquipo),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setEquipoMsg('✓ Cuenta creada.');
        setNuevoEquipo({ nombre: '', correo: '', password: '', admin_nivel: 'secretaria' });
        cargarUsuarios();
        setTimeout(() => setEquipoMsg(''), 4000);
      } else {
        setEquipoMsg(d.error || 'No se pudo crear la cuenta.');
      }
    } catch {
      setEquipoMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setCreandoEquipo(false);
    }
  };

  const cambiarNivel = async (u: Usuario, nivel: AdminNivel) => {
    const res = await fetch('/api/admin/usuarios', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: u.id, admin_nivel: nivel }),
    });
    if (res.ok) setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, admin_nivel: nivel } : x));
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'No se pudo cambiar el nivel.'); }
  };

  // ── Permisos por sección (casillas por empleado) ───────────────────────────
  // Solo se envían al servidor las excepciones; el servidor revalida todo (lista
  // blanca de áreas, no editarse a uno mismo, `usuarios_gestion` prohibida).
  const [permisosAbierto, setPermisosAbierto] = useState<number | null>(null);
  const [permisosDraft, setPermisosDraft] = useState<Record<number, PermisosExtra>>({});
  // Snapshot de permisos_extra que tenía cada panel al abrirse. Se usa para calcular
  // el DELTA a enviar (solo lo que esta sesión cambió), en vez de mandar el mapa
  // completo del draft y arriesgarse a pisar cambios de otra sesión concurrente.
  const [permisosBaseline, setPermisosBaseline] = useState<Record<number, PermisosExtra>>({});
  const [permisosMsg, setPermisosMsg] = useState('');
  const [guardandoPermisos, setGuardandoPermisos] = useState(false);

  const abrirPermisos = (u: Usuario) => {
    setPermisosMsg('');
    if (permisosAbierto === u.id) { setPermisosAbierto(null); return; }
    const actual = parsePermisosExtra(u.permisos_extra);
    setPermisosDraft(prev => ({ ...prev, [u.id]: actual }));
    setPermisosBaseline(prev => ({ ...prev, [u.id]: actual }));
    setPermisosAbierto(u.id);
  };

  // Diferencia entre lo que había al abrir el panel y lo que quedó en el draft:
  // solo esas claves se mandan al servidor (null = "quitar la excepción, volver al nivel").
  const deltaPermisos = (baseline: PermisosExtra, draft: PermisosExtra): PermisosExtraDelta => {
    const delta: PermisosExtraDelta = {};
    const claves = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
    for (const clave of claves) {
      const antes = baseline[clave];
      const despues = draft[clave];
      if (antes === despues) continue;
      delta[clave] = despues === undefined ? null : despues;
    }
    return delta;
  };

  const alternarArea = (u: Usuario, area: string) => {
    const nivelU = normalizarNivel(u.admin_nivel);
    setPermisosDraft(prev => {
      const actual = prev[u.id] ?? parsePermisosExtra(u.permisos_extra);
      const valor = !puede(nivelU, area, actual);
      const nuevo = { ...actual };
      // Si el valor elegido coincide con el del nivel, no es excepción: se hereda.
      if (valor === puede(nivelU, area)) delete nuevo[area];
      else nuevo[area] = valor;
      return { ...prev, [u.id]: nuevo };
    });
  };

  const restablecerPermisos = (u: Usuario) => setPermisosDraft(prev => ({ ...prev, [u.id]: {} }));

  const guardarPermisos = async (u: Usuario) => {
    const draft = permisosDraft[u.id] ?? parsePermisosExtra(u.permisos_extra);
    const baseline = permisosBaseline[u.id] ?? parsePermisosExtra(u.permisos_extra);
    const delta = deltaPermisos(baseline, draft);
    setGuardandoPermisos(true); setPermisosMsg('');
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, permisos_extra: delta }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const guardados = parsePermisosExtra(d.permisos_extra ?? draft);
        setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, permisos_extra: JSON.stringify(guardados) } : x));
        setPermisosDraft(prev => ({ ...prev, [u.id]: guardados }));
        setPermisosBaseline(prev => ({ ...prev, [u.id]: guardados }));
        setPermisosMsg('✓ Permisos guardados.');
        setTimeout(() => setPermisosMsg(''), 4000);
      } else {
        setPermisosMsg(d.error || 'No se pudieron guardar los permisos.');
      }
    } catch {
      setPermisosMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setGuardandoPermisos(false);
    }
  };

  const guardarNuevaContrasena = async () => {
    if (!resetPass) return;
    if (resetPass.nueva.length < 6) return;
    if (resetPass.nueva !== resetPass.confirmar) return;
    const nueva = resetPass.nueva;
    setResetPass(r => r ? { ...r, guardando: true, ok: '' } : r);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resetPass.uid, nueva_contrasena: nueva }),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) {
        setResetPass(r => r ? { ...r, guardando: false, ok: nueva } : r);
      } else {
        setResetPass(r => r ? { ...r, guardando: false, ok: `Error: ${d.error || res.status}` } : r);
      }
    } catch {
      setResetPass(r => r ? { ...r, guardando: false, ok: 'Error: sin conexión' } : r);
    }
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

  const toggleVitrina = async (v: Vehiculo) => {
    const nuevo = v.en_vitrina ? 0 : 1;
    setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, en_vitrina: nuevo } : x));
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ en_vitrina: nuevo }),
      });
      if (!res.ok) throw new Error('No se pudo actualizar');
    } catch {
      // Revierte el cambio optimista si el servidor no lo confirmó.
      setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, en_vitrina: v.en_vitrina } : x));
    }
  };

  // Activa/desactiva `disponible` directamente desde el panel de admin (antes solo se podía
  // desde el dashboard del propietario). El servidor (app/api/vehiculos/[id]/route.ts) ya
  // rechaza con 400 el intento de activar si el SOAT o la Tecno-mecánica no están aprobados,
  // y también rechaza mandar `documentos` junto con `disponible: 1` — por eso el body de este
  // PUT va siempre solo con `{ disponible }`, sin ningún campo extra.
  const toggleDisponible = async (v: Vehiculo) => {
    const nuevo = v.disponible ? 0 : 1;
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disponible: nuevo }),
      });
      if (res.ok) {
        setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, disponible: nuevo } : x));
      } else {
        // Ej. el gate de SOAT/Tecno-mecánica: el servidor no deja marcar disponible=1
        // hasta que ambos documentos estén aprobados por DrivePass.
        const d = await res.json().catch(() => ({}));
        alert((d as { error?: string }).error || 'No se pudo cambiar la disponibilidad.');
      }
    } catch {
      alert('Sin conexión — intenta de nuevo.');
    }
  };

  const cargarVehiculosArchivados = () =>
    fetch('/api/vehiculos?archivados=1').then(r => r.json()).then(d => setVehiculosArchivados(d.vehiculos || [])).catch(() => {});

  const alternarVerArchivadosVehiculos = () => {
    const nuevo = !verArchivadosVehiculos;
    setVerArchivadosVehiculos(nuevo);
    if (nuevo) { setVerRevisionContenido(false); cargarVehiculosArchivados(); }
  };

  // Eliminar vehículo (borrado inteligente, ver lib/eliminar.ts): el servidor decide solo
  // entre borrado real y archivado reversible según si el vehículo tiene reservas.
  const eliminarVehiculo = async (v: Vehiculo) => {
    if (!window.confirm(
      `¿Eliminar ${v.marca} ${v.modelo} ${v.anio}?\n\n` +
      'Si nunca tuvo reservas se borra para siempre. Si sí tuvo, se archivará ' +
      '(desaparece de la vitrina y del panel, pero se puede recuperar).'
    )) return;
    setEliminandoVehiculo(v.id);
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({})) as { resultado?: string; error?: string };
      if (!res.ok) { alert(d.error || 'No se pudo eliminar el vehículo.'); return; }
      setVehiculos(vs => vs.filter(x => x.id !== v.id));
      if (d.resultado === 'borrado') {
        alert(`✓ Se eliminó por completo ${v.marca} ${v.modelo} (no tenía reservas).`);
      } else {
        alert(`✓ ${v.marca} ${v.modelo} tenía reservas, así que se archivó (no se borró) — puedes desarchivarlo desde "Ver archivados".`);
        if (verArchivadosVehiculos) cargarVehiculosArchivados();
      }
    } catch {
      alert('Error de conexión, intenta de nuevo.');
    } finally {
      setEliminandoVehiculo(null);
    }
  };

  const desarchivarVehiculo = async (v: Vehiculo) => {
    const res = await fetch(`/api/vehiculos/${v.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archivado: 0 }),
    });
    if (res.ok) {
      setVehiculosArchivados(vs => vs.filter(x => x.id !== v.id));
      cargarVehiculos();
    } else {
      alert('No se pudo desarchivar el vehículo.');
    }
  };

  // ── Moderación de contenido (fotos marcadas por la IA, ver lib/moderacion.ts) ──
  const cargarVehiculosRevisionContenido = () =>
    fetch('/api/vehiculos?revisionContenido=1').then(r => r.json()).then(d => setVehiculosRevisionContenido(d.vehiculos || [])).catch(() => {});

  const alternarVerRevisionContenido = () => {
    const nuevo = !verRevisionContenido;
    setVerRevisionContenido(nuevo);
    if (nuevo) { setVerArchivadosVehiculos(false); cargarVehiculosRevisionContenido(); }
  };

  const aprobarContenidoVehiculo = async (v: Vehiculo) => {
    if (!window.confirm(`¿Confirmas que revisaste las fotos de ${v.marca} ${v.modelo} ${v.anio} y NO tienen contenido inapropiado? Quedará publicado de nuevo.`)) return;
    setAprobandoContenido(v.id);
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenido_revision: 0, contenido_revision_motivo: '' }),
      });
      if (res.ok) {
        setVehiculosRevisionContenido(vs => vs.filter(x => x.id !== v.id));
        cargarVehiculos();
      } else {
        alert('No se pudo aprobar el vehículo.');
      }
    } finally {
      setAprobandoContenido(null);
    }
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

  // ── Editor de calendario (disponibilidad) del admin ───────────────────────────────────
  // Mismas capacidades que el propietario: marcar/desmarcar días. Sin poderes extra.
  // El servidor (PUT /api/vehiculos/[id]) audita el cambio y le avisa al propietario cuando
  // es un admin tocando un vehículo ajeno, y rechaza con 400 si el cambio cerraría un día
  // que ya tiene una reserva activa.

  /**
   * Días ya comprometidos por reservas activas de ESTE vehículo, con el MISMO criterio que
   * usa el servidor (fin EXCLUSIVO y solo de hoy en adelante, ver lib/dias-disponibles.ts).
   * Alimenta tanto las celdas rojas deshabilitadas como la unión de seguridad al guardar, así
   * que lo que se pinta y lo que se protege es exactamente el mismo conjunto.
   */
  const diasOcupadosVehiculo = (vid: number): string[] =>
    [...diasOcupadosPorReservas(reservas.filter(r => r.vehiculo_id === vid))];

  /** ¿Quedan cambios sin guardar en el modal de disponibilidad? (orden irrelevante) */
  const dispHayCambios = (() => {
    if (dispDias.length !== dispOriginal.length) return true;
    const guardados = new Set(dispOriginal);
    return dispDias.some(d => !guardados.has(d));
  })();

  const abrirDispModal = (v: Vehiculo) => {
    const guardados = parseDiasGuardados(v.dias_disponibles);
    setDispDias(guardados);
    setDispOriginal(guardados);
    setDispMsg('');
    setDispGuardando(false);
    setDispModal({ v });
  };

  /** Cierra el modal, pidiendo confirmación si hay cambios que nunca se guardaron. */
  const cerrarDispModal = () => {
    if (dispHayCambios && !dispGuardando) {
      const seguir = confirm('Tienes cambios en el calendario sin guardar. Si cierras ahora se pierden.\n\n¿Cerrar de todos modos?');
      if (!seguir) return;
    }
    setDispModal(null);
  };

  const guardarDispDias = async (v: Vehiculo, elegidos: string[]) => {
    const anterior = dispOriginal;

    // ⚠️ SEMÁNTICA INVERTIDA: dejar el calendario sin ningún día marcado NO cierra el
    // vehículo, lo deja ABIERTO SIN RESTRICCIONES (ver lib/dias-disponibles.ts) — justo lo
    // contrario de lo que sugiere el botón "Limpiar todo" del componente. Se confirma antes
    // de guardar en vez de cambiar la semántica del dato o el componente compartido.
    if (elegidos.length === 0 && anterior.length > 0) {
      const seguir = confirm(
        `Vas a dejar el calendario de ${v.marca} ${v.modelo} SIN ningún día marcado.\n\n` +
        'OJO: eso NO cierra el vehículo — lo deja ABIERTO SIN RESTRICCIONES (todos los días ' +
        'quedan disponibles para reservar).\n\n¿Continuar?'
      );
      if (!seguir) return;
    }

    // Los días con reserva activa se preservan siempre: el componente no deja marcarlos
    // (celdas deshabilitadas), así que sin esta unión un vehículo irrestricto con una reserva
    // encima quedaba en un callejón sin salida — el primer día que marcaras cerraría los días
    // reservados y el servidor rechazaría el guardado siempre.
    const dias = conDiasOcupados(elegidos, diasOcupadosVehiculo(v.id), anterior);

    setDispDias(dias);
    setDispMsg('');
    setDispGuardando(true);
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias_disponibles: JSON.stringify(dias) }),
      });
      if (res.ok) {
        // La UI se sincroniza con lo que el servidor dice que quedó en BD (normalizado), no
        // con lo que mandamos: si difirieran, lo que manda es la BD.
        const d = await res.json().catch(() => ({}));
        const guardados = Array.isArray((d as { dias_disponibles?: unknown }).dias_disponibles)
          ? ((d as { dias_disponibles: string[] }).dias_disponibles)
          : dias;
        setDispDias(guardados);
        setDispOriginal(guardados);
        setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, dias_disponibles: JSON.stringify(guardados) } : x));
        setDispMsg(guardados.length === 0
          ? '✓ Guardado — el vehículo quedó abierto sin restricciones.'
          : `✓ Guardado — ${guardados.length} día${guardados.length !== 1 ? 's' : ''} marcado${guardados.length !== 1 ? 's' : ''}.`);
      } else {
        // Rollback a lo último confirmado por el servidor: si rechazó el cambio, el calendario
        // no puede quedar mostrando algo que no se guardó.
        const d = await res.json().catch(() => ({}));
        setDispDias(anterior);
        setDispMsg((d as { error?: string }).error || 'No se pudo guardar el calendario.');
      }
    } catch {
      setDispDias(anterior);
      setDispMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setDispGuardando(false);
    }
  };

  // Abre el modal de documentos de un vehículo puntual al llegar desde una notificación
  // (?vehiculo=<id>, ver destinoDeNotificacion en components/Navbar.tsx) — solo una vez,
  // cuando la lista de vehículos ya cargó.
  const urlVehiculoAplicado = useRef(false);
  useEffect(() => {
    if (urlVehiculoAplicado.current || vehiculos.length === 0) return;
    const vehiculoParam = searchParams.get('vehiculo');
    if (!vehiculoParam) { urlVehiculoAplicado.current = true; return; }
    const v = vehiculos.find(x => x.id === Number(vehiculoParam));
    if (v) abrirDocModal(v);
    urlVehiculoAplicado.current = true;
  }, [vehiculos, searchParams]);

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

  // Las cuentas archivadas (ver lib/eliminar.ts) se ocultan del listado normal — solo se
  // ven al activar "Ver archivadas", que hoy no es un estado aparte sino el valor
  // 'archivada' del filtro de estado (así el botón y el `select` nunca se contradicen).
  const archivadasUsuariosCount = usuarios.filter(u => u.estado_cuenta === 'archivada').length;
  // La misma condición que gatea el botón y la opción del `select`, repetida acá a
  // propósito: si mañana alguien siembra este estado desde otro lado (una URL, un preset),
  // la lista no debe destaparle cuentas archivadas a quien no gestiona el equipo.
  const verArchivadosUsuarios = usrEstado === 'archivada' && puede(miNivel, 'usuarios_gestion');

  // Universo sobre el que se cuenta "de cuántos": las archivadas solo entran cuando se
  // están pidiendo a propósito, igual que antes.
  const usuariosVisibles = usuarios.filter(u =>
    verArchivadosUsuarios ? u.estado_cuenta === 'archivada' : u.estado_cuenta !== 'archivada'
  );
  const hayFiltrosUsuarios = !!(usrBusq.trim() || usrRol || usrEstado || usrDocs || usrDesde || usrHasta);
  const limpiarFiltrosUsuarios = () => {
    setUsrBusq(''); setUsrRol(''); setUsrEstado(''); setUsrDocs(''); setUsrDesde(''); setUsrHasta('');
  };
  const usuariosFiltrados = ordenarPorLlegada(
    usuariosVisibles.filter(u => {
      if (usrRol && u.rol !== usrRol) return false;
      if (usrEstado && u.estado_cuenta !== usrEstado) return false;
      if (usrDocs === 'completos' && !docsUsuarioCompletos(u)) return false;
      if (usrDocs === 'incompletos' && docsUsuarioCompletos(u)) return false;
      if (!enRangoRegistro(u.created_at, usrDesde, usrHasta)) return false;
      const q = plano(usrBusq.trim());
      if (q) {
        // Nombre, correo, documento y celular (con y sin indicativo, para que sirva tanto
        // "3001234567" como "+573001234567").
        const celular = `${u.celular_indicativo || ''}${u.celular || ''}`;
        const campos = [u.nombre, u.correo, u.documento_identidad, u.celular, celular];
        if (!campos.some(c => plano(c).includes(q))) return false;
      }
      return true;
    }),
    usrOrden,
  );

  // ── Filtros de vehículos ───────────────────────────────────────────────────
  // Se aplican IGUAL a las tres vistas de la pestaña (activos, archivados y en revisión
  // de contenido): son tres consultas distintas al mismo endpoint, pero para quien mira
  // la pantalla es la misma lista de carros, y tener el buscador solo en una de ellas
  // obligaba a recordar en cuál sí funcionaba.
  const propietariosDeVehiculos = (() => {
    const mapa = new Map<number, string>();
    for (const v of [...vehiculos, ...vehiculosArchivados, ...vehiculosRevisionContenido]) {
      if (!mapa.has(v.propietario_id)) mapa.set(v.propietario_id, v.propietario_nombre || `Propietario #${v.propietario_id}`);
    }
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  })();
  const hayFiltrosVehiculos = !!(vehBusq.trim() || vehPropietario || vehDocs || vehDisponible || vehCombustible || vehDesde || vehHasta);
  const limpiarFiltrosVehiculos = () => {
    setVehBusq(''); setVehPropietario(''); setVehDocs(''); setVehDisponible('');
    setVehCombustible(''); setVehDesde(''); setVehHasta('');
  };
  const filtrarVehiculosLista = (lista: Vehiculo[]) => ordenarPorLlegada(
    lista.filter(v => {
      if (vehPropietario && String(v.propietario_id) !== vehPropietario) return false;
      if (vehDocs && (v.documentos_estado || 'sin_documentos') !== vehDocs) return false;
      if (vehDisponible && String(Number(v.disponible) === 1 ? 1 : 0) !== vehDisponible) return false;
      // 'sin' = el propietario no declaró combustible (columna en ''), que es un caso real
      // y útil de listar: son los carros a los que les falta ese dato de la matrícula.
      if (vehCombustible === 'sin' && (v.combustible || '')) return false;
      if (vehCombustible && vehCombustible !== 'sin' && (v.combustible || '') !== vehCombustible) return false;
      if (!enRangoRegistro(v.created_at, vehDesde, vehHasta)) return false;
      const q = plano(vehBusq.trim());
      if (q) {
        const campos = [v.placa, v.marca, v.modelo, `${v.marca} ${v.modelo}`, String(v.anio)];
        if (!campos.some(c => plano(c).includes(q))) return false;
      }
      return true;
    }),
    vehOrden,
  );
  const vehiculosFiltrados = filtrarVehiculosLista(vehiculos);
  const vehiculosArchivadosFiltrados = filtrarVehiculosLista(vehiculosArchivados);
  const vehiculosRevisionFiltrados = filtrarVehiculosLista(vehiculosRevisionContenido);

  // Abre el visor a pantalla completa con TODAS las fotos de un vehículo: primero las
  // siete casillas etiquetadas (`fotos_detalle`) y después las sueltas de la galería
  // (`fotos`) que no estén ya entre ellas.
  const fotosDeVehiculo = (v: Vehiculo): FotoVisor[] => {
    let detalle: Record<string, string> = {};
    try { detalle = JSON.parse(v.fotos_detalle || '{}') as Record<string, string>; } catch { detalle = {}; }
    const fotos: FotoVisor[] = [];
    const vistas = new Set<string>();
    for (const [clave, label] of Object.entries(FOTOS_LABELS)) {
      const url = (detalle[clave] || '').trim();
      if (!url || vistas.has(url)) continue;
      vistas.add(url);
      // `alt` (campo de FotoVisor): sin él el visor arma "Foto de frente 1 de 1", que
      // no dice de qué carro es. Acá sí se sabe.
      fotos.push({ url, grupo: label, alt: `${label} — ${v.marca} ${v.modelo} ${v.anio}` });
    }
    let galeria: string[] = [];
    try { galeria = JSON.parse(v.fotos || '[]') as string[]; } catch { galeria = []; }
    for (const u of galeria) {
      const url = String(u || '').trim();
      if (!url || vistas.has(url)) continue;
      vistas.add(url);
      fotos.push({ url, grupo: 'Galería', alt: `Foto de ${v.marca} ${v.modelo} ${v.anio}` });
    }
    return fotos;
  };
  const tituloVehiculo = (v: Vehiculo) =>
    `${v.marca} ${v.modelo} ${v.anio}${v.placa ? ` · ${v.placa}` : ''}`;
  const abrirVisorVehiculo = (v: Vehiculo, url?: string) => {
    const fotos = fotosDeVehiculo(v);
    if (fotos.length === 0) return;
    const i = url ? fotos.findIndex(f => f.url === url) : 0;
    setVisorFotos({ fotos, indice: i >= 0 ? i : 0, titulo: tituloVehiculo(v) });
  };

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
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6 pb-6 border-b border-border">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-ink tracking-[-0.02em]">Panel Administrador</h1>
          <p className="text-ink-soft mt-1.5">Gestión total del sistema DrivePass</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="https://accounts.zoho.com/signin?service_language=es&servicename=VirtualOffice&signupurl=https://www.zoho.com/mail/signup.html&serviceurl=https://mail.zoho.com"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-ink font-semibold text-sm px-5 h-11 rounded-xl border border-border bg-surface-2 transition hover:bg-surface hover:-translate-y-0.5">
            ✉️ Correo (Zoho)
            <span className="text-[10px] opacity-60">↗</span>
          </a>
          <a href="/control" target="_blank" rel="noopener"
            className="glow-accent inline-flex items-center gap-2 text-white font-semibold text-sm px-5 h-11 rounded-xl transition hover:-translate-y-0.5"
            style={{ background: 'var(--gradient-accent)' }}>
            🎛️ Panel de control interno
            <span className="text-[10px] opacity-80">↗</span>
          </a>
        </div>
      </div>

      {/* Stats (StatCards del Design System) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[
          { label: 'Total usuarios',      value: stats.total,          tone: 'ink'    },
          { label: 'Propietarios',        value: stats.propietarios,   tone: 'accent' },
          { label: 'Alquiladores',        value: stats.usuariosCount,  tone: 'ink'    },
          { label: 'Sin precio asignado', value: sinPrecio,            tone: sinPrecio > 0 ? 'danger' : 'ink' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-4 sm:p-5 border border-border bg-surface-2 shadow-[var(--shadow-card)]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{s.label}</p>
            <p className={`text-3xl font-black mt-2 font-mono ${s.tone === 'accent' ? 'text-accent' : s.tone === 'danger' ? 'text-danger' : 'text-ink'}`}
              style={{ fontFeatureSettings: "'tnum' 1" }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border flex-wrap">
        {([
          { key: 'usuarios',  label: `Usuarios (${usuarios.length})` },
          { key: 'vehiculos', label: `Vehículos (${vehiculos.length})` },
          { key: 'buses', label: '🚌 Buses' },
          { key: 'reservas',  label: `Reservas (${reservas.length})`, badge: pendientesCount },
          { key: 'contabilidad', label: '💰 Contabilidad' },
          { key: 'mercado', label: '📊 Mercado' },
          { key: 'calculadora', label: '🧮 Calculadora' },
          { key: 'leads', label: '🎯 Leads' },
          { key: 'soporte', label: '💬 Soporte' },
          { key: 'nfc', label: '📇 Tarjetas NFC' },
          { key: 'config', label: 'Configuración' },
          { key: 'auditoria', label: '🧾 Bitácora' },
        ] as const).filter(t => puede(miNivel, t.key, misPermisos)).map(t => (
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
      {tab === 'usuarios' && errorListas.usuarios && (
        <div className="bg-danger/10 border border-danger/25 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-danger">No pudimos cargar los usuarios. Revisa tu conexión.</span>
          <button onClick={cargarUsuarios} className="text-xs font-semibold text-danger underline">Reintentar</button>
        </div>
      )}
      {tab === 'usuarios' && puede(miNivel, 'usuarios_gestion') && (
        <div className="bg-surface-2 rounded-2xl border border-border p-5 mb-4 space-y-4">
          <div>
            <p className="text-sm font-bold text-ink">👥 Equipo y roles</p>
            <p className="text-[11px] text-ink/50">Crea cuentas con acceso limitado. La <strong>secretaría</strong> solo ve Reservas, Leads y Soporte aquí, más el <strong>Panel de control</strong> (Operaciones, Tareas, Calendario, Documentos y Tableros) — sin plata, usuarios ni configuración. Los <strong>socios</strong> ven todo pero no gestionan el equipo ni la configuración.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input value={nuevoEquipo.nombre} onChange={e => setNuevoEquipo(s => ({ ...s, nombre: e.target.value }))}
              placeholder="Nombre" className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            <input value={nuevoEquipo.correo} onChange={e => setNuevoEquipo(s => ({ ...s, correo: e.target.value }))}
              placeholder="Correo" className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            <input value={nuevoEquipo.password} onChange={e => setNuevoEquipo(s => ({ ...s, password: e.target.value }))}
              placeholder="Contraseña (mín. 6)" type="text" className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            <select value={nuevoEquipo.admin_nivel} onChange={e => setNuevoEquipo(s => ({ ...s, admin_nivel: e.target.value as AdminNivel }))}
              className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
              {NIVELES.map(n => <option key={n} value={n}>{NIVEL_LABEL[n]}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={crearEquipo} disabled={creandoEquipo}
              className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition disabled:opacity-60">
              {creandoEquipo ? 'Creando…' : 'Crear cuenta de equipo'}
            </button>
            {equipoMsg && <span className={`text-xs ${equipoMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{equipoMsg}</span>}
          </div>
        </div>
      )}
      {/* Filtros de la lista de usuarios. Mismo estilo que los de la pestaña Reservas. */}
      {tab === 'usuarios' && (
        <div className="space-y-3 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <FiltroCampo label="Buscar" className="flex-1 min-w-48">
              <input
                type="search" placeholder="Nombre, correo, documento o celular…"
                className={CLASE_CONTROL_FILTRO}
                value={usrBusq}
                onChange={e => setUsrBusq(e.target.value)}
              />
            </FiltroCampo>
            <FiltroCampo label="Rol">
              <select className={CLASE_CONTROL_FILTRO} value={usrRol} onChange={e => setUsrRol(e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(ROL_FILTRO_LABELS).map(([valor, label]) => (
                  <option key={valor} value={valor}>{label}</option>
                ))}
              </select>
            </FiltroCampo>
            <FiltroCampo label="Estado de la cuenta">
              <select className={CLASE_CONTROL_FILTRO} value={usrEstado} onChange={e => setUsrEstado(e.target.value)}>
                <option value="">Todas (sin archivadas)</option>
                {/* 'Archivada' se ofrece SOLO a quien ya podía abrir esa vista con el botón
                    "🗄️ Ver archivadas" (usuarios_gestion). No es un dato nuevo —el listado
                    de GET /api/admin/usuarios siempre las manda, a cualquier admin con el
                    área 'usuarios'— pero el panel no se las mostraba, y este filtro no es
                    el lugar para cambiar quién ve qué. */}
                {Object.entries(ESTADO_CUENTA_LABELS)
                  .filter(([valor]) => valor !== 'archivada' || puede(miNivel, 'usuarios_gestion'))
                  .map(([valor, label]) => (
                    <option key={valor} value={valor}>
                      {label}{valor === 'archivada' ? ` (${archivadasUsuariosCount})` : ''}
                    </option>
                  ))}
              </select>
            </FiltroCampo>
            <FiltroCampo label="Documentos">
              <select className={CLASE_CONTROL_FILTRO} value={usrDocs} onChange={e => setUsrDocs(e.target.value)}>
                <option value="">Todos</option>
                <option value="completos">Completos</option>
                <option value="incompletos">Incompletos</option>
              </select>
            </FiltroCampo>
            <FiltroCampo label="Registrados desde" className="min-w-36">
              <input type="date" className={CLASE_CONTROL_FILTRO} value={usrDesde} max={usrHasta || undefined}
                onChange={e => setUsrDesde(e.target.value)} />
            </FiltroCampo>
            <FiltroCampo label="hasta" className="min-w-36">
              <input type="date" className={CLASE_CONTROL_FILTRO} value={usrHasta} min={usrDesde || undefined}
                onChange={e => setUsrHasta(e.target.value)} />
            </FiltroCampo>
            <BotonOrdenLlegada orden={usrOrden} onCambiar={setUsrOrden} titulo="fecha de registro" />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <ResumenFiltros
              mostrados={usuariosFiltrados.length}
              total={usuariosVisibles.length}
              hayFiltros={hayFiltrosUsuarios}
              onLimpiar={limpiarFiltrosUsuarios}
              etiqueta={verArchivadosUsuarios ? 'cuentas archivadas' : 'cuentas'}
            />
            {puede(miNivel, 'usuarios_gestion') && (
              <button onClick={() => setUsrEstado(e => e === 'archivada' ? '' : 'archivada')}
                className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                  verArchivadosUsuarios ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface'
                }`}>
                {verArchivadosUsuarios ? '← Ver cuentas activas' : `🗄️ Ver archivadas (${archivadasUsuariosCount})`}
              </button>
            )}
          </div>
        </div>
      )}
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
                  {/* Fecha de llegada de esa persona a la plataforma. Es clicable: cambia
                      el orden entre "más recientes primero" y "más antiguos primero",
                      igual que el botón de la barra de filtros. */}
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">
                    <button type="button"
                      onClick={() => setUsrOrden(o => o === 'recientes' ? 'antiguos' : 'recientes')}
                      title="Clic para invertir el orden"
                      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-accent transition">
                      Se registró
                      <span aria-hidden="true" className="text-accent">{usrOrden === 'recientes' ? '↓' : '↑'}</span>
                      <span className="sr-only">
                        {usrOrden === 'recientes' ? 'más recientes primero' : 'más antiguos primero'}
                      </span>
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {usuariosFiltrados.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-ink/40">
                    {hayFiltrosUsuarios
                      ? 'Ningún usuario coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                      : verArchivadosUsuarios ? 'No hay cuentas archivadas.' : 'No hay usuarios.'}
                  </td></tr>
                )}
                {usuariosFiltrados.map(u => (
                  <Fragment key={u.id}>
                  <tr className="hover:bg-surface transition">
                    <td className="px-4 py-3 font-semibold text-ink">
                      <span className="flex items-center gap-2">
                        {u.nombre}
                        {u.rol === 'propietario' && propietariosConDocsEnRevision.has(u.id) && (
                          <span title="Tiene documentos pendientes de revisión" className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 whitespace-nowrap">📄 Docs pendientes</span>
                        )}
                        {/* Distinto del badge de arriba: aquel habla de los documentos de
                            SUS VEHÍCULOS; este, de los de SU CUENTA (ver docsUsuarioCompletos). */}
                        {!docsUsuarioCompletos(u) && (
                          <span title={u.rol === 'propietario'
                            ? 'Le falta cédula (frente y dorso), datos bancarios o certificado bancario'
                            : 'Le falta el documento de identidad o la foto de la cédula (frente y dorso)'}
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ink/10 text-ink/60 border border-border whitespace-nowrap">
                            🪪 Documentos incompletos
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink/60 hidden sm:table-cell">{u.correo}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${rolColor[u.rol] || 'bg-surface'}`}>{u.rol}</span>
                      {u.rol === 'admin' && <span className="block mt-1 text-[10px] text-ink/50">{NIVEL_LABEL[normalizarNivel(u.admin_nivel)]}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        u.estado_cuenta === 'activa' ? 'bg-success/15 text-success'
                          : u.estado_cuenta === 'archivada' ? 'bg-warning/15 text-warning'
                          : 'bg-danger/15 text-danger'
                      }`}>
                        {u.estado_cuenta}
                      </span>
                    </td>
                    {/* `created_at` está en UTC: fechaRegistroCorta lo pasa a hora de
                        Medellín antes de mostrarlo (ver lib/fecha-registro.ts). */}
                    <td className="px-4 py-3 text-ink/60 whitespace-nowrap"
                      title={`Se registró el ${fechaRegistroLarga(u.created_at)}`}>
                      {fechaRegistroCorta(u.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap items-center">
                        <button onClick={() => setPerfilModal({ u })}
                          className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                          <IconUser size={11} /> Perfil
                        </button>
                        {u.estado_cuenta === 'archivada' ? (
                          puede(miNivel, 'usuarios_gestion') && (
                            <button onClick={() => desarchivarUsuario(u)}
                              className="text-xs px-3 py-1.5 rounded-xl border border-success/30 text-success hover:bg-success/10 transition font-medium">
                              📤 Desarchivar
                            </button>
                          )
                        ) : (
                          <>
                            {u.rol === 'admin' && puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                              <select value={normalizarNivel(u.admin_nivel)} onChange={e => cambiarNivel(u, e.target.value as AdminNivel)}
                                className="text-xs border border-border rounded-xl px-2 py-1.5 bg-surface text-ink" title="Nivel de acceso">
                                {NIVELES.map(n => <option key={n} value={n}>{NIVEL_LABEL[n]}</option>)}
                              </select>
                            )}
                            {u.rol === 'admin' && puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                              <button onClick={() => abrirPermisos(u)} title="Elegir qué secciones ve esta persona"
                                className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                                  permisosAbierto === u.id ? 'border-accent text-accent bg-accent-light' : 'border-border text-ink/70 hover:bg-surface'
                                }`}>
                                🔐 Secciones
                                {Object.keys(parsePermisosExtra(u.permisos_extra)).length > 0 && (
                                  <span className="ml-1 text-[10px] font-bold text-warning">
                                    ({Object.keys(parsePermisosExtra(u.permisos_extra)).length})
                                  </span>
                                )}
                              </button>
                            )}
                            {(u.rol !== 'admin' || (puede(miNivel, 'usuarios_gestion') && u.id !== miId)) && (
                              <button onClick={() => toggleEstado(u)}
                                className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                                  u.estado_cuenta === 'activa'
                                    ? 'border-danger/25 text-danger hover:bg-danger/10'
                                    : 'border-success/30 text-success hover:bg-success/10'
                                }`}>
                                {u.estado_cuenta === 'activa' ? 'Desactivar' : 'Activar'}
                              </button>
                            )}
                            {/* Eliminar cuenta: exclusiva de usuarios_gestion, sin excepción — nunca sobre uno mismo. */}
                            {puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                              <button onClick={() => eliminarUsuario(u)} disabled={eliminandoUsuario === u.id}
                                title="Borra la cuenta si nunca tuvo actividad; si tuvo, la archiva"
                                className="text-xs px-3 py-1.5 rounded-xl border border-danger/30 text-danger hover:bg-danger/10 transition font-medium disabled:opacity-50">
                                {eliminandoUsuario === u.id ? 'Eliminando…' : '🗑️ Eliminar'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {u.rol === 'admin' && puede(miNivel, 'usuarios_gestion') && u.id !== miId && permisosAbierto === u.id && (
                    <tr className="bg-surface">
                      <td colSpan={6} className="px-4 py-4">
                        <PermisosSecciones
                          u={u}
                          draft={permisosDraft[u.id] ?? parsePermisosExtra(u.permisos_extra)}
                          baseline={permisosBaseline[u.id] ?? parsePermisosExtra(u.permisos_extra)}
                          onToggle={area => alternarArea(u, area)}
                          onReset={() => restablecerPermisos(u)}
                          onGuardar={() => guardarPermisos(u)}
                          guardando={guardandoPermisos}
                          msg={permisosMsg}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VEHÍCULOS ── */}
      {/* Filtros de la lista de vehículos: mismo estilo que Reservas y Usuarios. Los dos
          botones de vista (archivados / en revisión de contenido) viven acá dentro porque
          son parte de "qué carros estoy mirando", igual que el resto de la barra. */}
      {tab === 'vehiculos' && (
        <div className="space-y-3 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <FiltroCampo label="Buscar" className="flex-1 min-w-48">
              <input
                type="search" placeholder="Placa, marca o modelo…"
                className={CLASE_CONTROL_FILTRO}
                value={vehBusq}
                onChange={e => setVehBusq(e.target.value)}
              />
            </FiltroCampo>
            <FiltroCampo label="Propietario" className="min-w-44">
              <select className={CLASE_CONTROL_FILTRO} value={vehPropietario} onChange={e => setVehPropietario(e.target.value)}>
                <option value="">Todos</option>
                {propietariosDeVehiculos.map(([id, nombre]) => (
                  <option key={id} value={String(id)}>{nombre}</option>
                ))}
              </select>
            </FiltroCampo>
            <FiltroCampo label="Documentos">
              <select className={CLASE_CONTROL_FILTRO} value={vehDocs} onChange={e => setVehDocs(e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(DOC_ESTADO_FILTRO_LABELS).map(([valor, label]) => (
                  <option key={valor} value={valor}>{label}</option>
                ))}
              </select>
            </FiltroCampo>
            <FiltroCampo label="Disponible" className="min-w-32">
              <select className={CLASE_CONTROL_FILTRO} value={vehDisponible} onChange={e => setVehDisponible(e.target.value)}>
                <option value="">Todos</option>
                <option value="1">Sí, activo</option>
                <option value="0">No disponible</option>
              </select>
            </FiltroCampo>
            <FiltroCampo label="Combustible">
              <select className={CLASE_CONTROL_FILTRO} value={vehCombustible} onChange={e => setVehCombustible(e.target.value)}>
                <option value="">Todos</option>
                {COMBUSTIBLES.map(c => <option key={c} value={c}>{COMBUSTIBLE_LABELS[c]}</option>)}
                <option value="sin">Sin declarar</option>
              </select>
            </FiltroCampo>
            <FiltroCampo label="Publicados desde" className="min-w-36">
              <input type="date" className={CLASE_CONTROL_FILTRO} value={vehDesde} max={vehHasta || undefined}
                onChange={e => setVehDesde(e.target.value)} />
            </FiltroCampo>
            <FiltroCampo label="hasta" className="min-w-36">
              <input type="date" className={CLASE_CONTROL_FILTRO} value={vehHasta} min={vehDesde || undefined}
                onChange={e => setVehHasta(e.target.value)} />
            </FiltroCampo>
            <BotonOrdenLlegada orden={vehOrden} onCambiar={setVehOrden} titulo="fecha de publicación" />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <ResumenFiltros
              mostrados={
                verRevisionContenido ? vehiculosRevisionFiltrados.length
                  : verArchivadosVehiculos ? vehiculosArchivadosFiltrados.length
                  : vehiculosFiltrados.length
              }
              total={
                verRevisionContenido ? vehiculosRevisionContenido.length
                  : verArchivadosVehiculos ? vehiculosArchivados.length
                  : vehiculos.length
              }
              hayFiltros={hayFiltrosVehiculos}
              onLimpiar={limpiarFiltrosVehiculos}
              etiqueta={
                verRevisionContenido ? 'vehículos en revisión'
                  : verArchivadosVehiculos ? 'vehículos archivados'
                  : 'vehículos'
              }
            />
            <div className="flex items-center gap-2 flex-wrap">
              {vehiculosRevisionContenido.length > 0 && !verRevisionContenido && (
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-danger/15 text-danger border border-danger/25">
                  {vehiculosRevisionContenido.length} en revisión de contenido
                </span>
              )}
              <button onClick={alternarVerRevisionContenido}
                className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                  verRevisionContenido ? 'border-danger bg-danger text-white' : 'border-border text-ink/60 hover:bg-surface'
                }`}>
                {verRevisionContenido ? '← Ver vehículos activos' : '🔞 Ver en revisión de contenido'}
              </button>
              <button onClick={alternarVerArchivadosVehiculos}
                className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                  verArchivadosVehiculos ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface'
                }`}>
                {verArchivadosVehiculos ? '← Ver vehículos activos' : '🗄️ Ver archivados'}
              </button>
            </div>
          </div>
        </div>
      )}
      {tab === 'vehiculos' && verRevisionContenido && (
        <div className="space-y-3">
          {vehiculosRevisionFiltrados.length === 0 && (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">
                {hayFiltrosVehiculos && vehiculosRevisionContenido.length > 0
                  ? 'Ningún vehículo en revisión coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                  : 'No hay vehículos en revisión de contenido.'}
              </p>
            </div>
          )}
          {vehiculosRevisionFiltrados.map(v => {
            let portada = '';
            try { portada = (JSON.parse(v.fotos) as string[])[0] || ''; } catch { portada = ''; }
            // Se calcula UNA vez por tarjeta (parsea dos JSON): la miniatura necesita
            // cuántas fotos hay para saber si vale la pena ofrecer el visor.
            const fotosV = fotosDeVehiculo(v);
            return (
              <div key={v.id} className="bg-surface-2 rounded-2xl shadow-sm p-4 border border-danger/30 ring-1 ring-danger/20 flex gap-4 items-center flex-wrap">
                <MiniaturaVehiculo portada={portada} alt={`${v.marca} ${v.modelo}`}
                  cantidad={fotosV.length} onAbrir={() => abrirVisorVehiculo(v, portada)} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                  <p className="text-sm text-ink/50 mt-0.5">Propietario: {v.propietario_nombre} {v.placa && `· Placa: ${v.placa}`}</p>
                  <p className="text-xs text-ink/40 mt-0.5" title={`Se publicó el ${fechaRegistroLarga(v.created_at)}`}>
                    Publicado: {fechaRegistroCorta(v.created_at)}
                  </p>
                  <p className="text-xs text-danger mt-1">🔞 {v.contenido_revision_motivo || 'La IA marcó al menos una foto como contenido inapropiado.'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => setFotoModal({ v })}
                    className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                    Ver fotos
                  </button>
                  <button onClick={() => aprobarContenidoVehiculo(v)} disabled={aprobandoContenido === v.id}
                    className="flex items-center gap-1 text-xs border border-success/30 text-success px-2.5 py-1.5 rounded-xl hover:bg-success/10 transition font-medium disabled:opacity-50">
                    {aprobandoContenido === v.id ? 'Aprobando…' : '✓ Aprobar y publicar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'vehiculos' && verArchivadosVehiculos && (
        <div className="space-y-3">
          {vehiculosArchivadosFiltrados.length === 0 && (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">
                {hayFiltrosVehiculos && vehiculosArchivados.length > 0
                  ? 'Ningún vehículo archivado coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                  : 'No hay vehículos archivados.'}
              </p>
            </div>
          )}
          {vehiculosArchivadosFiltrados.map(v => {
            let portada = '';
            try { portada = (JSON.parse(v.fotos) as string[])[0] || ''; } catch { portada = ''; }
            // Se calcula UNA vez por tarjeta (parsea dos JSON): la miniatura necesita
            // cuántas fotos hay para saber si vale la pena ofrecer el visor.
            const fotosV = fotosDeVehiculo(v);
            return (
              <div key={v.id} className="bg-surface-2 rounded-2xl shadow-sm p-4 border border-border flex gap-4 items-center flex-wrap">
                <MiniaturaVehiculo portada={portada} alt={`${v.marca} ${v.modelo}`} atenuada
                  cantidad={fotosV.length} onAbrir={() => abrirVisorVehiculo(v, portada)} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                  <p className="text-sm text-ink/50 mt-0.5">Propietario: {v.propietario_nombre} {v.placa && `· Placa: ${v.placa}`}</p>
                  <p className="text-xs text-ink/40 mt-0.5" title={`Se publicó el ${fechaRegistroLarga(v.created_at)}`}>
                    Publicado: {fechaRegistroCorta(v.created_at)}
                  </p>
                </div>
                <button onClick={() => desarchivarVehiculo(v)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-success/30 text-success hover:bg-success/10 transition font-medium">
                  📤 Desarchivar
                </button>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'vehiculos' && !verArchivadosVehiculos && !verRevisionContenido && (
        <div className="space-y-3">
          {errorListas.vehiculos ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">No pudimos cargar los vehículos. Revisa tu conexión.</p>
              <button onClick={cargarVehiculos} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : vehiculosFiltrados.length === 0 && (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">
                {hayFiltrosVehiculos && vehiculos.length > 0
                  ? 'Ningún vehículo coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                  : 'No hay vehículos publicados aún.'}
              </p>
            </div>
          )}
          {vehiculosFiltrados.map(v => {
            let portada = '';
            try { portada = (JSON.parse(v.fotos) as string[])[0] || ''; } catch { portada = ''; }
            // Se calcula UNA vez por tarjeta (parsea dos JSON): la miniatura necesita
            // cuántas fotos hay para saber si vale la pena ofrecer el visor.
            const fotosV = fotosDeVehiculo(v);
            const sinPrecioV = !v.precio_dia || v.precio_dia === 0;
            const editandoPrecio = (vid: number) => vid in precioEdit;
            // La exención entra en la decisión: los eléctricos (y los híbridos/GNV que ya
            // inscribieron el trámite ante la Secretaría de Movilidad) están exentos en
            // Medellín (ver lib/pico-placa.ts), así que no se les pinta el borde rojo ni el badge.
            const enPP = placaRestringida(picoPlaca, v.placa ?? '', new Date(),
              { combustible: v.combustible, inscrita: v.exencion_pico_placa_inscrita });
            const leftBorder = enPP ? 'border-danger' : sinPrecioV ? 'border-accent' : 'border-transparent';
            // `disponible=0` ya se explica visualmente cuando hay un badge de documentos_estado
            // "en revisión" o "denegado" (ver más abajo). Pero también puede estar en 0 sin
            // documentos subidos (documentos_estado='sin_documentos', p. ej. un vehículo recién
            // publicado) o en cualquier otro estado que no lo explique — en esos casos, sin este
            // badge, el vehículo no tenía NINGÚN indicador visual de por qué no es visible al
            // público (así fue como un caso real quedó invisible en las 3 pestañas del panel).
            const noDisponibleSinExplicar = Number(v.disponible) === 0
              && v.documentos_estado !== 'en_revision' && v.documentos_estado !== 'denegado';

            return (
              <div key={v.id} className={`bg-surface-2 rounded-2xl shadow-sm p-4 border-l-4 ${leftBorder} ${enPP ? 'ring-1 ring-danger/30 bg-danger/5' : ''} ${!enPP && !sinPrecioV ? 'border' : ''}`}
                style={!enPP && !sinPrecioV ? { borderWidth: '1px', borderColor: 'var(--color-border)' } : {}}>
                <div className="flex gap-4 items-start flex-wrap">
                  <MiniaturaVehiculo portada={portada} alt={`${v.marca} ${v.modelo}`}
                    cantidad={fotosV.length} onAbrir={() => abrirVisorVehiculo(v, portada)} />
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
                      {noDisponibleSinExplicar && (
                        <span className="text-xs bg-ink/10 text-ink/60 px-2 py-0.5 rounded-full font-semibold border border-border">⛔ No disponible</span>
                      )}
                    </div>
                    <p className="text-sm text-ink/50 mt-0.5">Propietario: {v.propietario_nombre}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {v.placa && <span className="text-xs text-ink/50">Placa: {v.placa}</span>}
                      {/* Cuándo llegó este carro a la plataforma (created_at, en UTC → se
                          pasa a hora de Medellín en lib/fecha-registro.ts). */}
                      <span className="text-xs text-ink/40" title={`Se publicó el ${fechaRegistroLarga(v.created_at)}`}>
                        📅 Publicado: {fechaRegistroCorta(v.created_at)}
                      </span>
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
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/50 text-xs">$</span>
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
                    <button onClick={() => toggleVitrina(v)}
                      title={v.en_vitrina ? 'Quitar de la vitrina del inicio' : 'Mostrar en la vitrina del inicio'}
                      className={`flex items-center gap-1 text-xs border px-2.5 py-1.5 rounded-xl transition font-medium ${
                        v.en_vitrina
                          ? 'border-accent bg-accent text-white hover:bg-accent-hover'
                          : 'border-border text-ink/60 hover:bg-surface'
                      }`}>
                      ⭐ {v.en_vitrina ? 'En vitrina' : 'Vitrina'}
                    </button>
                    <button onClick={() => toggleDisponible(v)}
                      title={v.disponible ? 'Desactivar (se oculta del catálogo público)' : 'Activar (requiere SOAT y Tecno-mecánica aprobados)'}
                      className={`flex items-center gap-1 text-xs border px-2.5 py-1.5 rounded-xl transition font-medium ${
                        v.disponible
                          ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
                          : 'border-border text-ink/60 hover:bg-surface'
                      }`}>
                      {v.disponible ? '✓ Activo' : 'Activar'}
                    </button>
                    <button onClick={() => setFotoModal({ v })}
                      className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                      Fotos
                    </button>
                    <button onClick={() => abrirDispModal(v)}
                      title="Ver y modificar el calendario de disponibilidad de este vehículo"
                      className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                      📅 Disponibilidad
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
                    <button onClick={() => eliminarVehiculo(v)} disabled={eliminandoVehiculo === v.id}
                      title="Borra el vehículo si nunca tuvo reservas; si tuvo, lo archiva"
                      className="flex items-center gap-1 text-xs border border-danger/30 text-danger px-2.5 py-1.5 rounded-xl hover:bg-danger/10 transition font-medium disabled:opacity-50">
                      {eliminandoVehiculo === v.id ? 'Eliminando…' : '🗑️ Eliminar'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── BUSES ── */}
      {tab === 'buses' && <BusesPanel initialSubTab={searchParams.get('sub')} />}

      {/* ── RESERVAS ── */}
      {tab === 'reservas' && (
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
      )}

      {/* ── OPERACIONES / LOGÍSTICA ── */}

      {/* ── CONTABILIDAD (cotizaciones, facturas, liquidaciones a propietarios) ── */}
      {tab === 'contabilidad' && <ContabilidadPanel />}

      {/* ── CALCULADORA (precio de mercado + rentabilidad, manual) ── */}
      {tab === 'calculadora' && <CalculadoraPanel />}

      {/* ── MERCADO (comparador de precios) ── */}
      {tab === 'mercado' && (
        <div className="space-y-6 max-w-4xl">
          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h2 className="font-bold text-ink text-lg">Comparador de precios de mercado</h2>
              <p className="text-sm text-ink/50">
                La IA analiza las páginas de tu competencia y ajusta los precios automáticamente cada mañana a las 6am.
              </p>
            </div>
            <button onClick={ejecutarCheck} disabled={mercadoChecking}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-60 text-sm">
              <IconShield size={15} />
              {mercadoChecking ? 'Analizando…' : '▶ Verificar ahora'}
            </button>
          </div>

          {mercadoMsg && (
            <div className="text-sm px-4 py-2.5 rounded-xl border bg-brand-muted border-border text-ink">
              {mercadoMsg}
            </div>
          )}

          {/* Cron setup */}
          <div className="bg-surface-2 rounded-2xl border border-border p-4">
            <p className="text-xs font-bold text-ink/50 uppercase tracking-widest mb-2">Cron automático (6am diario)</p>
            <code className="text-xs bg-surface rounded-xl px-3 py-2 border border-border block text-ink/70 break-all">
              0 6 * * * /ruta/a/rentdrive/scripts/mercado-cron.sh &gt;&gt; /tmp/mercado-cron.log 2&gt;&amp;1
            </code>
            <p className="text-[11px] text-ink/50 mt-2">
              Asegúrate de tener <code>CRON_SECRET</code> y <code>APP_URL</code> en <code>.env.local</code>.
            </p>
          </div>

          {/* Agregar competidor */}
          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h3 className="font-bold text-ink mb-4">+ Agregar competidor</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Nombre</label>
                <input placeholder="Ej. Localiza Colombia"
                  value={nuevoComp.nombre}
                  onChange={e => setNuevoComp(n => ({ ...n, nombre: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">URL de su página de precios</label>
                <input placeholder="https://www.localiza.com/co/..."
                  value={nuevoComp.url}
                  onChange={e => setNuevoComp(n => ({ ...n, url: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Ajuste vs. mercado (%)</label>
                <input type="number" placeholder="-5"
                  value={nuevoComp.ajuste_pct}
                  onChange={e => setNuevoComp(n => ({ ...n, ajuste_pct: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                <p className="text-[11px] text-ink/50 mt-1">-5 = 5% más barato que el promedio. 0 = igualar el mercado.</p>
              </div>
              <div className="flex flex-col justify-center gap-2 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={nuevoComp.auto_actualizar}
                    onChange={e => setNuevoComp(n => ({ ...n, auto_actualizar: e.target.checked }))}
                    className="w-4 h-4 accent-accent" />
                  <span className="text-sm text-ink font-medium">Actualizar precios automáticamente</span>
                </label>
                <p className="text-[11px] text-ink/50">Si activo, el cron modifica los precios de tus vehículos cada día.</p>
              </div>
            </div>
            <button onClick={agregarCompetidor}
              disabled={!nuevoComp.nombre || !nuevoComp.url}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-40">
              <IconCheck size={14} /> Agregar
            </button>
          </div>

          {/* Lista de competidores */}
          {mercadoLoading ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="bg-surface-2 rounded-2xl border border-border h-28 animate-pulse" />)}</div>
          ) : competidores.length === 0 ? (
            <div className="text-center py-12 bg-surface-2 rounded-2xl border border-border">
              <p className="text-3xl mb-2">📊</p>
              <p className="text-ink/50 text-sm">Aún no has agregado ningún competidor.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {competidores.map(c => {
                const p = c.ultimo_precio;
                const tiposConPrecio = p && p.encontrado ? [
                  p.sedan && `Sedán $${p.sedan.toLocaleString('es-CO')}`,
                  p.suv && `SUV $${p.suv.toLocaleString('es-CO')}`,
                  p.compacto && `Compacto $${p.compacto.toLocaleString('es-CO')}`,
                  p.pickup && `Pickup $${p.pickup.toLocaleString('es-CO')}`,
                ].filter(Boolean) : [];

                return (
                  <div key={c.id} className={`bg-surface-2 rounded-2xl border p-5 ${c.activo ? 'border-border' : 'border-border/50 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-ink">{c.nombre}</p>
                          {c.auto_actualizar === 1 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/20">⚡ Auto-precio</span>
                          )}
                          {c.ajuste_pct !== 0 && (
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                              c.ajuste_pct < 0 ? 'bg-success/10 text-success border-success/30' : 'bg-warning/10 text-warning border-warning/25'
                            }`}>
                              {c.ajuste_pct > 0 ? '+' : ''}{c.ajuste_pct}% vs mercado
                            </span>
                          )}
                        </div>
                        <a href={c.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-accent/70 hover:text-accent transition truncate block max-w-xs mt-0.5">
                          {c.url}
                        </a>
                        {c.ultimo_check && (
                          <p className="text-[11px] text-ink/50 mt-0.5">
                            Último check: {c.ultimo_check.split('T')[0]} {c.ultimo_check.split('T')[1]?.slice(0, 5)}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => toggleActivoComp(c.id, c.activo)}
                          className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                            c.activo ? 'border-success/30 text-success hover:bg-success/10' : 'border-border text-ink/50 hover:border-accent/30 hover:text-accent'
                          }`}>
                          {c.activo ? 'Activo' : 'Inactivo'}
                        </button>
                        <button onClick={() => toggleAutoComp(c.id, c.auto_actualizar)}
                          className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                            c.auto_actualizar ? 'border-accent/30 text-accent bg-accent/10' : 'border-border text-ink/50'
                          }`}>
                          {c.auto_actualizar ? '⚡ Auto ON' : 'Auto OFF'}
                        </button>
                        <button onClick={() => eliminarCompetidor(c.id)}
                          onBlur={() => setConfirmarElimComp(cur => cur === c.id ? null : cur)}
                          aria-label={confirmarElimComp === c.id ? 'Confirmar eliminación' : 'Eliminar competidor'}
                          title={confirmarElimComp === c.id ? 'Confirmar eliminación' : 'Eliminar competidor'}
                          className={`text-xs border px-2.5 py-1.5 rounded-xl transition font-medium flex items-center gap-1 ${
                            confirmarElimComp === c.id ? 'border-danger bg-danger text-white' : 'border-danger/25 text-danger hover:bg-danger/10'
                          }`}>
                          <IconX size={12} /> {confirmarElimComp === c.id && '¿Seguro?'}
                        </button>
                      </div>
                    </div>

                    {/* Precios encontrados */}
                    {p ? (
                      p.encontrado ? (
                        <div className="border-t border-border pt-3">
                          <div className="flex flex-wrap gap-2 mb-1">
                            {tiposConPrecio.map(t => (
                              <span key={t as string} className="text-xs bg-success/10 border border-success/30 text-success font-medium px-2.5 py-1 rounded-xl">
                                {t}
                              </span>
                            ))}
                          </div>
                          {p.nota && <p className="text-[11px] text-ink/50 mt-1">{p.nota}</p>}
                        </div>
                      ) : (
                        <div className="border-t border-border pt-3">
                          <p className="text-xs text-warning">⚠ Sin precios en el último check</p>
                          {p.nota && <p className="text-[11px] text-ink/50 mt-0.5">{p.nota}</p>}
                        </div>
                      )
                    ) : (
                      <div className="border-t border-border pt-3">
                        <p className="text-xs text-ink/50">Sin verificaciones aún. Haz clic en "Verificar ahora".</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Advertencia JS */}
          <div className="bg-surface-2 rounded-xl border border-border/60 p-4">
            <p className="text-xs font-bold text-ink/50 uppercase tracking-wide mb-1">Importante</p>
            <p className="text-xs text-ink/50">
              La IA analiza el HTML estático de las páginas. Sitios que usan JavaScript para cargar precios (Sixt, Europcar, etc.) pueden aparecer como "Sin precios" — en ese caso, agrega la URL de una página de lista de tarifas específica o ingresa los precios de referencia manualmente.
            </p>
          </div>
        </div>
      )}

      {/* ── CONFIGURACIÓN (pico y placa) ── */}
      {tab === 'leads' && <LeadsPropietariosPanel />}

      {tab === 'soporte' && <SoportePanel focusConvId={searchParams.get('conv') ? Number(searchParams.get('conv')) : null} />}

      {tab === 'nfc' && <NfcCardsPanel />}

      {tab === 'config' && <PicoPlacaConfig />}

      {tab === 'auditoria' && <AuditoriaPanel />}

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
        const docs: { label: string; url?: string }[] = [
          { label: r.documento_es_pasaporte ? 'Pasaporte' : 'Documento de identidad (frente)', url: r.documento_id_url },
          ...(r.documento_es_pasaporte ? [] : [{ label: 'Documento de identidad (dorso)', url: r.documento_id_url_dorso }]),
          { label: 'Licencia de conducción (frente)', url: r.licencia_url },
          { label: 'Licencia de conducción (dorso)', url: r.licencia_url_dorso },
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
                          <span className="text-[11px] text-ink/50 mt-1 inline-block">Clic para ampliar</span>
                        </a>
                      )
                    ) : (
                      <p className="text-sm text-ink/50">No subido.</p>
                    )}
                  </div>
                ))}
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

      {/* Modal fotos */}
      {fotoModal && (() => {
        const v = fotoModal.v;
        let detalle: Record<string, string> = {};
        try { detalle = JSON.parse(v.fotos_detalle || '{}'); } catch { detalle = {}; }
        const tieneDetalle = Object.keys(detalle).some(k => (detalle[k] || '').trim());
        // Fotos de la galería (`vehiculos.fotos`) que NO son ninguna de las siete casillas.
        // Antes este modal solo miraba `fotos_detalle`, así que un carro publicado con fotos
        // sueltas decía "no tiene fotos" aunque su miniatura sí se viera en la lista.
        const enCasillas = new Set(Object.values(detalle).map(u => String(u || '').trim()).filter(Boolean));
        let sueltas: string[] = [];
        try { sueltas = (JSON.parse(v.fotos || '[]') as string[]).map(u => String(u || '').trim()); } catch { sueltas = []; }
        sueltas = [...new Set(sueltas.filter(u => u && !enCasillas.has(u)))];
        const hayAlgo = tieneDetalle || sueltas.length > 0;
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setFotoModal(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-5">
                <div className="min-w-0">
                  <h3 className="font-bold text-ink">{v.marca} {v.modelo} — Fotos</h3>
                  {hayAlgo && <p className="text-[11px] text-ink/50 mt-0.5">Clic en una foto para verla completa y con zoom.</p>}
                </div>
                <button onClick={() => setFotoModal(null)} aria-label="Cerrar"
                  className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                  <IconX size={18} />
                </button>
              </div>
              {hayAlgo ? (
                <div className="space-y-5">
                  {tieneDetalle && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {Object.entries(FOTOS_LABELS).map(([key, label]) => (
                        <div key={key}>
                          <p className="text-xs text-ink/50 mb-1 font-medium">{label}</p>
                          {detalle[key] ? (
                            // Abre components/VisorFotos.tsx (el mismo de Operaciones): la
                            // miniatura va con object-cover, o sea RECORTADA — sin ampliar no
                            // se puede revisar un rayón ni leer una placa.
                            <button type="button" onClick={() => abrirVisorVehiculo(v, detalle[key])}
                              title="Clic para ver la foto en grande"
                              className="block w-full rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/50">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={detalle[key]} alt={label} className="w-full h-28 object-cover rounded-xl border border-border hover:opacity-85 transition" />
                            </button>
                          ) : (
                            <div className="w-full h-28 bg-surface rounded-xl flex items-center justify-center text-ink/25 text-xs border border-border">
                              Sin foto
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {sueltas.length > 0 && (
                    <div>
                      <p className="text-xs text-ink/50 mb-2 font-medium">
                        Otras fotos de la publicación ({sueltas.length})
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {sueltas.map((url, i) => (
                          <button key={url} type="button" onClick={() => abrirVisorVehiculo(v, url)}
                            title="Clic para ver la foto en grande"
                            className="block w-full rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Foto ${i + 1} de ${v.marca} ${v.modelo}`} className="w-full h-28 object-cover rounded-xl border border-border hover:opacity-85 transition" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
                  <p className="text-ink/50">Este vehículo no tiene fotos todavía.</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Modal disponibilidad (calendario del vehículo) */}
      {dispModal && (() => {
        const v = dispModal.v;
        // Un admin con la sección "vehiculos" puede NO tener la sección "reservas" (GET
        // /api/reservas responde 403): en ese caso no sabemos qué días están reservados, así
        // que el calendario se muestra en SOLO LECTURA. Editar a ciegas podría pisar una
        // reserva sin que el admin lo vea (el servidor lo rechazaría, pero la UI no debe
        // ofrecer una edición que no puede verificar).
        const puedeEditar = reservasOk === true;
        const ocupadas = puedeEditar ? diasOcupadosVehiculo(v.id) : [];
        // El recuadro informativo habla de lo que hay HOY EN BD (`dispOriginal`), no del
        // borrador que se está editando: el borrador ya se ve en el propio calendario.
        const irrestricto = dispOriginal.length === 0;
        // Un admin puede ser también el propietario del vehículo: ahí no hay "calendario
        // ajeno" ni notificación al propietario (el servidor no se auto-notifica).
        const esAjeno = Number(v.propietario_id) !== miId;

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={cerrarDispModal}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-ink">{v.marca} {v.modelo} {v.anio} — Disponibilidad</h3>
                  {v.placa && <p className="text-xs text-ink/50 mt-0.5">Placa: {v.placa}</p>}
                  <p className="text-xs text-ink/50 mt-0.5">Propietario: <span className="font-semibold text-ink/70">{v.propietario_nombre}</span></p>
                </div>
                <button onClick={cerrarDispModal} aria-label="Cerrar"
                  className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                  <IconX size={18} />
                </button>
              </div>

              {/* Aviso: se está tocando el calendario de otra persona */}
              <div className="bg-warning/10 border border-warning/25 rounded-xl p-3 mb-4">
                <p className="text-xs text-warning font-semibold">
                  {esAjeno
                    ? `Estás editando el calendario de ${v.propietario_nombre}.`
                    : 'Estás editando el calendario de tu propio vehículo.'}
                </p>
                <p className="text-[11px] text-ink/60 mt-1">
                  {esAjeno
                    ? 'Todo cambio queda registrado en la Bitácora y se le notifica al propietario. Los días con una reserva activa no se pueden cerrar.'
                    : 'Los días con una reserva activa no se pueden cerrar.'}
                </p>
              </div>

              {!puedeEditar && (
                <div className="bg-danger/10 border border-danger/25 rounded-xl p-3 mb-4">
                  <p className="text-xs text-danger font-semibold">
                    {reservasOk === null ? 'Cargando reservas…' : 'No podemos verificar las reservas de este vehículo.'}
                  </p>
                  <p className="text-[11px] text-ink/60 mt-1">
                    {reservasOk === null
                      ? 'El calendario queda en solo lectura hasta terminar de cargar las reservas.'
                      : 'Tu cuenta no tiene acceso a la sección Reservas, así que no sabemos qué días están ocupados. El calendario queda en SOLO LECTURA para no pisar una reserva sin verla. Pídele a un administrador principal el permiso de "Reservas".'}
                  </p>
                </div>
              )}

              {/* Semántica invertida: sin días marcados = abierto, no cerrado */}
              <div className={`rounded-xl p-3 mb-4 border ${irrestricto ? 'bg-accent-light border-accent/25' : 'bg-surface border-border'}`}>
                <p className="text-xs text-ink/70">
                  {irrestricto
                    ? <>Hoy este vehículo está <span className="font-bold text-accent">abierto sin restricciones</span>: no hay ningún día marcado, así que todos los días quedan disponibles para reservar.</>
                    : <>Hoy este vehículo tiene <span className="font-bold text-accent">{dispOriginal.length} día{dispOriginal.length !== 1 ? 's' : ''}</span> marcado{dispOriginal.length !== 1 ? 's' : ''} como disponible{dispOriginal.length !== 1 ? 's' : ''}; el resto está cerrado.</>}
                </p>
                <p className="text-[11px] text-ink/50 mt-1">
                  Ojo con “Limpiar todo”: dejar el calendario vacío NO cierra el vehículo, lo abre por completo.
                </p>
                {dispHayCambios && (
                  <p className="text-[11px] text-warning font-semibold mt-1">
                    Estás editando un borrador: quedaría en {dispDias.length === 0 ? 'abierto sin restricciones (0 días marcados)' : `${dispDias.length} día${dispDias.length !== 1 ? 's' : ''} marcado${dispDias.length !== 1 ? 's' : ''}`}. Nada se guarda hasta que toques “Guardar cambios”.
                  </p>
                )}
              </div>

              {/* Edición LOCAL: el calendario emite `onChange` por cada celda, así que guardar
                  ahí mismo significaba un PUT (y una notificación al propietario) por clic.
                  Se acumula en el estado y se persiste con el botón "Guardar cambios". */}
              <CalendarioDisponibilidad
                value={dispDias}
                onChange={(dias) => { setDispDias(dias); setDispMsg(''); }}
                readOnly={!puedeEditar || dispGuardando}
                reservedDates={ocupadas}
                placa={v.placa}
                combustible={v.combustible}
                exencionInscrita={v.exencion_pico_placa_inscrita}
              />

              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <span className={`text-xs font-medium ${dispMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>
                  {dispGuardando
                    ? <span className="text-ink/50">Guardando…</span>
                    : dispMsg || (dispHayCambios
                      ? <span className="text-warning">Tienes cambios sin guardar.</span>
                      : null)}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={cerrarDispModal}
                    className="text-xs border border-border text-ink/60 px-3 py-2 rounded-xl hover:bg-surface transition font-medium">
                    Cerrar
                  </button>
                  {puedeEditar && (
                    <button
                      onClick={() => { void guardarDispDias(v, dispDias); }}
                      disabled={dispGuardando || !dispHayCambios}
                      className="text-xs bg-accent text-white px-4 py-2 rounded-xl hover:bg-accent-hover transition font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                      {dispGuardando ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal documentos */}
      {docModal && (() => {
        const v = docModal.v;
        let docs: Documentos = {};
        try { docs = JSON.parse(v.documentos || '{}'); } catch { docs = {}; }

        const docItems: { key: string; label: string; data: DocItem | { url: string } | undefined }[] = [
          { key: 'soat',       label: 'SOAT',                  data: docs.soat },
          { key: 'tecno',      label: 'Tecno-mecánica',         data: docs.tecno },
          { key: 'tarjeta',    label: 'Tarjeta de propiedad',   data: docs.tarjeta },
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
                  <p className="text-xs text-ink/50 mt-0.5">Propietario: {v.propietario_nombre}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ESTADO_BADGE[estado] || ESTADO_BADGE.sin_documentos}`}>
                    {ESTADO_LABEL[estado] || estado}
                  </span>
                  <button onClick={() => setDocModal(null)} aria-label="Cerrar" className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
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
                    <span className="text-xs text-ink/50">Lee SOAT, tecno y tarjeta de propiedad; valida fechas, placa y propietario.</span>
                  </div>

                  {iaError && (
                    <div className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">{iaError}</div>
                  )}

                  {iaVerif && iaVerif.vid === v.id && (
                    <div className="space-y-3">
                      <ResultadoIA res={iaVerif.res} auto={iaVerif.auto} />
                      <p className="text-[11px] text-ink/50 leading-relaxed">
                        La IA auto-aprueba solo documentos limpios de alta confianza; los marcados como revisión quedan a tu criterio abajo. Decisión final humana.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Documentos — revisión individual */}
              {!tieneDocs ? (
                <div className="text-center py-10 text-ink/50">
                  <p className="text-3xl mb-3">📄</p>
                  <p>Este vehículo no tiene documentos cargados aún.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {docItems.map(({ key, label, data }) => {
                    // Tecno-mecánica exenta (Ley 2294 de 2023) y sin nada subido: en vez de
                    // omitir la fila (que se vería igual que "simplemente falta"), se muestra
                    // un aviso explícito de que no aplica — consistente con el mismo aviso
                    // que ya se le muestra al propietario en su dashboard.
                    if (key === 'tecno' && !tecnoRequerida(v.anio) && (!data || !('url' in data) || !data.url)) {
                      return (
                        <div key={key} className="rounded-xl p-3 border bg-surface border-border">
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <p className="text-xs font-bold text-ink">{label}</p>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ink/10 text-ink/60 border border-border whitespace-nowrap">No exigible (vehículo &lt; 5 años)</span>
                          </div>
                          <p className="text-[11px] text-ink/50">✓ No aplica — vehículo de menos de 5 años (Ley 2294 de 2023). El propietario no necesita subir este documento.</p>
                        </div>
                      );
                    }
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
                          {/* Tecno-mecánica: exención de la Ley 2294 de 2023 (ver lib/tecnomecanica.ts) —
                              vehículos con menos de 5 años (aprox. por año-modelo) no la requieren. Se
                              muestra igual si el propietario subió algo (ej. tecno vencida), pero este
                              badge aclara que NO cuenta para el estado agregado ni bloquea la publicación,
                              sin importar si el admin la aprueba o deniega abajo. */}
                          {key === 'tecno' && !tecnoRequerida(v.anio) && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ink/10 text-ink/60 border border-border whitespace-nowrap">No exigible (vehículo &lt; 5 años)</span>
                          )}
                          {rev.estado === 'aprobado' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30 whitespace-nowrap">✓ Aprobado</span>}
                          {rev.estado === 'denegado' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25 whitespace-nowrap">✗ Denegado</span>}
                          {rev.estado === 'pendiente' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 whitespace-nowrap">⏳ Pendiente</span>}
                        </div>

                        {/* Preview */}
                        {isPdf ? (
                          <div className="flex items-center gap-3 flex-wrap mb-2">
                            <a href={data.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-2 text-accent hover:text-accent-hover text-sm font-medium">
                              <span className="text-xl">📄</span> Ver PDF
                            </a>
                            <a href={urlDescarga(data.url)} download
                              className="flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
                              <IconExport size={12} /> Descargar
                            </a>
                          </div>
                        ) : (
                          <div className="mb-2">
                            <img src={data.url} alt={label} className="w-full h-24 object-cover rounded-lg border border-border" />
                            <a href={urlDescarga(data.url)} download
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
                              <IconExport size={12} /> Descargar
                            </a>
                          </div>
                        )}
                        {key === 'tarjeta' && 'url_dorso' in data && (data as { url_dorso?: string }).url_dorso && (
                          <div className="mb-2">
                            <p className="text-[10px] text-ink/50 mb-1">Dorso</p>
                            <img src={(data as { url_dorso?: string }).url_dorso} alt={`${label} (dorso)`} className="w-full h-24 object-cover rounded-lg border border-border" />
                            <a href={urlDescarga((data as { url_dorso?: string }).url_dorso as string)} download
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
                              <IconExport size={12} /> Descargar
                            </a>
                          </div>
                        )}
                        {key === 'tarjeta' && !('url_dorso' in data && (data as { url_dorso?: string }).url_dorso) && (
                          <p className="text-[11px] text-warning mb-2">⚠ Falta el dorso.</p>
                        )}
                        {'vence' in data && data.vence && <p className="text-[11px] text-ink/50 mb-1">Vence: {(data as { vence?: string }).vence}</p>}

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

              {/* Carátula de la póliza todo riesgo — la carga DrivePass, no el propietario.
                  Va FUERA de la lista de arriba (y fuera del `tieneDocs`) a propósito: no
                  pertenece al flujo de revisión del propietario, no cuenta para el estado
                  agregado y tiene que poder cargarse aunque el carro todavía no tenga ningún
                  otro documento. Ver lib/poliza-vehiculo.ts. */}
              <div className="mt-4">
                <PolizaVehiculoAdmin
                  key={v.id}
                  vehiculoId={v.id}
                  documentos={v.documentos}
                  titulo={`${v.marca} ${v.modelo} ${v.anio}${v.placa ? ` · ${v.placa}` : ''}`}
                  onGuardado={docsJson => {
                    setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, documentos: docsJson } : x));
                    setDocModal(d => d ? { v: { ...d.v, documentos: docsJson } } : null);
                  }}
                />
              </div>
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
                  <button onClick={() => setPerfilModal(null)} aria-label="Cerrar" className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                    <IconX size={18} />
                  </button>
                </div>
              </div>

              {/* Sección: Identidad */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest">Documento de identidad</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Tipo</p>
                    <p className="text-sm font-semibold text-ink">{TIPO_DOC_LABELS[u.tipo_documento || ''] || u.tipo_documento || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Número</p>
                    <p className="text-sm font-semibold text-ink font-mono">{u.documento_identidad || '—'}</p>
                  </div>
                </div>

                {/* Foto de la cédula (frente y dorso) */}
                <div className="grid grid-cols-2 gap-3">
                  {[{ label: 'Cédula (frente)', url: u.cedula_url }, { label: 'Cédula (dorso)', url: u.cedula_url_dorso }].map(d => (
                    <DocumentoVista key={d.label} label={d.label} url={d.url} titulo={u.nombre} />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Fecha de nacimiento</p>
                    <p className="text-sm font-semibold text-ink">{u.fecha_nacimiento || '—'}</p>
                    {edad !== null && <p className="text-[11px] text-ink/50 mt-0.5">{edad} años</p>}
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Celular</p>
                    <p className="text-sm font-semibold text-ink font-mono">{u.celular ? `${u.celular_indicativo || '+57'} ${u.celular}` : '—'}</p>
                  </div>
                </div>

                {/* Sección: Licencia — solo para quien la necesita.
                    `usuarios.numero_licencia` es UNA sola columna compartida: es obligatoria
                    para el arrendatario (rol 'usuario') y desde sep-2026 ya no se le pide al
                    propietario en el registro, así que a un propietario le llegaría siempre
                    vacía y mostrar la sección solo confundía. Se sigue mostrando si el dato
                    existe (cuentas viejas de propietario que alcanzaron a llenarlo). La
                    columna NO se tocó: la usa la verificación con IA de los documentos del
                    arrendatario (ver app/api/verificar-documentos/route.ts). */}
                {(u.rol !== 'propietario' || !!u.numero_licencia || !!u.licencia_url) && (
                  <>
                    <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Licencia de conducción</p>
                    <div className="bg-surface rounded-xl p-3 border border-border">
                      <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Número de licencia</p>
                      <p className="text-sm font-semibold text-ink font-mono">{u.numero_licencia || '—'}</p>
                    </div>
                    {/* Las fotos de la licencia del PERFIL (`usuarios.licencia_url`) tampoco se
                        mostraban acá: solo se veían las de cada reserva. */}
                    {(u.licencia_url || u.licencia_url_dorso) && (
                      <div className="grid grid-cols-2 gap-3">
                        <DocumentoVista label="Licencia (frente)" url={u.licencia_url} titulo={u.nombre} />
                        <DocumentoVista label="Licencia (dorso)" url={u.licencia_url_dorso} titulo={u.nombre} />
                      </div>
                    )}
                  </>
                )}

                {/* Sección: Datos bancarios (propietarios).
                    El certificado bancario se le pide al propietario como OBLIGATORIO al
                    completar su perfil y se guarda en `usuarios.certificado_bancario_url`,
                    pero hasta ahora no se mostraba en ninguna pantalla del equipo: no había
                    forma de verificarlo ni de descargarlo para hacer la transferencia. */}
                {(u.rol === 'propietario' || !!u.certificado_bancario_url || !!u.banco) && (
                  <>
                    <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Datos bancarios</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-surface rounded-xl p-3 border border-border">
                        <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Banco</p>
                        <p className="text-sm font-semibold text-ink">{u.banco || '—'}</p>
                      </div>
                      <div className="bg-surface rounded-xl p-3 border border-border">
                        <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Número de cuenta</p>
                        <p className="text-sm font-semibold text-ink font-mono break-all">{u.numero_cuenta || '—'}</p>
                      </div>
                    </div>
                    <DocumentoVista
                      label="Certificado bancario"
                      url={u.certificado_bancario_url}
                      titulo={`${u.nombre} — certificado bancario`}
                      vacio="No lo ha subido todavía."
                      nota="Emitido por el banco, máximo 3 meses de antigüedad."
                    />
                  </>
                )}

                {/* Paquete completo: un solo .zip con la cédula, la licencia, el certificado
                    bancario y los documentos de todos sus vehículos y reservas. Se arma en el
                    servidor y cada descarga queda en la Bitácora. */}
                <div className="pt-1">
                  <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest mb-2">Todos sus documentos</p>
                  <BotonPaqueteDocumentos
                    endpoint={`/api/admin/usuarios/${u.id}/paquete`}
                    autoInfo
                    nota="Contiene datos personales. La descarga queda registrada en la Bitácora."
                  />
                </div>

                {/* Sección: Dirección */}
                <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Dirección</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border col-span-2">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Dirección</p>
                    <p className="text-sm font-semibold text-ink">{u.direccion || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Ciudad</p>
                    <p className="text-sm font-semibold text-ink">{u.ciudad || '—'}</p>
                  </div>
                </div>

                {/* Sección: Contacto de emergencia */}
                <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Contacto de emergencia</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Nombre</p>
                    <p className="text-sm font-semibold text-ink">{emergencia.nombre || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Teléfono</p>
                    <p className="text-sm font-semibold text-ink font-mono">{emergencia.telefono || '—'}</p>
                  </div>
                </div>

                {/* Estado de cuenta */}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <div>
                    {/* `created_at` viene en UTC y se mostraba en crudo ('2026-09-16 01:00:00'):
                        un registro de las 8 p. m. en Medellín se leía como del día siguiente. */}
                    <p className="text-xs text-ink/50" title={fechaRegistroLarga(u.created_at)}>
                      Registrado el {fechaRegistroCorta(u.created_at)}
                    </p>
                    <p className="text-xs text-ink/50">Estado: <span className={u.estado_cuenta === 'activa' ? 'text-success font-semibold' : 'text-danger font-semibold'}>{u.estado_cuenta}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.rol !== 'admin' && u.estado_cuenta !== 'archivada' && (
                      <button onClick={() => { toggleEstado(u); setPerfilModal(p => p ? { u: { ...p.u, estado_cuenta: p.u.estado_cuenta === 'activa' ? 'inactiva' : 'activa' } } : null); }}
                        className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                          u.estado_cuenta === 'activa'
                            ? 'border-danger/25 text-danger hover:bg-danger/10'
                            : 'border-success/30 text-success hover:bg-success/10'
                        }`}>
                        {u.estado_cuenta === 'activa' ? 'Desactivar cuenta' : 'Activar cuenta'}
                      </button>
                    )}
                    {puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                      u.estado_cuenta === 'archivada' ? (
                        <button onClick={() => { desarchivarUsuario(u); setPerfilModal(null); }}
                          className="text-xs px-3 py-1.5 rounded-xl border border-success/30 text-success hover:bg-success/10 transition font-medium">
                          📤 Desarchivar
                        </button>
                      ) : (
                        <button onClick={async () => { await eliminarUsuario(u); setPerfilModal(null); }}
                          className="text-xs px-3 py-1.5 rounded-xl border border-danger/30 text-danger hover:bg-danger/10 transition font-medium">
                          🗑️ Eliminar
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Resetear contraseña */}
                <div className="pt-2 border-t border-border">
                  {resetPass?.uid !== u.id ? (
                    <button
                      onClick={() => setResetPass({ uid: u.id, nueva: '', confirmar: '', guardando: false, ok: '' })}
                      className="text-xs border border-warning/30 text-warning px-3 py-1.5 rounded-xl hover:bg-warning/10 transition font-medium">
                      🔑 Resetear contraseña
                    </button>
                  ) : resetPass.ok && !resetPass.ok.startsWith('Error') ? (
                    /* Contraseña establecida — mostrarla una sola vez */
                    <div className="bg-success/10 border border-success/30 rounded-xl p-4 space-y-2">
                      <p className="text-xs font-bold text-success">✓ Contraseña actualizada</p>
                      <p className="text-xs text-ink/60">Comparte esta contraseña temporal con el usuario:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-ink tracking-wider">
                          {resetPass.ok}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(resetPass.ok)}
                          className="text-xs border border-border text-ink/50 px-2.5 py-2 rounded-lg hover:border-accent/40 hover:text-accent transition">
                          Copiar
                        </button>
                      </div>
                      <button onClick={() => setResetPass(null)}
                        className="text-xs text-ink/50 hover:text-ink transition">Cerrar</button>
                    </div>
                  ) : (
                    /* Formulario de nueva contraseña */
                    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
                      <p className="text-xs font-bold text-ink">Nueva contraseña para {u.nombre}</p>
                      <div className="space-y-2">
                        <input
                          type="password"
                          placeholder="Nueva contraseña (mín. 6 caracteres)"
                          value={resetPass.nueva}
                          onChange={e => setResetPass(r => r ? { ...r, nueva: e.target.value, ok: '' } : r)}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-warning/40"
                        />
                        <input
                          type="password"
                          placeholder="Confirmar contraseña"
                          value={resetPass.confirmar}
                          onChange={e => setResetPass(r => r ? { ...r, confirmar: e.target.value, ok: '' } : r)}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-warning/40"
                        />
                        {resetPass.nueva && resetPass.confirmar && resetPass.nueva !== resetPass.confirmar && (
                          <p className="text-xs text-danger">Las contraseñas no coinciden</p>
                        )}
                        {resetPass.ok?.startsWith('Error') && (
                          <p className="text-xs text-danger">{resetPass.ok}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={guardarNuevaContrasena}
                          disabled={
                            resetPass.guardando ||
                            resetPass.nueva.length < 6 ||
                            resetPass.nueva !== resetPass.confirmar
                          }
                          className="flex items-center gap-1.5 bg-warning hover:bg-warning/80 text-white text-xs font-bold px-3 py-2 rounded-xl transition disabled:opacity-50">
                          <IconCheck size={13} />
                          {resetPass.guardando ? 'Guardando…' : 'Establecer contraseña'}
                        </button>
                        <button onClick={() => setResetPass(null)}
                          className="text-xs border border-border text-ink/50 px-3 py-2 rounded-xl hover:border-ink/30 transition">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Visor de fotos a pantalla completa — el MISMO componente que usan Operaciones y
          la pantalla del mensajero (components/VisorFotos.tsx): zoom, flechas, pellizco en
          móvil y cierre con Escape. Va al final y con su propio z-index (z-[100]), por
          encima del modal de fotos desde el que también se abre. */}
      {visorFotos && (
        <VisorFotos
          fotos={visorFotos.fotos}
          indice={visorFotos.indice}
          titulo={visorFotos.titulo}
          onIndice={i => setVisorFotos(v => (v ? { ...v, indice: i } : v))}
          onCerrar={() => setVisorFotos(null)} />
      )}
    </div>
  );
}
