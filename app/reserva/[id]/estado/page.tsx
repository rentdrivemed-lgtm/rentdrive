'use client';
// El cliente ve cómo quedó registrado el carro, con las fotos, y lo confirma.
//
// Es la otra mitad de lo que el mensajero anota con el vehículo delante: sin esto, el
// acta diría que las dos partes vieron el mismo estado sin que el cliente hubiera visto
// nada. Confirmar aquí es lo que permite afirmarlo.
//
// Las FOTOS van primero, y no es decoración: lo que el cliente puede revisar de verdad
// desde el celular son las fotos. El inventario en letras es el resumen de lo que esas
// fotos muestran, no al revés.
//
// Si no confirma, no pasa nada grave: quien entrega deja constancia y la entrega sigue.
// El acta lo dirá tal cual.
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Foto = { url: string; casilla?: string };
type Item = { estado: 'B' | 'R' | 'M'; nota: string };

type Momento = {
  fase: 'salida' | 'entrada';
  etiqueta: string;
  kilometraje: number | null;
  combustible: string;
  inventario: Record<string, Item>;
  fotos: Foto[];
  completo: boolean;
  confirmadoEn: string;
  constancia: string;
  itemsFaltantes: string[];
};

type Datos = {
  items: string[];
  entrega: Momento;
  devolucion: Momento;
  puedeConfirmar: boolean;
};

const ESTADO_TEXTO: Record<string, string> = { B: 'Bien', R: 'Regular', M: 'Mal' };
const ESTADO_CLASE: Record<string, string> = {
  B: 'text-success', R: 'text-warning', M: 'text-danger',
};

export default function EstadoDelVehiculoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const reservaId = Number(params?.id);

  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [confirmando, setConfirmando] = useState('');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/reservas/${reservaId}/reporte`);
      if (r.status === 401) { router.push('/login'); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'No pudimos cargar el estado del vehículo.'); return; }
      setDatos(d);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [reservaId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  const confirmar = async (fase: 'salida' | 'entrada') => {
    setError('');
    setConfirmando(fase);
    try {
      const r = await fetch(`/api/reservas/${reservaId}/reporte`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fase }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'No se pudo confirmar.'); return; }
      await cargar();
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setConfirmando('');
    }
  };

  if (cargando) {
    return <main className="max-w-2xl mx-auto px-4 py-10"><p className="text-sm text-ink/60">Cargando…</p></main>;
  }
  if (!datos) {
    return <main className="max-w-2xl mx-auto px-4 py-10"><p className="text-sm text-danger">{error}</p></main>;
  }

  const momentos = [datos.entrega, datos.devolucion];

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
      <h1 className="text-xl font-bold text-ink">Estado del vehículo</h1>
      <p className="text-sm text-ink/70 mt-1">
        Así quedó registrado el carro de tu reserva #{reservaId}. Revísalo y confírmalo.
      </p>

      {error && <p className="text-sm text-danger mt-3">{error}</p>}

      {momentos.map(m => {
        // El momento que todavía no ha ocurrido no se pinta: mostrar la devolución de
        // un carro que sigue alquilado solo confunde.
        if (!m.completo && m.fotos.length === 0) return null;

        return (
          <section key={m.fase} className="mt-6 rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-base font-bold text-ink capitalize">Al momento de {m.etiqueta}</h2>
              {m.confirmadoEn ? (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-success/15 text-success">
                  Confirmado
                </span>
              ) : m.constancia ? (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-warning/15 text-warning">
                  Sin confirmar
                </span>
              ) : null}
            </div>

            {/* Las fotos primero: es lo que de verdad se puede revisar. */}
            {m.fotos.length > 0 && (
              <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {m.fotos.map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i} src={f.url} alt={f.casilla || `Foto ${i + 1}`}
                    className="w-full aspect-square object-cover rounded-lg border border-border"
                  />
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-4 text-sm">
              <div>
                <p className="text-[11px] text-ink/50">Kilometraje</p>
                <p className="font-semibold text-ink tabular-nums">{m.kilometraje ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] text-ink/50">Combustible</p>
                <p className="font-semibold text-ink">{m.combustible || '—'}</p>
              </div>
            </div>

            {/* Solo lo que NO está perfecto. Una lista de 18 «bien» no la lee nadie, y
                lo que importa revisar es exactamente lo que tiene algo. */}
            {(() => {
              const conNovedad = datos.items.filter(i => m.inventario[i] && m.inventario[i].estado !== 'B');
              return (
                <div className="mt-4">
                  <p className="text-[11px] text-ink/50 mb-1.5">
                    {conNovedad.length === 0
                      ? 'Todo se revisó y quedó en buen estado.'
                      : `Se anotaron ${conNovedad.length} novedad(es):`}
                  </p>
                  {conNovedad.length > 0 && (
                    <ul className="space-y-1">
                      {conNovedad.map(i => (
                        <li key={i} className="text-xs text-ink/80">
                          <span className={`font-semibold ${ESTADO_CLASE[m.inventario[i].estado]}`}>
                            {ESTADO_TEXTO[m.inventario[i].estado]}
                          </span>
                          {' · '}{i}
                          {m.inventario[i].nota ? ` — ${m.inventario[i].nota}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}

            {m.constancia && !m.confirmadoEn && (
              <p className="mt-3 text-[11px] text-ink/60">
                Quedó constancia de que no confirmaste: {m.constancia}
              </p>
            )}

            {datos.puedeConfirmar && !m.confirmadoEn && m.completo && (
              <button
                type="button"
                disabled={confirmando === m.fase}
                onClick={() => confirmar(m.fase)}
                className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {confirmando === m.fase ? 'Confirmando…' : `Confirmo el estado de ${m.etiqueta}`}
              </button>
            )}

            {datos.puedeConfirmar && !m.completo && (
              <p className="mt-3 text-[11px] text-ink/50">
                Todavía se está levantando el reporte de {m.etiqueta}. Podrás confirmarlo en cuanto esté.
              </p>
            )}
          </section>
        );
      })}

      <p className="text-[11px] text-ink/50 mt-5">
        Si algo no coincide con lo que ves en el carro, díselo a quien te lo entrega antes de
        confirmar. Lo que confirmes aquí queda en el acta.
      </p>
    </main>
  );
}
