'use client';
import { useCallback, useEffect, useRef } from 'react';
import Script from 'next/script';

// Botón "Continuar con Google" vía Google Identity Services (GIS) — NO usa el flujo
// de redirect con Client Secret: solo pedimos un ID token (JWT) firmado por Google
// y lo verificamos en /api/auth/google. Si el dueño aún no configuró su proyecto de
// Google Cloud (NEXT_PUBLIC_GOOGLE_CLIENT_ID vacío), el componente no renderiza nada
// — no debe romper /login ni /registro para nadie mientras tanto.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

type GoogleUser = { id: number; nombre: string; correo: string; rol: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type Props = {
  /** Rol elegido en el formulario (solo aplica si Google crea una cuenta nueva). */
  rol?: 'usuario' | 'propietario';
  onSuccess: (user: GoogleUser) => void;
  onError: (mensaje: string) => void;
};

export default function GoogleAuthButton({ rol, onSuccess, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // El callback de Google se registra una sola vez (al inicializar), así que leemos
  // el rol vigente desde un ref en vez de re-inicializar el botón en cada cambio.
  const rolRef = useRef(rol);
  useEffect(() => { rolRef.current = rol; }, [rol]);

  const handleCredential = useCallback(async (response: { credential: string }) => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential, rol: rolRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { onError(data.error || 'No pudimos iniciar sesión con Google.'); return; }
      onSuccess(data.user);
    } catch {
      onError('Sin conexión — revisa tu internet e intenta de nuevo.');
    }
  }, [onSuccess, onError]);

  const initGoogle = useCallback(() => {
    if (!GOOGLE_CLIENT_ID || !window.google || !containerRef.current) return;
    window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
    containerRef.current.innerHTML = '';
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'center',
      width: Math.min(containerRef.current.offsetWidth || 320, 400),
    });
  }, [handleCredential]);

  useEffect(() => {
    if (window.google) initGoogle();
  }, [initGoogle]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={initGoogle} />
      <div ref={containerRef} className="w-full flex justify-center" />
    </>
  );
}
