'use client';
import { useState } from 'react';
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { IconKey, IconArrowL } from '@/components/Icons';

export default function OlvidePasswordPage() {
  const [correo, setCorreo] = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!correo.trim()) { setError('Ingresa tu correo.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/olvide-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No pudimos procesar la solicitud. Intenta de nuevo.'); return; }
      setEnviado(true);
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
          <h1 className="text-lg font-bold text-ink mb-0.5">¿Olvidaste tu contraseña?</h1>
          <p className="text-ink/50 text-sm mb-5">Te enviamos un enlace a tu correo para crear una nueva.</p>

          {enviado ? (
            <div className="bg-success/10 text-success px-4 py-3 rounded-xl text-sm border border-success/25">
              Si ese correo existe en RentDrive, te enviamos un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada (y spam).
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="bg-danger/10 text-danger px-4 py-2.5 rounded-xl text-sm border border-danger/25">{error}</div>
              )}
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Correo electrónico</label>
                <input type="email" required autoComplete="email"
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={correo} onChange={e => setCorreo(e.target.value)} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60">
                <IconKey size={16} /> {loading ? 'Enviando…' : 'Enviar enlace'}
              </button>
            </form>
          )}

          <p className="text-center text-sm text-ink/50 mt-5">
            <Link href="/login" className="text-accent font-semibold hover:text-accent-hover transition inline-flex items-center gap-1">
              <IconArrowL size={13} /> Volver a iniciar sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
