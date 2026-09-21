'use client';
import { useEffect, useState } from 'react';
import { IconUser, IconCoin } from '@/components/Icons';
import { TIPO_VEHICULO_LABELS } from '@/lib/rentabilidad';

type Lead = {
  id: number; nombre: string; correo: string; celular: string;
  tipo_vehiculo: string; origen: string; created_at: string;
};

// `tipo_vehiculo` llega como texto libre desde la tabla de leads (puede ser un tipo viejo o
// vacío), por eso el Record es de string y el llamador cae al valor crudo si no lo reconoce.
// La lista sale de lib/rentabilidad.ts: era una tercera copia a mano y se habría quedado sin
// 'Económico' ni 'Pick up' justo cuando esos son los dos segmentos nuevos.
const TIPO_LABELS: Record<string, string> = TIPO_VEHICULO_LABELS;

export default function LeadsPropietariosPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch('/api/leads-propietarios', { cache: 'no-store' });
      if (!res.ok) { setError('No se pudieron cargar los leads.'); return; }
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      setError('Sin conexión — no se pudieron cargar los leads.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const copiarCorreos = async () => {
    const correos = leads.map(l => l.correo).join(', ');
    try {
      await navigator.clipboard.writeText(correos);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError('No se pudo copiar al portapapeles.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-ink flex items-center gap-2">
            <IconCoin size={16} className="text-accent" /> Leads de la calculadora de propietarios ({leads.length})
          </h2>
          <p className="text-ink/50 text-xs mt-0.5">Personas que simularon su vehículo y dejaron sus datos para remarketing.</p>
        </div>
        {leads.length > 0 && (
          <button onClick={copiarCorreos}
            className="text-xs border border-accent/30 text-accent px-3 py-2 rounded-xl hover:bg-accent-light transition font-medium">
            {copiado ? '✓ Correos copiados' : 'Copiar todos los correos'}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/25 rounded-xl px-4 py-3 text-sm text-danger flex items-center justify-between">
          {error}
          <button onClick={cargar} className="text-xs font-semibold underline">Reintentar</button>
        </div>
      )}

      {cargando ? (
        <div className="text-center py-14 text-ink/50 text-sm">Cargando…</div>
      ) : leads.length === 0 ? (
        <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
          <IconUser size={40} className="text-ink/20 mx-auto mb-3" />
          <p className="text-ink/50">Todavía no hay leads de la calculadora.</p>
        </div>
      ) : (
        <div className="bg-surface-2 rounded-2xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-ink/50 text-xs uppercase tracking-wide border-b border-border">
                <th className="px-4 py-3 font-semibold">Nombre</th>
                <th className="px-4 py-3 font-semibold">Correo</th>
                <th className="px-4 py-3 font-semibold">Celular</th>
                <th className="px-4 py-3 font-semibold">Categoría simulada</th>
                <th className="px-4 py-3 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{l.nombre}</td>
                  <td className="px-4 py-3 text-ink/70">{l.correo}</td>
                  <td className="px-4 py-3 text-ink/70">{l.celular}</td>
                  <td className="px-4 py-3 text-ink/70">{TIPO_LABELS[l.tipo_vehiculo] || l.tipo_vehiculo || '—'}</td>
                  <td className="px-4 py-3 text-ink/50 text-xs">{l.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
