'use client';
// Kilometraje, combustible e inventario del vehículo, con el carro delante.
//
// Es lo que hasta sep-2026 se llenaba A MANO en el acta impresa mientras estos mismos
// datos se tomaban en fotos desde la app. Ahora se anotan aquí una vez y el acta los
// imprime (ver lib/reporte-entrega.ts).
//
// Pensado para un celular en la calle, con una mano:
//   · el combustible es una fila de octavos que se toca, no un texto que se escribe;
//   · cada ítem del inventario son tres botones —bueno, regular, malo— y la nota solo
//     aparece cuando algo NO está bien, que es cuando hay algo que contar;
//   · se guarda solo, ítem a ítem: nadie pierde media revisión por cerrar la pantalla.
import { useState } from 'react';

export type ItemInventario = { estado: 'B' | 'R' | 'M'; nota: string };
export type Inventario = Record<string, ItemInventario>;

type Props = {
  titulo: string;
  items: readonly string[];
  kilometraje: number | null;
  combustible: number | null;
  inventario: Inventario;
  /** Guarda un trozo. Devuelve false si el servidor lo rechazó. */
  onGuardar: (datos: {
    kilometraje?: number; combustible?: number; inventario?: Inventario;
  }) => Promise<boolean>;
  /** Solo lectura cuando el momento ya se firmó. */
  bloqueado?: boolean;
};

const ESTADOS: { valor: 'B' | 'R' | 'M'; letra: string; texto: string; clase: string }[] = [
  { valor: 'B', letra: 'B', texto: 'Bien', clase: 'bg-success/15 text-success border-success/30' },
  { valor: 'R', letra: 'R', texto: 'Regular', clase: 'bg-warning/15 text-warning border-warning/30' },
  { valor: 'M', letra: 'M', texto: 'Mal', clase: 'bg-danger/15 text-danger border-danger/30' },
];

export default function ReporteMediciones({
  titulo, items, kilometraje, combustible, inventario, onGuardar, bloqueado = false,
}: Props) {
  const [km, setKm] = useState(kilometraje === null ? '' : String(kilometraje));
  const [guardando, setGuardando] = useState('');
  const [error, setError] = useState('');

  const calificados = items.filter(i => inventario[i]).length;
  const listo = kilometraje !== null && combustible !== null && calificados === items.length;

  const guardar = async (datos: Parameters<Props['onGuardar']>[0], etiqueta: string) => {
    setError('');
    setGuardando(etiqueta);
    const ok = await onGuardar(datos);
    if (!ok) setError('No se pudo guardar. Revisa la conexión e inténtalo otra vez.');
    setGuardando('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">{titulo}</p>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
          listo ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
        }`}>
          {listo ? 'Completo' : `${calificados}/${items.length} revisados`}
        </span>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {/* Kilometraje. Se guarda al salir del campo, no en cada tecla. */}
      <div>
        <label className="block text-[11px] font-semibold text-ink/60 mb-1">Kilometraje del odómetro</label>
        <input
          type="number" inputMode="numeric" min={0} disabled={bloqueado}
          className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface disabled:opacity-60"
          placeholder="Ej: 45230"
          value={km}
          onChange={e => setKm(e.target.value)}
          onBlur={() => {
            const n = Number(km);
            if (km !== '' && Number.isInteger(n) && n !== kilometraje) guardar({ kilometraje: n }, 'km');
          }}
        />
        {guardando === 'km' && <p className="text-[11px] text-ink/45 mt-1">Guardando…</p>}
      </div>

      {/* Combustible en octavos: es lo que marca la aguja, y es lo que el contrato
          obliga a comparar entre la entrega y la devolución. */}
      <div>
        <label className="block text-[11px] font-semibold text-ink/60 mb-1.5">Nivel de combustible</label>
        <div className="flex gap-1">
          {Array.from({ length: 9 }, (_, i) => i).map(n => (
            <button
              key={n} type="button" disabled={bloqueado}
              onClick={() => guardar({ combustible: n }, `comb-${n}`)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border transition disabled:opacity-60 ${
                combustible === n
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface text-ink/60 border-border hover:bg-ink/5'
              }`}
            >
              {n === 0 ? 'V' : n === 8 ? 'F' : `${n}`}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-ink/45 mt-1">V = vacío · F = lleno · los números son octavos</p>
      </div>

      {/* Inventario. Tres botones por ítem; la nota solo cuando algo no está bien. */}
      <div>
        <p className="text-[11px] font-semibold text-ink/60 mb-1.5">Estado del vehículo</p>
        <div className="space-y-1.5">
          {items.map(item => {
            const actual = inventario[item];
            return (
              <div key={item} className="rounded-lg border border-border/70 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink/80 min-w-0 flex-1">{item}</span>
                  <div className="flex gap-1 shrink-0">
                    {ESTADOS.map(e => (
                      <button
                        key={e.valor} type="button" disabled={bloqueado}
                        aria-label={`${item}: ${e.texto}`}
                        onClick={() => guardar(
                          { inventario: { [item]: { estado: e.valor, nota: actual?.nota ?? '' } } },
                          `${item}-${e.valor}`,
                        )}
                        className={`w-9 h-8 rounded-lg text-[11px] font-bold border transition disabled:opacity-60 ${
                          actual?.estado === e.valor ? e.clase : 'bg-surface text-ink/40 border-border hover:bg-ink/5'
                        }`}
                      >
                        {e.letra}
                      </button>
                    ))}
                  </div>
                </div>

                {/* La nota aparece cuando hay algo que contar: un ítem que no está bien
                    sin explicación no le sirve a nadie al comparar la devolución. */}
                {actual && actual.estado !== 'B' && (
                  <input
                    type="text" disabled={bloqueado}
                    className="mt-1.5 w-full border border-border rounded-lg px-2 py-1.5 text-[11px] bg-surface disabled:opacity-60"
                    placeholder="¿Qué tiene? Ej: rayón de 10 cm en la puerta derecha"
                    defaultValue={actual.nota}
                    onBlur={e => {
                      const nota = e.target.value.trim();
                      if (nota !== actual.nota) {
                        guardar({ inventario: { [item]: { estado: actual.estado, nota } } }, `${item}-nota`);
                      }
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
