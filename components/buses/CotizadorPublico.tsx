'use client';
import { useState } from 'react';
import GaleriaVehiculo from '@/components/GaleriaVehiculo';
import TelefonoInput from '@/components/TelefonoInput';
import { IconArrowL, IconPin, IconUsers, IconRoute, IconClock, IconCheck } from '@/components/Icons';
import { validarCelular, PAIS_TEL_DEFAULT } from '@/lib/validacion';
import { BUS_CATEGORIAS, type CategoriaBus } from '@/lib/busCotizador';
import { cop } from './types';
import type { BusPublico } from './BusVitrinaCard';

// Vista de detalle + cotizador del bus seleccionado en la vitrina pública (app/buses/page.tsx,
// COTIZADOR-BUSES-SPEC.md §8). Consume exclusivamente POST /api/buses/cotizar (público, sin
// sesión) — esa misma llamada calcula el precio Y guarda la solicitud en `cotizaciones_bus`
// (ver app/api/buses/cotizar/route.ts), así que no existe un paso de "solo previsualizar":
// el botón de abajo cotiza y solicita en un solo clic.
//
// HUECO DE API (no se inventa nada nuevo, solo se documenta): no hay ningún endpoint público
// para listar los destinos que YA tiene cargados este bus en particular — GET
// /api/buses/tarifas-vehiculo exige sesión (dueño del bus o admin con el área "buses", ver
// ese archivo). Por eso la pestaña "Por destino" usa un campo de texto libre en vez de un
// selector: el propio POST /api/buses/cotizar resuelve el destino escrito contra la tarifa
// de ESE bus y, si no la tiene cargada, cae automáticamente al fallback "referencial" contra
// la tarifa de referencia de su categoría (§7.2 del spec) — la respuesta trae `referencial:true`
// en ese caso, que se muestra tal cual al cliente.
const KM_MAXIMO = 5000;
const HORAS_MAXIMO = 720;

type Modo = 'destino' | 'trayecto' | 'horas';

type ResultadoCotizacion = {
  numero: string;
  modo: Modo;
  destino: string | null;
  km: number | null;
  horas: number | null;
  conRecargo: boolean;
  tarifaAplicada: number;
  recargoValor: number;
  total: number;
  referencial: boolean;
  categoria: CategoriaBus;
};

const CATEGORIA_LABEL: Record<CategoriaBus, string> = Object.fromEntries(
  BUS_CATEGORIAS.map(c => [c.codigo, c.nombre]),
) as Record<CategoriaBus, string>;

const TABS: { key: Modo; label: string; icon: React.ReactNode }[] = [
  { key: 'destino', label: 'Por destino', icon: <IconPin size={13} /> },
  { key: 'trayecto', label: 'Por trayecto (km)', icon: <IconRoute size={13} /> },
  { key: 'horas', label: 'Por horas', icon: <IconClock size={13} /> },
];

const hoy = new Date().toISOString().split('T')[0];

export default function CotizadorPublico({ bus, onVolver }: { bus: BusPublico; onVolver: () => void }) {
  const [modo, setModo] = useState<Modo>('destino');
  const [destino, setDestino] = useState('');
  const [km, setKm] = useState('');
  const [horas, setHoras] = useState('');
  const [conRecargo, setConRecargo] = useState(false);
  const [clienteNombre, setClienteNombre] = useState('');
  const [indicativo, setIndicativo] = useState(PAIS_TEL_DEFAULT);
  const [numero, setNumero] = useState('');
  const [fechaServicio, setFechaServicio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<ResultadoCotizacion | null>(null);

  let fotos: string[] = [];
  try { fotos = JSON.parse(bus.fotos || '[]'); } catch { fotos = []; }

  const cambiarModo = (m: Modo) => { setModo(m); setError(''); };

  const solicitar = async () => {
    setError('');

    if (modo === 'destino' && !destino.trim()) {
      setError('Escribe el destino al que necesitas viajar.');
      return;
    }
    if (modo === 'trayecto') {
      const n = Number(km);
      if (!Number.isFinite(n) || n <= 0) { setError('Ingresa un número de kilómetros válido.'); return; }
      if (n > KM_MAXIMO) { setError(`Los kilómetros no pueden superar ${KM_MAXIMO}.`); return; }
    }
    if (modo === 'horas') {
      const n = Number(horas);
      if (!Number.isFinite(n) || n <= 0) { setError('Ingresa un número de horas válido.'); return; }
      if (n > HORAS_MAXIMO) { setError(`Las horas no pueden superar ${HORAS_MAXIMO}.`); return; }
    }
    if (!clienteNombre.trim()) {
      setError('Ingresa tu nombre para que el propietario pueda contactarte.');
      return;
    }
    const errCel = validarCelular(indicativo, numero);
    if (errCel) { setError(errCel); return; }

    setEnviando(true);
    try {
      const res = await fetch('/api/buses/cotizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehiculoId: bus.id,
          modo,
          destino: modo === 'destino' ? destino.trim() : undefined,
          km: modo === 'trayecto' ? Number(km) : undefined,
          horas: modo === 'horas' ? Number(horas) : undefined,
          conRecargo,
          clienteNombre: clienteNombre.trim(),
          clienteTelefono: `${indicativo} ${numero}`.trim(),
          fechaServicio,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Cubre el 429 de rate limit (mensaje ya viene armado por el backend, ver
        // app/api/buses/cotizar/route.ts) y cualquier otro error (400/404/500) sin romper la UI.
        setError(data.error || 'No se pudo generar la cotización. Intenta de nuevo.');
        return;
      }
      setResultado(data);
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const nuevaCotizacion = () => { setResultado(null); setError(''); };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={onVolver}
        className="inline-flex items-center gap-1.5 text-accent hover:text-accent-hover text-sm mb-5 font-medium transition">
        <IconArrowL size={14} /> Volver a la vitrina
      </button>

      <div className="bg-surface-2 rounded-3xl shadow-sm border border-border overflow-hidden">
        <div className="p-6 grid md:grid-cols-2 gap-6">
          {/* Info del bus */}
          <div>
            <div className="relative mb-5">
              <GaleriaVehiculo fotos={fotos} titulo={`${bus.marca} ${bus.modelo} · ${bus.anio}`} />
              {bus.bus_categoria && (
                <span className="absolute top-3 right-3 z-20 bg-brand/80 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full">
                  {CATEGORIA_LABEL[bus.bus_categoria]}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-ink mb-1">{bus.marca} {bus.modelo}</h1>
            <p className="text-ink/50 text-sm mb-1 flex items-center gap-1.5">
              <IconPin size={13} /> {bus.ubicacion} · {bus.anio}
            </p>
            {bus.capacidad_pasajeros != null && (
              <p className="text-ink/50 text-sm mb-4 flex items-center gap-1.5">
                <IconUsers size={13} /> Hasta {bus.capacidad_pasajeros} pasajeros
              </p>
            )}
            {bus.descripcion && <p className="text-ink/70 text-sm leading-relaxed">{bus.descripcion}</p>}
          </div>

          {/* Cotizador */}
          <div className="bg-surface rounded-2xl p-5 border border-border">
            {resultado ? (
              <div className="text-center">
                <IconCheck size={32} className="text-success mx-auto mb-2" />
                <p className="font-bold text-ink text-lg mb-1">¡Cotización enviada!</p>
                <p className="text-ink/60 text-xs mb-4">
                  Número de cotización: <span className="font-mono font-bold text-ink">{resultado.numero}</span>
                </p>

                <div className="bg-surface-2 rounded-xl border border-border p-4 text-left text-sm space-y-1.5 mb-4">
                  <div className="flex justify-between text-ink/70">
                    <span>Tarifa aplicada</span><span>{cop(resultado.tarifaAplicada)}</span>
                  </div>
                  {resultado.recargoValor > 0 && (
                    <div className="flex justify-between text-ink/70">
                      <span>Recargo (+30%)</span><span>+{cop(resultado.recargoValor)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-accent pt-1.5 border-t border-border">
                    <span>Total</span><span>{cop(resultado.total)}</span>
                  </div>
                </div>

                {resultado.referencial && (
                  <div className="bg-warning/10 border border-warning/25 rounded-xl px-3 py-2.5 text-xs text-warning mb-4 text-left">
                    Esta es una tarifa referencial: este bus todavía no tiene un precio propio
                    cargado para ese destino, así que el valor mostrado queda sujeto a
                    confirmación del propietario.
                  </div>
                )}

                <p className="text-ink/60 text-xs mb-5">
                  Ya avisamos al propietario del bus y a nuestro equipo. Te contactaremos pronto
                  al número que registraste para confirmar los detalles del servicio.
                </p>

                <div className="flex gap-2">
                  <button onClick={nuevaCotizacion}
                    className="flex-1 text-sm font-semibold text-accent border border-accent/30 bg-accent-light hover:bg-accent/10 px-4 py-2.5 rounded-xl transition">
                    Cotizar otra opción
                  </button>
                  <button onClick={onVolver}
                    className="flex-1 text-sm font-semibold bg-accent hover:bg-accent-hover text-white px-4 py-2.5 rounded-xl transition">
                    Ver otros buses
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="font-bold text-ink mb-4">Cotiza este bus</h2>

                {/* Pestañas de modalidad */}
                <div className="flex gap-1 bg-surface-2 rounded-xl border border-border p-1 mb-4">
                  {TABS.map(t => (
                    <button key={t.key} onClick={() => cambiarModo(t.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition ${
                        modo === t.key ? 'bg-accent text-white shadow-sm' : 'text-ink/60 hover:text-ink'
                      }`}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {modo === 'destino' && (
                    <div>
                      <label className="text-xs font-medium text-ink/60 block mb-1">Destino</label>
                      <input value={destino} onChange={e => setDestino(e.target.value)}
                        placeholder="Ej. Guatapé, Santa Fe de Antioquia..."
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
                    </div>
                  )}
                  {modo === 'trayecto' && (
                    <div>
                      <label className="text-xs font-medium text-ink/60 block mb-1">Kilómetros del trayecto</label>
                      <input type="number" min={1} max={KM_MAXIMO} value={km} onChange={e => setKm(e.target.value)}
                        placeholder="Ej. 120"
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
                    </div>
                  )}
                  {modo === 'horas' && (
                    <div>
                      <label className="text-xs font-medium text-ink/60 block mb-1">Horas de disponibilidad</label>
                      <input type="number" min={1} max={HORAS_MAXIMO} value={horas} onChange={e => setHoras(e.target.value)}
                        placeholder="Ej. 6"
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-sm text-ink/70 cursor-pointer">
                    <input type="checkbox" checked={conRecargo} onChange={e => setConRecargo(e.target.checked)} />
                    Aplicar recargo (+30%)
                  </label>

                  <div className="pt-3 mt-1 border-t border-border space-y-3">
                    <div>
                      <label className="text-xs font-medium text-ink/60 block mb-1">Tu nombre</label>
                      <input value={clienteNombre} onChange={e => setClienteNombre(e.target.value)}
                        placeholder="Nombre completo"
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-ink/60 block mb-1">Tu celular</label>
                      <TelefonoInput indicativo={indicativo} numero={numero}
                        onChangeIndicativo={setIndicativo} onChangeNumero={setNumero} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-ink/60 block mb-1">
                        Fecha del servicio <span className="text-ink/40">(opcional)</span>
                      </label>
                      <input type="date" min={hoy} value={fechaServicio} onChange={e => setFechaServicio(e.target.value)}
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
                    </div>
                  </div>

                  {error && (
                    <div className="text-sm px-3 py-2.5 rounded-xl border bg-danger/10 text-danger border-danger/25">
                      {error}
                    </div>
                  )}

                  <button onClick={solicitar} disabled={enviando}
                    className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm">
                    <IconRoute size={15} />
                    {enviando ? 'Calculando...' : 'Calcular y solicitar cotización'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
