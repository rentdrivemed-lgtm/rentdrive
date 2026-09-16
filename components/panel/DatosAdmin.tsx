'use client';
// ── La capa de datos compartida de las secciones del panel ──────────────────
//
// POR QUÉ EXISTE. Al partir app/dashboard/admin/page.tsx en secciones (Personas,
// Vehículos, Reservas, Mercado) quedó a la vista lo que ese archivo escondía: las
// tres listas grandes NO son de una sección sola.
//   · `usuarios`  — la sección Personas la lista; la pantalla la cuenta arriba.
//   · `vehiculos` — la lista Vehículos, el modal de reserva de mostrador (Reservas),
//                   el badge de "documentos pendientes" de Personas y el contador
//                   "sin precio" de la cabecera.
//   · `reservas`  — la sección Reservas y el calendario de disponibilidad de un
//                   vehículo (días ya comprometidos).
// Si cada sección las pidiera por su cuenta habría dos y tres peticiones iguales por
// pantalla, y —peor— dos copias del mismo dato que se desincronizan en cuanto una
// sección aprueba, archiva o borra algo.
//
// QUÉ HACE. Guarda esas listas una sola vez por pantalla y expone los mismos
// `setX` que ya usaban los manejadores del panel de siempre (actualizaciones
// optimistas incluidas), más un `asegurarX()` que pide la lista la PRIMERA vez que
// alguien la necesita. Quien monta el proveedor decide qué cargar de entrada:
// /dashboard/admin pide las tres al abrir (como siempre hizo, porque los contadores
// de la cabecera las necesitan); /panel deja que cada sección pida la suya.
//
// LO QUE NO HACE. No decide permisos ni oculta nada: el gating real es de cada API
// (`guardArea`), y un 403 acá solo marca la lista como "no se pudo cargar", que es
// exactamente lo que hacía el panel de siempre.
import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react';
import type { ReservaCalendario } from '@/components/CalendarioReservas';
import type { Usuario, Vehiculo } from '@/components/panel/tipos-admin';

export type ErrorListas = { usuarios?: boolean; vehiculos?: boolean; reservas?: boolean };

type DatosAdmin = {
  usuarios: Usuario[];
  setUsuarios: Dispatch<SetStateAction<Usuario[]>>;
  vehiculos: Vehiculo[];
  setVehiculos: Dispatch<SetStateAction<Vehiculo[]>>;
  reservas: ReservaCalendario[];
  setReservas: Dispatch<SetStateAction<ReservaCalendario[]>>;
  vehiculosArchivados: Vehiculo[];
  setVehiculosArchivados: Dispatch<SetStateAction<Vehiculo[]>>;
  vehiculosRevisionContenido: Vehiculo[];
  setVehiculosRevisionContenido: Dispatch<SetStateAction<Vehiculo[]>>;
  errorListas: ErrorListas;
  /** ¿Se pudieron cargar las reservas? `null` = todavía no se sabe. */
  reservasOk: boolean | null;
  cargarUsuarios: () => Promise<void>;
  cargarVehiculos: () => Promise<void>;
  cargarReservas: () => Promise<void>;
  cargarVehiculosArchivados: () => Promise<void>;
  cargarVehiculosRevisionContenido: () => Promise<void>;
  /** Carga la lista solo si nadie la ha pedido todavía en esta pantalla. */
  asegurarUsuarios: () => void;
  asegurarVehiculos: () => void;
  asegurarReservas: () => void;
  asegurarVehiculosRevisionContenido: () => void;
};

const Ctx = createContext<DatosAdmin | null>(null);

export function useDatosAdmin(): DatosAdmin {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDatosAdmin necesita un <DatosAdminProvider> por encima.');
  return ctx;
}

export function DatosAdminProvider({ children }: { children: ReactNode }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [reservas, setReservas] = useState<ReservaCalendario[]>([]);
  const [vehiculosArchivados, setVehiculosArchivados] = useState<Vehiculo[]>([]);
  const [vehiculosRevisionContenido, setVehiculosRevisionContenido] = useState<Vehiculo[]>([]);
  const [errorListas, setErrorListas] = useState<ErrorListas>({});
  // `reservasOk` se marca aparte de `errorListas.reservas` a propósito: `errorListas` solo
  // controla el recuadro de "Reintentar" de la sección Reservas (que un admin sin esa área ni
  // siquiera ve); `reservasOk` es lo que consume el editor de calendario de un vehículo para
  // no dejar editar a ciegas cuando el 403 del área `reservas` nos dejó sin saber qué días
  // están reservados.
  const [reservasOk, setReservasOk] = useState<boolean | null>(null);

  // Quién ya pidió qué (ref, no estado: no repinta y sobrevive a que una sección se
  // desmonte al cambiar de pestaña).
  const pedido = useRef<Record<string, boolean>>({});

  const cargarUsuarios = useCallback(() =>
    fetch('/api/admin/usuarios').then(r => r.json()).then(d => setUsuarios(d.usuarios || [])).catch(() => setErrorListas(e => ({ ...e, usuarios: true }))), []);

  const cargarVehiculos = useCallback(() =>
    fetch('/api/vehiculos?panelAdmin=1').then(r => r.json()).then(d => setVehiculos(d.vehiculos || [])).catch(() => setErrorListas(e => ({ ...e, vehiculos: true }))), []);

  const cargarReservas = useCallback(() =>
    fetch('/api/reservas')
      .then(async r => {
        if (!r.ok) { setReservasOk(false); return; }
        const d = await r.json();
        setReservas(d.reservas || []);
        setReservasOk(true);
      })
      .catch(() => { setReservasOk(false); setErrorListas(e => ({ ...e, reservas: true })); }), []);

  const cargarVehiculosArchivados = useCallback(() =>
    fetch('/api/vehiculos?archivados=1').then(r => r.json()).then(d => setVehiculosArchivados(d.vehiculos || [])).catch(() => {}), []);

  const cargarVehiculosRevisionContenido = useCallback(() =>
    fetch('/api/vehiculos?revisionContenido=1').then(r => r.json()).then(d => setVehiculosRevisionContenido(d.vehiculos || [])).catch(() => {}), []);

  const unaVez = useCallback((clave: string, cargar: () => Promise<void>) => {
    if (pedido.current[clave]) return;
    pedido.current[clave] = true;
    void cargar();
  }, []);

  const asegurarUsuarios = useCallback(() => unaVez('usuarios', cargarUsuarios), [unaVez, cargarUsuarios]);
  const asegurarVehiculos = useCallback(() => unaVez('vehiculos', cargarVehiculos), [unaVez, cargarVehiculos]);
  const asegurarReservas = useCallback(() => unaVez('reservas', cargarReservas), [unaVez, cargarReservas]);
  const asegurarVehiculosRevisionContenido = useCallback(
    () => unaVez('revision', cargarVehiculosRevisionContenido), [unaVez, cargarVehiculosRevisionContenido]);

  const valor = useMemo<DatosAdmin>(() => ({
    usuarios, setUsuarios,
    vehiculos, setVehiculos,
    reservas, setReservas,
    vehiculosArchivados, setVehiculosArchivados,
    vehiculosRevisionContenido, setVehiculosRevisionContenido,
    errorListas, reservasOk,
    cargarUsuarios, cargarVehiculos, cargarReservas,
    cargarVehiculosArchivados, cargarVehiculosRevisionContenido,
    asegurarUsuarios, asegurarVehiculos, asegurarReservas, asegurarVehiculosRevisionContenido,
  }), [
    usuarios, vehiculos, reservas, vehiculosArchivados, vehiculosRevisionContenido,
    errorListas, reservasOk,
    cargarUsuarios, cargarVehiculos, cargarReservas,
    cargarVehiculosArchivados, cargarVehiculosRevisionContenido,
    asegurarUsuarios, asegurarVehiculos, asegurarReservas, asegurarVehiculosRevisionContenido,
  ]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
