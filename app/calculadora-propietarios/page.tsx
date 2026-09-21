'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  IconCoin, IconCar, IconCheck, IconArrowR, IconArrowL, IconKey, IconCalendar, IconShield, IconUser, IconInbox,
  IconComuna13,
} from '@/components/Icons';
import {
  DEFAULTS_POR_TIPO, TIPO_VEHICULO_LABELS,
  COMISION_PLATAFORMA_DEFAULT, OCUPACION_DEFAULT, IVA_TARIFA_DEFAULT,
  GPS_DISPOSITIVO_DEFAULT, GPS_ANIOS_AMORTIZACION_DEFAULT, GPS_PLAN_ANUAL_DEFAULT,
  ANIO_MINIMO_SIN_INSPECCION, DIAS_MINIMOS_ALQUILER, ESCALERA_DURACION,
  calcularRentabilidad, sensibilidadPorOcupacion, desgloseTarifa, factorDuracion, factorPrecioCliente,
  type TipoVehiculo, type RentabilidadInput,
} from '@/lib/rentabilidad';
import {
  bandaPrecioValor, valorComercialSugerido, precioSegmentoPorAnio, precioMercadoSugerido,
  MODELOS_MERCADO, precioModeloSugerido,
  BENEFICIO_EXENCION_PICO_PLACA_DEFAULT, factorTarifaExencion,
  TRANSMISION_LABELS, EQUIPAMIENTO_LABELS,
  type Transmision, type Equipamiento,
} from '@/lib/precioMercado';
import {
  COMBUSTIBLE_LABELS, COMBUSTIBLES, exentoPicoPlaca, requiereInscripcionExencion,
  type Combustible,
} from '@/lib/vehiculo-campos';
import InputPorcentaje from '@/components/InputPorcentaje';

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

// Límites del año del vehículo. Sin ellos, vaciar el campo daba `anio = 0` y la página
// imprimía "Sugerido para un 0" y "Kia Picanto 0" en el texto que se pega en WhatsApp; y
// tecleando "2", "20", "201" el valor comercial saltaba a la curva de 10+ años en cada
// pulsación. Se corrige al salir del campo (onBlur) y no mientras se escribe, para no pelear
// con quien está tecleando.
const ANIO_MINIMO_VEHICULO = 1990;
const ANIO_MAXIMO_VEHICULO = new Date().getFullYear() + 1;
function anioValido(a: number): number {
  if (!Number.isFinite(a) || a <= 0) return new Date().getFullYear() - 2;
  return Math.min(ANIO_MAXIMO_VEHICULO, Math.max(ANIO_MINIMO_VEHICULO, a));
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
          <IconComuna13 size={26} className="text-accent" />
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
            <button onClick={reenviar} disabled={reenviando || cooldown > 0} className="text-accent font-medium disabled:opacity-50 disabled:text-ink/50">
              {cooldown > 0 ? `Reenviar en ${cooldown}s` : reenviando ? 'Reenviando…' : `Reenviar por ${canal === 'correo' ? 'correo' : 'WhatsApp'}`}
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-ink/50 text-center mt-4">
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
  const [precioDia, setPrecioDia] = useState(() => precioMercadoSugerido(primerTipo, primero.valorComercial) || primero.precioDia);
  const [comision, setComision] = useState(COMISION_PLATAFORMA_DEFAULT);
  const [ocupacion, setOcupacion] = useState(OCUPACION_DEFAULT);
  const [gpsAvanzado, setGpsAvanzado] = useState(false);
  const [gpsDispositivo, setGpsDispositivo] = useState(GPS_DISPOSITIVO_DEFAULT);
  const [gpsAnios, setGpsAnios] = useState(GPS_ANIOS_AMORTIZACION_DEFAULT);
  const [gpsPlan, setGpsPlan] = useState(GPS_PLAN_ANUAL_DEFAULT);
  const [ajustePrecio, setAjustePrecio] = useState(0);            // ajuste por demanda / negociación, %
  const [modeloIdx, setModeloIdx] = useState<number | null>(null); // null = "Otro / no está en la lista"
  const [transmision, setTransmision] = useState<Transmision>('mecanica');
  const [equipamiento, setEquipamiento] = useState<Equipamiento>('estandar');
  const [combustible, setCombustible] = useState<Combustible>('gasolina');
  const [exencionInscrita, setExencionInscrita] = useState(false);
  const [digitoPlaca, setDigitoPlaca] = useState('');              // '' = todavía no lo sabe
  // El BENEFICIO TOTAL de estar exento, no el multiplicador de tarifa: la parte que aportan los
  // días facturables se descuenta después con `factorTarifaExencion()`, para no contarla dos veces.
  const [beneficioExencion, setBeneficioExencion] = useState(BENEFICIO_EXENCION_PICO_PLACA_DEFAULT);
  const [diasAlquiler, setDiasAlquiler] = useState(DIAS_MINIMOS_ALQUILER + 1);
  const [cobrarIva, setCobrarIva] = useState(true);
  const [copiado, setCopiado] = useState<'cliente' | 'propietario' | null>(null);
  // Se cancela al desmontar: sin esto, salir de la página dentro de los 2 segundos siguientes a
  // copiar dispara un setState sobre un componente que ya no existe.
  const temporizadorCopiado = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (temporizadorCopiado.current) clearTimeout(temporizadorCopiado.current); }, []);

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
    setModeloIdx(null);                    // categoría manual → sin modelo específico
    setTipo(t);
    setNombreVehiculo(TIPO_VEHICULO_LABELS[t]);
    const d = DEFAULTS_POR_TIPO[t];
    setSoat(d.soat);
    setPctSeguro(d.pctSeguro);
    setMantenimiento(d.mantenimiento);
    // Valor comercial y precio/día se recalculan solos (efectos abajo).
  };

  const aplicarModelo = (idxStr: string) => {
    if (idxStr === '') { setModeloIdx(null); return; }   // "Otro / no está en la lista"
    const idx = Number(idxStr);
    const m = MODELOS_MERCADO[idx];
    if (!m) { setModeloIdx(null); return; }
    setModeloIdx(idx);
    setTipo(m.tipo);
    setNombreVehiculo(`${m.marca} ${m.modelo}`);
    const d = DEFAULTS_POR_TIPO[m.tipo];
    setSoat(d.soat);
    setPctSeguro(d.pctSeguro);
    setMantenimiento(d.mantenimiento);
    // Los modelos que solo existen en automático fijan la transmisión: dejar el selector en
    // "mecánica" mostraría un valor comercial y un precio de una versión que no se vende.
    // Y al salir de uno de esos, se vuelve a mecánica: si no, el +10% de automática se quedaba
    // pegado al siguiente modelo (elegir un Tiguan y después un Mazda 2 lo dejaba automático).
    setTransmision(m.soloAutomatica ? 'automatica' : 'mecanica');
    // Valor comercial y precio/día se recalculan solos (efectos abajo).
  };

  const modeloSel = modeloIdx != null ? MODELOS_MERCADO[modeloIdx] : null;
  const soloAutomatica = !!modeloSel?.soloAutomatica;
  const transmisionEfectiva: Transmision = soloAutomatica ? 'automatica' : transmision;

  // ¿Este vehículo está exento de pico y placa? La decisión NO se toma acá: se delega en
  // `exentoPicoPlaca()` (lib/vehiculo-campos.ts), el mismo punto de verdad que usan el
  // calendario de reservas y el motor de disponibilidad. Los eléctricos quedan exentos
  // solos; los híbridos y los de gas, solo con la inscripción hecha ante la Secretaría de
  // Movilidad de Medellín.
  const exento = exentoPicoPlaca({ combustible, inscrita: exencionInscrita });
  const necesitaTramite = requiereInscripcionExencion(combustible);

  // ─── Valor comercial: ahora SÍ sigue al año ────────────────────────────────
  // Este era el bug reportado en producción: al bajar el año de un CX-5 de 2024 a 2016 el
  // precio caía de $435.000 a $326.000 pero el valor comercial se quedaba en $135.000.000,
  // el de un ejemplar 0 km. Eso metía el carro en el tramo del 3,5% de impuesto vehicular
  // en vez del 2,5%, inflaba la prima del seguro, subestimaba el retorno, y hacía que la
  // banda de cordura marcara como "fuera de mercado" el precio que la propia calculadora
  // acababa de sugerir.
  const valorBase = modeloSel ? modeloSel.valor : DEFAULTS_POR_TIPO[tipo].valorComercial;
  const valorSugerido = useMemo(
    () => valorComercialSugerido(valorBase, anio, { transmision: transmisionEfectiva, equipamiento, soloAutomatica }),
    [valorBase, anio, transmisionEfectiva, equipamiento, soloAutomatica],
  );

  // El valor sigue al sugerido cuando cambia alguna de sus entradas (modelo, categoría, año,
  // transmisión, equipamiento), y el propietario puede escribirlo a mano — ese valor manual
  // queda hasta el próximo cambio de esas entradas.
  //
  // Se reconcilia DURANTE EL RENDER y no en un `useEffect`, que es el patrón que React
  // recomienda para "ajustar estado cuando cambia una entrada derivada": el efecto provoca un
  // render intermedio con el valor viejo ya pintado (y es lo que marca la regla
  // react-hooks/set-state-in-effect). El `useState` testigo recuerda a qué sugerencia se
  // sincronizó la última vez, para no pisar lo que el propietario escribió a mano.
  // El testigo guarda la IDENTIDAD de las entradas, no la cifra resultante. Guardando la cifra,
  // dos modelos con el mismo valor de referencia no disparaban la reconciliación y el valor
  // escrito a mano para el carro anterior se quedaba pegado al nuevo. Hay varias colisiones
  // reales en la tabla: Alaskan y Trailblazer ($150M, y encima de segmentos distintos), RAV4 y
  // CX-9 ($160M), Equinox/CX-30/Sportage/Tucson/Arkana (todos $120M).
  const claveValor = `${modeloIdx ?? 'n'}|${tipo}|${anio}|${transmisionEfectiva}|${equipamiento}`;
  const [valorSincronizado, setValorSincronizado] = useState(claveValor);
  if (claveValor !== valorSincronizado) {
    setValorSincronizado(claveValor);
    // Blindaje: `NaN !== NaN` es siempre true, así que un NaN acá sería un "Too many
    // re-renders" y una página en blanco. Hoy es inalcanzable, pero sale barato.
    if (Number.isFinite(valorSugerido)) setValorComercial(valorSugerido || 0);
  }

  // Precio sugerido EFECTIVO: si hay modelo elegido manda la tabla marca+modelo (afinada por
  // año, transmisión y exención); si no, se interpola por segmento según el valor comercial.
  // En ambos casos aplica el ajuste %. La escalera de duración NO entra acá: este es el canon
  // base (tramo de 2 a 4 días) y la duración se aplica después, en la cotización.
  const factorExencionTarifa = factorTarifaExencion(beneficioExencion);
  const precioSugerido = useMemo(
    () => modeloSel
      ? precioModeloSugerido(modeloSel, anio, {
          ajustePct: ajustePrecio, transmision: transmisionEfectiva,
          exentoPicoPlaca: exento, factorExencion: factorExencionTarifa,
        })
      : precioSegmentoPorAnio(tipo, valorComercial, anio, {
          ajustePct: ajustePrecio, exentoPicoPlaca: exento, factorExencion: factorExencionTarifa,
        }),
    [modeloSel, tipo, valorComercial, anio, ajustePrecio, transmisionEfectiva, exento, factorExencionTarifa],
  );

  // El precio/día efectivo sigue al sugerido cuando cambia cualquiera de sus entradas (modelo,
  // categoría, valor, año, ajuste). El usuario aún puede escribirlo a mano: queda hasta el próximo
  // cambio de esas entradas. Mismo patrón de reconciliación en render que el valor comercial —
  // antes era un `useEffect` y pintaba un render intermedio con el precio anterior.
  const [precioSincronizado, setPrecioSincronizado] = useState(precioSugerido);
  if (Number.isFinite(precioSugerido) && precioSugerido !== precioSincronizado) {
    setPrecioSincronizado(precioSugerido);
    setPrecioDia(precioSugerido || 0);
  }

  // ─── Escalera de duración y disponibilidad ─────────────────────────────────
  // `precioDia` es el CANON base, el del tramo más corto (2 a 4 días). La escalera de
  // duración se aplica encima, y sobre ese canon ya escalonado se calcula el IVA — que se
  // causa sobre la comisión, no sobre el canon (ver desgloseTarifa en lib/rentabilidad.ts).
  const canonPorDias = (dias: number) => Math.round(precioDia * factorDuracion(dias) / 1000) * 1000;
  const tarifaPorDias = (dias: number) => desgloseTarifa(canonPorDias(dias), { comision, cobrarIva });
  const diasCotiza = Math.max(DIAS_MINIMOS_ALQUILER, diasAlquiler || DIAS_MINIMOS_ALQUILER);

  // Un carro NO exento pierde un día hábil por semana de disponibilidad: 52 días al año que
  // no se pueden alquilar por más demanda que haya. Es el techo real de ocupación.
  const diasDisponiblesAnio = exento ? 365 : 365 - 52;
  const ocupacionTecho = diasDisponiblesAnio / 365;
  const ocupacionExcedeTecho = ocupacion > ocupacionTecho + 0.001;

  // La proyección anual usa el canon YA ESCALONADO a la duración típica que el propietario
  // indicó arriba, no el del tramo de 2 días. Proyectar el año entero al canon corto es
  // literalmente "el precio de 2 días multiplicado por 365" — justo lo que la escalera existe
  // para evitar — y sobreestimaba la utilidad anual entre un 10% y un 28%.
  const input: RentabilidadInput = useMemo(() => ({
    valorComercial, soat, pctSeguro, mantenimiento,
    gpsDispositivo, gpsAniosAmortizacion: gpsAnios, gpsPlanAnual: gpsPlan,
    precioDia: Math.round(precioDia * factorDuracion(diasCotiza) / 1000) * 1000,
    comision, ocupacion, diasDisponibles: diasDisponiblesAnio,
  }), [valorComercial, soat, pctSeguro, mantenimiento, gpsDispositivo, gpsAnios, gpsPlan, precioDia, diasCotiza, comision, ocupacion, diasDisponiblesAnio]);

  const r = useMemo(() => calcularRentabilidad(input), [input]);
  const sensibilidad = useMemo(() => sensibilidadPorOcupacion(input), [input]);
  const requiereInspeccion = anio > 0 && anio < ANIO_MINIMO_SIN_INSPECCION;

  // Banda de cordura por valor comercial + posición del precio dentro de ella.
  // La banda tiene que mirar los MISMOS ejes que el precio, o vuelve a acusar el precio que la
  // propia calculadora sugiere: el equipamiento sube el valor y no la tarifa, la exención sube
  // la tarifa y no el valor.
  const banda = useMemo(
    () => bandaPrecioValor(valorComercial, {
      anio, equipamiento, factorExencion: exento ? factorExencionTarifa : 1,
    }),
    [valorComercial, anio, equipamiento, exento, factorExencionTarifa],
  );
  const fueraDeBanda: 'bajo' | 'alto' | null =
    valorComercial > 0 && precioDia > 0
      ? (precioDia < banda.min ? 'bajo' : precioDia > banda.max ? 'alto' : null)
      : null;
  const pctDelValor = valorComercial > 0 ? (precioDia / valorComercial) * 100 : 0;

  // ─── Cotización ────────────────────────────────────────────────────────────
  const tarifa = tarifaPorDias(diasCotiza);

  // El día de pico y placa del vehículo no se le cobra al arrendatario ni se le paga al
  // propietario: sale de los días facturables. Un carro exento factura los 7 días.
  //
  // Esta es la MITAD del beneficio de estar exento; la otra mitad va en la tarifa/día. Las dos
  // juntas componen el beneficio total configurable de arriba — ver `factorTarifaExencion()` en
  // lib/precioMercado.ts, donde está explicado por qué no se pueden aplicar las dos a full.
  const diasPicoPlaca = exento ? 0 : Math.floor(diasCotiza / 7);
  const diasFacturables = Math.max(1, diasCotiza - diasPicoPlaca);
  const totalCliente = tarifa.precioCliente * diasFacturables;
  const totalPropietario = tarifa.propietario * diasFacturables;

  const notaExencion = exento
    ? combustible === 'electrico'
      ? 'Exento de pico y placa en el Valle de Aburrá — se puede alquilar los 7 días. La exención de los eléctricos es automática por su registro en el RUNT; verifícalo en tu matrícula.'
      : 'Exento de pico y placa en el Valle de Aburrá — se puede alquilar los 7 días. Mantén vigente la inscripción de la exención ante la Secretaría de Movilidad de Medellín.'
    : null;

  const copiar = async (que: 'cliente' | 'propietario', texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      if (temporizadorCopiado.current) clearTimeout(temporizadorCopiado.current);
      temporizadorCopiado.current = setTimeout(() => setCopiado(null), 2000);
    } catch {
      /* Sin permiso de portapapeles (o contexto no seguro): el texto queda visible para
         seleccionarlo a mano, así que no hay nada que avisar. */
    }
  };

  // Tuteo, sin emojis y sin lenguaje burocrático: esto se pega tal cual en WhatsApp.
  const textoCliente = [
    `${nombreVehiculo} ${anio}`.trim(),
    `${cop(tarifaPorDias(DIAS_MINIMOS_ALQUILER).precioCliente)} por día`,
    `5 días o más: ${cop(tarifaPorDias(5).precioCliente)} por día`,
    `Un mes: ${cop(tarifaPorDias(30).precioCliente)} por día`,
    '',
    'Incluye kilometraje ilimitado, póliza SURA de alquiler y entrega donde estés.',
    ...(exento
      ? ['Este carro no tiene pico y placa, lo puedes usar los 7 días.']
      : digitoPlaca
        ? [`La placa termina en ${digitoPlaca}: tiene pico y placa un día entre semana, y ese día no te lo cobramos.`]
        : []),
  ].join('\n');

  const pctPropietario = Math.round((1 - comision) * 100);
  const textoPropietario = [
    `${nombreVehiculo} ${anio}`.trim(),
    `Tú recibes el ${pctPropietario}%: ${cop(tarifaPorDias(DIAS_MINIMOS_ALQUILER).propietario)} por día alquilado`,
  ].join('\n');

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
          seguro todo riesgo, mantenimiento y GPS. Ajusta cualquier campo — es tu vehículo, tus números.
        </p>
        <p className="text-ink/50 text-xs mt-2 flex items-center justify-center gap-1.5">
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
                <td className="py-2 font-semibold text-accent">{cop(precioMercadoSugerido(t, DEFAULTS_POR_TIPO[t].valorComercial))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-ink/50 mt-3">
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
            <p className="text-xs text-ink/50 mt-0.5">{cop(precioMercadoSugerido(t, DEFAULTS_POR_TIPO[t].valorComercial))}/día</p>
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
                <label className="text-xs font-medium text-ink/60 block mb-1">Marca y modelo</label>
                <select value={modeloIdx ?? ''} onChange={e => aplicarModelo(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                  <option value="">Otro / no está en la lista</option>
                  {(Object.keys(TIPO_VEHICULO_LABELS) as TipoVehiculo[]).map(t => {
                    const items = MODELOS_MERCADO
                      .map((m, i) => ({ m, i }))
                      .filter(x => x.m.tipo === t);
                    if (items.length === 0) return null;
                    return (
                      <optgroup key={t} label={TIPO_VEHICULO_LABELS[t]}>
                        {items.map(({ m, i }) => (
                          <option key={i} value={i}>{m.marca} {m.modelo}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <p className="text-[11px] text-ink/50 mt-1">Elige tu modelo para un precio afinado al mercado. Si no está, usa &ldquo;Otro&rdquo; y se estima por categoría y valor.</p>
              </div>
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
                  <input type="number" min={ANIO_MINIMO_VEHICULO} max={ANIO_MAXIMO_VEHICULO} value={anio}
                    onChange={e => setAnio(numInput(e.target.value))}
                    onBlur={e => setAnio(anioValido(numInput(e.target.value)))}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Transmisión</label>
                  <select value={transmisionEfectiva} disabled={soloAutomatica}
                    onChange={e => setTransmision(e.target.value as Transmision)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40">
                    {(Object.keys(TRANSMISION_LABELS) as Transmision[]).map(t => (
                      <option key={t} value={t}>{TRANSMISION_LABELS[t]}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-ink/50 mt-1">
                    {soloAutomatica
                      ? 'Este modelo solo se consigue automático.'
                      : 'Un automático vale más y se alquila más caro.'}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Equipamiento</label>
                  <select value={equipamiento} onChange={e => setEquipamiento(e.target.value as Equipamiento)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                    {(Object.keys(EQUIPAMIENTO_LABELS) as Equipamiento[]).map(t => (
                      <option key={t} value={t}>{EQUIPAMIENTO_LABELS[t]}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-ink/50 mt-1">Sube el valor comercial, no la tarifa.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Tren motriz</label>
                  <select value={combustible}
                    onChange={e => {
                      const c = e.target.value as Combustible;
                      setCombustible(c);
                      // La inscripción es de un vehículo concreto: al cambiar el tren motriz
                      // deja de aplicar, y dejarla marcada haría pasar por exento a un carro
                      // que no lo está.
                      if (!requiereInscripcionExencion(c)) setExencionInscrita(false);
                    }}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                    {COMBUSTIBLES.map(c => (
                      <option key={c} value={c}>{COMBUSTIBLE_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Último dígito de la placa</label>
                  <select value={exento ? 'exento' : digitoPlaca} disabled={exento}
                    onChange={e => setDigitoPlaca(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40">
                    {exento
                      ? <option value="exento">Exento</option>
                      : <>
                          <option value="">Todavía no lo sé</option>
                          {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </>}
                  </select>
                </div>
              </div>

              {necesitaTramite && (
                <label className="flex items-start gap-2.5 bg-surface rounded-xl border border-border px-3.5 py-3 cursor-pointer">
                  <input type="checkbox" checked={exencionInscrita}
                    onChange={e => setExencionInscrita(e.target.checked)}
                    className="mt-0.5 accent-accent" />
                  <span className="text-xs text-ink/70 leading-relaxed">
                    Ya inscribí la exención de pico y placa ante la <strong>Secretaría de Movilidad de Medellín</strong>.
                    <span className="block text-ink/50 mt-0.5">
                      En {COMBUSTIBLE_LABELS[combustible].toLowerCase()} la exención no es automática: sin ese trámite
                      el carro sigue con pico y placa y lo comparendan igual.
                    </span>
                  </span>
                </label>
              )}

              {notaExencion && (
                <div className="flex items-start gap-2.5 bg-success/10 border border-success/25 rounded-xl px-3.5 py-3">
                  <IconCheck size={14} className="text-success mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-success leading-relaxed">{notaExencion}</p>
                </div>
              )}

              {requiereInspeccion && (
                <div className="flex items-start gap-2.5 bg-warning/10 border border-warning/25 rounded-xl px-3.5 py-3">
                  <span className="text-warning text-base leading-none">⚠️</span>
                  <p className="text-xs text-warning leading-relaxed">
                    Los vehículos anteriores al modelo {ANIO_MINIMO_SIN_INSPECCION} no se aprueban automáticamente:
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
                {valorSugerido > 0 && (
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-[11px] text-ink/60">
                      Sugerido para un {anio}: <span className="font-semibold text-accent">{cop(valorSugerido)}</span>
                    </p>
                    {valorComercial !== valorSugerido && (
                      <button type="button" onClick={() => setValorComercial(valorSugerido)}
                        className="text-[11px] font-semibold text-accent hover:underline whitespace-nowrap">
                        Usar sugerido
                      </button>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-ink/50 mt-1">
                  Se recalcula con el año, la transmisión y el equipamiento. Puedes escribirlo a mano si conoces
                  el valor real de tu carro.
                </p>
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
                <InputPorcentaje value={pctSeguro} onChange={setPctSeguro} decimals={1}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/60 block mb-1">Mantenimiento anual (COP)</label>
                <input type="text" inputMode="numeric" value={mantenimiento.toLocaleString('es-CO')}
                  onChange={e => setMantenimiento(numInput(e.target.value))}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
            </div>
            <p className="text-[11px] text-ink/50 mt-2">
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
                {precioSugerido > 0 && (
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-[11px] text-ink/60">
                      {modeloSel
                        ? <>Precio de mercado de <span className="font-semibold text-ink">{modeloSel.marca} {modeloSel.modelo}</span> (afinado al año)</>
                        : <>Estimado por segmento según valor</>}
                      : <span className="font-semibold text-accent">{cop(precioSugerido)}/día</span>
                      <span className="text-ink/40"> · {pctDelValor.toFixed(2)}% del valor/día</span>
                    </p>
                    {precioDia !== precioSugerido && (
                      <button type="button" onClick={() => setPrecioDia(precioSugerido)}
                        className="text-[11px] font-semibold text-accent hover:underline whitespace-nowrap">
                        Usar sugerido
                      </button>
                    )}
                  </div>
                )}
                <div className="mt-2">
                  <label className="text-xs font-medium text-ink/60 block mb-1">Ajuste por demanda / negociación (%)</label>
                  <input type="number" step="1" value={ajustePrecio}
                    onChange={e => setAjustePrecio(Number(e.target.value) || 0)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                  <p className="text-[11px] text-ink/50 mt-1">Sube modelos muy pedidos (Fortuner, Prado, híbridos) o baja los de baja rotación. Recomendado: −15% a +15%.</p>
                </div>
                {exento && (
                  <div className="mt-2">
                    <label className="text-xs font-medium text-ink/60 block mb-1">Multiplicador por estar exento de pico y placa</label>
                    <input type="number" step="0.05" min="1" value={beneficioExencion}
                      onChange={e => setBeneficioExencion(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                    <p className="text-[11px] text-ink/50 mt-1 leading-relaxed">
                      Un carro sin pico y placa se alquila los 7 días y se cobra más caro. En Medellín la diferencia
                      publicada llega al 50%; por defecto usamos {BENEFICIO_EXENCION_PICO_PLACA_DEFAULT.toFixed(2)},
                      que es más conservador.
                    </p>
                  </div>
                )}
                {modeloSel?.estimado && (
                  <p className="text-[11px] text-ink/60 mt-2 leading-relaxed bg-surface rounded-lg border border-border px-2.5 py-2">
                    <strong className="text-ink/80">Precio estimado</strong> — sin referencia publicada en el mercado
                    formal. Lo calculamos a partir de modelos comparables que sí la tienen, así que tómalo como un
                    punto de partida y no como una tarifa de referencia.
                  </p>
                )}
                {fueraDeBanda && (
                  <p className="text-[11px] text-warning mt-2 leading-relaxed">
                    ⚠️ Este precio está {fueraDeBanda === 'alto' ? 'por encima' : 'por debajo'} del rango de mercado
                    para un carro de este valor ({cop(banda.min)}–{cop(banda.max)}/día). Revísalo antes de publicar.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Comisión de la plataforma (%)</label>
                  <InputPorcentaje value={comision} onChange={setComision} decimals={1}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/60 block mb-1">Ocupación esperada (%)</label>
                  <InputPorcentaje value={ocupacion} onChange={setOcupacion} decimals={0}
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
              {ocupacionExcedeTecho && (
                <p className="text-[11px] text-warning leading-relaxed">
                  Con pico y placa tu carro solo está disponible {diasDisponiblesAnio} días al año
                  ({pct(ocupacionTecho)} como máximo). Por encima de ahí los números no se cumplen.
                </p>
              )}
            </div>
          </div>

          {/* ─── Cotización para WhatsApp ─── */}
          <div className="bg-surface-2 rounded-2xl border border-border p-5">
            <h2 className="font-bold text-ink text-sm mb-4 flex items-center gap-2">
              <IconCalendar size={15} className="text-accent" /> Cotización
            </h2>

            <div className="mb-4">
              <label className="text-xs font-medium text-ink/60 block mb-1">Días de alquiler</label>
              <input type="number" min={DIAS_MINIMOS_ALQUILER} value={diasAlquiler}
                onChange={e => setDiasAlquiler(numInput(e.target.value))}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
              {diasAlquiler < DIAS_MINIMOS_ALQUILER && (
                <p className="text-[11px] text-warning mt-1">
                  El alquiler de un solo día no está disponible: el mínimo son {DIAS_MINIMOS_ALQUILER} días.
                </p>
              )}
            </div>

            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="text-left text-ink/50 text-[11px] uppercase tracking-wide">
                  <th className="pb-2 font-semibold">Duración</th>
                  <th className="pb-2 font-semibold text-right">Canon/día</th>
                  <th className="pb-2 font-semibold text-right">Paga el cliente</th>
                </tr>
              </thead>
              <tbody>
                {ESCALERA_DURACION.map(t => {
                  const activo = diasCotiza >= t.desde && (t.hasta === null || diasCotiza <= t.hasta);
                  const d = tarifaPorDias(t.desde);
                  return (
                    <tr key={t.desde} className={`border-t border-border/60 ${activo ? 'bg-accent-light' : ''}`}>
                      <td className="py-2 font-medium text-ink">{t.etiqueta}</td>
                      <td className="py-2 text-right text-ink/60 tabular-nums">{cop(d.canon)}</td>
                      <td className="py-2 text-right font-semibold text-accent tabular-nums">{cop(d.precioCliente)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
              <input type="checkbox" checked={cobrarIva} onChange={e => setCobrarIva(e.target.checked)}
                className="mt-0.5 accent-accent" />
              <span className="text-xs text-ink/70 leading-relaxed">
                Cobrar IVA
                <span className="block text-ink/50 mt-0.5">
                  El {pct(IVA_TARIFA_DEFAULT)} se causa sobre la comisión de DrivePass, no sobre el canon:
                  el cliente paga {factorPrecioCliente(comision).toFixed(4)} veces el canon.
                </span>
              </span>
            </label>

            <dl className="space-y-2 text-sm border-t border-border/60 pt-3">
              <div className="flex items-center justify-between">
                <dt className="text-ink/50">Canon por día ({diasCotiza} días)</dt>
                <dd className="font-medium text-ink tabular-nums">{cop(tarifa.canon)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/50">Comisión DrivePass ({pct(comision)})</dt>
                <dd className="font-medium text-ink tabular-nums">{cop(tarifa.comision)}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink/50">IVA sobre la comisión ({pct(IVA_TARIFA_DEFAULT)})</dt>
                <dd className="font-medium text-ink tabular-nums">{cobrarIva ? cop(tarifa.iva) : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink font-semibold">Precio al cliente / día</dt>
                <dd className="font-bold text-accent tabular-nums">{cop(tarifa.precioCliente)}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <dt className="text-ink font-semibold">Tú recibes / día</dt>
                <dd className="font-bold text-success tabular-nums">{cop(tarifa.propietario)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/50">Días facturables</dt>
                <dd className="font-medium text-ink tabular-nums">
                  {diasFacturables} de {diasCotiza}
                  {diasPicoPlaca > 0 && <span className="text-ink/40"> · −{diasPicoPlaca} por pico y placa</span>}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/50">Total del alquiler (cliente)</dt>
                <dd className="font-medium text-ink tabular-nums">{cop(totalCliente)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/50">Total para ti</dt>
                <dd className="font-medium text-success tabular-nums">{cop(totalPropietario)}</dd>
              </div>
            </dl>

            {diasPicoPlaca > 0 && (
              <p className="text-[11px] text-ink/50 mt-3 leading-relaxed">
                El día de pico y placa no se le cobra al cliente ni se te paga a ti: sale de los días facturables.
                Un carro exento factura los 7 días de la semana.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <button type="button" onClick={() => copiar('cliente', textoCliente)}
                className="text-xs font-semibold py-2.5 rounded-xl border border-accent text-accent hover:bg-accent-light transition">
                {copiado === 'cliente' ? 'Copiado' : 'Copiar cotización · cliente'}
              </button>
              <button type="button" onClick={() => copiar('propietario', textoPropietario)}
                className="text-xs font-semibold py-2.5 rounded-xl border border-border text-ink/70 hover:bg-surface transition">
                {copiado === 'propietario' ? 'Copiado' : 'Copiar cotización · propietario'}
              </button>
            </div>
            <pre className="text-[11px] text-ink/60 bg-surface rounded-xl border border-border p-3 mt-3 whitespace-pre-wrap font-sans leading-relaxed">
              {textoCliente}
            </pre>
          </div>
        </div>

        {/* RESULTADOS */}
        <div className="space-y-5">
          <div className={`rounded-2xl p-6 border-2 ${r.esRentable ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5'}`}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/50 mb-1">Ingreso mensual (después de comisión)</p>
            <p className="text-3xl font-black text-success">{cop(r.ingresoNetoAnual / 12)}<span className="text-base font-semibold text-ink/50"> /mes</span></p>

            <div className="border-t border-border/60 mt-4 pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/50 mb-1">Ganancia neta (después de gastos)</p>
              <p className={`text-2xl font-black ${r.esRentable ? 'text-success' : 'text-danger'}`}>{cop(r.utilidadNetaMensual)}<span className="text-sm font-semibold text-ink/50"> /mes</span></p>
              <p className="text-sm text-ink/60 mt-1">{cop(r.utilidadNetaAnual)} al año · retorno de {pct(r.roiAnual)} anual sobre el valor de tu carro</p>
              {!r.esRentable && (
                <p className="text-xs text-danger mt-2 font-medium">A este precio y ocupación no cubres tus costos — sube el precio por día o la ocupación esperada.</p>
              )}
            </div>
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
                <p className="text-[11px] text-ink/50 mt-1 leading-relaxed">
                  Es lo que sale de tu bolsillo cada año: SOAT {cop(soat)} + impuesto vehicular {cop(r.impuesto)} + seguro todo riesgo {cop(r.seguro)} + mantenimiento {cop(mantenimiento)} + GPS amortizado {cop(r.gpsAnualAmortizado)} = {cop(r.costoCajaAnual)}.
                </p>
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
                  <p className="text-[10px] text-ink/50">/mes</p>
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

      <p className="text-[11px] text-ink/50 text-center mt-8 max-w-2xl mx-auto leading-relaxed flex items-center justify-center gap-1.5">
        <IconCheck size={12} className="flex-shrink-0" />
        Tarifas de referencia de rentadoras formales de Medellín (septiembre 2026); SOAT, impuesto vehicular de
        Antioquia y seguros con tarifas 2026. Es una guía, no una cotización en firme — tu caso real puede variar.
      </p>
    </div>
  );
}
