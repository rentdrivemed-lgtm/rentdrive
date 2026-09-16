'use client';
// ── Panel de administración (la pantalla de siempre) ────────────────────────
//
// Este archivo tenía 3.356 líneas y era el más grande del proyecto. Sus cinco secciones
// de más peso (Personas, Vehículos, Reservas, Mercado y Configuración) viven ahora en
// componentes propios y esta pantalla los MONTA, en vez de contenerlos:
//
//   components/panel/PersonasSeccion.tsx    · Usuarios (clientes, propietarios y equipo)
//   components/panel/VehiculosSeccion.tsx   · Flota, fotos, documentos y disponibilidad
//   components/panel/ReservasSeccion.tsx    · Reservas y punto de atención
//   components/panel/MercadoSeccion.tsx     · Comparador de precios
//   components/PicoPlacaConfig.tsx          · Configuración (ya era un componente)
//
// Los MISMOS componentes los monta el panel unificado (/panel). No hay dos copias:
// arreglar algo en uno lo arregla en los dos. Esta pantalla no cambió de comportamiento
// con la mudanza — mismas pestañas, mismos permisos, mismos contadores.
//
// LAS LISTAS son compartidas (components/panel/DatosAdmin.tsx): usuarios, vehículos y
// reservas se piden UNA vez por pantalla y las usan tanto los contadores de aquí arriba
// como las secciones de abajo. Por eso el proveedor envuelve a toda la pantalla.
//
// LAS SECCIONES SE QUEDAN MONTADAS al cambiar de pestaña (se ocultan con `hidden`): así
// los filtros, el buscador y lo que haya a medio escribir siguen ahí al volver, igual
// que cuando todo vivía en un solo componente.
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ContabilidadPanel from '@/components/ContabilidadPanel';
import BusesPanel from '@/components/buses/BusesPanel';
import SoportePanel from '@/components/SoportePanel';
import LeadsPropietariosPanel from '@/components/LeadsPropietariosPanel';
import AuditoriaPanel from '@/components/AuditoriaPanel';
import CalculadoraPanel from '@/components/CalculadoraPanel';
import NfcCardsPanel from '@/components/NfcCardsPanel';
import PicoPlacaConfig from '@/components/PicoPlacaConfig';
import { DatosAdminProvider, useDatosAdmin } from '@/components/panel/DatosAdmin';
import PersonasSeccion from '@/components/panel/PersonasSeccion';
import VehiculosSeccion from '@/components/panel/VehiculosSeccion';
import ReservasSeccion from '@/components/panel/ReservasSeccion';
import MercadoSeccion from '@/components/panel/MercadoSeccion';
import {
  puede, normalizarNivel, parsePermisosExtra, type AdminNivel, type PermisosExtra,
} from '@/lib/permisos';

// useSearchParams exige un límite <Suspense> alrededor del componente que lo usa (mismo
// patrón que ya sigue app/pago/page.tsx) — se usa para preseleccionar pestaña/ítem cuando
// se llega desde una notificación clicable del Navbar (ver destinoDeNotificacion).
export default function DashboardAdmin() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-ink/50">Cargando…</div>}>
      <DatosAdminProvider>
        <DashboardAdminInner />
      </DatosAdminProvider>
    </Suspense>
  );
}

const TABS_ADMIN = ['usuarios', 'vehiculos', 'buses', 'reservas', 'contabilidad', 'mercado', 'calculadora', 'leads', 'soporte', 'nfc', 'config', 'auditoria'] as const;
type TabAdmin = typeof TABS_ADMIN[number];

/**
 * Una sección de una pestaña. Se queda MONTADA aunque no sea la pestaña abierta (solo se
 * oculta), para no perder filtros ni formularios a medio llenar al ir y volver — que es
 * como se comportaba cuando las doce pestañas eran un único componente gigante.
 */
function Seccion({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <div className={visible ? undefined : 'hidden'}>{children}</div>;
}

function DashboardAdminInner() {
  const [tab, setTab] = useState<TabAdmin>('usuarios');
  const [miNivel, setMiNivel] = useState<AdminNivel>('principal');
  const [miId, setMiId] = useState<number | null>(null);
  // Excepciones de permisos de MI cuenta (solo para pintar pestañas; el gating real es del servidor).
  const [misPermisos, setMisPermisos] = useState<PermisosExtra>({});

  // Las tres listas grandes, compartidas con las secciones (ver components/panel/DatosAdmin.tsx).
  const { usuarios, vehiculos, reservas, asegurarUsuarios, asegurarVehiculos, asegurarReservas } = useDatosAdmin();

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
    // Los contadores de esta cabecera (y de las pestañas) necesitan las tres listas
    // completas, sin importar en qué pestaña se entre — igual que siempre. Las secciones
    // piden exactamente las mismas y se sirven de esta única carga.
    asegurarUsuarios();
    asegurarVehiculos();
    asegurarReservas();
  }, [router, asegurarUsuarios, asegurarVehiculos, asegurarReservas]);

  // Si el nivel actual no puede ver la pestaña seleccionada, lo mandamos a la primera permitida.
  useEffect(() => {
    if (!puede(miNivel, tab, misPermisos)) {
      const orden = ['reservas', 'leads', 'soporte', 'usuarios', 'vehiculos', 'buses', 'contabilidad', 'mercado', 'calculadora', 'nfc', 'config', 'auditoria'] as const;
      const primera = orden.find(k => puede(miNivel, k, misPermisos));
      if (primera) setTab(primera);
    }
  }, [miNivel, misPermisos, tab]);


  const stats = {
    total:         usuarios.length,
    propietarios:  usuarios.filter(u => u.rol === 'propietario').length,
    usuariosCount: usuarios.filter(u => u.rol === 'usuario').length,
    activos:       usuarios.filter(u => u.estado_cuenta === 'activa').length,
  };

  const sinPrecio = vehiculos.filter(v => !v.precio_dia || v.precio_dia === 0).length;
  const pendientesCount = reservas.filter(r => r.estado === 'pendiente').length;

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
          {/* Puerta al panel nuevo (`/panel`). Se construye AL LADO de este, no encima: mientras
              la migración avanza sección por sección, los dos conviven y esta pantalla sigue
              siendo la de referencia. Sin este enlace la única vía era escribir la URL a mano,
              que fue justo lo que pasó la primera vez que el dueño lo buscó. Se quita cuando
              el panel nuevo pase a ser el principal. */}
          <a href="/panel"
            className="inline-flex items-center gap-2 text-ink font-semibold text-sm px-5 h-11 rounded-xl border border-accent/50 bg-accent/10 transition hover:bg-accent/20 hover:-translate-y-0.5">
            ✨ Probar el panel nuevo
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold uppercase tracking-wide">Beta</span>
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

      {/* ── Las secciones. Las cinco que salieron de este archivo se quedan montadas
          (ver <Seccion/>); las que siempre fueron un componente aparte se montan al
          entrar, como antes. ── */}
      {puede(miNivel, 'usuarios', misPermisos) && (
        <Seccion visible={tab === 'usuarios'}>
          <PersonasSeccion miNivel={miNivel} miId={miId} />
        </Seccion>
      )}

      {puede(miNivel, 'vehiculos', misPermisos) && (
        <Seccion visible={tab === 'vehiculos'}>
          <VehiculosSeccion miId={miId} vehiculoInicial={searchParams.get('vehiculo')} />
        </Seccion>
      )}

      {tab === 'buses' && <BusesPanel initialSubTab={searchParams.get('sub')} />}

      {puede(miNivel, 'reservas', misPermisos) && (
        <Seccion visible={tab === 'reservas'}>
          <ReservasSeccion />
        </Seccion>
      )}

      {/* ── CONTABILIDAD (cotizaciones, facturas, liquidaciones a propietarios) ── */}
      {tab === 'contabilidad' && <ContabilidadPanel />}

      {/* ── CALCULADORA (precio de mercado + rentabilidad, manual) ── */}
      {tab === 'calculadora' && <CalculadoraPanel />}

      {/* ── MERCADO (comparador de precios) ── */}
      {puede(miNivel, 'mercado', misPermisos) && (
        <Seccion visible={tab === 'mercado'}>
          <MercadoSeccion activa={tab === 'mercado'} />
        </Seccion>
      )}

      {tab === 'leads' && <LeadsPropietariosPanel />}

      {tab === 'soporte' && <SoportePanel focusConvId={searchParams.get('conv') ? Number(searchParams.get('conv')) : null} />}

      {tab === 'nfc' && <NfcCardsPanel />}

      {/* ── CONFIGURACIÓN (pico y placa) ── */}
      {tab === 'config' && <PicoPlacaConfig />}

      {tab === 'auditoria' && <AuditoriaPanel />}
    </div>
  );
}
