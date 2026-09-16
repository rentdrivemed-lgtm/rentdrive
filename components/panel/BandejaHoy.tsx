'use client';
// ── La vista HOY: la bandeja del día ────────────────────────────────────────
//
// Una sola lista priorizada con lo que hay que resolver, venga de donde venga. No
// es un tablero de métricas: es la respuesta a la pregunta de las 8 de la mañana.
//
// Todo llega de UN endpoint agregador (GET /api/panel/bandeja, ver lib/bandeja.ts).
// Este componente no sabe consultar la base ni conoce las nueve fuentes: solo pinta,
// filtra por grupo y sabe volver a pedir la lista.
//
// EL CONTADOR BAJA AL RESOLVER: la lista se vuelve a pedir después de cada acción,
// al volver a la pestaña (`visibilitychange`) y cada minuto. Como el agregador define
// cada fuente por su condición de "todavía sin resolver", la fila desaparece sola en
// cuanto el trabajo se hace — aquí o en la pantalla a la que lleva.
//
// Componente de cliente puro: de `lib/bandeja` y `lib/permisos` solo entra el TIPO y
// la matriz de etiquetas (módulos sin `fs` ni `better-sqlite3`).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Bandeja, GrupoBandeja, ItemBandeja } from '@/lib/bandeja';
import { areaLabel } from '@/lib/permisos';
import {
  IconCalendar, IconRoute, IconShield, IconChat, IconCoin, IconPhoto, IconCar, IconRotate, IconCheck,
} from '@/components/Icons';

const REFRESCO_MS = 60_000;

const CHIPS: { clave: 'todo' | GrupoBandeja; label: string }[] = [
  { clave: 'todo', label: 'Todo' },
  { clave: 'reservas', label: 'Reservas' },
  { clave: 'documentos', label: 'Documentos' },
  { clave: 'calle', label: 'Calle' },
  { clave: 'dinero', label: 'Dinero' },
  { clave: 'soporte', label: 'Soporte' },
];

const ICONO: Record<ItemBandeja['fuente'], React.ReactNode> = {
  reserva_pendiente: <IconCalendar size={16} />,
  documento_vehiculo: <IconShield size={16} />,
  servicio_sin_mensajero: <IconRoute size={16} />,
  devolucion_hoy: <IconCar size={16} />,
  inspeccion_hallazgos: <IconPhoto size={16} />,
  liquidacion_por_pagar: <IconCoin size={16} />,
  contrato_sin_firmar: <IconShield size={16} />,
  foto_revision: <IconPhoto size={16} />,
  soporte_sin_responder: <IconChat size={16} />,
};

// Peso 0 = urgente (naranja de marca), 1 = alta (ámbar), 2 = normal (apagado).
const TONO: Record<number, string> = {
  0: 'border-accent/45 bg-accent-light',
  1: 'border-warning/30 bg-warning/[0.06]',
  2: 'border-border bg-surface-2',
};
const TONO_PILDORA: Record<number, string> = {
  0: 'bg-accent/20 text-accent-hover',
  1: 'bg-warning/15 text-warning',
  2: 'bg-surface-3 text-ink/70',
};

export type DestinoInterno = { seccion: string; reserva?: number; conv?: number };

/** '/panel?seccion=contratos&reserva=12' → { seccion:'contratos', reserva:12 }. */
function destinoInterno(destino: string): DestinoInterno | null {
  if (!destino.startsWith('/panel?')) return null;
  const params = new URLSearchParams(destino.slice(destino.indexOf('?') + 1));
  const seccion = params.get('seccion');
  if (!seccion) return null;
  const reserva = Number(params.get('reserva'));
  const conv = Number(params.get('conv'));
  return {
    seccion,
    reserva: Number.isInteger(reserva) && reserva > 0 ? reserva : undefined,
    conv: Number.isInteger(conv) && conv > 0 ? conv : undefined,
  };
}

function saludo(): string {
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false }).format(new Date()));
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  // Mediodía UTC para que el desplazamiento de zona no corra el día.
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
}

export default function BandejaHoy({ nombre, onIrASeccion }: { nombre: string; onIrASeccion: (d: DestinoInterno) => void }) {
  const [datos, setDatos] = useState<Bandeja | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<'todo' | GrupoBandeja>('todo');
  // Confirmación en dos pasos de la acción rápida: aprobar una reserva manda correos
  // y crea el servicio logístico, así que no puede irse en un clic accidental.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ejecutando, setEjecutando] = useState<string | null>(null);

  const cargar = useCallback((): Promise<void> => {
    return fetch('/api/panel/bandeja', { cache: 'no-store' })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'No se pudo cargar la bandeja.');
        return d as Bandeja;
      })
      .then(d => { setDatos(d); setError(''); })
      .catch((e: Error) => { setError(e.message || 'No se pudo cargar la bandeja.'); })
      .finally(() => { setCargando(false); });
  }, []);

  useEffect(() => {
    let vivo = true;
    const tick = () => { if (vivo) void cargar(); };
    tick();
    const intervalo = setInterval(tick, REFRESCO_MS);
    // Al volver de la pantalla a la que llevó una fila, la lista se refresca sola:
    // sin esto la bandeja mostraría algo ya resuelto, que es la única forma de que
    // una bandeja pierda la confianza del equipo.
    const alVolver = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolver); };
  }, [cargar]);

  const aprobarReserva = useCallback((item: ItemBandeja) => {
    setEjecutando(item.id);
    // Mismo endpoint y mismo cuerpo que el botón «Aprobar» del panel actual
    // (app/dashboard/admin/page.tsx → aprobarReserva): una sola vía de aprobación.
    fetch(`/api/reservas/${item.entidad_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'confirmada', pago_estado: 'pagado' }),
    })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error || 'No se pudo aprobar la reserva.');
        }
      })
      .then(() => cargar())
      .catch((e: Error) => { setError(e.message); })
      .finally(() => { setEjecutando(null); setConfirmando(null); });
  }, [cargar]);

  const items = datos?.items ?? [];
  const visibles = filtro === 'todo' ? items : items.filter(i => i.grupo === filtro);
  const total = datos?.conteos.todo ?? 0;

  return (
    <div className="max-w-4xl">
      {/* Cabecera */}
      <header className="mb-5">
        <h1 className="text-xl md:text-2xl font-black text-ink tracking-tight">
          {saludo()}{nombre ? `, ${nombre.split(' ')[0]}` : ''}
        </h1>
        <p className="text-xs md:text-sm text-ink/50 mt-1 first-letter:uppercase">
          {datos ? fechaLarga(datos.fecha) : '—'}
          {datos && (
            <>
              {' · '}
              <span className={total ? 'text-accent font-bold' : 'text-success font-bold'}>
                {total === 0 ? 'nada pendiente' : `${total} ${total === 1 ? 'cosa' : 'cosas'} por resolver`}
              </span>
            </>
          )}
        </p>
      </header>

      {/* Chips de grupo, con su contador */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-2 mb-3">
        {CHIPS.map(c => {
          const n = datos?.conteos[c.clave] ?? 0;
          if (c.clave !== 'todo' && n === 0) return null;
          const activo = filtro === c.clave;
          return (
            <button
              key={c.clave}
              type="button"
              onClick={() => setFiltro(c.clave)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                activo ? 'border-accent/50 bg-accent/15 text-ink' : 'border-border text-ink/60 hover:text-ink hover:bg-surface-2'
              }`}>
              {c.label}
              <span className="ml-1.5 text-[10px] font-mono opacity-70">{n}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => { setCargando(true); void cargar(); }}
          className="shrink-0 ml-auto grid place-items-center w-8 h-8 rounded-full border border-border text-ink/50 hover:text-ink hover:bg-surface-2 transition"
          aria-label="Actualizar la bandeja">
          <IconRotate size={14} />
        </button>
      </div>

      {error && (
        <p className="mb-3 text-xs text-danger border border-danger/25 bg-danger/10 rounded-xl px-3 py-2">{error}</p>
      )}

      {cargando && !datos && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-2xl shimmer" />)}
        </div>
      )}

      {datos && visibles.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface-2 px-5 py-10 text-center">
          <div className="inline-grid place-items-center w-11 h-11 rounded-full bg-success/15 text-success mb-3"><IconCheck size={20} /></div>
          <p className="text-sm font-bold text-ink">
            {total === 0 ? 'No hay nada pendiente' : 'Nada pendiente en este filtro'}
          </p>
          <p className="text-xs text-ink/50 mt-1">
            {total === 0 ? 'Todo lo que llegaba a esta bandeja ya está resuelto.' : 'Cambia de chip para ver el resto.'}
          </p>
        </div>
      )}

      {/* La lista */}
      <ul className="space-y-2">
        {visibles.map(item => {
          const interno = destinoInterno(item.destino);
          const pendienteConfirmar = confirmando === item.id;
          const enCurso = ejecutando === item.id;
          return (
            <li key={item.id} className={`rounded-2xl border px-3.5 py-3 transition ${TONO[item.peso]}`}>
              <div className="flex items-start gap-3">
                <span className={`shrink-0 grid place-items-center w-8 h-8 rounded-xl ${TONO_PILDORA[item.peso]}`}>
                  {ICONO[item.fuente]}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${TONO_PILDORA[item.peso]}`}>
                      {item.etiqueta}
                    </span>
                    {item.cuando && <span className="text-[11px] text-ink/50 font-mono">{item.cuando}</span>}
                  </div>
                  <p className="text-sm font-bold text-ink mt-1 break-words">{item.titulo}</p>
                  {item.quien && <p className="text-xs text-ink-soft break-words">{item.quien}</p>}
                  {item.detalle && <p className="text-[11px] text-ink/50 mt-0.5 break-words">{item.detalle}</p>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-2.5 pl-11">
                {item.accion === 'aprobar_reserva' && (
                  pendienteConfirmar ? (
                    <>
                      <button
                        type="button"
                        disabled={enCurso}
                        onClick={() => aprobarReserva(item)}
                        className="text-xs font-bold bg-success text-white px-3 py-1.5 rounded-xl disabled:opacity-50">
                        {enCurso ? 'Aprobando…' : 'Confirmar aprobación'}
                      </button>
                      <button
                        type="button"
                        disabled={enCurso}
                        onClick={() => setConfirmando(null)}
                        className="text-xs border border-border text-ink/60 px-3 py-1.5 rounded-xl hover:bg-surface-2">
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmando(item.id)}
                      className="text-xs font-bold border border-success/40 text-success px-3 py-1.5 rounded-xl hover:bg-success/10 transition">
                      Aprobar
                    </button>
                  )
                )}

                {interno ? (
                  <button
                    type="button"
                    onClick={() => onIrASeccion(interno)}
                    className="text-xs font-semibold border border-border text-ink/70 px-3 py-1.5 rounded-xl hover:bg-surface-2 hover:text-ink transition">
                    Abrir
                  </button>
                ) : (
                  <Link
                    href={item.destino}
                    className="text-xs font-semibold border border-border text-ink/70 px-3 py-1.5 rounded-xl hover:bg-surface-2 hover:text-ink transition">
                    Abrir
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Honestidad sobre el alcance: si la cuenta no ve un área, la bandeja lo dice
          en vez de dar a entender que "no hay nada" de ese lado. */}
      {datos && datos.areas_ocultas.length > 0 && (
        <p className="mt-4 text-[11px] text-ink/40">
          Esta bandeja no incluye {datos.areas_ocultas.map(areaLabel).join(', ')}: tu cuenta no tiene esas secciones.
        </p>
      )}
    </div>
  );
}
