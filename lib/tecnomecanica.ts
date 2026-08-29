// Exención de revisión técnico-mecánica (tecnomecánica) para vehículos particulares nuevos.
//
// Base legal: Ley 2294 de 2023 (Plan Nacional de Desarrollo 2022-2026), reglamentada por el
// Ministerio de Transporte, redujo de 6 a 5 años la exención de la primera revisión
// técnico-mecánica para vehículos particulares nuevos: "la primera revisión se realiza a los
// 5 años desde la fecha de matrícula". Antes de los 5 años, un vehículo particular NO requiere
// tecnomecánica; a partir del 5º año se vuelve obligatoria.
//
// Limitación de datos conocida: la plataforma no guarda la fecha exacta de matrícula del
// vehículo, solo el año-modelo (`vehiculos.anio`). Usamos `anio` como aproximación razonable
// de la fecha de matrícula real (simplificación documentada, no exacta: un vehículo modelo
// 2022 pudo matricularse en 2021 o 2022, etc.).
//
// Diseño fail-safe (no fail-open): si no hay dato confiable de año, se EXIGE tecnomecánica por
// defecto, para no relajar un requisito legal por falta de información. Esto incluye años
// FUTUROS no confiables (más de 1 año adelante de hoy): un `anio` así de lejano no corresponde
// a un "vehículo modelo próximo año" real (práctica habitual de la industria es vender el
// modelo del año siguiente antes de que termine el año actual, nunca más allá de eso), así
// que en vez de tratarlo como "recién matriculado" y eximirlo, se trata como dato no
// confiable (igual que un año faltante o absurdamente viejo) y se exige tecnomecánica.

/**
 * Determina si un vehículo requiere tecnomecánica según su año-modelo (aproximación de la
 * fecha de matrícula) y la fecha de referencia dada.
 *
 * @param anio Año-modelo del vehículo (aproximación de la fecha de matrícula).
 * @param hoy Fecha de referencia para calcular la antigüedad (inyectable para tests/determinismo;
 *            NO usa `new Date()` como default oculto sin poder overridearlo salvo por defecto).
 */
export function tecnoRequerida(anio: number | null | undefined, hoy: Date = new Date()): boolean {
  if (!anio || !Number.isFinite(anio) || anio < 1900) return true; // sin dato confiable → exigir por defecto (fail-safe)
  const anioMaximoConfiable = hoy.getFullYear() + 1; // margen: modelo del año siguiente, ya a la venta
  if (anio > anioMaximoConfiable) return true; // año futuro no confiable → exigir (fail-safe), nunca eximir
  const antiguedad = hoy.getFullYear() - anio;
  return antiguedad >= 5;
}
