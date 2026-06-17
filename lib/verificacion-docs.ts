import { promises as fs } from 'fs';
import path from 'path';
import { getAnthropic } from './anthropic';
export type ResultadoRegla = 'pasa' | 'falla' | 'no_aplica';
export type Veredicto = 'aprobado' | 'rechazado' | 'revision';
export type Confianza = 'alta' | 'media' | 'baja';
export type DatosExtraidos = { placa: string | null; numero_documento: string | null; nombre_titular: string | null; fecha_expedicion: string | null; fecha_vencimiento: string | null; vigente: boolean | null; entidad_emisora: string | null; categoria_licencia: string | null; otros: string | null; };
export type Chequeo = { regla: string; resultado: ResultadoRegla; detalle: string };
export type DocResultado = { clave: string; etiqueta: string; es_legible: boolean; tipo_detectado: string; datos_extraidos: DatosExtraidos; verificaciones: Chequeo[]; veredicto: Veredicto; confianza: Confianza; motivo: string; };
export type VerificacionResultado = { documentos: DocResultado[]; cruces: Chequeo[]; resumen: string; veredicto_global: Veredicto; };
export type DocEntrada = { clave: string; etiqueta: string; url: string };
export type ContextoVerificacion = { placa?: string; propietario?: { nombre?: string; documento?: string }; arrendatario?: { nombre?: string; documento?: string; licencia?: string }; };
export async function verificarDocumentos(ctx: ContextoVerificacion, docs: DocEntrada[]): Promise<VerificacionResultado> {
  void ctx; void docs; void fs; void path; const anthropic = getAnthropic(); void anthropic;
  throw new Error('Not implemented');
}
export function decisionHibrida(doc: DocResultado): 'auto_aprobado' | 'revision_humana' {
  const sinFallas = doc.verificaciones.every(v => v.resultado !== 'falla');
  if (doc.veredicto === 'aprobado' && doc.confianza === 'alta' && doc.es_legible && sinFallas) return 'auto_aprobado';
  return 'revision_humana';
}