'use client';
// Aviso fijo de «tienes un contrato pendiente de firma», para el panel del cliente y
// el del propietario.
//
// El documento se emite al crear la cuenta (app/api/auth/registro) o lo habilita el
// equipo desde el panel, pero SE FIRMA ACÁ: desde la cuenta de la propia persona, en
// su propio teléfono. Este aviso es lo que la lleva hasta la pantalla de firma
// (/contratos/<id>), que es la misma que ya se usa para los contratos de una reserva.
//
// No se pinta nada mientras no haya nada que firmar: a quien ya firmó —y a las cuentas
// a las que todavía no se les ha emitido el documento— no se les muestra ningún aviso.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconShield } from '@/components/Icons';

type Faltante = { ruta: string; etiqueta: string };
type Estado = {
  tipo: string | null;
  titulo: string;
  contratoId: number | null;
  numero: string;
  firmadoPorTitular: boolean;
  completo: boolean;
  faltantes: Faltante[];
};

export default function AvisoVinculacion({ className = '' }: { className?: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [borrador, setBorrador] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch('/api/contratos/vinculacion')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (vivo && d?.estado) { setEstado(d.estado); setBorrador(!!d.borradorSinRevisar); } })
      .catch(() => { /* el aviso es accesorio: si falla, no se muestra nada */ });
    return () => { vivo = false; };
  }, []);

  // Nada que mostrar: no le toca contrato, aún no se le ha emitido, o ya lo firmó.
  if (!estado || !estado.tipo || estado.contratoId === null || estado.firmadoPorTitular) return null;

  // Si al perfil le faltan datos que van EN el documento, firmarlo identificaría al
  // titular con huecos. Se le manda a completar el perfil primero.
  const faltan = estado.faltantes.length > 0;

  return (
    <div className={`rounded-2xl border border-warning/30 bg-warning/5 p-4 sm:p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5 text-warning"><IconShield /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Tienes un contrato pendiente de firma</p>
          <p className="text-xs text-ink/70 mt-1">
            {estado.titulo}{estado.numero ? ` · ${estado.numero}` : ''}. Para poder operar necesitas leerlo y firmarlo.
            Puedes hacerlo desde aquí, en tu propio celular.
          </p>

          {borrador && (
            <p className="text-[11px] text-ink/50 mt-2">
              El texto está en revisión legal; se te avisará si cambia antes de tu firma.
            </p>
          )}

          {faltan ? (
            <>
              <p className="text-xs text-ink/70 mt-3">
                Antes de firmar, completa estos datos de tu perfil: {estado.faltantes.map(f => f.etiqueta).join(', ')}.
              </p>
              <Link
                href="/completar-perfil"
                className="inline-block mt-3 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90"
              >
                Completar mi perfil
              </Link>
            </>
          ) : (
            <Link
              href={`/contratos/${estado.contratoId}`}
              className="inline-block mt-3 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90"
            >
              Leer y firmar ahora
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
