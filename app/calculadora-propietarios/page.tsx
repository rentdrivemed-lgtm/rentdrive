'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  IconCoin, IconCar, IconCheck, IconArrowR, IconArrowL, IconKey, IconCalendar, IconShield, IconUser, IconInbox,
} from '@/components/Icons';
import {
  DEFAULTS_POR_TIPO, TIPO_VEHICULO_LABELS,
  COMISION_PLATAFORMA_DEFAULT, OCUPACION_DEFAULT,
  GPS_DISPOSITIVO_DEFAULT, GPS_ANIOS_AMORTIZACION_DEFAULT, GPS_PLAN_ANUAL_DEFAULT,
  ANIO_MINIMO_SIN_INSPECCION,
  calcularRentabilidad, sensibilidadPorOcupacion,
  type TipoVehiculo, type RentabilidadInput,
} from '@/lib/rentabilidad';

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const TIPOS = Object.keys(TIPO_VEHICULO_LABELS) as TipoVehiculo[];
const LEAD_STORAGE_KEY = 'rentdrive:lead_propietario';
// Interruptor temporal para probar la calculadora sin correo/WhatsApp configurados.
// Pon NEXT_PUBLIC_CALCULADORA_VERIFICACION=on en .env.local para volver a exigir el código.
const VERIFICACION_ACTIVA = process.env.NEXT_PUBLIC_CALCULADORA_VERIFICACION === 'on';

type Lead = { nombre: string; correo: string; celular: string };

// Solo dígitos: el value mostrado ya trae puntos de miles (toLocaleString), así que
// hay que descartarlos todos al parsear, no solo los caracteres "no numéricos".
function numInput(v: string): number {
  const n = Number(v.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function LeadGate({ tipo, onDesbloqueado }: { tipo: TipoVehiculo; onDesbloqueado: (lead: Lead) => void }) {
  const [paso, setPaso] = useState<'datos' | 'codigo'>('datos');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [celular, setCelular] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState<'correo' | 'whatsapp' | null>(null);

  const [leadId, setLeadId] = useState<number | null>(null);
  const [canal, setCanal] = useState<'correo' | 'whatsapp'>('correo');
  const [avisoEnvio, setAvisoEnvio] = useState('');
  const [codigo, setCodigo] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const pedirCodigo = async (canalElegido: 'correo' | 'whatsapp') => {
    setError('');
    if (!nombre.trim() || !correo.trim() || !celular.trim()) {
      setError('Completa los 3 campos para continuar.');
      return;
    }
    setEnviando(canalElegido);
    try {
      const res = await fetch('/api/leads-propietarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, correo, celular, tipo_vehiculo: tipo, canal: canalElegido }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No pudimos procesar tus datos. Intenta de nuevo.');
        return;
      }
      setLeadId(data.id);
      setCanal(canalElegido);
      setCooldown(30);
      setAvisoEnvio(
        data.enviado
          ? `Te enviamos un código de 6 dígitos por ${canalElegido === 'correo' ? 'correo' : 'WhatsApp'}.`
          : `No pudimos enviarlo automáticamente todavía (falta terminar de configurar el envío por ${canalElegido === 'correo' ? 'correo' : 'WhatsApp'}) — pídele el código al equipo de RentDrive.`
      );
      setPaso('codigo');
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setEnviando(null);
    }
  };

  const reenviar = async () => {
    if (!leadId || cooldown > 0) return;
    setReenviando(true);
    setError('');
    try {
      const res = await fetch('/api/leads-propietarios/reenviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: leadId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No pudimos reenviar el código.'); return; }
      setCooldown(30);
      setAvisoEnvio(data.enviado ? 'Te enviamos un nuevo código.' : 'No pudimos reenviarlo automáticamente — pide el código al equipo de RentDrive.');
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setReenviando(false);
    }
  };

  const verificar = async () => {
    if (!leadId) return;
    setError('');
    if (!/^\d{6}$/.test(codigo.trim())) {
      setError('El código son 6 dígitos.');
      return;
    }
    setVerificando(true);
    try {
      const res = await fetch('/api/leads-propietarios/verificar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: leadId, codigo: codigo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setError(data.error || 'No pudimos verificar el código.'); return; }
      const lead = { nombre, correo, celular };
      try { localStorage.setItem(LEAD_STORAGE_KEY, JSON.stringify(lead)); } catch { /* localStorage no disponible */ }
      onDesbloqueado(lead);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setVerificando(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-14">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-accent-light flex items-center justify-center mx-auto mb-4">
          <IconCoin size={26} className="text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-ink mb-2">Calculadora de ganancias según tu vehículo</h1>
        {paso === 'datos' ? (
          <p className="text-ink/60 text-sm">
            Antes de mostrarte los números, verifica tu correo o tu WhatsApp — así te guardamos tu
            simulación y podemos contactarte si tienes dudas. Toma menos de un minuto.
          </p>
        ) : (
          <p className="text-ink/60 text-sm">{avisoEnvio}</p>
        )}
      </div>

      {paso === 'datos' ? (
        <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-3">
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
              placeholder="Tu nombre completo"
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Correo</label>
            <input type="email" value={correo} onChange={e => setCorreo(e.target.value)}
              placeholder="tucorreo@ejemplo.com"
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Celular / WhatsApp</label>
            <input type="tel" value={celular} onChange={e => setCelular(e.target.value)}
              placeholder="300 000 0000"
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          {error && <p className="text-xs text-danger font-medium">{error}</p>}
          <p className="text-xs font-medium text-ink/60 pt-1">¿Cómo quieres verificarte?</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => pedirCodigo('correo')} disabled={enviando !== null}
              className="flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-bold px-4 py-3 rounded-xl transition shadow-lg shadow-accent/30 text-sm">
              <IconInbox size={15} /> {enviando === 'correo' ? 'Enviando…' : 'Por correo'}
            </button>
            <button onClick={() => pedirCodigo('whatsapp')} disabled={enviando !== null}
              className="flex items-center justify-center gap-2 bg-surface-3 hover:bg-surface-3/80 disabled:opacity-60 text-ink font-bold px-4 py-3 rounded-xl transition border border-border text-sm">
              {enviando === 'whatsapp' ? 'Enviando…' : 'Por WhatsApp'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-3">
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Código de 6 dígitos</label>
            <input type="text" inputMode="numeric" maxLength={6} value={codigo}
              onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full border border-border rounded-xl px-3 py-3 text-center text-2xl font-black tracking-[0.4em] text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          {error && <p className="text-xs text-danger font-medium">{error}</p>}
          <button onClick={verificar} disabled={verificando}
            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-bold px-6 py-3 rounded-xl transition shadow-lg shadow-accent/30">
            {verificando ? 'Verificando…' : 'Verificar y ver mi calculadora'} {!verificando && <IconCheck size={16} />}
          </button>
          <div className="flex items-center justify-between text-xs pt-1">
            <button onClick={() => { setPaso('datos'); setCodigo(''); setError(''); }} className="text-ink/50 hover:text-ink flex items-center gap-1">
              <IconArrowL size={12} /> Cambiar mis datos
            </button>
            <button onClick={reenviar} disabled={reenviando || cooldown > 0} className="text-accent font-medium disabled:opacity-50 disabled:text-ink/40">
              {cooldown > 0 ? `Reenviar en ${cooldown}s` : reenviando ? 'Reenviando…' : `Reenviar por ${canal === 'correo' ? 'correo' : 'WhatsApp'}`}
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-ink/40 text-center mt-4">
        Usamos estos datos solo para contactarte sobre tu vehículo y RentDrive — nunca los compartimos con terceros.
      </p>
    </div>
  );
}

export default function CalculadoraPropietariosPage() {
  const primerTipo = TIPOS[0];
  const primero = DEFAULTS_POR_TIPO[primerTipo];
  const [nombreVehiculo, setNombreVehiculo] = useState(TIPO_VEHICULO_LABELS[primerTipo]);
  const [tipo, setTipo] = useState<TipoVehiculo>(primerTipo);
  const [anio, setAnio] = useState<number>(new Date().getFullYear() - 2);
  const [valorComercial, setValorComercial] = useState(primero.valorComercial);
  const [soat, setSoat] = useState(primero.soat);
  const [pctSeguro, setPctSeguro] = useState(primero.pctSeguro);
  const [mantenimiento, setMantenimiento] = useState(primero.mantenimiento);
  const [pctDepreciacion, setPctDepreciacion] = useState(primero.pctDepreciacion);
  const [precioDia, setPrecioDia] = useState(primero.precioDia);
  const [comision, setComision] = useState(COMISION_PLATAFORMA_DEFAULT);
  const [ocupacion, setOcupacion] = useState(OCUPACION_DEFAULT);
  const [gpsAvanzado, setGpsAvanzado] = useState(false);
  const [gpsDispositivo, setGpsDispositivo] = useState(GPS_DISPOSITIVO_DEFAULT);
  const [gpsAnios, setGpsAnios] = useState(GPS_ANIOS_AMORTIZACION_DEFAULT);
  const [gpsPlan, setGpsPlan] = useState(GPS_PLAN_ANUAL_DEFAULT);

  const [lead, setLead] = useState<Lead | null>(null);
  const [revisandoLead, setRevisandoLead] = useState(true);

  useEffect(() => {
    if (!VERIFICACION_ACTIVA) {
      setLead({ nombre: 'Invitado', correo: '', celular: '' });
      setRevisandoLead(false);
      return;
    }
    try {
      const raw = localStorage.getItem(LEAD_STORAGE_KEY);
      if (raw) setLead(JSON.parse(raw));
    } catch { /* localStorage no disponible o dato corrupto — se vuelve a pedir */ }
    setRevisandoLead(false);
  }, []);

  const aplicarTipo = (t: TipoVehiculo) => {
    setTipo(t);
    setNombreVehiculo(TIPO_VEHICULO_LABELS[t]);
    const d = DEFAULTS_POR_TIPO[t];
    setValorComercial(d.valorComercial);
    setSoat(d.soat);
    setPctSeguro(d.pctSeguro);
    setMantenimiento(d.mantenimiento);
    setPctDepreciacion(d.pctDepreciacion);
    setPrecioDia(d.precioDia);
  };

  const input: RentabilidadInput = useMemo(() => ({
    valorComercial, soat, pctSeguro, mantenimiento, pctDepreciacion,
    gpsDispositivo, gpsAniosAmortizacion: gpsAnios, gpsPlanAnual: gpsPlan,
    precioDia, comision, ocupacion,
  }), [valorComercial, soat, pctSeguro, mantenimiento, pctDepreciacion, gpsDispositivo, gpsAnios, gpsPlan, precioDia, comision, ocupacion]);

  const r = useMemo(() => calcularRentabilidad(input), [input]);
  const sensibilidad = useMemo(() => sensibilidadPorOcupacion(input), [input]);
  const requiereInspeccion = anio > 0 && anio < ANIO_MINIMO_SIN_INSPECCION;

  if (revisandoLead) return null;

  if (!lead) {
    return <LeadGate tipo={tipo} onDesbloqueado={setLead} />;
  }

  const registroParams = new URLSearchParams({
    rol: 'propietario', nombre: lead.nombre, correo: lead.correo, celular: lead.celular,
  }).toString();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-full px-4 py-1.5 mb-4">
          <IconCoin size={14} className="text-accent" />
          <span className="text-accent text-xs font-semibold tracking-wide">Para propietarios</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-ink mb-3">¿Cuánto puedes ganar con tu carro?</h1>
        <p className="text-ink/60 max-w-2xl mx-auto">
          Simula tu propio caso con los mismos costos que usamos internamente: SOAT, impuesto vehicular,
          seguro todo riesgo, mantenimiento, GPS y depreciación. Ajusta cualquier campo — es tu vehículo, tus números.
        </p>
        <p className="text-ink/40 text-xs mt-2 flex items-center justify-center gap-1.5">
          <IconUser size={12} /> Hola {lead.nombre.split(' ')[0]} — guardamos tus datos para que no tengas que repetirlos.
        </p>
      </div>

      {/* Tabla de referencia por categoría */}
      <div className="bg-surface-2 rounded-2xl border border-border p-5 mb-6 overflow-x-auto">
        <h2 className="font-bold text-ink text-sm mb-3">Precios aproximados de alquiler por categoría</h2>
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left text-ink/50 text-xs uppercase tracking-wide">
              <th className="pb-2 font-semibold">Categoría</th>
              <th className="pb-2 font-semibold">Valor comercial estimado</th>
              <th className="pb-2 font-semibold">Precio aprox./día</th>
            </tr>
          </thead>
          <tbody>
            {TIPOS.map(t => (
              <tr key={t} className={`border-t border-border/60 ${t === tipo ? 'bg-accent-light' : ''}`}>
                <td className="py-2 font-medium text-ink">{TIPO_VEHICULO_LABELS[t]}</td>
                <td className="py-2 text-ink/60">{cop(DEFAULTS_POR_TIPO[t].valorComercial)}</td>
                <td className="py-2 font-semibold text-accent">{cop(DEFAULTS_POR_TIPO[t].precioDia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-ink/40 mt-3">
          Referencia general, no una cotización por modelo específico. Elige tu categoría abajo y ajusta cualquier campo con los datos reales de tu carro.
        </p>
      </div>

      {/* Selector por categoría */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-8">
        {TIPOS.map(t => (
          <button key={t} onClick={() => aplicarTipo(t)}
            className={`text-left p-3 rounded-xl border transition ${
              tipo === t ? 'border-accent bg-accent-light' : 'border-border bg-surface-2 hover:bg-surface-3'
            }`}>
            <p className="text-sm font-bold text-ink leading-tight">{TIPO_VEHICULO_LABELS[t]}</p>
            <p className="text-xs text-ink/50 mt-0.5">{cop(DEFAULTS_POR_TIPO[t].precioDia)}/día</p>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* FORM */}
        <div className="space-y-5">
          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
              <IconCar size={15} className="text-accent" /> Tu vehículo
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Nombre (referencia)</label>
                <input type="text" value={nombreVehiculo} onChange={e => setNombreVehiculo(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Categoría</label>
                  <select value={tipo} onChange={e => aplicarTipo(e.target.value as TipoVehiculo)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                    {TIPOS.map(t => (
                      <option key={t} value={t}>{TIPO_VEHICULO_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Año del vehículo</label>
                  <input type="number" value={anio} onChange={e => setAnio(numInput(e.target.value))}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
              </div>
              {requiereInspeccion && (
                <div className="flex items-start gap-2.5 bg-warning/10 border border-warning/25 rounded-xl px-3.5 py-3">
                  <span className="text-warning text-base leading-none">⚠️</span>
                  <p className="text-xs text-warning leading-relaxed">
                    Los vehículos modelo {ANIO_MINIMO_SIN_INSPECCION} o anteriores no se aprueban automáticamente:
                    su publicación queda sujeta a <strong>inspección física</strong>. Puedes seguir viendo la simulación,
                    pero coordina la inspección con nuestro equipo antes de publicar.
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Valor comercial estimado de tu carro (COP)</label>
                <input type="text" inputMode="numeric" value={valorComercial.toLocaleString('es-CO')}
                  onChange={e => setValorComercial(numInput(e.target.value))}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                <p className="text-[11px] text-ink/40 mt-1">Si no lo sabes con certeza, usa ~80% del precio 0&nbsp;km.</p>
              </div>
            </div>
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
              <IconShield size={15} className="text-accent" /> Costos anuales
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">SOAT anual (COP)</label>
                <input type="text" inputMode="numeric" value={soat.toLocaleString('es-CO')}
                  onChange={e => setSoat(numInput(e.target.value))}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">% Seguro todo riesgo</label>
                <input type="number" step="0.1" value={(pctSeguro * 100).toFixed(1)}
                  onChange={e => setPctSeguro(numInput(e.target.value) / 100)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Mantenimiento anual (COP)</label>
                <input type="text" inputMode="numeric" value={mantenimiento.toLocaleString('es-CO')}
                  onChange={e => setMantenimiento(numInput(e.target.value))}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">% Depreciación anual</label>
                <input type="number" step="0.1" value={(pctDepreciacion * 100).toFixed(1)}
                  onChange={e => setPctDepreciacion(numInput(e.target.value) / 100)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
            </div>
            <p className="text-[11px] text-ink/40 mt-2">
              % Impuesto vehicular (Antioquia) se calcula automático según el valor comercial: {pct(r.pctImpuesto)}.
            </p>

            <button onClick={() => setGpsAvanzado(o => !o)}
              className="text-xs text-accent font-medium mt-4 hover:underline">
              {gpsAvanzado ? '− Ocultar GPS avanzado' : '+ Editar costos de GPS'}
            </button>
            {gpsAvanzado && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">GPS dispositivo+instalación (COP)</label>
                  <input type="text" inputMode="numeric" value={gpsDispositivo.toLocaleString('es-CO')}
                    onChange={e => setGpsDispositivo(numInput(e.target.value))}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Años de amortización</label>
                  <input type="number" min="1" value={gpsAnios}
                    onChange={e => setGpsAnios(numInput(e.target.value))}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Plan anual GPS (COP)</label>
                  <input type="text" inputMode="numeric" value={gpsPlan.toLocaleString('es-CO')}
                    onChange={e => setGpsPlan(numInput(e.target.value))}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
              </div>
            )}
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
              <IconCoin size={15} className="text-accent" /> Tu oferta
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Precio de alquiler por día (COP)</label>
                <input type="text" inputMode="numeric" value={precioDia.toLocaleString('es-CO')}
                  onChange={e => setPrecioDia(numInput(e.target.value))}
                  className="w-full border-2 border-accent/40 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Comisión de la plataforma (%)</label>
                  <input type="number" step="0.1" value={(comision * 100).toFixed(1)}
                    onChange={e => setComision(numInput(e.target.value) / 100)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Ocupación esperada (%)</label>
                  <input type="number" step="1" value={(ocupacion * 100).toFixed(0)}
                    onChange={e => setOcupacion(numInput(e.target.value) / 100)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
              </div>
              <div className="flex gap-2">
                {[0.30, 0.45, 0.60].map(o => (
                  <button key={o} onClick={() => setOcupacion(o)}
                    className={`flex-1 text-xs font-semibold py-2 rounded-xl border transition ${
                      Math.abs(ocupacion - o) < 0.001 ? 'border-accent bg-accent-light text-accent' : 'border-border text-ink/50 hover:bg-surface'
                    }`}>
                    {pct(o)} ocupación
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RESULTADOS */}
        <div className="space-y-5">
          <div className={`rounded-2xl p-6 border-2 ${r.esRentable ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5'}`}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/50 mb-1">Utilidad neta estimada</p>
            <p className={`text-4xl font-black ${r.esRentable ? 'text-success' : 'text-danger'}`}>{cop(r.utilidadNetaMensual)}<span className="text-base font-semibold text-ink/40"> /mes</span></p>
            <p className="text-sm text-ink/60 mt-1">{cop(r.utilidadNetaAnual)} al año · retorno de {pct(r.roiAnual)} anual sobre el valor de tu carro</p>
            {!r.esRentable && (
              <p className="text-xs text-danger mt-2 font-medium">A este precio y ocupación no cubres tus costos — sube el precio por día o la ocupación esperada.</p>
            )}
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
              <IconCalendar size={15} className="text-accent" /> Detalle del cálculo
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Impuesto vehicular</dt>
                <dd className="font-medium text-ink">{cop(r.impuesto)} ({pct(r.pctImpuesto)})</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Seguro todo riesgo</dt>
                <dd className="font-medium text-ink">{cop(r.seguro)}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">GPS (amortizado por año)</dt>
                <dd className="font-medium text-ink">{cop(r.gpsAnualAmortizado)}</dd>
              </div>
              <div className="border-b border-border/60 pb-2">
                <div className="flex items-center justify-between">
                  <dt className="text-ink font-semibold">Costo de caja anual</dt>
                  <dd className="font-bold text-ink">{cop(r.costoCajaAnual)}</dd>
                </div>
                <p className="text-[11px] text-ink/40 mt-1 leading-relaxed">
                  Es lo que sale de tu bolsillo cada año (no incluye la depreciación): SOAT {cop(soat)} + impuesto vehicular {cop(r.impuesto)} + seguro todo riesgo {cop(r.seguro)} + mantenimiento {cop(mantenimiento)} + GPS amortizado {cop(r.gpsAnualAmortizado)} = {cop(r.costoCajaAnual)}.
                </p>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Depreciación anual (no es caja)</dt>
                <dd className="font-medium text-ink">{cop(r.depreciacion)}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Punto de equilibrio por día rentado</dt>
                <dd className="font-medium text-ink">{cop(r.puntoEquilibrioDia)}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Días rentados al año</dt>
                <dd className="font-medium text-ink">{Math.round(r.diasRentados)} días</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Ingreso bruto anual</dt>
                <dd className="font-medium text-ink">{cop(r.ingresoBrutoAnual)}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Comisión de la plataforma</dt>
                <dd className="font-medium text-ink">{cop(r.comisionCop)}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">Ingreso neto del propietario</dt>
                <dd className="font-medium text-ink">{cop(r.ingresoNetoAnual)}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink text-sm mb-4">Sensibilidad por ocupación</h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              {sensibilidad.map(s => (
                <div key={s.ocupacion} className={`rounded-xl p-3 border ${Math.abs(s.ocupacion - ocupacion) < 0.001 ? 'border-accent bg-accent-light' : 'border-border bg-surface'}`}>
                  <p className="text-xs font-bold text-ink/60">{pct(s.ocupacion)}</p>
                  <p className="text-sm font-bold text-ink mt-1">{cop(s.utilidadNetaMensual)}</p>
                  <p className="text-[10px] text-ink/40">/mes</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-brand rounded-2xl p-6 text-center">
            <h3 className="text-white font-bold mb-1">¿Te gusta lo que ves?</h3>
            <p className="text-white/60 text-sm mb-4">Continúa con el registro completo — ya adelantamos tus datos.</p>
            <Link href={`/registro?${registroParams}`}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-6 py-3 rounded-xl transition shadow-lg shadow-accent/30">
              <IconKey size={16} /> Publicar mi vehículo <IconArrowR size={14} />
            </Link>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-ink/40 text-center mt-8 max-w-2xl mx-auto leading-relaxed flex items-center justify-center gap-1.5">
        <IconCheck size={12} className="flex-shrink-0" />
        Simulación con datos de mercado de julio 2026 (SOAT, impuesto vehicular Antioquia, seguros). Es una guía, no una cotización — tu caso real puede variar.
      </p>
    </div>
  );
}
