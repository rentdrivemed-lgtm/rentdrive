'use client';
import { TIPO_ICON } from '@/components/InspeccionResultado';

export type MarcaPrevia = { tipo: string; ubicacion: string; descripcion: string; confianza: 'alta' | 'media' | 'baja' };
export type EstadoEntrega = {
  marcas: MarcaPrevia[];
  zonas_no_cubiertas: string;
  resumen: string;
};

/**
 * Tarjeta del INVENTARIO DE ENTREGA (paso 1): las marcas que el vehículo YA TRAÍA
 * cuando salió.
 *
 * ── Por qué es un componente aparte y no un modo de InspeccionResultado ──
 * Aquel dibuja un VEREDICTO y por eso tiene tres estados (limpio / puntos a revisar /
 * daños confirmados), badge por severidad, encabezado "Daños nuevos detectados" y
 * recomendación. Nada de eso existe acá: este dato no tiene severidad, no tiene
 * veredicto y no tiene recomendación — describe cómo está un carro usado antes de
 * entregarlo. Meterlo allá habría sido colgar un `modo` de toda esa lógica y dejar la
 * tarjeta más delicada de la app (la que decide si se le dice a alguien que devolvió el
 * carro dañado) dependiendo de un flag.
 *
 * ── Y sobre todo: esto NO se pinta como alarma ──
 * Una lista larga de marcas es el resultado NORMAL y BUENO acá (ver el prompt de
 * `analizarEstadoEntrega`: se le pide ser exhaustivo justamente para que nada de lo que
 * ya estaba se le cobre después a quien no lo hizo). Si esta tarjeta saliera en rojo,
 * un empleado leería "20 daños" con el cliente delante y el efecto sería el contrario
 * del que busca la función. Por eso todo va en tonos neutros, sin rojo, sin naranja y
 * sin la palabra "daño".
 *
 * Se muestra en el punto de atención antes de entregar el carro, así que está pensada
 * para leerse en un celular: tipografía algo más grande que la del veredicto y cada
 * marca en su propia fila.
 */
export default function EstadoEntregaResultado({ res }: { res: EstadoEntrega }) {
  const total = res.marcas.length;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Paso 1 · Estado al entregar</span>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-ink/10 text-ink/70 border-border-strong">
          {total === 0 ? 'Sin marcas registradas' : `${total} marca${total === 1 ? '' : 's'} registrada${total === 1 ? '' : 's'}`}
        </span>
      </div>

      <p className="text-sm text-ink/70 leading-relaxed">{res.resumen}</p>

      {total > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink/70">Así sale el vehículo — marcas que ya tenía</p>
          <ul className="space-y-1.5">
            {res.marcas.map((m, i) => (
              <li key={i} className="text-[13px] rounded-xl p-2.5 border border-border/60 bg-surface">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span>{TIPO_ICON[m.tipo] || '•'}</span>
                  <span className="font-semibold text-ink capitalize">{m.tipo.replace(/_/g, ' ')}</span>
                  <span className="text-ink/50">· {m.ubicacion}</span>
                  <span className="ml-auto text-[11px] text-ink/45 shrink-0">conf. {m.confianza}</span>
                </div>
                <p className="mt-0.5 text-ink/60 leading-relaxed">{m.descripcion}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {res.zonas_no_cubiertas && (
        <p className="text-[11px] text-ink/50">⚠️ No se pudo revisar: {res.zonas_no_cubiertas}</p>
      )}

      <p className="text-[11px] text-ink/50 bg-surface rounded-xl p-2.5 border border-border/60 leading-relaxed">
        Esto no es un daño de nadie: es el estado en que el vehículo sale a la calle. Se anota para que, cuando el
        cliente lo devuelva, ninguna de estas marcas se cuente como nueva.
      </p>

      <p className="text-[10px] text-ink/40">La IA es una ayuda; la revisión final del estado del vehículo es humana.</p>
    </div>
  );
}
