'use client';
import { useEffect, useState } from 'react';
import { IconArrowL, IconArrowR } from '@/components/Icons';
import { DIAS_SEMANA, fechaISOLocal as isoDate, picoPlacaVacio, placaRestringida, ultimoDigitoPlaca, type PicoPlaca } from '@/lib/pico-placa';
import { useLang } from '@/contexts/LanguageContext';

// Nombres de días en inglés, en el mismo orden/índices que DIAS_SEMANA (id '1'..'5' = Lun..Vie).
const DIA_NOMBRE_EN: Record<string, string> = { '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday' };

type Props = {
  /** Días marcados disponibles por el propietario. Vacío = cualquier día futuro. */
  availableDates?: string[];
  /** Días ya ocupados por reservas activas (no seleccionables). */
  reservedDates?: string[];
  placa?: string;
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
    ocupado: 'Ocupado', noDisponible: 'No disponible',
    rangoInvalido: 'Ese rango incluye días no disponibles. Elige otras fechas.',
    vehiculoInactivo: 'Este vehículo no está disponible para reservas en este momento.',
    ant: 'Ant.', sig: 'Sig.', limpiar: 'Limpiar',
    tocaRecogida: 'Toca el día de recogida.', tocaDevolucion: 'Ahora toca el día de devolución.', rangoOk: 'Rango seleccionado ✓',
    leyendaSel: 'Selección', leyendaDisp: 'Disponible', leyendaOcup: 'Ocupado', leyendaPico: 'Pico y placa',
    placaTermina: 'Placa termina en', picoPlacaDia: 'pico y placa:', sinRestriccion: 'sin restricción de pico y placa',
  },
  en: {
    dias: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], locale: 'en-US',
    ocupado: 'Booked', noDisponible: 'Not available',
    rangoInvalido: 'That range includes unavailable days. Pick other dates.',
    vehiculoInactivo: 'This vehicle is not available for booking right now.',
    ant: 'Prev', sig: 'Next', limpiar: 'Clear',
    tocaRecogida: 'Tap the pickup day.', tocaDevolucion: 'Now tap the return day.', rangoOk: 'Range selected ✓',
    leyendaSel: 'Selected', leyendaDisp: 'Available', leyendaOcup: 'Booked', leyendaPico: 'Plate restriction',
    placaTermina: 'Plate ends in', picoPlacaDia: 'restricted day:', sinRestriccion: 'no plate restriction',
  },
};

export default function CalendarioReserva({
  availableDates, reservedDates, placa, inicio, fin, onChange, disabled,
}: Props) {
  const { lang } = useLang();
  const c = T[lang];
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [base, setBase] = useState(() => new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [aviso, setAviso] = useState('');
  const [pp, setPp] = useState<PicoPlaca>(picoPlacaVacio());

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
  const diasRestriccionPlaca = digitoPlaca !== null && pp.activo
    ? DIAS_SEMANA.filter(d => (pp.dias[d.id] ?? []).includes(digitoPlaca)).map(d => (lang === 'en' ? DIA_NOMBRE_EN[d.id] : d.nombre))
    : [];

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
    // Sin inicio, o rango ya completo → empezar de nuevo
    if (!inicio || (inicio && fin)) { onChange(str, ''); return; }
    // Hay inicio, falta fin
    if (str <= inicio) { onChange(str, ''); return; }   // click anterior o igual → reinicia
    if (rangoLibre(inicio, str)) { onChange(inicio, str); }
    else { setAviso(c.rangoInvalido); onChange(str, ''); }
  };

  const enRango = (str: string) => inicio && fin && str > inicio && str < fin;

  const renderMes = (primerDia: Date) => {
    const año = primerDia.getFullYear();
    const mes = primerDia.getMonth();
    const totalDias = new Date(año, mes + 1, 0).getDate();
    const offset = (new Date(año, mes, 1).getDay() + 6) % 7;
    const nombreMes = primerDia.toLocaleDateString(c.locale, { month: 'long', year: 'numeric' });
    const picoSet = new Set<string>();
    if (placa) {
      for (let i = 1; i <= totalDias; i++) {
        const d = new Date(año, mes, i);
        if (placaRestringida(pp, placa, d)) picoSet.add(isoDate(d));
      }
    }
    const celdas: (Date | null)[] = [
      ...Array(offset).fill(null),
      ...Array.from({ length: totalDias }, (_, i) => new Date(año, mes, i + 1)),
    ];

    return (
      <div>
        <p className="text-sm font-semibold text-ink capitalize mb-2 text-center">{nombreMes}</p>
        <div className="grid grid-cols-7 gap-0.5 text-xs">
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

            let cls = '';
            let title: string | undefined;
            if (pasado) { cls = 'text-ink/15 cursor-not-allowed'; }
            else if (reservada) { cls = 'bg-danger/15 text-danger cursor-not-allowed line-through'; title = c.ocupado; }
            else if (noDispProp) { cls = 'text-ink/20 cursor-not-allowed'; title = c.noDisponible; }
            else if (esInicio || esFin) { cls = 'bg-accent text-white font-bold shadow-sm shadow-accent/30'; }
            else if (dentro) { cls = 'bg-accent/25 text-ink'; }
            else if (sel) { cls = 'text-ink hover:bg-accent/15 ring-1 ring-success/30'; }
            else { cls = 'text-ink/40'; }

            return (
              <button key={str} type="button" disabled={!sel}
                onClick={() => click(str, fecha)} title={title}
                className={`relative rounded-lg py-1.5 text-center transition select-none text-[11px] font-medium ${cls}`}>
                {fecha.getDate()}
                {esPico && !pasado && !reservada && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent block" />
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

  return (
    <div>
      {placa && digitoPlaca !== null && (
        <p className="text-xs text-ink/60 mb-2">
          {c.placaTermina} <span className="font-semibold text-ink">{digitoPlaca}</span>
          {diasRestriccionPlaca.length > 0
            ? <> — {c.picoPlacaDia} <span className="font-semibold text-accent">{diasRestriccionPlaca.join(lang === 'en' ? ' and ' : ' y ')}</span></>
            : <> — {c.sinRestriccion}</>}
        </p>
      )}
      <div className="flex justify-between items-center mb-2">
        <button type="button" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() - 1, 1))}
          disabled={base <= new Date(hoy.getFullYear(), hoy.getMonth(), 1)}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-2 py-1 rounded-lg hover:bg-accent-light transition text-xs font-medium disabled:opacity-30">
          <IconArrowL size={13} /> {c.ant}
        </button>
        {(inicio || fin) && (
          <button type="button" onClick={() => { onChange('', ''); setAviso(''); }}
            className="text-[11px] text-ink/50 hover:text-danger transition font-medium">{c.limpiar}</button>
        )}
        <button type="button" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() + 1, 1))}
          className="flex items-center gap-1 text-accent hover:text-accent-hover px-2 py-1 rounded-lg hover:bg-accent-light transition text-xs font-medium">
          {c.sig} <IconArrowR size={13} />
        </button>
      </div>

      {renderMes(base)}

      <p className="text-[11px] text-ink/50 mt-2">
        {!inicio ? c.tocaRecogida : !fin ? c.tocaDevolucion : c.rangoOk}
      </p>
      {aviso && <p className="text-[11px] text-danger mt-1">{aviso}</p>}

      <div className="mt-2 flex items-center gap-3 text-[10px] text-ink/45 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-accent inline-block" /> {c.leyendaSel}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded ring-1 ring-success/40 inline-block" /> {c.leyendaDisp}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-danger/15 border border-danger/30 inline-block" /> {c.leyendaOcup}</span>
        {placa && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded relative inline-block"><span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" /></span> {c.leyendaPico}</span>}
      </div>
    </div>
  );
}
