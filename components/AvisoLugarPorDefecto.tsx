'use client';
// «No elegiste dónde recoger el carro»: te proponemos el punto de atención.
//
// Sale ANTES de crear la reserva, no después. Hasta sep-2026 quien llegaba al checkout
// sin lugar recibía un 400 seco —«Indica el lugar y la hora de recogida»— sobre una
// pantalla que ni siquiera tiene selector de lugar, así que se quedaba sin salida: ni
// podía elegir ahí ni sabía a dónde volver.
//
// No decide por nadie a su espalda: se le dice exactamente qué se va a tomar, dónde
// queda y a qué hora, y puede cambiar la hora o irse a elegir otro lugar. Lo que acepte
// queda marcado en la reserva como asignado por defecto, no como elegido por él.
import { useState } from 'react';
import { IconPin } from '@/components/Icons';

type Props = {
  direccion: string;
  horaPropuesta: string;
  /** Acepta el punto de atención a la hora indicada. */
  onAceptar: (hora: string) => void;
  /** Se va a elegir otro lugar (vuelve a la ficha del vehículo, que sí tiene selector). */
  onElegirOtro: () => void;
};

export default function AvisoLugarPorDefecto({ direccion, horaPropuesta, onAceptar, onElegirOtro }: Props) {
  const [hora, setHora] = useState(horaPropuesta);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-4"
      role="dialog" aria-modal="true" aria-labelledby="aviso-lugar-titulo"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="shrink-0 mt-0.5 text-accent"><IconPin size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="aviso-lugar-titulo" className="text-base font-bold text-ink">
              ¿Recoges y entregas en nuestro punto de atención?
            </h2>
            <p className="text-sm text-ink/70 mt-1.5">
              No elegiste un lugar, así que tomaremos el <strong>Punto de atención San Joaquín</strong> para
              recoger y para entregar el carro.
            </p>
            <p className="text-xs text-ink/55 mt-1.5">{direccion} · Sin costo de traslado</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-[11px] font-semibold text-ink/60 mb-1">¿A qué hora lo recoges?</label>
          <input
            type="time"
            className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface"
            value={hora}
            onChange={e => setHora(e.target.value)}
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 mt-5">
          <button
            type="button"
            onClick={onElegirOtro}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-ink/70 hover:bg-ink/5"
          >
            Elegir otro lugar
          </button>
          <button
            type="button"
            disabled={!hora}
            onClick={() => onAceptar(hora)}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            Aceptar
          </button>
        </div>

        <p className="text-[11px] text-ink/50 mt-3">
          Si eliges otro lugar puede haber un costo de traslado, que verás antes de pagar.
        </p>
      </div>
    </div>
  );
}
