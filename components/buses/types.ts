// Tipos compartidos por las sub-secciones del panel admin de Buses (Etapa 3, ver
// COTIZADOR-BUSES-SPEC.md §5). Reflejan exactamente lo que devuelven los endpoints de
// app/api/buses/* (Etapa 2, ya cerrada) — no se inventa ningún campo que el backend no
// exponga.
import type { CategoriaBus } from '@/lib/busCotizador';

// Fila de `vehiculos` con tipo='bus' (GET /api/buses) + propietario_nombre (JOIN).
export type BusRow = {
  id: number;
  marca: string;
  modelo: string;
  anio: number;
  placa: string;
  capacidad_pasajeros: number | null;
  bus_categoria: CategoriaBus | null;
  disponible: number;
  contenido_revision?: number;
  propietario_id: number;
  propietario_nombre: string;
  ubicacion?: string;
};

// bus_tarifas_destino_ref (GET/PUT /api/buses/tarifas-referencia).
export type TarifaDestinoRef = {
  id: number;
  destino: string;
  km: number | null;
  px12: number | null; px12_30: number | null;
  px14: number | null; px14_30: number | null;
  px16: number | null; px16_30: number | null;
  px19: number | null; px19_30: number | null;
  px22_25: number | null; px22_25_30: number | null;
  px30_42: number | null; px30_42_30: number | null;
  observaciones: string;
  activo: number;
  updated_at: string;
};

// bus_tarifas_hora_ref (GET/PUT /api/buses/tarifas-referencia).
export type TarifaHoraRef = {
  categoria: CategoriaBus;
  tarifa_hora: number;
  minimo_horas: number;
  hora_adicional: number;
};

// bus_valor_km_ref (GET/PUT /api/buses/tarifas-referencia).
export type TarifaKmRef = {
  categoria: CategoriaBus;
  valor_km: number;
  tarifa_minima: number;
  calculado_de_tarifario: number;
};

// bus_tarifas_cambios + JOIN vehiculos/usuarios (GET/PUT /api/buses/cambios).
export type EstadoCambioTarifa = 'pendiente' | 'auto_aprobada' | 'aprobada' | 'rechazada';
export type CambioTarifa = {
  id: number;
  vehiculo_id: number;
  propietario_id: number;
  tipo: 'destino' | 'hora' | 'km';
  destino: string | null;
  categoria: CategoriaBus;
  valor_anterior: string; // JSON
  valor_propuesto: string; // JSON
  estado: EstadoCambioTarifa;
  motivo_admin: string;
  revisado_por: number | null;
  revisado_en: string | null;
  created_at: string;
  marca: string;
  modelo: string;
  placa: string;
  propietario_nombre: string;
};

// cotizaciones_bus + JOIN vehiculos (GET/PUT /api/buses/cotizaciones).
export type EstadoCotizacionBus = 'nueva' | 'contactada' | 'confirmada' | 'descartada';
export type CotizacionBus = {
  id: number;
  numero: string;
  vehiculo_id: number;
  categoria: CategoriaBus;
  modo: 'destino' | 'trayecto' | 'horas';
  destino: string | null;
  km: number | null;
  horas: number | null;
  con_recargo: number;
  tarifa_aplicada: number;
  recargo_valor: number;
  total: number;
  cliente_nombre: string;
  cliente_telefono: string;
  fecha_servicio: string;
  estado: EstadoCotizacionBus;
  created_at: string;
  marca: string;
  modelo: string;
  placa: string;
  propietario_id: number;
};

export function cop(n: number): string {
  return `$${Math.round(n || 0).toLocaleString('es-CO')}`;
}
