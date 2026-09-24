'use client';
// Página pública (sin login) para que un cliente presencial guarde su tarjeta
// SIN que se le cobre nada — ver app/api/admin/enlaces-tarjeta (quien genera el
// link) y app/api/guardar-tarjeta/[token] (quien lo valida y guarda la fuente
// de pago). El admin manda este link por su cuenta (WhatsApp, SMS, etc.).
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { IconShield } from '@/components/Icons';
import { openCardTokenizer } from '@/lib/wompi-widget-client';

export default function GuardarTarjetaPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState('');
  const [invalido, setInvalido] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/guardar-tarjeta/${token}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => setNombre(data.nombre || ''))
      .catch(() => setInvalido(true))
      .finally(() => setCargando(false));
  }, [token]);

  const guardarTarjeta = async () => {
    setError('');
    setGuardando(true);
    let tokenRecibido = false;
    const liberarSiCierraSinGuardar = () => {
      window.removeEventListener('focus', liberarSiCierraSinGuardar);
      setTimeout(() => { if (!tokenRecibido) setGuardando(false); }, 500);
    };
    try {
      const publicKey = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY || '';
      await openCardTokenizer(publicKey, (source) => {
        tokenRecibido = true;
        window.removeEventListener('focus', liberarSiCierraSinGuardar);
        confirmar(source.token);
      });
      window.addEventListener('focus', liberarSiCierraSinGuardar);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el formulario de pago. Intenta de nuevo.');
      setGuardando(false);
    }
  };

  const confirmar = async (cardToken: string) => {
    try {
      const res = await fetch(`/api/guardar-tarjeta/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_token: cardToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No se pudo guardar la tarjeta.'); return; }
      setExito(true);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) {
    return <div className="max-w-md mx-auto px-4 py-20 text-center text-ink/50">Cargando…</div>;
  }

  if (invalido) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <p className="text-danger font-semibold mb-1">Este enlace ya no es válido.</p>
        <p className="text-sm text-ink/50">Pide uno nuevo en el punto de atención de RentDrive.</p>
      </div>
    );
  }

  if (exito) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">✓</span>
        </div>
        <h1 className="text-xl font-bold text-ink mb-1">¡Tarjeta guardada!</h1>
        <p className="text-sm text-ink/50">No se te cobró nada. Ya puedes cerrar esta página.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="bg-surface-2 rounded-2xl border border-border p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-brand-muted flex items-center justify-center mx-auto mb-4">
          <IconShield size={26} className="text-brand" />
        </div>
        <h1 className="text-lg font-bold text-ink mb-1">Hola{nombre ? `, ${nombre.split(' ')[0]}` : ''}</h1>
        <p className="text-sm text-ink/60 mb-6">
          RentDrive te pide guardar una tarjeta como respaldo de tu alquiler.
          <strong> No se te va a cobrar nada ahora.</strong> Vas a ingresar los datos
          directo en el formulario seguro de Wompi — nunca pasan por esta página.
        </p>

        {error && (
          <div className="bg-danger/10 border border-danger/25 text-danger text-sm px-3 py-2.5 rounded-xl mb-4 text-left">
            {error}
          </div>
        )}

        <button
          onClick={guardarTarjeta}
          disabled={guardando}
          className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-3 rounded-xl transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm"
        >
          {guardando ? 'Procesando…' : 'Guardar mi tarjeta'}
        </button>
      </div>
    </div>
  );
}
