'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { IconKey, IconCar } from '@/components/Icons';
import { useSession } from '@/contexts/SessionContext';
import { tomarDestino } from '@/lib/lugares';

type Rol = 'usuario' | 'propietario';

const CONTEXTO = {
  usuario: {
    titulo: 'Bienvenido de nuevo',
    subtitulo: 'Inicia sesión para buscar y reservar vehículos',
    boton: 'Entrar a mi cuenta',
  },
  propietario: {
    titulo: 'Bienvenido, propietario',
    subtitulo: 'Inicia sesión para gestionar tu flota y reservas',
    boton: 'Entrar al panel',
  },
};

export default function LoginPage() {
  const [rol, setRol] = useState<Rol>('usuario');
  const [form, setForm] = useState({ correo: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { setUser, refetch } = useSession();

  const ctx = CONTEXTO[rol];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error); return; }

    // Actualiza la sesión global de inmediato (navbar, polling) sin esperar al
    // re-fetch por cambio de ruta.
    setUser(data.user);
    refetch();

    const userRol = data.user.rol;
    // Si venía de reservar (reserva en curso guardada), retoma el pago.
    const destino = tomarDestino();
    if (destino && userRol === 'usuario') { router.push(destino); return; }

    if (userRol === 'admin') router.push('/dashboard/admin');
    else if (userRol === 'propietario') router.push('/dashboard/propietario');
    else router.push('/dashboard/usuario');
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-md space-y-4">

        {/* Logo */}
        <div className="flex justify-center mb-2">
          <div className="flex flex-col items-center gap-2">
            <LogoMark size={52} />
            <span className="text-ink font-bold text-xl">Drive<span className="text-accent">Pass</span></span>
          </div>
        </div>

        {/* Selector de rol */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setRol('usuario')}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition font-medium text-sm ${
              rol === 'usuario'
                ? 'border-accent bg-accent text-white shadow-lg shadow-accent/25'
                : 'border-border bg-surface-2 text-ink/60 hover:border-brand/30 hover:bg-surface'
            }`}
          >
            <IconKey size={22} />
            <span>Quiero alquilar</span>
          </button>
          <button
            type="button"
            onClick={() => setRol('propietario')}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition font-medium text-sm ${
              rol === 'propietario'
                ? 'border-brand bg-brand text-white shadow-lg shadow-brand/25'
                : 'border-border bg-surface-2 text-ink/60 hover:border-brand/30 hover:bg-surface'
            }`}
          >
            <IconCar size={22} />
            <span>Soy propietario</span>
          </button>
        </div>

        {/* Formulario */}
        <div className="bg-surface-2 rounded-3xl shadow-sm border border-border p-5 sm:p-7">
          <h1 className="text-lg font-bold text-ink mb-0.5">{ctx.titulo}</h1>
          <p className="text-ink/50 text-sm mb-5">{ctx.subtitulo}</p>

          {error && (
            <div className="bg-danger/10 text-danger px-4 py-2.5 rounded-xl mb-4 text-sm border border-danger/25">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                Correo electrónico
              </label>
              <input
                type="email" required autoComplete="email"
                className="w-full border border-border rounded-xl px-4 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={form.correo}
                onChange={e => setForm(f => ({ ...f, correo: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                Contraseña
              </label>
              <input
                type="password" required autoComplete="current-password"
                className="w-full border border-border rounded-xl px-4 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
              <div className="text-right mt-1.5">
                <Link href="/olvide-password" className="text-xs text-accent font-medium hover:text-accent-hover transition">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            </div>
            <button
              type="submit" disabled={loading}
              className={`w-full flex items-center justify-center gap-2 text-white py-3 rounded-xl font-bold transition shadow-md disabled:opacity-60 mt-1 ${
                rol === 'propietario'
                  ? 'bg-brand hover:bg-brand-hover shadow-brand/20'
                  : 'bg-accent hover:bg-accent-hover shadow-accent/20'
              }`}
            >
              <IconKey size={16} />
              {loading ? 'Entrando…' : ctx.boton}
            </button>
          </form>

          <p className="text-center text-sm text-ink/50 mt-5">
            ¿No tienes cuenta?{' '}
            <Link
              href={rol === 'propietario' ? '/registro?rol=propietario' : '/registro'}
              className="text-accent font-semibold hover:text-accent-hover transition"
            >
              Regístrate gratis
            </Link>
          </p>
        </div>

        {/* Acceso oculto admin */}
        <p className="text-center text-[11px] text-ink/20 mt-2">
          <Link href="/acceso-drivepass" className="hover:text-ink/40 transition">
            Equipo DrivePass
          </Link>
        </p>

      </div>
    </div>
  );
}
