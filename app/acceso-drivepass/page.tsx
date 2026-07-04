'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogoMark } from '@/components/Logo';
import { IconShield, IconKey } from '@/components/Icons';

export default function AccesoAdminPage() {
  const [form, setForm] = useState({ correo: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Credenciales incorrectas'); return; }
      if (data.user.rol !== 'admin') {
        setError('Esta área es exclusiva del equipo DrivePass.');
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        return;
      }
      router.push('/dashboard/admin');
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-brand flex items-center justify-center px-4 py-8">

      {/* Fondo decorativo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-accent/10" />
      </div>

      <div className="relative w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mb-4">
            <LogoMark size={44} />
          </div>
          <h1 className="text-white font-bold text-2xl">DrivePass</h1>
          <p className="text-white/40 text-sm mt-1">Acceso interno · Equipo administrativo</p>
        </div>

        {/* Aviso de área restringida */}
        <div className="flex items-center gap-2 bg-accent/15 border border-accent/30 rounded-xl px-4 py-3 mb-6">
          <IconShield size={16} className="text-accent flex-shrink-0" />
          <p className="text-white/70 text-xs">
            Área restringida. Solo personal autorizado de DrivePass.
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-3xl p-6">
          {error && (
            <div className="bg-danger/100/20 border border-danger/30 text-danger px-4 py-2.5 rounded-xl mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-white/60 mb-1.5 uppercase tracking-wide">
                Correo corporativo
              </label>
              <input
                type="email" required autoComplete="email"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/40"
                placeholder="admin@drivepass.co"
                value={form.correo}
                onChange={e => setForm(f => ({ ...f, correo: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/60 mb-1.5 uppercase tracking-wide">
                Contraseña
              </label>
              <input
                type="password" required autoComplete="current-password"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/40"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-lg shadow-accent/30 disabled:opacity-60 mt-2"
            >
              <IconKey size={16} />
              {loading ? 'Verificando…' : 'Ingresar al panel'}
            </button>
          </form>
        </div>

        {/* Footer discreto */}
        <p className="text-center text-white/20 text-[11px] mt-6">
          DrivePass Medellín · Panel de administración
        </p>
      </div>
    </div>
  );
}
