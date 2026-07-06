// Reglas de disponibilidad para propietarios de vehículos.
//
// Calibradas con los supuestos reales del modelo de negocio (ver
// Modelo_Financiero_DrivePass.xlsx, hoja "1. Supuestos" y "2. Unit Economics"):
// el escenario realista asume ~50% de ocupación por vehículo (15 días ocupados
// de 30 al mes) y una reserva promedio de ~4.3 días. El propietario sigue
// teniendo el control total de su calendario — estas reglas solo evitan que,
// dentro de los meses que decide tener activos, la disponibilidad quede tan
// fragmentada que sea imposible para DrivePass acercarse a ese escenario.
//
// Un vehículo sin ninguna restricción (dias_disponibles = []) está 100%
// abierto y cumple automáticamente todas las reglas.

export const MIN_NOCHES_RESERVA = 2;
export const MIN_DIAS_ABIERTOS_SEMANA = 3;
export const MIN_FINES_DE_SEMANA_MES = 2;
export const MAX_MESES_CERRADOS_ANIO = 2;
export const MIN_DISPONIBILIDAD_ANUAL_PCT = 0.60;
export const UMBRAL_ALTA_DISPONIBILIDAD_PCT = 0.80;

export type Problema = { regla: string; detalle: string };

export type EvaluacionMes = {
  anio: number;
  mes: number; // 0-indexado
  diasEnMes: number;
  diasAbiertos: number;
  pct: number;
  cerradoCompleto: boolean;
  finesDeSemanaAbiertos: number;
  finesDeSemanaTotales: number;
  semanasIncumplidas: number;
  altaDisponibilidad: boolean;
};

export type EvaluacionDisponibilidad = {
  meses: EvaluacionMes[];
  pctAnual: number;
  mesesCerrados: number;
  problemas: Problema[];
  cumple: boolean;
};

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Semana (0-indexada) dentro del mes, agrupando lunes a domingo. */
function semanaDelMes(anio: number, mes: number, dia: number): number {
  const offset = (new Date(anio, mes, 1).getDay() + 6) % 7; // días de la semana anterior que "empujan" el día 1
  return Math.floor((dia - 1 + offset) / 7);
}

function evaluarMes(anio: number, mes: number, estaAbierto: (d: Date) => boolean): EvaluacionMes {
  const diasEnMes = new Date(anio, mes + 1, 0).getDate();
  let abiertos = 0;
  let finesTotales = 0;
  let finesAbiertos = 0;
  const diasPorSemana: Record<number, { total: number; abiertos: number }> = {};

  for (let dia = 1; dia <= diasEnMes; dia++) {
    const d = new Date(anio, mes, dia);
    const abierto = estaAbierto(d);
    if (abierto) abiertos++;

    const semana = semanaDelMes(anio, mes, dia);
    if (!diasPorSemana[semana]) diasPorSemana[semana] = { total: 0, abiertos: 0 };
    diasPorSemana[semana].total++;
    if (abierto) diasPorSemana[semana].abiertos++;

    if (d.getDay() === 6) { // sábado: representa el fin de semana con el domingo siguiente
      finesTotales++;
      const domingo = new Date(anio, mes, dia + 1);
      if (abierto || estaAbierto(domingo)) finesAbiertos++;
    }
  }

  const cerradoCompleto = abiertos === 0;

  // Solo se exige el mínimo semanal en semanas con al menos 4 días dentro de
  // este mes (evita falsos positivos en semanas de borde muy cortas).
  const semanasIncumplidas = cerradoCompleto ? 0 : Object.values(diasPorSemana)
    .filter(s => s.total >= 4 && s.abiertos < MIN_DIAS_ABIERTOS_SEMANA).length;

  const pct = abiertos / diasEnMes;

  return {
    anio, mes, diasEnMes, diasAbiertos: abiertos, pct, cerradoCompleto,
    finesDeSemanaAbiertos: finesAbiertos, finesDeSemanaTotales: finesTotales,
    semanasIncumplidas,
    altaDisponibilidad: pct >= UMBRAL_ALTA_DISPONIBILIDAD_PCT,
  };
}

const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Evalúa un conjunto de días marcados como disponibles contra las reglas de la
 * plataforma, en una ventana móvil de 12 meses desde `desde` (por defecto, hoy).
 */
export function evaluarDisponibilidad(diasDisponibles: string[], desde: Date = new Date()): EvaluacionDisponibilidad {
  const irrestricto = diasDisponibles.length === 0;
  const set = new Set(diasDisponibles);
  const estaAbierto = (d: Date) => irrestricto || set.has(isoDate(d));

  const inicio = new Date(desde.getFullYear(), desde.getMonth(), 1);
  const meses: EvaluacionMes[] = [];
  for (let i = 0; i < 12; i++) {
    const cursor = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    meses.push(evaluarMes(cursor.getFullYear(), cursor.getMonth(), estaAbierto));
  }

  const totalDias = meses.reduce((s, m) => s + m.diasEnMes, 0);
  const totalAbiertos = meses.reduce((s, m) => s + m.diasAbiertos, 0);
  const pctAnual = totalDias > 0 ? totalAbiertos / totalDias : 1;
  const mesesCerrados = meses.filter(m => m.cerradoCompleto).length;

  const problemas: Problema[] = [];

  if (!irrestricto) {
    for (const m of meses) {
      if (m.cerradoCompleto) continue;
      if (m.semanasIncumplidas > 0) {
        problemas.push({
          regla: 'minimo_semanal',
          detalle: `${NOMBRE_MES[m.mes]} de ${m.anio}: al menos una semana tiene menos de ${MIN_DIAS_ABIERTOS_SEMANA} días abiertos.`,
        });
      }
      if (m.finesDeSemanaTotales > 0 && m.finesDeSemanaAbiertos < MIN_FINES_DE_SEMANA_MES) {
        problemas.push({
          regla: 'fines_de_semana',
          detalle: `${NOMBRE_MES[m.mes]} de ${m.anio}: solo ${m.finesDeSemanaAbiertos} de ${m.finesDeSemanaTotales} fines de semana están disponibles (mínimo ${MIN_FINES_DE_SEMANA_MES}).`,
        });
      }
    }

    if (mesesCerrados > MAX_MESES_CERRADOS_ANIO) {
      problemas.push({
        regla: 'meses_cerrados',
        detalle: `Tienes ${mesesCerrados} meses completamente cerrados en los próximos 12 meses (máximo permitido: ${MAX_MESES_CERRADOS_ANIO}).`,
      });
    }

    if (pctAnual < MIN_DISPONIBILIDAD_ANUAL_PCT) {
      problemas.push({
        regla: 'disponibilidad_anual',
        detalle: `Solo tienes ${(pctAnual * 100).toFixed(0)}% de disponibilidad en los próximos 12 meses (mínimo ${(MIN_DISPONIBILIDAD_ANUAL_PCT * 100).toFixed(0)}%).`,
      });
    }
  }

  return { meses, pctAnual, mesesCerrados, problemas, cumple: problemas.length === 0 };
}

/** true si el mes actual (el primero de la ventana evaluada) supera el umbral de alta disponibilidad. */
export function tieneAltaDisponibilidadEsteMes(diasDisponibles: string[], hoy: Date = new Date()): boolean {
  if (diasDisponibles.length === 0) return true; // sin restricción = 100%
  const evalua = evaluarDisponibilidad(diasDisponibles, hoy);
  return evalua.meses[0]?.altaDisponibilidad ?? false;
}
