'use client';

export type HallazgoDano = { tipo: string; ubicacion: string; descripcion: string; confianza: 'alta' | 'media' | 'baja' };
export type InspeccionResultado = {
  hay_danos_nuevos: boolean;
  severidad_general: 'ninguna' | 'leve' | 'moderada' | 'grave';
  hallazgos: HallazgoDano[];
  zonas_no_comparables: string;
  resumen: string;
  recomendacion: string;
};

const SEV_BADGE: Record<string, string> = {
  ninguna:  'bg-success/15 text-success border-success/30',
  leve:     'bg-warning/15 text-warning border-warning/25',
  moderada: 'bg-accent/15 text-accent border-accent/25',
  grave:    'bg-danger/15 text-danger border-danger/25',
};
const SEV_LABEL: Record<string, string> = {
  ninguna: 'Sin daños nuevos', leve: 'Daños leves', moderada: 'Daños moderados', grave: 'Daños graves',
};
const TIPO_ICON: Record<string, string> = {
  rayon: '✏️', abolladura: '🔨', hundido: '🔨', vidrio_roto: '🧊', espejo: '🪞', faro: '💡', llanta: '🛞', otro: '⚠️',
};

export default function InspeccionResultado({ res }: { res: InspeccionResultado }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Inspección IA</span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${SEV_BADGE[res.severidad_general] || SEV_BADGE.leve}`}>
          {SEV_LABEL[res.severidad_general] || res.severidad_general}
        </span>
      </div>

      <p className="text-sm text-ink/70 leading-relaxed">{res.resumen}</p>

      {res.hallazgos.length > 0 && (
        <ul className="space-y-1.5">
          {res.hallazgos.map((h, i) => (
            <li key={i} className="text-xs bg-surface rounded-xl p-2.5 border border-border/60">
              <div className="flex items-center gap-1.5">
                <span>{TIPO_ICON[h.tipo] || '⚠️'}</span>
                <span className="font-semibold text-ink capitalize">{h.tipo.replace(/_/g, ' ')}</span>
                <span className="text-ink/50">· {h.ubicacion}</span>
                <span className="ml-auto text-[10px] text-ink/50">conf. {h.confianza}</span>
              </div>
              <p className="text-ink/60 mt-0.5">{h.descripcion}</p>
            </li>
          ))}
        </ul>
      )}

      {res.zonas_no_comparables && (
        <p className="text-[11px] text-ink/50">⚠️ No comparable: {res.zonas_no_comparables}</p>
      )}

      {res.recomendacion && (
        <p className="text-xs text-ink/70 bg-surface rounded-xl p-2.5 border border-border/60">
          <span className="font-semibold text-ink">Recomendación:</span> {res.recomendacion}
        </p>
      )}

      <p className="text-[10px] text-ink/40">La IA es una ayuda; la verificación final del estado del vehículo es humana.</p>
    </div>
  );
}
