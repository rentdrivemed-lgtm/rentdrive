'use client';
// Calculadora manual de precio y rentabilidad para el panel del admin.
// Sirve para cotizar un vehículo que AÚN no está en el sistema: se elige categoría + valor
// comercial y muestra el precio de mercado sugerido (mismo motor que la vitrina) junto con la
// rentabilidad completa. Reutiliza lib/rentabilidad + lib/precioMercado.
import { useMemo, useState } from 'react';
import {
  DEFAULTS_POR_TIPO, TIPO_VEHICULO_LABELS,
  COMISION_PLATAFORMA_DEFAULT, OCUPACION_DEFAULT,
  GPS_DISPOSITIVO_DEFAULT, GPS_ANIOS_AMORTIZACION_DEFAULT, GPS_PLAN_ANUAL_DEFAULT,
  ANIO_MINIMO_SIN_INSPECCION,
  calcularRentabilidad,
  type TipoVehiculo, type RentabilidadInput,
} from '@/lib/rentabilidad';
import { precioMercadoSugerido, bandaPrecioValor } from '@/lib/precioMercado';

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const CATEGORIAS = Object.entries(TIPO_VEHICULO_LABELS) as [TipoVehiculo, string][];

function numInput(v: string): number {
  const n = Number(v.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export default function CalculadoraPanel() {
  const primero = DEFAULTS_POR_TIPO.sedan;
  const [tipo, setTipo] = useState<TipoVehiculo>('sedan');
  const [anio, setAnio] = useState<number>(new Date().getFullYear() - 2);
  const [valorComercial, setValorComercial] = useState(primero.valorComercial);
  const [ajuste, setAjuste] = useState(0);
  const [precioDia, setPrecioDia] = useState(precioMercadoSugerido('sedan', primero.valorComercial));
  const [soat, setSoat] = useState(primero.soat);
  const [pctSeguro, setPctSeguro] = useState(primero.pctSeguro);
  const [mantenimiento, setMantenimiento] = useState(primero.mantenimiento);
  const [pctDepreciacion, setPctDepreciacion] = useState(primero.pctDepreciacion);
  const [comision, setComision] = useState(COMISION_PLATAFORMA_DEFAULT);
  const [ocupacion, setOcupacion] = useState(OCUPACION_DEFAULT);

  const aplicarTipo = (t: TipoVehiculo) => {
    setTipo(t);
    const d = DEFAULTS_POR_TIPO[t];
    setValorComercial(d.valorComercial);
    setSoat(d.soat);
    setPctSeguro(d.pctSeguro);
    setMantenimiento(d.mantenimiento);
    setPctDepreciacion(d.pctDepreciacion);
    setPrecioDia(precioMercadoSugerido(t, d.valorComercial, ajuste) || d.precioDia);
  };

  const input: RentabilidadInput = useMemo(() => ({
    valorComercial, soat, pctSeguro, mantenimiento, pctDepreciacion,
    gpsDispositivo: GPS_DISPOSITIVO_DEFAULT, gpsAniosAmortizacion: GPS_ANIOS_AMORTIZACION_DEFAULT,
    gpsPlanAnual: GPS_PLAN_ANUAL_DEFAULT, precioDia, comision, ocupacion,
  }), [valorComercial, soat, pctSeguro, mantenimiento, pctDepreciacion, precioDia, comision, ocupacion]);

  const r = useMemo(() => calcularRentabilidad(input), [input]);
  const precioSugerido = useMemo(() => precioMercadoSugerido(tipo, valorComercial, ajuste), [tipo, valorComercial, ajuste]);
  const banda = useMemo(() => bandaPrecioValor(valorComercial), [valorComercial]);
  const fueraDeBanda = valorComercial > 0 && precioDia > 0 && (precioDia < banda.min || precioDia > banda.max);
  const requiereInspeccion = anio > 0 && anio < ANIO_MINIMO_SIN_INSPECCION;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-ink">🧮 Calculadora de precio y rentabilidad</h2>
        <p className="text-sm text-ink/60 mt-1">
          Cotiza un vehículo que aún no está en el sistema. El precio sale del mismo motor de mercado
          que usa la vitrina (interpolado por valor comercial). Nada de esto se guarda.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Entradas */}
        <div className="space-y-4">
          <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-3">
            <h3 className="font-bold text-ink text-sm">Datos del vehículo</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Categoría</label>
                <select value={tipo} onChange={e => aplicarTipo(e.target.value as TipoVehiculo)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                  {CATEGORIAS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Año</label>
                <input type="number" value={anio} onChange={e => setAnio(numInput(e.target.value))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Valor comercial (COP)</label>
              <input type="text" inputMode="numeric" value={valorComercial.toLocaleString('es-CO')}
                onChange={e => setValorComercial(numInput(e.target.value))}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Ajuste por demanda (%)</label>
              <input type="number" step="1" value={ajuste} onChange={e => setAjuste(Number(e.target.value) || 0)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              <p className="text-[11px] text-ink/50 mt-1">+ para modelos de alta demanda, − para baja. Afecta el precio sugerido.</p>
            </div>
            {requiereInspeccion && (
              <div className="flex items-start gap-2 bg-warning/10 border border-warning/25 rounded-xl px-3 py-2.5">
                <span className="text-warning text-sm leading-none">⚠️</span>
                <p className="text-[11px] text-warning leading-relaxed">
                  Modelo {ANIO_MINIMO_SIN_INSPECCION} o anterior: no se aprueba automático, requiere inspección física.
                </p>
              </div>
            )}
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-3">
            <h3 className="font-bold text-ink text-sm">Costos anuales</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">SOAT (COP)</label>
                <input type="text" inputMode="numeric" value={soat.toLocaleString('es-CO')}
                  onChange={e => setSoat(numInput(e.target.value))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">% Seguro todo riesgo</label>
                <input type="number" step="0.1" value={(pctSeguro * 100).toFixed(1)}
                  onChange={e => setPctSeguro(numInput(e.target.value) / 100)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Mantenimiento (COP)</label>
                <input type="text" inputMode="numeric" value={mantenimiento.toLocaleString('es-CO')}
                  onChange={e => setMantenimiento(numInput(e.target.value))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">% Depreciación</label>
                <input type="number" step="0.1" value={(pctDepreciacion * 100).toFixed(1)}
                  onChange={e => setPctDepreciacion(numInput(e.target.value) / 100)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
            </div>
            <p className="text-[11px] text-ink/50">Impuesto vehicular (Antioquia) automático: {pct(r.pctImpuesto)}.</p>
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-3">
            <h3 className="font-bold text-ink text-sm">Oferta</h3>
            <div>
              <label className="text-xs font-medium text-ink/60 block mb-1">Precio de alquiler por día (COP)</label>
              <input type="text" inputMode="numeric" value={precioDia.toLocaleString('es-CO')}
                onChange={e => setPrecioDia(numInput(e.target.value))}
                className="w-full border-2 border-accent/40 rounded-xl px-3 py-2 text-sm font-semibold text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              {precioSugerido > 0 && (
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <p className="text-[11px] text-ink/50">Sugerido de mercado: <strong className="text-accent">{cop(precioSugerido)}/día</strong></p>
                  {precioDia !== precioSugerido && (
                    <button type="button" onClick={() => setPrecioDia(precioSugerido)}
                      className="text-[11px] font-semibold text-accent hover:underline">Usar sugerido</button>
                  )}
                </div>
              )}
              {fueraDeBanda && (
                <p className="text-[11px] text-warning mt-1.5 leading-relaxed">
                  ⚠️ Fuera del rango de mercado ({cop(banda.min)}–{cop(banda.max)}/día) para este valor comercial.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Comisión plataforma (%)</label>
                <input type="number" step="0.1" value={(comision * 100).toFixed(1)}
                  onChange={e => setComision(numInput(e.target.value) / 100)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Ocupación esperada (%)</label>
                <input type="number" step="1" value={(ocupacion * 100).toFixed(0)}
                  onChange={e => setOcupacion(numInput(e.target.value) / 100)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
            </div>
          </div>
        </div>

        {/* Resultados */}
        <div className="space-y-4">
          <div className="rounded-2xl p-5 border-2 border-accent/40 bg-accent-light">
            <p className="text-[11px] font-bold uppercase tracking-wide text-accent mb-1">Precio de mercado sugerido</p>
            <p className="text-3xl font-black text-accent">{precioSugerido > 0 ? `${cop(precioSugerido)}` : '—'}<span className="text-base font-semibold text-ink/50"> /día</span></p>
            {precioSugerido > 0 && (
              <p className="text-xs text-ink/60 mt-1">Rango de cordura: {cop(banda.min)} – {cop(banda.max)} /día</p>
            )}
          </div>

          <div className={`rounded-2xl p-5 border-2 ${r.esRentable ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5'}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/50 mb-1">Utilidad neta estimada</p>
            <p className={`text-3xl font-black ${r.esRentable ? 'text-success' : 'text-danger'}`}>{cop(r.utilidadNetaMensual)}<span className="text-base font-semibold text-ink/50"> /mes</span></p>
            <p className="text-sm text-ink/60 mt-1">{cop(r.utilidadNetaAnual)} al año · ROI {pct(r.roiAnual)} anual</p>
            {!r.esRentable && (
              <p className="text-xs text-danger mt-2 font-medium">A este precio y ocupación no cubre costos.</p>
            )}
          </div>

          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h3 className="font-bold text-ink text-sm mb-3">Detalle del cálculo</h3>
            <dl className="space-y-2 text-sm">
              {[
                ['Impuesto vehicular', `${cop(r.impuesto)} (${pct(r.pctImpuesto)})`],
                ['Seguro todo riesgo', cop(r.seguro)],
                ['GPS (amortizado/año)', cop(r.gpsAnualAmortizado)],
                ['Costo de caja anual', cop(r.costoCajaAnual)],
                ['Depreciación anual', cop(r.depreciacion)],
                ['Punto de equilibrio/día', cop(r.puntoEquilibrioDia)],
                ['Días rentados/año', `${Math.round(r.diasRentados)} días`],
                ['Ingreso bruto anual', cop(r.ingresoBrutoAnual)],
                ['Comisión plataforma', cop(r.comisionCop)],
                ['Ingreso neto propietario', cop(r.ingresoNetoAnual)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-border/60 pb-2">
                  <dt className="text-ink/50">{k}</dt>
                  <dd className="font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
