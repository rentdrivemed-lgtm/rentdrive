'use client';
// «El cliente no pudo confirmar»: por qué, y seguimos.
//
// Decisión del dueño (sep-2026): la entrega NO se traba porque el cliente no tenga el
// celular a mano, esté de afán o no quiera revisar. Se deja constancia de por qué y el
// vehículo se entrega igual.
//
// Lo que NO hace, y es el punto: no marca al cliente como conforme. El acta dirá que no
// confirmó y con qué motivo, en vez de afirmar una conformidad que no hubo. Esa es toda
// la diferencia entre una constancia y una firma falsa.
//
// Solo aparece cuando hace falta: si el cliente ya confirmó, no hay nada que justificar.
import { useState } from 'react';

type EstadoFase = { confirmado: boolean; constancia: string };

type Props = {
  salida: EstadoFase;
  entrada: EstadoFase;
  onDejar: (fase: 'salida' | 'entrada', motivo: string) => Promise<boolean>;
};

const MINIMO = 10;

export default function ConstanciaCliente({ salida, entrada, onDejar }: Props) {
  const [abierta, setAbierta] = useState<'salida' | 'entrada' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const fases: { clave: 'salida' | 'entrada'; etiqueta: string; estado: EstadoFase }[] = [
    { clave: 'salida', etiqueta: 'la entrega', estado: salida },
    { clave: 'entrada', etiqueta: 'la devolución', estado: entrada },
  ];

  // Solo las que ni están confirmadas ni tienen ya su constancia.
  const pendientes = fases.filter(f => !f.estado.confirmado && !f.estado.constancia);
  const conConstancia = fases.filter(f => !!f.estado.constancia);

  if (pendientes.length === 0 && conConstancia.length === 0) return null;

  const guardar = async (fase: 'salida' | 'entrada') => {
    setGuardando(true);
    const ok = await onDejar(fase, motivo.trim());
    setGuardando(false);
    if (ok) { setAbierta(null); setMotivo(''); }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-surface/60 p-3 space-y-2">
      {conConstancia.map(f => (
        <p key={f.clave} className="text-[11px] text-ink/60">
          <span className="font-semibold">Constancia de {f.etiqueta}:</span> {f.estado.constancia}
        </p>
      ))}

      {pendientes.map(f => (
        <div key={f.clave}>
          {abierta === f.clave ? (
            <div className="space-y-2">
              <p className="text-[11px] text-ink/70">
                ¿Por qué no pudo confirmar el cliente? Quedará escrito en el acta.
              </p>
              <textarea
                rows={2}
                className="w-full border border-border rounded-lg px-2 py-1.5 text-[11px] bg-surface"
                placeholder="Ej: el cliente no traía el celular y pidió recibir el carro igual"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setAbierta(null); setMotivo(''); }}
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-ink/60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={motivo.trim().length < MINIMO || guardando}
                  onClick={() => guardar(f.clave)}
                  className="flex-1 rounded-lg bg-accent px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  {guardando ? 'Guardando…' : 'Dejar constancia'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setAbierta(f.clave); setMotivo(''); }}
              className="text-[11px] text-ink/50 hover:text-ink/80 underline"
            >
              El cliente no pudo confirmar {f.etiqueta}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
