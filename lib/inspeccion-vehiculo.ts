import { promises as fs } from 'fs';
import path from 'path';
import { getAnthropic } from './anthropic';
export type HallazgoDano = { tipo: string; ubicacion: string; descripcion: string; confianza: 'alta' | 'media' | 'baja'; };
export type InspeccionResultado = { hay_danos_nuevos: boolean; severidad_general: 'ninguna' | 'leve' | 'moderada' | 'grave'; hallazgos: HallazgoDano[]; zonas_no_comparables: string; resumen: string; recomendacion: string; };
export async function compararFotosVehiculo(ctx: { vehiculo?: string; placa?: string }, fotosSalida: string[], fotosEntrada: string[]): Promise<InspeccionResultado> {
  void ctx; void fotosSalida; void fotosEntrada; void fs; void path;
  const anthropic = getAnthropic(); void anthropic;
  throw new Error('Not implemented');
}