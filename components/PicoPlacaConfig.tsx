'use client';
import { useEffect, useState } from 'react';
import { DIAS_SEMANA, parsePicoPlaca, picoPlacaVacio, digitosRestringidos, type PicoPlaca } from '@/lib/pico-placa';

type Afectada = { reserva_id: number; placa: string; digito: number; marca: string; modelo: string; usuario_nombre: string; propietario_nombre: string };

export default function PicoPlacaConfig() {
  const [pp, setPp] = useState<PicoPlaca>(picoPlacaVacio());
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState('');
  const [afectadas, setAfectadas] = useState<Afectada[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState('');
  const [errorCarga, setErrorCarga] = useState('');

  const cargar = async () => {
    setCargando(true);
    setErrorCarga('');
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorCarga('No pudimos cargar la configuración. Intenta de nuevo.'); return; }
      setPp(parsePicoPlaca(d.config?.pico_placa || ''));
    } catch {
      setErrorCarga('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };
  useEffect(() => { cargar(); }, []);

  const toggleDigito = (dia: string, dig: number) => {
    setPp(p => {
      const actual = p.dias[dia] || [];
      const nuevos = actual.includes(dig) ? actual.filter(x => x !== dig) : [...actual, dig].sort((a, b) => a - b);
      return { ...p, dias: { ...p.dias, [dia]: nuevos } };
    });
  };

  const guardar = async () => {
    setMsg('');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pico_placa: JSON.stringify(pp) }),
      });
      setMsg(res.ok ? '✓ Guardado' : 'Error al guardar');
    } catch {
      setMsg('Sin conexión');
    }
  };

  const previsualizar = async () => {
    try {
      const res = await fetch('/api/pico-placa/alertas', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      setAfectadas(res.ok ? (d.afectadas || []) : []);
    } catch {
      setAfectadas([]);
    }
  };

  const enviar = async () => {
    setEnviando(true); setResultado('');
    try {
      const res = await fetch('/api/pico-placa/alertas', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setResultado(`Afectadas hoy: ${d.total_afectadas}. Avisos enviados: ${d.enviados}.`);
        previsualizar();
      } else setResultado(d.error || 'Error al enviar.');
    } catch {
      setResultado('Sin conexión — intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (cargando) return <div className="text-center py-12 text-ink/50">Cargando…</div>;
  if (errorCarga) return (
    <div className="text-center py-12 bg-surface-2 rounded-2xl border border-border">
      <p className="text-ink/60 mb-4">{errorCarga}</p>
      <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
    </div>
  );

  const hoy = new Date();
  const restringidosHoy = digitosRestringidos(pp, hoy);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-surface-2 rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-ink">Rotación de pico y placa</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pp.activo} onChange={e => setPp(p => ({ ...p, activo: e.target.checked }))} />
            <span className="text-ink/70">Activo</span>
          </label>
        </div>
        <p className="text-xs text-ink/50 mb-4">Marca, por día, los últimos dígitos de placa que tienen restricción en Medellín. Esta rotación la actualizas tú cuando cambie.</p>

        <div className="mb-4">
          <label className="text-[11px] text-ink/50 block mb-1">Vigencia (referencia)</label>
          <input
            value={pp.vigencia}
            onChange={e => setPp(p => ({ ...p, vigencia: e.target.value }))}
            placeholder="Ej. 2026 · primer semestre"
            className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink/40" />
        </div>

        <div className="space-y-2">
          {DIAS_SEMANA.map(dia => (
            <div key={dia.id} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 text-sm text-ink/70">{dia.nombre}</span>
              {Array.from({ length: 10 }, (_, n) => n).map(n => {
                const on = (pp.dias[dia.id] || []).includes(n);
                return (
                  <button key={n} onClick={() => toggleDigito(dia.id, n)}
                    className={`w-8 h-8 rounded-lg text-sm font-semibold border transition ${on ? 'bg-danger/20 text-danger border-danger/40' : 'bg-surface text-ink/50 border-border hover:border-accent/40'}`}>
                    {n}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={guardar} className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition">Guardar rotación</button>
          {msg && <span className="text-xs text-success">{msg}</span>}
        </div>
      </div>

      {/* Aviso de hoy */}
      <div className="bg-surface-2 rounded-2xl border border-border p-5">
        <h3 className="font-bold text-ink mb-1">Avisos de hoy</h3>
        <p className="text-xs text-ink/50 mb-3">
          {pp.activo
            ? (restringidosHoy.length ? `Hoy tienen pico y placa las placas terminadas en: ${restringidosHoy.join(', ')}.` : 'Hoy no hay restricción configurada (o es fin de semana).')
            : 'El pico y placa está inactivo. Actívalo arriba para que aplique.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={previsualizar} className="text-sm bg-surface text-ink/70 hover:text-ink px-3.5 py-2 rounded-xl font-medium transition">Ver afectadas hoy</button>
          <button onClick={enviar} disabled={enviando} className="text-sm gradient-accent text-white px-3.5 py-2 rounded-xl font-semibold transition disabled:opacity-60">
            {enviando ? 'Enviando…' : 'Avisar pico y placa de hoy'}
          </button>
          {resultado && <span className="text-xs text-ink/60">{resultado}</span>}
        </div>
        {afectadas && (
          <div className="mt-3">
            {afectadas.length === 0 ? (
              <p className="text-sm text-ink/50">Ningún vehículo alquilado hoy está en pico y placa.</p>
            ) : (
              <ul className="space-y-1">
                {afectadas.map(a => (
                  <li key={a.reserva_id} className="text-xs text-ink/70 bg-surface rounded-lg px-3 py-1.5 border border-border/60">
                    {a.marca} {a.modelo} ({a.placa}) · termina en {a.digito} · {a.usuario_nombre}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="text-[11px] text-ink/50 mt-3">El envío automático cada mañana requiere la tarea programada (cron). El WhatsApp real solo sale si <code>WHATSAPP_ENABLED=true</code>; las notificaciones dentro de la app llegan siempre.</p>
      </div>
    </div>
  );
}
