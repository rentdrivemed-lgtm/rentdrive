'use client';
import { evaluarDisponibilidad, MIN_DIAS_ABIERTOS_SEMANA, MIN_FINES_DE_SEMANA_MES, MAX_MESES_CERRADOS_ANIO, MIN_DISPONIBILIDAD_ANUAL_PCT, UMBRAL_ALTA_DISPONIBILIDAD_PCT } from '@/lib/disponibilidad-reglas';
import { IconCheck, IconX } from '@/components/Icons';

type Props = { dias: string[] };

export default function DisponibilidadReglas({ dias }: Props) {
  const irrestricto = dias.length === 0;
  const evaluacion = evaluarDisponibilidad(dias);
  const mesActual = evaluacion.meses[0];

  const reglas = [
    {
      ok: irrestricto || evaluacion.problemas.every(p => p.regla !== 'minimo_semanal'),
      texto: `Mínimo ${MIN_DIAS_ABIERTOS_SEMANA} días abiertos por semana (en meses activos)`,
    },
    {
      ok: irrestricto || evaluacion.problemas.every(p => p.regla !== 'fines_de_semana'),
      texto: `Mínimo ${MIN_FINES_DE_SEMANA_MES} fines de semana disponibles por mes (en meses activos)`,
    },
    {
      ok: irrestricto || evaluacion.mesesCerrados <= MAX_MESES_CERRADOS_ANIO,
      texto: `Máximo ${MAX_MESES_CERRADOS_ANIO} meses completamente cerrados al año (llevas ${evaluacion.mesesCerrados})`,
    },
    {
      ok: irrestricto || evaluacion.pctAnual >= MIN_DISPONIBILIDAD_ANUAL_PCT,
      texto: `Mínimo ${(MIN_DISPONIBILIDAD_ANUAL_PCT * 100).toFixed(0)}% de disponibilidad en el año (llevas ${(evaluacion.pctAnual * 100).toFixed(0)}%)`,
    },
  ];

  return (
    <div className="bg-surface rounded-xl border border-border p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink/60 uppercase tracking-wide">Reglas de disponibilidad</p>
        {mesActual?.altaDisponibilidad && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">
            ⭐ Alta disponibilidad este mes
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {reglas.map((r, i) => (
          <li key={i} className={`flex items-start gap-1.5 text-[11px] ${r.ok ? 'text-ink/60' : 'text-danger'}`}>
            {r.ok ? <IconCheck size={11} className="mt-0.5 flex-shrink-0 text-success" /> : <IconX size={11} className="mt-0.5 flex-shrink-0" />}
            {r.texto}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-ink/40">
        Todo el calendario abierto (sin restricciones) siempre cumple. Si tienes más de {(UMBRAL_ALTA_DISPONIBILIDAD_PCT * 100).toFixed(0)}%
        de disponibilidad en el mes, tu vehículo aparece con más prioridad en las búsquedas.
      </p>
    </div>
  );
}
