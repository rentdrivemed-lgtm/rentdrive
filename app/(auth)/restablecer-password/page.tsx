'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { IconKey } from '@/components/Icons';

function RestablecerForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') || '';
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) { setError('Este enlace no es válido — solicita uno nuevo desde "Olvidé mi contraseña".'); return; }
    if (nueva.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (nueva !== confirmar) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/restablecer-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, nueva_password: nueva }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No pudimos restablecer tu contraseña. Intenta de nuevo.'); return; }
      setOk(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center mb-2">
          <div className="flex flex-col items-center gap-2">
            <LogoMark size={52} />
            <span className="text-ink font-bold text-xl">Drive<span className="text-accent">Pass</span></span>
          </div>
        </div>

        <div className="bg-surface-2 rounded-3xl shadow-sm border border-border p-5 sm:p-7">
          <h1 className="text-lg font-bold text-ink mb-0.5">Crea una nueva contraseña</h1>
          <p className="text-ink/50 text-sm mb-5">Elige una contraseña de al menos 6 caracteres.</p>

          {ok ? (
            <div className="bg-success/10 text-success px-4 py-3 rounded-xl text-sm border border-success/25">
              ¡Listo! Tu contraseña fue actualizada. Te llevamos a iniciar sesión…
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="bg-danger/10 text-danger px-4 py-2.5 rounded-xl text-sm border border-danger/25">{error}</div>
              )}
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Nueva contraseña</label>
                <input type="password" required autoComplete="new-password"
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={nueva} onChange={e => setNueva(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Confirmar contraseña</label>
                <input type="password" required autoComplete="new-password"
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={confirmar} onChange={e => setConfirmar(e.target.value)} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60">
                <IconKey size={16} /> {loading ? 'Guardando…' : 'Guardar nueva contraseña'}
              </button>
            </form>
          )}

          <p className="text-center text-sm text-ink/50 mt-5">
            <Link href="/login" className="text-accent font-semibold hover:text-accent-hover transition">Volver a iniciar sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function RestablecerPasswordPage() {
  return (
    <Suspense>
      <RestablecerForm />
    </Suspense>
  );
}
