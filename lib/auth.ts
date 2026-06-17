import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
const SECRET = process.env.JWT_SECRET || 'rentdrive-secret-2024';
export type UserPayload = { id: number; nombre: string; correo: string; rol: 'admin' | 'propietario' | 'usuario'; };
export function signToken(payload: UserPayload): string { return jwt.sign(payload, SECRET, { expiresIn: '7d' }); }
export function verifyToken(token: string): UserPayload | null { try { return jwt.verify(token, SECRET) as UserPayload; } catch { return null; } }
export async function getCurrentUser(): Promise<UserPayload | null> { const cookieStore = await cookies(); const token = cookieStore.get('token')?.value; if (!token) return null; return verifyToken(token); }