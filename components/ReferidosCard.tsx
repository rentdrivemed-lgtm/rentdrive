'use client';
import { useEffect, useState } from 'react';
import { IconCheck, IconSend } from '@/components/Icons';

export default function ReferidosCard() {
  const [codigo, setCodigo] = useState('');
  const [creditos, setCreditos] = useState(0);
  const [habilitado, setHabilitado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setCodigo(d.user?.codigo_referido || '');
      setCreditos(Number(d.user?.creditos_referido || 0));
      setHabilitado(!!d.user?.referido_habilitado);
    }).catch(() => {}).finally(() => setCargando(false));
  }, []);

  if (cargando || !habilitado || !codigo) return null;

  const link = typeof window !== 'undefined' ? `${window.location.origin}/registro?ref=${codigo}` : '';

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* el navegador puede bloquear el portapapeles, no es crítico */ }
  };

  const compartirWhatsapp = () => {
    const texto = `¡Únete a DrivePass con mi código ${codigo} y ambos ganamos descuento! ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
  };

  return (
    <div className="bg-gradient-to-br from-accent to-accent-hover rounded-2xl p-5 text-white shadow-lg shadow-accent/20">
      <p className="text-sm font-bold uppercase tracking-wide opacity-90">🎁 Invita y gana</p>
      <p className="text-sm opacity-90 mt-1">Comparte tu código — cuando tu amigo complete su primera reserva, ambos ganan crédito para su próximo alquiler.</p>

      <div className="mt-3 bg-white/15 rounded-xl px-4 py-2.5 flex items-center justify-between gap-2">
        <span className="font-mono font-bold text-lg tracking-wide">{codigo}</span>
        <button onClick={copiar} className="text-xs font-semibold bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition flex items-center gap-1 flex-shrink-0">
          {copiado ? <><IconCheck size={12} /> Copiado</> : 'Copiar link'}
        </button>
      </div>

      <div className="flex items-center justify-between mt-3">
        {creditos > 0 ? (
          <p className="text-sm font-semibold">Tienes ${creditos.toLocaleString('es-CO')} en créditos disponibles</p>
        ) : <span />}
        <button onClick={compartirWhatsapp} className="text-xs font-semibold bg-white text-accent px-3 py-1.5 rounded-lg hover:bg-white/90 transition flex items-center gap-1">
          <IconSend size={12} /> Compartir por WhatsApp
        </button>
      </div>
    </div>
  );
}
