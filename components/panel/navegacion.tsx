// ── El mapa del panel unificado (/panel) ────────────────────────────────────
//
// Seis grupos con nombre — HOY · OPERACIÓN · DINERO · CATÁLOGO · EQUIPO · SISTEMA —
// en vez de doce pestañas planas en una app y seis módulos en otra. Este archivo es
// la ÚNICA fuente de la navegación: de aquí salen la barra lateral, la barra inferior
// del celular y el cajón «Más». Agregar una entrada es agregar una línea acá.
//
// PERMISOS: cada entrada declara el `area` de `lib/permisos.ts` que la habilita. La
// UI usa `puede(nivel, area, permisos_extra)` para mostrarla u ocultarla; el gating
// REAL sigue siendo del servidor en cada API. Un grupo sin entradas visibles no se
// pinta. Este archivo NO define permisos nuevos ni toca el modelo: solo lo consume.
//
// DOS TIPOS DE ENTRADA:
//   · `seccion` — la pantalla vive DENTRO de /panel.
//   · `enlace`  — todavía apunta a la pantalla de siempre, que sigue funcionando igual.
//
// ETAPA 2 (esta): Reservas, Vehículos, Personas, Mercado y Configuración pasaron de
// enlace a sección. NO son una copia: el panel de siempre (/dashboard/admin) monta
// exactamente los mismos componentes (components/panel/{Personas,Vehiculos,Reservas,
// Mercado}Seccion.tsx), así que las dos pantallas no pueden desincronizarse.
//
// SIGUEN COMO ENLACE los cuatro módulos de /control (Tareas, Calendario, Documentos y
// Tableros): su interfaz está escrita con las clases de app/control/control.css —otra
// paleta (crema/ámbar) y otras tipografías (Oswald + IBM Plex), que no son las de la
// marca— y montarlos aquí sin reescribir su estilo metería dos identidades visuales en
// la misma pantalla. Portarlos es reestilarlos, no moverlos: es su propia etapa.
//
// Módulo puro (datos + iconos SVG del set de la app): no importa nada de servidor.
import type { ReactNode } from 'react';
import {
  IconInbox, IconCalendar, IconRoute, IconShield, IconChat, IconCoin, IconDashboard,
  IconCar, IconBus, IconUsers, IconStar, IconCompass, IconCheck, IconPhoto, IconNfc,
  IconHistory, IconKey, IconMenu,
} from '@/components/Icons';

export type EntradaPanel = {
  /** Id de la sección (tipo 'seccion') o del enlace. Único en todo el panel. */
  clave: string;
  label: string;
  /** Área de `AREA_NIVELES` que habilita esta entrada. */
  area: string;
  tipo: 'seccion' | 'enlace';
  /** Solo en `enlace`: a dónde va (pantalla actual, que no se toca en esta etapa). */
  href?: string;
  icono: ReactNode;
  /** Texto de ayuda bajo la entrada en el cajón «Más». */
  pista?: string;
};

export type GrupoPanel = { titulo: string; entradas: EntradaPanel[] };

const t = 16;

export const GRUPOS_PANEL: GrupoPanel[] = [
  {
    titulo: 'Hoy',
    entradas: [
      { clave: 'hoy', label: 'Hoy', area: 'panel', tipo: 'seccion', icono: <IconInbox size={t} />, pista: 'Todo lo que hay que resolver, en una sola lista' },
    ],
  },
  {
    titulo: 'Operación',
    entradas: [
      { clave: 'reservas', label: 'Reservas', area: 'reservas', tipo: 'seccion', icono: <IconCalendar size={t} />, pista: 'Aprobar, rechazar y seguir reservas' },
      { clave: 'operaciones', label: 'Entregas y devoluciones', area: 'operaciones', tipo: 'seccion', icono: <IconRoute size={t} />, pista: 'Servicios, mensajeros, fotos e inspección' },
      { clave: 'contratos', label: 'Contratos', area: 'contratos', tipo: 'seccion', icono: <IconShield size={t} />, pista: 'Los seis documentos de cada reserva y sus firmas' },
      { clave: 'soporte', label: 'Soporte', area: 'soporte', tipo: 'seccion', icono: <IconChat size={t} />, pista: 'Conversaciones escaladas a una persona' },
    ],
  },
  {
    titulo: 'Dinero',
    entradas: [
      { clave: 'contabilidad', label: 'Contabilidad', area: 'contabilidad', tipo: 'seccion', icono: <IconCoin size={t} />, pista: 'Gastos, cotizaciones, facturas y liquidaciones' },
      { clave: 'calculadora', label: 'Calculadora', area: 'calculadora', tipo: 'seccion', icono: <IconDashboard size={t} />, pista: 'Rentabilidad de un vehículo' },
    ],
  },
  {
    titulo: 'Catálogo',
    entradas: [
      { clave: 'vehiculos', label: 'Vehículos', area: 'vehiculos', tipo: 'seccion', icono: <IconCar size={t} />, pista: 'Flota, documentos, fotos y disponibilidad' },
      { clave: 'buses', label: 'Buses', area: 'buses', tipo: 'seccion', icono: <IconBus size={t} />, pista: 'Flota de buses, tarifas y cotizaciones' },
      { clave: 'usuarios', label: 'Personas', area: 'usuarios', tipo: 'seccion', icono: <IconUsers size={t} />, pista: 'Clientes, propietarios y equipo' },
      { clave: 'leads', label: 'Leads', area: 'leads', tipo: 'seccion', icono: <IconStar size={t} />, pista: 'Propietarios interesados en publicar' },
      { clave: 'mercado', label: 'Mercado', area: 'mercado', tipo: 'seccion', icono: <IconCompass size={t} />, pista: 'Precios de la competencia' },
    ],
  },
  {
    titulo: 'Equipo',
    entradas: [
      { clave: 'tareas', label: 'Tareas', area: 'tareas', tipo: 'enlace', href: '/control?tab=tareas', icono: <IconCheck size={t} />, pista: 'Pendientes del equipo' },
      { clave: 'calendario', label: 'Calendario', area: 'calendario', tipo: 'enlace', href: '/control?tab=calendario', icono: <IconCalendar size={t} />, pista: 'Eventos internos' },
      { clave: 'documentos', label: 'Documentos', area: 'documentos', tipo: 'enlace', href: '/control?tab=documentos', icono: <IconPhoto size={t} />, pista: 'Archivos compartidos del equipo' },
      { clave: 'tableros', label: 'Tableros', area: 'tableros', tipo: 'enlace', href: '/control?tab=tableros', icono: <IconDashboard size={t} />, pista: 'Tableros de trabajo' },
    ],
  },
  {
    titulo: 'Sistema',
    entradas: [
      { clave: 'config', label: 'Configuración', area: 'config', tipo: 'seccion', icono: <IconKey size={t} />, pista: 'Comisión, pico y placa, WhatsApp, empresa' },
      { clave: 'nfc', label: 'Tarjetas NFC', area: 'nfc', tipo: 'seccion', icono: <IconNfc size={t} />, pista: 'Tarjetas de contacto del equipo' },
      { clave: 'auditoria', label: 'Bitácora', area: 'auditoria', tipo: 'seccion', icono: <IconHistory size={t} />, pista: 'Quién hizo qué y cuándo' },
    ],
  },
];

/** Todas las entradas, aplanadas. */
export const ENTRADAS_PANEL: EntradaPanel[] = GRUPOS_PANEL.flatMap(g => g.entradas);

export function entradaPorClave(clave: string): EntradaPanel | undefined {
  return ENTRADAS_PANEL.find(e => e.clave === clave);
}

/** Claves de sección válidas (las que /panel sabe pintar por dentro). */
export const SECCIONES_PANEL: string[] = ENTRADAS_PANEL.filter(e => e.tipo === 'seccion').map(e => e.clave);

// ── Celular ─────────────────────────────────────────────────────────────────
//
// La barra lateral no cabe en un teléfono y no tiene por qué. Abajo van los cuatro
// destinos que se usan de pie, con una mano, en la calle — más «Más», que abre el
// resto del mapa completo. El orden y las etiquetas son los de la propuesta:
// Hoy · Reservas · Entregas · Dinero · Más.
export const MOVIL_PRINCIPALES: { clave: string; label: string }[] = [
  { clave: 'hoy', label: 'Hoy' },
  { clave: 'reservas', label: 'Reservas' },
  { clave: 'operaciones', label: 'Entregas' },
  { clave: 'contabilidad', label: 'Dinero' },
];

export const ICONO_MAS = <IconMenu size={18} />;
