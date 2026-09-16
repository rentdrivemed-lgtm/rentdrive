'use client';
// ═══════════════════════════════════════════════════════════════════════════
// /panel — el panel unificado del equipo (etapa 1: armazón + vista HOY)
// ═══════════════════════════════════════════════════════════════════════════
//
// QUÉ ES. Un solo panel organizado por ÁREA DE TRABAJO: una barra lateral con seis
// grupos con nombre (Hoy · Operación · Dinero · Catálogo · Equipo · Sistema) en vez
// de doce pestañas planas en una aplicación y seis módulos en otra pestaña del
// navegador. El mapa completo vive en components/panel/navegacion.tsx.
//
// QUÉ NO ES (todavía). Esta etapa NO migra secciones ni apaga nada: /dashboard/admin
// y /control siguen existiendo y funcionando exactamente igual. Las entradas de tipo
// `enlace` llevan a esas pantallas tal cual están hoy. Lo que sí está montado aquí
// son los módulos que ya eran componentes independientes.
//
// COLORES. Los de la marca, de app/globals.css (navy, acento naranja, ink/surface/
// border). No hay paleta propia ni logo nuevo: lo que se rediseña es el orden.
//
// PERMISOS. Cada entrada declara su área y se muestra con `puede(nivel, area, extra)`
// —el mismo modelo de lib/permisos.ts, sin cambios—. Un grupo que queda sin entradas
// visibles no se pinta. Que la UI oculte algo es cosmético: el gating real es de cada
// API (`guardArea`), igual que en el resto del sistema.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  normalizarNivel, parsePermisosExtra, puede, NIVEL_LABEL,
  type AdminNivel, type PermisosExtra,
} from '@/lib/permisos';
import { LogoMark } from '@/components/Logo';
import { IconX, IconArrowR } from '@/components/Icons';
import { GRUPOS_PANEL, MOVIL_PRINCIPALES, ICONO_MAS, SECCIONES_PANEL, entradaPorClave, type EntradaPanel } from '@/components/panel/navegacion';
import CampanaPanel from '@/components/panel/CampanaPanel';
import BandejaHoy, { type DestinoInterno } from '@/components/panel/BandejaHoy';
import ContratosSeccion from '@/components/panel/ContratosSeccion';
import OperacionesPanel from '@/components/OperacionesPanel';
import ContabilidadPanel from '@/components/ContabilidadPanel';
import CalculadoraPanel from '@/components/CalculadoraPanel';
import SoportePanel from '@/components/SoportePanel';
import LeadsPropietariosPanel from '@/components/LeadsPropietariosPanel';
import NfcCardsPanel from '@/components/NfcCardsPanel';
import AuditoriaPanel from '@/components/AuditoriaPanel';
import BusesPanel from '@/components/buses/BusesPanel';

// `useSearchParams` exige un límite <Suspense> (mismo patrón que app/control/page.tsx
// y app/pago/page.tsx) — se usa para los enlaces profundos ?seccion=…&reserva=…&conv=…
export default function PanelPage() {
  return (
    <Suspense fallback={<div className="flex-1 grid place-items-center text-sm text-ink/40">Cargando…</div>}>
      <PanelApp />
    </Suspense>
  );
}

function PanelApp() {
  const searchParams = useSearchParams();

  // Arranque en el nivel MÁS BAJO a propósito: mientras /api/auth/me responde, el menú
  // muestra de menos y nunca de más (mismo criterio que app/control/page.tsx).
  const [nivel, setNivel] = useState<AdminNivel>('secretaria');
  const [permisos, setPermisos] = useState<PermisosExtra>({});
  const [nombre, setNombre] = useState('');

  const [seccion, setSeccion] = useState<string>(() => {
    const s = searchParams.get('seccion');
    return s && SECCIONES_PANEL.includes(s) ? s : 'hoy';
  });
  // Enlaces profundos de la vista HOY: abrir los contratos de UNA reserva, o UNA
  // conversación de soporte. Se consumen al montar la sección correspondiente.
  const [reservaFoco, setReservaFoco] = useState<number | null>(() => {
    const n = Number(searchParams.get('reserva'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [convFoco, setConvFoco] = useState<number | null>(() => {
    const n = Number(searchParams.get('conv'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });

  const [masAbierto, setMasAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!vivo || !d?.user) return;
        setNivel(normalizarNivel(d.user.admin_nivel));
        setPermisos(parsePermisosExtra(d.user.permisos_extra));
        setNombre(String(d.user.nombre || ''));
      })
      .catch(() => { /* el layout de servidor ya cerró la puerta a quien no es admin */ });
    return () => { vivo = false; };
  }, []);

  // Grupos con sus entradas filtradas por permiso efectivo. Un grupo vacío no se pinta.
  const grupos = useMemo(
    () => GRUPOS_PANEL
      .map(g => ({ titulo: g.titulo, entradas: g.entradas.filter(e => puede(nivel, e.area, permisos)) }))
      .filter(g => g.entradas.length > 0),
    [nivel, permisos],
  );

  const seccionesVisibles = useMemo(
    () => grupos.flatMap(g => g.entradas).filter(e => e.tipo === 'seccion').map(e => e.clave),
    [grupos],
  );

  // Sección efectiva DERIVADA (no un efecto que reescriba el estado): si la abierta no
  // está permitida, cae a la primera disponible. Así, cuando llegan los permisos reales,
  // la vista se corrige sola sin un render intermedio con contenido prohibido.
  const seccionActiva: string | null = seccionesVisibles.includes(seccion) ? seccion : (seccionesVisibles[0] ?? null);

  const irASeccion = useCallback((destino: DestinoInterno) => {
    setSeccion(destino.seccion);
    setReservaFoco(destino.reserva ?? null);
    setConvFoco(destino.conv ?? null);
    setMasAbierto(false);
  }, []);

  const abrirEntrada = useCallback((e: EntradaPanel) => {
    if (e.tipo !== 'seccion') return;
    setSeccion(e.clave);
    setReservaFoco(null);
    setConvFoco(null);
    setMasAbierto(false);
  }, []);

  const tituloActual = seccionActiva ? (entradaPorClave(seccionActiva)?.label ?? '') : '';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Barra superior (la campana vive aquí, visible desde cualquier pantalla) ── */}
      <header className="shrink-0 flex items-center gap-3 px-3 md:px-5 h-14 border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-30">
        <Link href="/panel" className="flex items-center gap-2 shrink-0" aria-label="DrivePass">
          <LogoMark size={28} />
          <span className="hidden sm:block text-sm font-black text-ink tracking-tight">
            Drive<span className="text-accent">Pass</span>
          </span>
        </Link>
        <span className="hidden md:block text-xs text-ink/35">·</span>
        <span className="hidden md:block text-xs text-ink/50 truncate">{tituloActual}</span>

        <div className="ml-auto flex items-center gap-2">
          <CampanaPanel />
          <div className="hidden sm:block text-right leading-tight">
            <p className="text-[11px] font-bold text-ink truncate max-w-[10rem]">{nombre || 'Equipo'}</p>
            <p className="text-[10px] text-ink/45">{NIVEL_LABEL[nivel]}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* ── Barra lateral (escritorio) ── */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-surface/40 overflow-y-auto py-4">
          {grupos.map(g => (
            <nav key={g.titulo} className="px-3 mb-4">
              {/* El grupo «Hoy» tiene una sola entrada y su nombre es el de la entrada:
                  repetir el encabezado sería ruido. */}
              {g.entradas.length > 1 || g.titulo !== 'Hoy' ? (
                <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/35">{g.titulo}</p>
              ) : null}
              <ul className="space-y-0.5">
                {g.entradas.map(e => <li key={e.clave}>{renderEntrada(e, seccionActiva, abrirEntrada)}</li>)}
              </ul>
            </nav>
          ))}

          <div className="mt-auto px-5 pt-3 border-t border-border">
            <p className="text-[10px] text-ink/30 leading-relaxed">
              Panel nuevo en construcción. Las pantallas de siempre siguen disponibles en{' '}
              <Link href="/dashboard/admin" className="text-ink/50 hover:text-accent underline">Administración</Link> y{' '}
              <Link href="/control" className="text-ink/50 hover:text-accent underline">Control</Link>.
            </p>
          </div>
        </aside>

        {/* ── Contenido ── */}
        <main className="flex-1 min-w-0 overflow-y-auto px-3 md:px-6 py-4 md:py-6 pb-28 md:pb-10">
          {seccionActiva === 'hoy' && <BandejaHoy nombre={nombre} onIrASeccion={irASeccion} />}
          {seccionActiva === 'operaciones' && <OperacionesPanel />}
          {seccionActiva === 'contratos' && <ContratosSeccion reservaInicial={reservaFoco} />}
          {seccionActiva === 'soporte' && <SoportePanel focusConvId={convFoco} />}
          {seccionActiva === 'contabilidad' && <ContabilidadPanel />}
          {seccionActiva === 'calculadora' && <CalculadoraPanel />}
          {seccionActiva === 'buses' && <BusesPanel />}
          {seccionActiva === 'leads' && <LeadsPropietariosPanel />}
          {seccionActiva === 'nfc' && <NfcCardsPanel />}
          {seccionActiva === 'auditoria' && <AuditoriaPanel />}
          {seccionActiva === null && (
            <div className="max-w-md">
              <h1 className="text-lg font-black text-ink">Sin secciones asignadas</h1>
              <p className="text-xs text-ink/50 mt-1">
                Tu cuenta no tiene ninguna sección de este panel habilitada. Pídele acceso al administrador principal.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* ── Barra inferior (celular): cinco entradas, no veinticuatro ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 glass border-t border-border flex items-stretch"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {MOVIL_PRINCIPALES.map(m => {
          const e = entradaPorClave(m.clave);
          if (!e || !puede(nivel, e.area, permisos)) return null;
          const activo = e.tipo === 'seccion' && seccionActiva === e.clave;
          const contenido = (
            <>
              <span className={activo ? 'text-accent' : 'text-ink/55'}>{e.icono}</span>
              <span className={`text-[10px] font-semibold ${activo ? 'text-accent' : 'text-ink/55'}`}>{m.label}</span>
            </>
          );
          const clases = 'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-w-0';
          return e.tipo === 'seccion'
            ? <button key={m.clave} type="button" onClick={() => abrirEntrada(e)} className={clases}>{contenido}</button>
            : <Link key={m.clave} href={e.href || '#'} className={clases}>{contenido}</Link>;
        })}
        <button type="button" onClick={() => setMasAbierto(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-w-0">
          <span className="text-ink/55">{ICONO_MAS}</span>
          <span className="text-[10px] font-semibold text-ink/55">Más</span>
        </button>
      </nav>

      {/* ── «Más»: el mapa completo, para lo que nadie hace caminando ── */}
      {masAbierto && (
        <div className="md:hidden fixed inset-0 z-50 bg-bg overflow-y-auto">
          <div className="flex items-center justify-between px-4 h-14 border-b border-border sticky top-0 bg-bg">
            <span className="text-sm font-black text-ink">Todo el panel</span>
            <button type="button" onClick={() => setMasAbierto(false)} aria-label="Cerrar" className="grid place-items-center w-9 h-9 rounded-xl border border-border text-ink/60">
              <IconX size={16} />
            </button>
          </div>
          <div className="px-4 py-4 pb-10">
            {grupos.map(g => (
              <section key={g.titulo} className="mb-5">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/35">{g.titulo}</p>
                <ul className="space-y-1.5">
                  {g.entradas.map(e => (
                    <li key={e.clave}>{renderEntradaMovil(e, seccionActiva, abrirEntrada)}</li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-[11px] text-ink/35 leading-relaxed">
              Las pantallas de siempre siguen disponibles en{' '}
              <Link href="/dashboard/admin" className="text-ink/50 underline">Administración</Link> y{' '}
              <Link href="/control" className="text-ink/50 underline">Control</Link>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Piezas de la navegación ─────────────────────────────────────────────────

function renderEntrada(e: EntradaPanel, activa: string | null, abrir: (e: EntradaPanel) => void) {
  const esActiva = e.tipo === 'seccion' && activa === e.clave;
  const clases = `w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition ${
    esActiva ? 'bg-surface-3 text-ink font-bold' : 'text-ink/65 hover:text-ink hover:bg-surface-2'
  }`;
  const contenido = (
    <>
      <span className={esActiva ? 'text-accent' : 'text-ink/45'}>{e.icono}</span>
      <span className="truncate">{e.label}</span>
      {/* Las entradas que todavía viven en la pantalla de siempre lo dicen: nadie
          debería descubrir por sorpresa que salió del panel nuevo. */}
      {e.tipo === 'enlace' && <IconArrowR size={12} className="ml-auto opacity-30" />}
    </>
  );
  return e.tipo === 'seccion'
    ? <button type="button" onClick={() => abrir(e)} className={clases}>{contenido}</button>
    : <Link href={e.href || '#'} className={clases}>{contenido}</Link>;
}

function renderEntradaMovil(e: EntradaPanel, activa: string | null, abrir: (e: EntradaPanel) => void) {
  const esActiva = e.tipo === 'seccion' && activa === e.clave;
  const clases = `w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl border transition ${
    esActiva ? 'border-accent/40 bg-accent-light' : 'border-border bg-surface-2'
  }`;
  const contenido = (
    <>
      <span className={`mt-0.5 ${esActiva ? 'text-accent' : 'text-ink/45'}`}>{e.icono}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{e.label}</span>
        {e.pista && <span className="block text-[11px] text-ink/45">{e.pista}</span>}
      </span>
      {e.tipo === 'enlace' && <IconArrowR size={12} className="ml-auto mt-1 opacity-30 shrink-0" />}
    </>
  );
  return e.tipo === 'seccion'
    ? <button type="button" onClick={() => abrir(e)} className={clases}>{contenido}</button>
    : <Link href={e.href || '#'} className={clases}>{contenido}</Link>;
}
