'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogoMark } from '@/components/Logo';
import { IconInbox, IconCheck, IconArrowL } from '@/components/Icons';
import { useSession } from '@/contexts/SessionContext';

// Pantalla "Verifica tu correo" — se muestra a cuentas nuevas creadas con
// correo+contraseña (app/api/auth/registro) mientras su correo siga pendiente
// de activación. El resto del sitio (navegar, ver vehículos, chatear) sigue
// funcionando sin pasar por acá: la autoridad real que exige esto es el
// servidor, en app/api/reservas y app/api/vehiculos (lib/verificacion-correo.ts)
// — esta pantalla es solo la forma cómoda de resolverlo. Mismo criterio que
// app/completar-perfil (perfil incompleto de cuentas Google).
//
// Si emailHabilitado() está apagado en el servidor (falta RESEND_API_KEY),
// `correo_pendiente` viene siempre en false — esta pantalla nunca aparece
// mientras el equipo no configure el envío real.

type MeUser = { id: number; nombre: string; correo: string; rol: string; correo_pendiente?: boolean };

function destinoPorRol(rol: string): string {
  if (rol === 'admin') return '/dashboard/admin';
  if (rol === 'propietario') return '/dashboard/propietario';
  return '/dashboard/usuario';
}

// Igual que en app/completar-perfil: solo se acepta un ?next= interno (evita
// un open redirect tras verificar).
function destinoSeguro(next: string | null, rol: string): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return destinoPorRol(rol);
}

const COOLDOWN_INICIAL_SEGUNDOS = 45;

function VerificarCorreoForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refetch } = useSession();

  const [cargando, setCargando] = useState(true);
  const [user, setUser] = useState<MeUser | null>(null);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('Te enviamos un código de 6 dígitos a tu correo al crear la cuenta.');
  const [verificando, setVerificando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (!vivo) return;
        const u = d?.user as MeUser | null;
        if (!u) { router.replace('/login'); return; }
        if (!u.correo_pendiente) {
          router.replace(destinoSeguro(searchParams.get('next'), u.rol));
          return;
        }
        setUser(u);
        setCargando(false);
      })
      .catch(() => { if (vivo) { setError('Sin conexión — revisa tu internet e intenta de nuevo.'); setCargando(false); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(codigo.trim())) {
      setError('El código son 6 dígitos.');
      return;
    }
    setVerificando(true);
    try {
      const res = await fetch('/api/auth/verificar-correo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setError(data.error || 'No pudimos verificar el código.'); return; }
      refetch();
      router.push(destinoSeguro(searchParams.get('next'), user?.rol || 'usuario'));
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setVerificando(false);
    }
  };

  const reenviar = async () => {
    if (cooldown > 0) return;
    setReenviando(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verificar-correo/reenviar', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No pudimos reenviar el código.'); return; }
      setCooldown(COOLDOWN_INICIAL_SEGUNDOS);
      setAviso(data.enviado ? 'Te enviamos un nuevo código a tu correo.' : 'No pudimos reenviarlo automáticamente — escríbele al equipo de RentDrive.');
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setReenviando(false);
    }
  };

  if (cargando) {
    return <div className="text-center py-20 text-ink/50">Cargando...</div>;
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center mb-1">
          <div className="flex flex-col items-center gap-2">
            <LogoMark size={48} />
            <span className="text-ink font-bold text-xl">Drive<span className="text-accent">Pass</span></span>
          </div>
        </div>

        <div className="bg-surface-2 rounded-3xl shadow-sm border border-border p-5 sm:p-7">
          <h1 className="text-lg font-bold text-ink mb-0.5 flex items-center gap-2">
            <IconInbox size={18} className="text-accent" /> Verifica tu correo
          </h1>
          <p className="text-ink/50 text-sm mb-5">
            {aviso} {user?.correo ? <span className="font-medium text-ink/70">({user.correo})</span> : null}
          </p>

          <form onSubmit={verificar} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Código de 6 dígitos</label>
              <input type="text" inputMode="numeric" maxLength={6} required
                value={codigo}
                onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full border border-border rounded-xl px-3 py-3 text-center text-2xl font-black tracking-[0.4em] text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>

            {error && (
              <div className="bg-danger/10 text-danger px-4 py-2.5 rounded-xl text-sm border border-danger/25">
                {error}
              </div>
            )}

            <button type="submit" disabled={verificando}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60">
              {verificando ? 'Verificando…' : 'Verificar y continuar'} {!verificando && <IconCheck size={16} />}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <button type="button" onClick={() => router.back()} className="text-ink/50 hover:text-ink flex items-center gap-1">
                <IconArrowL size={12} /> Volver
              </button>
              <button type="button" onClick={reenviar} disabled={reenviando || cooldown > 0}
                className="text-accent font-medium disabled:opacity-50 disabled:text-ink/50">
                {cooldown > 0 ? `Reenviar en ${cooldown}s` : reenviando ? 'Reenviando…' : 'Reenviar código'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function VerificarCorreoPage() {
  return (
    <Suspense>
      <VerificarCorreoForm />
    </Suspense>
  );
}
