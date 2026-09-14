// Filtro de campos sensibles de la tabla `vehiculos` antes de responder por API.
//
// Los GET de vehículos/buses (GET /api/vehiculos, GET /api/vehiculos/[id],
// GET /api/buses, GET /api/buses/[id]) son PÚBLICOS: los consume la home, la vitrina, la
// ficha del vehículo y la página de pago sin sesión. Esos endpoints hacen `SELECT v.*` y
// serializaban la fila completa, así que cualquiera sin cookie recibía también
// `documentos` — el JSON con las URLs de la tarjeta de propiedad y el SOAT del
// propietario (documentos con nombre, cédula, dirección, placa y número de motor/chasis),
// más su nota/estado de revisión y el `valor_comercial` declarado del carro.
//
// Regla: esos campos solo salen si quien pregunta es el propietario dueño del vehículo o
// un admin con el área correspondiente ('vehiculos' para carros, 'buses' para buses).
// Para todos los demás (anónimo u otro usuario autenticado) se eliminan de la respuesta.
//
// Se filtra por lista negra a propósito, y no proyectando columnas en el SELECT: la fila
// de `vehiculos` alimenta media docena de vistas (vitrina, ficha, dashboard del
// propietario, panel admin, buses) que leen muchos campos distintos, y una lista blanca
// silenciosamente incompleta rompería alguna de ellas. IMPORTANTE: al agregar a la tabla
// una columna nueva con datos privados del propietario, hay que sumarla ACÁ.

/** Campos de `vehiculos` que nunca deben salir hacia alguien no autorizado. */
export const CAMPOS_SENSIBLES_VEHICULO = [
  'documentos',
  'documentos_revisiones',
  'documentos_nota',
  'documentos_estado',
  'valor_comercial',
  // Nota interna de moderación (p. ej. el motivo por el que la IA marcó una foto). No es
  // para el público: describe el juicio del equipo sobre la publicación de esa persona.
  // No siempre queda vacía cuando `contenido_revision` vuelve a 0 — solo se limpia si el
  // admin aprueba a mano; `reprocesar-placas` la escribe sin pasar por ese ciclo.
  'contenido_revision_motivo',
] as const;

/** Quién está preguntando, ya resuelto por la ruta (sesión + permiso de área). */
export type ContextoVehiculo = {
  /** id del usuario de la sesión, o null si no hay sesión. */
  usuarioId: number | null;
  /** true si es un admin con el área correspondiente ('vehiculos' o 'buses'). */
  esAdminConPermiso: boolean;
};

/** true si este usuario puede ver los campos sensibles de ESTA fila. */
export function puedeVerCamposSensibles(fila: Record<string, unknown>, ctx: ContextoVehiculo): boolean {
  if (ctx.esAdminConPermiso) return true;
  return ctx.usuarioId !== null && Number(fila.propietario_id) === ctx.usuarioId;
}

/** Copia de la fila sin los campos sensibles (no muta el original). */
export function sinCamposSensibles(fila: Record<string, unknown>): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...fila };
  for (const campo of CAMPOS_SENSIBLES_VEHICULO) delete copia[campo];
  return copia;
}

/** Deja la fila intacta si el usuario está autorizado; si no, le quita los campos sensibles. */
export function filtrarVehiculo(fila: Record<string, unknown>, ctx: ContextoVehiculo): Record<string, unknown> {
  return puedeVerCamposSensibles(fila, ctx) ? fila : sinCamposSensibles(fila);
}

/** Igual que `filtrarVehiculo`, fila por fila (cada vehículo puede ser de otro dueño). */
export function filtrarVehiculos(filas: Record<string, unknown>[], ctx: ContextoVehiculo): Record<string, unknown>[] {
  return filas.map(f => filtrarVehiculo(f, ctx));
}
