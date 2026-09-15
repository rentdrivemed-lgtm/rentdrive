// Reglas sobre el TITULAR de una reserva creada en el punto de atención.
//
// Decisión de producto (Victor, sep-2026): no existen reservas sin cuenta. El
// admin busca al cliente por cédula o correo y, si no tiene cuenta, se le crea en
// el momento. El motivo es de costo, no de gusto: `reservas.usuario_id` es NOT NULL
// con FK a `usuarios` y hay INNER JOINs contra esa tabla en media docena de
// archivos (listados, contabilidad, operaciones), así que un "titular suelto"
// obligaría a tocar todo eso.
//
// Módulo compartido por app/api/admin/clientes (búsqueda) y app/api/admin/reservas
// (creación), para que ambos juzguen igual qué cuenta sirve y qué le falta.
import { validarDireccion, validarCiudad, validarNombreContacto, validarTelefonoContacto } from './validacion';

/** Últimos 4 caracteres, con el resto enmascarado. '' si no hay dato. */
export function pistaDato(valor: string | null | undefined): string {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  if (v.length <= 4) return '•'.repeat(v.length);
  return `•••${v.slice(-4)}`;
}

/**
 * Iniciales del nombre ("Víctor Hugo Navarro" → "V. H. N."). '' si no hay dato.
 *
 * La búsqueda de cliente (GET /api/admin/clientes) devuelve esto y NO el nombre
 * completo. El motivo es de exposición, no de desconfianza en el empleado: la
 * búsqueda es por documento exacto, los números de cédula colombianos son
 * secuenciales y circulan filtrados en listas, así que devolver nombre + correo
 * convertiría el endpoint en un traductor de "cédula → identidad + buzón" para
 * quien tenga la sección "reservas" (nivel secretaria), que justamente NO tiene el
 * área "usuarios". Con la persona enfrente y su documento en la mano, iniciales +
 * últimos 4 del documento + últimos 4 del celular alcanzan de sobra para confirmar
 * que la cuenta encontrada es la suya, que es lo único que el flujo necesita.
 */
export function inicialesNombre(valor: string | null | undefined): string {
  const partes = String(valor ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (partes.length === 0) return '';
  return partes.map(p => `${p[0].toUpperCase()}.`).join(' ');
}

/** Correo enmascarado ("juan.perez@gmail.com" → "j•••@gmail.com"). '' si no hay dato. */
export function pistaCorreo(valor: string | null | undefined): string {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  const arroba = v.lastIndexOf('@');
  if (arroba <= 0) return '•••';
  return `${v[0]}•••${v.slice(arroba)}`;
}

/** Campos del perfil que el gate `perfilIncompleto` (lib/perfil.ts) exige para reservar. */
export function camposDePerfilQueFaltan(f: {
  tipo_documento?: string | null; documento_identidad?: string | null; fecha_nacimiento?: string | null;
}): string[] {
  const faltan: string[] = [];
  if (!String(f.tipo_documento ?? '').trim()) faltan.push('tipo_documento');
  if (!String(f.documento_identidad ?? '').trim()) faltan.push('documento_identidad');
  if (!String(f.fecha_nacimiento ?? '').trim()) faltan.push('fecha_nacimiento');
  return faltan;
}

/**
 * true si hay que pedirle al admin dirección/ciudad/contacto de emergencia.
 * Misma regla que `resolverDatosOperacion` (lib/reserva-core.ts): un valor legacy
 * guardado que YA no pasa las validaciones de hoy cuenta como faltante.
 */
export function faltanDatosDeOperacion(f: { direccion?: string | null; ciudad?: string | null; contacto_emergencia?: string | null }): boolean {
  let em: { nombre?: string; telefono?: string } = {};
  try { em = JSON.parse(f.contacto_emergencia || '{}') || {}; } catch { em = {}; }
  return (
    validarDireccion(String(f.direccion ?? '')) !== null ||
    validarCiudad(String(f.ciudad ?? '')) !== null ||
    validarNombreContacto(String(em.nombre ?? '')) !== null ||
    validarTelefonoContacto(String(em.telefono ?? '').replace(/\D/g, '')) !== null
  );
}

/**
 * Motivo por el que una cuenta encontrada NO sirve como titular, o '' si sí sirve.
 *
 * Se exige `rol = 'usuario'` igual que la vía pública (POST /api/reservas solo deja
 * reservar a ese rol): el mostrador no es el lugar para inventar una política de
 * roles distinta. Un propietario que quiera alquilar necesita una cuenta de cliente
 * aparte, como ya pasa hoy en la app.
 */
export function motivoNoReservable(f: { rol: string; estado_cuenta: string }): string {
  if (f.rol === 'admin') return 'Esa cuenta es del equipo DrivePass, no de un cliente.';
  if (f.rol !== 'usuario') return 'Esa cuenta está registrada como propietario de vehículos, no como cliente. El titular de una reserva debe tener cuenta de cliente.';
  if (f.estado_cuenta === 'archivada') return 'Esa cuenta está archivada. Desarchívala desde Usuarios antes de reservar a su nombre.';
  if (f.estado_cuenta !== 'activa') return 'Esa cuenta está desactivada. Actívala desde Usuarios antes de reservar a su nombre.';
  return '';
}

/** Edad cumplida a hoy. 0 si la fecha es vacía o inválida. */
export function calcularEdad(fechaNac: string): number {
  if (!fechaNac) return 0;
  const hoy = new Date();
  const nac = new Date(fechaNac);
  if (Number.isNaN(nac.getTime())) return 0;
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

export const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
