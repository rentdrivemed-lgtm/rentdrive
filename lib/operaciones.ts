import type Database from 'better-sqlite3';
import { lugarResumen, type Lugar } from './lugares';
import { compararFotosVehiculo, type InspeccionResultado } from './inspeccion-vehiculo';
type DB = Database.Database;
export type PlantillaTarea = { tipo: string; titulo: string; detalle: string; orden: number };
export function plantillaTareas(reserva: { recogida?: unknown; entrega?: unknown; fecha_inicio: string; fecha_fin: string }): PlantillaTarea[] {
  void lugarResumen; void reserva;
  return [];
}
export function crearOperacionParaReserva(db: DB, reservaId: number): { creada: boolean; operacionId: number } {
  void db; void reservaId;
  return { creada: false, operacionId: 0 };
}
export function getConfig(db: DB, clave: string): string { void db; void clave; return ''; }
export function setConfig(db: DB, clave: string, valor: string): void { void db; void clave; void valor; }
export async function ejecutarInspeccion(db: DB, opId: number): Promise<InspeccionResultado> {
  void db; void opId; void compararFotosVehiculo;
  throw new Error('Not implemented');
}