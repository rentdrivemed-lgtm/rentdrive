'use client';
import { useEffect, useState } from 'react';
import { IconArrowL, IconArrowR } from '@/components/Icons';
import { DIAS_SEMANA, fechaISOLocal as isoDate, picoPlacaVacio, placaRestringida, ultimoDigitoPlaca, type PicoPlaca } from '@/lib/pico-placa';
import { exentoPicoPlaca, motivoExencion } from '@/lib/vehiculo-campos';
import { calcularDiasAlquiler } from '@/lib/lugares';
import { MIN_NOCHES_RESERVA } from '@/lib/disponibilidad-reglas';
import { useLang } from '@/contexts/LanguageContext';

// Nombres de días en inglés, en el mismo orden/índices que DIAS_SEMANA (id '1'..'5' = Lun..Vie).
const DIA_NOMBRE_EN: Record<string, string> = { '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday' };

type Props = {
  /** Días marcados disponibles por el propietario. Vacío = cualquier día futuro. */
  availableDates?: string[];
  /** Días ya ocupados por reservas activas (no seleccionables). */
  reservedDates?: string[];
  placa?: string;
  /**
   * Combustible del vehículo (ver lib/vehiculo-campos.ts). Junto con `exencionInscrita`
   * decide si el vehículo está exento de pico y placa en Medellín: si lo está, no se le
   * marca ningún día ni se le muestra el aviso de restricción.
   */
  combustible?: string;
  /**
   * `vehiculos.exencion_pico_placa_inscrita` (0/1 desde la BD): el propietario confirmó que
   * inscribió la exención ante la Secretaría de Movilidad de Medellín. Los híbridos y los de
   * gas (GNV) solo están exentos CON ese trámite; los eléctricos lo están sin él.
   */
  exencionInscrita?: boolean | number;
  /** Rango seleccionado (ISO YYYY-MM-DD). fin = día de devolución. */
  inicio: string;
  fin: string;
  onChange: (inicio: string, fin: string) => void;
  /** Vehículo inactivo: bloquea toda selección. */
  disabled?: boolean;
};

const T = {
  es: {
    dias: ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'], locale: 'es-CO',
    rangoInvalido: 'Ese rango incluye días no disponibles. Elige otras fechas.',
    vehiculoInactivo: 'Este vehículo no está disponible para reservas en este momento.',
    ant: 'Ant.', sig: 'Sig.', limpiar: 'Limpiar',
    campoRecogida: 'Recogida', campoDevolucion: 'Devolución', eligeFecha: 'Elige la fecha',
    paso: (n: number) => `Paso ${n} de 2`,
    tocaRecogida: 'Toca en el calendario el día en que recoges el carro.',
    tocaDevolucion: 'Ahora toca el día en que lo devuelves.',
    capInicio: 'Recoge', capFin: 'Entrega',
    diasRes: (n: number) => `${n} día${n !== 1 ? 's' : ''} de alquiler`,
    noches: (n: number) => `${n} noche${n !== 1 ? 's' : ''}`,
    minNoches: `El alquiler mínimo es de ${MIN_NOCHES_RESERVA} noches.`,
    tituloOcupado: 'Ocupado: no se puede reservar',
    tituloNoDisp: 'El propietario no tiene disponible este día',
    tituloElegirInicio: 'Elegir como día de recogida',
    tituloElegirFin: 'Elegir como día de devolución',
    tituloCruza: 'No se puede: entre las dos fechas hay días no disponibles',
    leyendaInicio: 'Recogida', leyendaFin: 'Devolución',
    leyendaDisp: 'Disponible', leyendaOcup: 'Ocupado', leyendaPico: 'Pico y placa',
    placaTermina: 'Placa termina en', picoPlacaDia: 'pico y placa:', sinRestriccion: 'sin restricción de pico y placa',
    exento: 'exento de pico y placa por ser',
    motivoExento: { electrico: 'eléctrico', hibrido: 'híbrido', gas: 'a gas natural (GNV)' } as Record<string, string>,
  },
  en: {
    dias: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], locale: 'en-US',
    rangoInvalido: 'That range includes unavailable days. Pick other dates.',
    vehiculoInactivo: 'This vehicle is not available for booking right now.',
    ant: 'Prev', sig: 'Next', limpiar: 'Clear',
    campoRecogida: 'Pick-up', campoDevolucion: 'Return', eligeFecha: 'Choose the date',
    paso: (n: number) => `Step ${n} of 2`,
    tocaRecogida: 'Tap on the calendar the day you pick the car up.',
    tocaDevolucion: 'Now tap the day you bring it back.',
    capInicio: 'Pick-up', capFin: 'Return',
    diasRes: (n: number) => `${n} rental day${n !== 1 ? 's' : ''}`,
    noches: (n: number) => `${n} night${n !== 1 ? 's' : ''}`,
    minNoches: `The minimum rental is ${MIN_NOCHES_RESERVA} nights.`,
    tituloOcupado: 'Booked: not available',
    tituloNoDisp: 'The owner is not available on this day',
    tituloElegirInicio: 'Choose as pick-up day',
    tituloElegirFin: 'Choose as return day',
    tituloCruza: 'Not possible: there are unavailable days in between',
    leyendaInicio: 'Pick-up', leyendaFin: 'Return',
    leyendaDisp: 'Available', leyendaOcup: 'Booked', leyendaPico: 'Plate restriction',
    placaTermina: 'Plate ends in', picoPlacaDia: 'restricted day:', sinRestriccion: 'no plate restriction',
    exento: 'exempt from the plate restriction — it is',
    motivoExento: { electrico: 'electric', hibrido: 'hybrid', gas: 'natural gas (CNG) powered' } as Record<string, string>,
  },
};

/** 'YYYY-MM-DD' → Date local (sin desfase de zona horaria). */
function fromISO(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function CalendarioReserva({
  availableDates, reservedDates, placa, combustible, exencionInscrita, inicio, fin, onChange, disabled,
}: Props) {
  const { lang } = useLang();
  const c = T[lang];
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [base, setBase] = useState(() => new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [aviso, setAviso] = useState('');
  const [pp, setPp] = useState<PicoPlaca>(picoPlacaVacio());
  // Día bajo el cursor / con foco de teclado: sirve para pintar la vista previa del rango.
  const [preview, setPreview] = useState('');

  useEffect(() => {
    let cancelado = false;
    fetch('/api/pico-placa')
      .then(r => (r.ok ? r.json() : null))
      .then((data: Partial<PicoPlaca> | null) => {
        if (cancelado || !data) return;
        setPp({ activo: !!data.activo, vigencia: data.vigencia ?? '', dias: data.dias ?? {} });
      })
      .catch(() => { /* si falla, no se marca ningún día — el calendario sigue funcionando */ });
    return () => { cancelado = true; };
  }, []);

  const reservedSet = new Set(reservedDates || []);
  const availSet = availableDates && availableDates.length > 0 ? new Set(availableDates) : null;

  // Último dígito de la placa y, bajo la config vigente, el/los día(s) de la semana en
  // que está restringido (vacío si pico y placa está desactivado o no aplica al dígito).
  const digitoPlaca = placa ? ultimoDigitoPlaca(placa) : null;
  // Exento en Medellín (eléctrico siempre; híbrido/GNV solo con la inscripción confirmada
  // ante la Secretaría de Movilidad) — ni días marcados ni lista de días.
  const exencion = { combustible, inscrita: exencionInscrita };
  const exento = exentoPicoPlaca(exencion);
  const diasRestriccionPlaca = digitoPlaca !== null && pp.activo && !exento
    ? DIAS_SEMANA.filter(d => (pp.dias[d.id] ?? []).includes(digitoPlaca)).map(d => (lang === 'en' ? DIA_NOMBRE_EN[d.id] : d.nombre))
    : [];
  const etiquetaExento = c.motivoExento[motivoExencion(exencion) ?? ''] ?? '';

  const seleccionable = (fecha: Date, str: string) => {
    if (disabled) return false;
    if (fecha < hoy) return false;
    if (reservedSet.has(str)) return false;
    if (availSet && !availSet.has(str)) return false; // si hay restricción del propietario
    return true;
  };

  // Todos los días del rango [a..b] (inclusive) deben ser seleccionables.
  const rangoLibre = (a: string, b: string) => {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    const cur = new Date(ay, am - 1, ad);
    const end = new Date(by, bm - 1, bd);
    while (cur <= end) {
      if (!seleccionable(cur, isoDate(cur))) return false;
      cur.setDate(cur.getDate() + 1);
    }
    return true;
  };

  const click = (str: string, fecha: Date) => {
    if (!seleccionable(fecha, str)) return;
    setAviso('');
    setPreview('');
    // Sin inicio, o rango ya completo → empezar de nuevo
    if (!inicio || (inicio && fin)) { onChange(str, ''); return; }
    // Hay inicio, falta fin
    if (str <= inicio) { onChange(str, ''); return; }   // click anterior o igual → reinicia
    if (rangoLibre(inicio, str)) { onChange(inicio, str); }
    else { setAviso(c.rangoInvalido); onChange(str, ''); }
  };

  const enRango = (str: string) => inicio && fin && str > inicio && str < fin;

  // Paso actual del flujo: 1) elegir recogida, 2) elegir devolución, 'listo' con el rango completo.
  const paso: 'inicio' | 'fin' | 'listo' = !inicio ? 'inicio' : !fin ? 'fin' : 'listo';

  // Vista previa del rango: solo con la recogida ya elegida y un día posterior señalado.
  const previewFin = paso === 'fin' && preview > inicio ? preview : '';
  const previewValido = previewFin ? rangoLibre(inicio, previewFin) : false;

  const fmtCorto = (str: string) =>
    fromISO(str).toLocaleDateString(c.locale, { weekday: 'short', day: 'numeric', month: 'short' });

  /** "20 – 23 de septiembre" / "28 de septiembre – 3 de octubre" (y su equivalente en inglés). */
  const rangoNatural = (a: string, b: string) => {
    const da = fromISO(a), db = fromISO(b);
    const mismoMes = da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear();
    if (lang === 'en') {
      const ini = da.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      return mismoMes ? `${ini} – ${db.getDate()}` : `${ini} – ${db.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
    }
    const mesA = da.toLocaleDateString('es-CO', { month: 'long' });
    const mesB = db.toLocaleDateString('es-CO', { month: 'long' });
    return mismoMes ? `${da.getDate()} – ${db.getDate()} de ${mesB}` : `${da.getDate()} de ${mesA} – ${db.getDate()} de ${mesB}`;
  };

  // MISMO número que se le cobra al cliente (app/api/reservas/route.ts y el resumen de precio
  // de la ficha usan calcularDiasAlquiler): días de alquiler = noches entre recogida y devolución.
  const diasRango = paso === 'listo' ? calcularDiasAlquiler(inicio, fin) : 0;

  const irAPaso = (destino: 'inicio' | 'fin') => {
    setAviso('');
    setPreview('');
    if (destino === 'inicio') { onChange('', ''); return; }
    if (inicio) onChange(inicio, '');
  };

  const renderMes = (primerDia: Date) => {
    const año = primerDia.getFullYear();
    const mes = primerDia.getMonth();
    const totalDias = new Date(año, mes + 1, 0).getDate();
    const offset = (new Date(año, mes, 1).getDay() + 6) % 7;
    // Solo se capitaliza la PRIMERA letra, no cada palabra: en español el mes va en
    // minúscula y `toLocaleDateString` devuelve "septiembre de 2026", así que la clase
    // `capitalize` de CSS lo dejaba como "Septiembre De 2026" (con "De" en mayúscula).
    const mesCrudo = primerDia.toLocaleDateString(c.locale, { month: 'long', year: 'numeric' });
    const nombreMes = mesCrudo.charAt(0).toUpperCase() + mesCrudo.slice(1);
    const picoSet = new Set<string>();
    if (placa) {
      for (let i = 1; i <= totalDias; i++) {
        const d = new Date(año, mes, i);
        if (placaRestringida(pp, placa, d, exencion)) picoSet.add(isoDate(d));
      }
    }
    const celdas: (Date | null)[] = [
      ...Array(offset).fill(null),
      ...Array.from({ length: totalDias }, (_, i) => new Date(año, mes, i + 1)),
    ];

    return (
      <div>
        <p className="text-sm font-semibold text-ink mb-2 text-center">{nombreMes}</p>
        <div className="grid grid-cols-7 gap-0.5 text-xs" onMouseLeave={() => setPreview('')}>
          {c.dias.map(d => (
            <div key={d} className="text-center text-ink/40 font-semibold py-1">{d}</div>
          ))}
          {celdas.map((fecha, i) => {
            if (!fecha) return <div key={`e${i}`} />;
            const str = isoDate(fecha);
            const pasado = fecha < hoy;
            const reservada = reservedSet.has(str);
            const noDispProp = !!availSet && !availSet.has(str);
            const sel = seleccionable(fecha, str);
            const esInicio = str === inicio;
            const esFin = str === fin;
            const dentro = enRango(str);
            const esPico = picoSet.has(str);
            const esPreviewFin = !!previewFin && str === previewFin;
            const enPreview = !!previewFin && previewValido && str > inicio && str < previewFin;

            let cls = '';
            let cap = '';
            let title: string | undefined;
            if (pasado) { cls = 'text-ink/15 cursor-not-allowed'; }
            else if (reservada) { cls = 'bg-danger/15 text-danger cursor-not-allowed line-through'; title = c.tituloOcupado; }
            else if (noDispProp) { cls = 'text-ink/20 cursor-not-allowed'; title = c.tituloNoDisp; }
            else if (esInicio) { cls = 'bg-accent text-white font-bold shadow-sm shadow-accent/30 rounded-l-2xl rounded-r-md'; cap = c.capInicio; title = c.campoRecogida; }
            else if (esFin) { cls = 'bg-accent text-white font-bold shadow-sm shadow-accent/30 rounded-r-2xl rounded-l-md ring-2 ring-accent-hover/70'; cap = c.capFin; title = c.campoDevolucion; }
            else if (dentro) { cls = 'bg-accent/40 text-white ring-1 ring-accent/60 rounded-md'; }
            else if (esPreviewFin && previewValido) { cls = 'bg-accent/70 text-white font-bold rounded-r-2xl rounded-l-md'; cap = c.capFin; title = c.tituloElegirFin; }
            else if (esPreviewFin) { cls = 'bg-danger/20 text-danger ring-1 ring-danger/40'; title = c.tituloCruza; }
            else if (enPreview) { cls = 'bg-accent/25 text-white ring-1 ring-accent/40'; }
            else if (sel) { cls = 'bg-surface-2 text-ink ring-1 ring-border-strong hover:bg-accent/25 hover:ring-accent/50'; title = paso === 'fin' ? c.tituloElegirFin : c.tituloElegirInicio; }
            else { cls = 'text-ink/40'; }

            return (
              <button key={str} type="button" disabled={!sel}
                onClick={() => click(str, fecha)}
                onMouseEnter={() => sel && setPreview(str)}
                onFocus={() => sel && setPreview(str)}
                onBlur={() => setPreview('')}
                title={title} aria-label={`${fmtCorto(str)}${title ? ` — ${title}` : ''}`}
                aria-pressed={sel ? esInicio || esFin || !!dentro : undefined}
                className={`relative flex flex-col items-center justify-center h-10 rounded-lg text-center transition select-none text-[13px] font-medium ${cls}`}>
                <span className="leading-none">{fecha.getDate()}</span>
                {cap && (
                  <span className="mt-0.5 text-[8px] font-bold uppercase tracking-tight leading-none">{cap}</span>
                )}
                {esPico && !pasado && !reservada && (
                  <span className={`absolute top-1 right-1 w-1 h-1 rounded-full block ${esInicio || esFin || esPreviewFin ? 'bg-white/80' : 'bg-accent'}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (disabled) {
    return (
      <div className="bg-danger/10 border border-danger/25 rounded-xl px-4 py-3 text-sm text-danger">
        {c.vehiculoInactivo}
      </div>
    );
  }

  const campoCls = (activo: boolean) =>
    `text-left rounded-xl px-3 py-2 border transition min-w-0 ${activo
      ? 'border-accent bg-accent-light ring-1 ring-accent/40'
      : 'border-border bg-surface-2 hover:border-border-strong'}`;

  return (
    <div>
      {/* Paso 1: los DOS campos del rango, arriba de todo — comunican de entrada que se
          eligen dos fechas (recogida y devolución), no días sueltos. */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => irAPaso('inicio')} aria-current={paso === 'inicio' ? 'step' : undefined}
          className={campoCls(paso === 'inicio')}>
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink/50">{c.campoRecogida}</span>
          <span className={`block text-sm font-semibold truncate ${inicio ? 'text-ink' : 'text-ink/35'}`}>
            {inicio ? fmtCorto(inicio) : c.eligeFecha}
          </span>
        </button>
        <button type="button" onClick={() => irAPaso('fin')} aria-current={paso === 'fin' ? 'step' : undefined}
          className={campoCls(paso === 'fin')}>
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink/50">{c.campoDevolucion}</span>
          <span className={`block text-sm font-semibold truncate ${fin ? 'text-ink' : 'text-ink/35'}`}>
            {fin ? fmtCorto(fin) : c.eligeFecha}
          </span>
        </button>
      </div>

      {/* Mismo espacio para la instrucción del paso activo y, al completarse, el resumen
          del rango. Va ARRIBA del calendario para que se lea antes de tocar un día. */}
      {paso === 'listo' ? (
        <div className={`mt-2 rounded-xl px-3 py-2 border ${diasRango < MIN_NOCHES_RESERVA
          ? 'bg-warning/10 border-warning/30' : 'bg-success/10 border-success/25'}`}>
          <p className="text-sm font-bold text-ink">{c.diasRes(diasRango)}</p>
          <p className="text-[11px] text-ink-soft">{rangoNatural(inicio, fin)} · {c.noches(diasRango)}</p>
          {diasRango < MIN_NOCHES_RESERVA && <p className="text-[11px] text-warning font-medium mt-0.5">{c.minNoches}</p>}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-accent-light border border-accent/25 px-3 py-2">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/15 rounded-full px-2 py-0.5">
            {c.paso(paso === 'inicio' ? 1 : 2)}
          </span>
          <p className="text-xs font-medium text-ink leading-snug">
            {paso === 'inicio' ? c.tocaRecogida : c.tocaDevolucion}
          </p>
        </div>
      )}
      {aviso && <p className="text-xs text-danger mt-1.5" role="alert">{aviso}</p>}

      <div className="flex justify-between items-center mt-3 mb-2">
        <button type="button" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() - 1, 1))}
          disabled={base <= new Date(hoy.getFullYear(), hoy.getMonth(), 1)}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-2 py-1 rounded-lg hover:bg-accent-light transition text-xs font-medium disabled:opacity-30">
          <IconArrowL size={13} /> {c.ant}
        </button>
        {(inicio || fin) && (
          <button type="button" onClick={() => { onChange('', ''); setAviso(''); setPreview(''); }}
            className="text-[11px] text-ink/50 hover:text-danger transition font-medium">{c.limpiar}</button>
        )}
        <button type="button" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() + 1, 1))}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-2 py-1 rounded-lg hover:bg-accent-light transition text-xs font-medium">
          {c.sig} <IconArrowR size={13} />
        </button>
      </div>

      {renderMes(base)}

      <div className="mt-2 flex items-center gap-3 text-[10px] text-ink-soft flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-l-full rounded-r-sm bg-accent inline-block" /> {c.leyendaInicio}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-r-full rounded-l-sm bg-accent ring-1 ring-accent-hover/70 inline-block" /> {c.leyendaFin}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-surface-2 ring-1 ring-border-strong inline-block" /> {c.leyendaDisp}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-danger/15 border border-danger/30 inline-block" /> {c.leyendaOcup}</span>
        {placa && !exento && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded relative inline-block"><span className="absolute top-0 right-0 w-1 h-1 rounded-full bg-accent" /></span> {c.leyendaPico}</span>}
      </div>

      {placa && digitoPlaca !== null && (
        <p className="text-[11px] text-ink/60 mt-2">
          {c.placaTermina} <span className="font-semibold text-ink">{digitoPlaca}</span>
          {exento
            ? <> — <span className="font-semibold text-success">{c.exento} {etiquetaExento}</span></>
            : diasRestriccionPlaca.length > 0
            ? <> — {c.picoPlacaDia} <span className="font-semibold text-accent">{diasRestriccionPlaca.join(lang === 'en' ? ' and ' : ' y ')}</span></>
            : <> — {c.sinRestriccion}</>}
        </p>
      )}
    </div>
  );
}
