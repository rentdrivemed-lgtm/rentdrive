import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

const SECRET = process.env.JWT_SECRET || 'rentdrive-secret-2024';

// Red de seguridad: en producción es obligatorio configurar JWT_SECRET (ya está
// puesto en Railway). El chequeo se hace en el primer USO real (no al cargar el
// módulo) porque `next build` evalúa los route handlers con NODE_ENV=production
// sin tener las variables de runtime disponibles — un throw a nivel de módulo
// rompería el build. Así, si faltara en producción, firmar/verificar truena
// explícito en vez de usar en silencio el secreto de desarrollo hardcodeado.
function exigirSecretoEnProduccion(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET no está configurado. Es obligatorio en producción.');
  }
}

export type UserPayload = { id: number; nombre: string; correo: string; rol: 'admin' | 'propietario' | 'usuario'; };
export function signToken(payload: UserPayload): string { exigirSecretoEnProduccion(); return jwt.sign(payload, SECRET, { expiresIn: '7d' }); }
export function verifyToken(token: string): UserPayload | null { exigirSecretoEnProduccion(); try { return jwt.verify(token, SECRET) as UserPayload; } catch { return null; } }
export async function getCurrentUser(): Promise<UserPayload | null> { const cookieStore = await cookies(); const token = cookieStore.get('token')?.value; if (!token) return null; return verifyToken(token); }