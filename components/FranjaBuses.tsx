'use client';
// «¿Viajan en grupo?» — la puerta a los buses desde la portada.
//
// EL PROBLEMA QUE RESUELVE. DrivePass alquila carros sin conductor Y transporta grupos
// de 12 a 42 pasajeros, pero la portada solo hablaba de lo primero. Quien necesitaba un
// bus no tenía forma de enterarse: no iba a buscar «buses» en una página de alquiler de
// carros, y la vitrina de /buses solo la encontraba quien ya sabía que existía.
//
// POR QUÉ NO ES UN BANNER. Un letrero que diga «también tenemos buses» se ignora igual
// que cualquier otro letrero. Lo que sí para a alguien es la pregunta que ya se está
// haciendo: no piensa «necesito una buseta», piensa «somos treinta». Así que la franja
// pregunta eso, y responde en el acto con el vehículo que le corresponde —de las
// categorías REALES, no de un texto de marketing— antes de pedirle ningún clic.
//
// El número viaja en el enlace, así que /buses abre ya filtrado y nadie repite el dato.
import { useState } from 'react';
import Link from 'next/link';
import { BUS_CATEGORIAS } from '@/lib/busCotizador';
import { IconBus, IconUsers } from '@/components/Icons';

/** Atajos que cubren los casos típicos sin obligar a escribir un número. */
const ATAJOS = [8, 15, 25, 40];

const CAPACIDAD_MAX = Math.max(...BUS_CATEGORIAS.map(c => c.capacidadMax));

export default function FranjaBuses() {
  const [pasajeros, setPasajeros] = useState('');

  const n = Number(pasajeros);
  const valido = Number.isInteger(n) && n > 0;
  // La categoría sale del catálogo real (lib/busCotizador.ts), que es el mismo que usan
  // el cotizador y el panel. Si mañana cambian las capacidades, esta franja cambia sola.
  const categoria = valido ? BUS_CATEGORIAS.find(c => n >= c.capacidadMin && n <= c.capacidadMax) : undefined;
  const excede = valido && n > CAPACIDAD_MAX;

  const href = valido && categoria ? `/buses?pasajeros=${n}` : '/buses';

  return (
    // `bg-surface` y no `bg-brand-muted`: esa la usa la franja de SURA, que va justo
    // encima, y con el mismo fondo las dos se leerían como un solo bloque.
    <section aria-labelledby="franja-buses-titulo" className="bg-surface border-y border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-7 sm:py-8">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-8">

          <div className="flex items-start gap-3 lg:max-w-sm">
            <div className="w-[46px] h-[46px] rounded-2xl bg-accent-light flex items-center justify-center shrink-0">
              <IconBus size={22} className="text-accent" />
            </div>
            <div>
              <h2 id="franja-buses-titulo" className="font-bold text-lg text-ink leading-tight">¿Viajan en grupo?</h2>
              <p className="text-sm text-ink-soft mt-0.5">
                También movemos grupos de 12 a {CAPACIDAD_MAX} pasajeros, con conductor.
                Paseos, empresas, colegios y eventos.
              </p>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <label htmlFor="franja-buses-pasajeros" className="block text-[11px] font-semibold text-ink/60 uppercase tracking-wide mb-1.5">
              ¿Cuántas personas van?
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {ATAJOS.map(a => (
                <button
                  key={a} type="button"
                  onClick={() => setPasajeros(String(a))}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold border transition ${
                    pasajeros === String(a)
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface text-ink/70 border-border hover:bg-ink/5'
                  }`}
                >
                  {a}
                </button>
              ))}

              <input
                id="franja-buses-pasajeros"
                type="number" inputMode="numeric" min={1} max={999}
                placeholder="Otra"
                className="w-24 border border-border rounded-xl px-3 py-2 text-sm bg-surface"
                value={ATAJOS.includes(n) ? '' : pasajeros}
                onChange={e => setPasajeros(e.target.value)}
              />

              <Link
                href={href}
                className="ml-auto inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 transition"
              >
                <IconUsers size={15} />
                {valido && categoria ? 'Ver y cotizar' : 'Ver los buses'}
              </Link>
            </div>

            {/* La respuesta ANTES del clic: es lo que convierte «somos 30» en «entonces
                necesito un bus de 30-42» sin salir de la portada. */}
            <p className="text-xs mt-2.5 min-h-[1.25rem]" aria-live="polite">
              {categoria ? (
                <span className="text-ink/70">
                  Para {n} {n === 1 ? 'persona' : 'personas'} te sirve un{' '}
                  <strong className="text-ink">{categoria.nombre}</strong>. La cotización depende del
                  destino, y la calculas ahí mismo.
                </span>
              ) : excede ? (
                <span className="text-ink/70">
                  Para {n} personas hace falta más de un vehículo. Escríbenos y lo organizamos.
                </span>
              ) : (
                <span className="text-ink/45">Te decimos qué vehículo les sirve.</span>
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
