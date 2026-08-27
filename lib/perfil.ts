// Gate de "perfil completo" — fuente de verdad real para poder reservar o publicar
// un vehículo. Nace del hueco que deja el login con Google (app/api/auth/google):
// crea la cuenta con password vacía y sin documento/fecha de nacimiento, así que
// esa persona nunca pasó por la validación de mayoría de edad ni tiene forma de
// volver a entrar sin Google. Se completa en app/api/auth/completar-perfil y se
// exige aquí, server-side, antes de las dos acciones que de verdad importan:
// reservar (app/api/reservas) y publicar un vehículo (app/api/vehiculos).
//
// Deliberadamente NO se exige para navegar/ver vehículos/chatear: solo para las
// dos mutaciones que requieren identidad real detrás.
import { getDb } from './db';

export const CODIGO_PERFIL_INCOMPLETO = 'perfil_incompleto';
export const MENSAJE_PERFIL_INCOMPLETO = 'Completa tu perfil antes de continuar.';

type FilaPerfil = {
  password: string | null;
  tipo_documento: string | null;
  documento_identidad: string | null;
  fecha_nacimiento: string | null;
};

/** true si falta password, tipo/número de documento o fecha de nacimiento. */
export function perfilIncompleto(userId: number): boolean {
  const db = getDb();
  const fila = db.prepare(
    'SELECT password, tipo_documento, documento_identidad, fecha_nacimiento FROM usuarios WHERE id = ?'
  ).get(userId) as FilaPerfil | undefined;
  if (!fila) return true;
  return !fila.password || !fila.tipo_documento || !fila.documento_identidad || !fila.fecha_nacimiento;
}
