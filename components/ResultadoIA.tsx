'use client';
// ── Resultado de la verificación de documentos con IA ───────────────────────
//
// Pinta lo que devuelve POST /api/verificar-documentos (lib/verificacion-docs.ts):
// veredicto global, cada documento con sus datos extraídos y sus chequeos, y los
// cruces entre documentos.
//
// Salió TAL CUAL de app/dashboard/admin/page.tsx al partir ese archivo en secciones.
// Lo usan las dos pantallas que verifican documentos: la sección Vehículos (SOAT,
// tecno y tarjeta de propiedad) y la sección Reservas (cédula y licencia del
// arrendatario), montadas tanto en /dashboard/admin como en /panel.
import { IconCheck } from '@/components/Icons';
import { DOC_LABELS } from '@/components/panel/tipos-admin';
import type { VerificacionResultado } from '@/lib/verificacion-docs';

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

export default function ResultadoIA({ res, auto }: { res: VerificacionResultado; auto?: string[] }) {
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
