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
// Exportado: components/EstadoEntregaResultado.tsx dibuja los mismos `tipo` (la lista
// blanca de lib/inspeccion-vehiculo.ts es la misma para las dos listas), y tener dos
// copias del mapa significaba que un ícono nuevo saldría en una tarjeta y en la otra no.
export const TIPO_ICON: Record<string, string> = {
  rayon: '✏️', abolladura: '🔨', hundido: '🔨', vidrio_roto: '🧊', espejo: '🪞', faro: '💡', llanta: '🛞', otro: '⚠️',
};

/**
 * Tarjeta del resultado de la inspección con IA.
 *
 * La lee un empleado con el cliente delante, a veces de afán, y con ella decide
 * si le dice a alguien que devolvió el carro dañado. Por eso hay TRES estados
 * visualmente distintos, y ninguno se puede confundir con otro:
 *
 *  1. Limpio          → `hay_danos_nuevos: false` y sin hallazgos. Badge verde.
 *  2. Puntos a revisar → `hay_danos_nuevos: false` PERO con hallazgos. Ocurre
 *     cuando todo lo que encontró la IA es de confianza baja: son cosas que
 *     podrían ser una sombra, un reflejo o suciedad. NO son un veredicto.
 *     Antes esto se pintaba con el badge verde "Sin daños nuevos" y, debajo, la
 *     lista de hallazgos con los mismos íconos de daño y el mismo estilo que un
 *     daño confirmado: se podía leer mal en las dos direcciones (ignorar algo
 *     que había que mirar, o cobrarle a alguien por un "daño" no confirmado).
 *     Ahora el badge es neutro y dice cuántos puntos hay, y las tarjetas van
 *     atenuadas, con borde punteado, lupa en vez de ícono de daño y la etiqueta
 *     "por revisar".
 *  3. Daños confirmados → `hay_danos_nuevos: true`. Badge por severidad y
 *     encabezado explícito sobre la lista.
 */
export default function InspeccionResultado({ res }: { res: InspeccionResultado }) {
  // Hallazgos SIN veredicto: la IA los lista para que una persona los mire, pero
  // no afirma que haya daño nuevo.
  const soloRevisar = !res.hay_danos_nuevos && res.hallazgos.length > 0;

  const badgeClase = res.hay_danos_nuevos
    ? (SEV_BADGE[res.severidad_general] || SEV_BADGE.leve)
    : soloRevisar
      ? 'bg-ink/10 text-ink/70 border-border-strong'
      : SEV_BADGE.ninguna;
  const badgeTexto = res.hay_danos_nuevos
    ? (SEV_LABEL[res.severidad_general] || res.severidad_general)
    : soloRevisar
      ? `Sin daños confirmados · ${res.hallazgos.length} punto${res.hallazgos.length === 1 ? '' : 's'} a revisar`
      : SEV_LABEL.ninguna;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Inspección IA</span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${badgeClase}`}>
          {badgeTexto}
        </span>
      </div>

      <p className="text-sm text-ink/70 leading-relaxed">{res.resumen}</p>

      {res.hallazgos.length > 0 && (
        <div className="space-y-1.5">
          {soloRevisar ? (
            <>
              <p className="text-xs font-semibold text-ink/70">Puntos a revisar en persona — no confirmados</p>
              <p className="text-[11px] text-ink/50 leading-relaxed">
                La IA no confirma ninguno: pueden ser sombras, reflejos, suciedad o el ángulo de la foto.
                Míralos con el cliente antes de concluir nada.
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold text-warning">Daños nuevos detectados</p>
          )}

          <ul className="space-y-1.5">
            {res.hallazgos.map((h, i) => (
              <li
                key={i}
                className={`text-xs rounded-xl p-2.5 border ${soloRevisar ? 'border-dashed border-border-strong bg-transparent' : 'bg-surface border-border/60'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span>{soloRevisar ? '🔎' : (TIPO_ICON[h.tipo] || '⚠️')}</span>
                  <span className={`capitalize ${soloRevisar ? 'font-medium text-ink/70' : 'font-semibold text-ink'}`}>
                    {h.tipo.replace(/_/g, ' ')}
                  </span>
                  <span className="text-ink/50">· {h.ubicacion}</span>
                  <span className="ml-auto text-[10px] text-ink/50 shrink-0">
                    {soloRevisar ? `por revisar · conf. ${h.confianza}` : `conf. ${h.confianza}`}
                  </span>
                </div>
                <p className={`mt-0.5 ${soloRevisar ? 'text-ink/50' : 'text-ink/60'}`}>{h.descripcion}</p>
              </li>
            ))}
          </ul>
        </div>
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
