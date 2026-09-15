'use client';
// ── Captura guiada de fotos por casillas ────────────────────────────────────
//
// COMPARTIDO por las dos pantallas que suben fotos de un servicio: la del
// mensajero sin login (`app/m/[token]/page.tsx`) y el panel de Operaciones del
// admin (`components/OperacionesPanel.tsx`). Una sola implementación para que el
// mensajero vea en el celular exactamente lo mismo que el administrador revisa
// después, y para que las instrucciones no se dupliquen.
//
// Las 8 zonas y sus instrucciones NO viven acá: vienen de `lib/fotos-servicio.ts`
// (módulo puro), que es la única fuente de verdad y la que usan también la IA, el
// acta y el bloqueo del servidor.
//
// Pensado para un celular, de pie, en la calle y con una mano:
//   · las 8 casillas se ven DESDE EL PRINCIPIO, con su nombre, su instrucción y si
//     ya está tomada o no — de un vistazo se sabe cuántas faltan;
//   · tocar una casilla vacía abre la cámara directo (`capture="environment"`);
//   · los botones son grandes y están apilados, no en una fila apretada.
//
// A propósito NO incluye el visor: para ver una foto en grande se usa el
// `VisorFotos` que ya existe, que el padre abre con `onVer`.
//
// Módulo de cliente puro: solo importa `lib/fotos-servicio` (sin fs ni
// better-sqlite3) y los iconos.
import { useRef, useState } from 'react';
import { IconCheck } from '@/components/Icons';
import {
  CASILLAS, fotoDeCasilla, fotosSinCasilla, omisionDeCasilla, resumenFase,
  MOTIVO_MIN, MOTIVO_MAX,
  type CasillaId, type FaseFoto, type FotoServicio, type OmisionFoto,
} from '@/lib/fotos-servicio';

type Props = {
  fase: FaseFoto;
  /** Encabezado visible ("Fotos de la ENTREGA al cliente"). */
  titulo: string;
  /** Fotos de ESTA fase, ya parseadas por el padre con `parseFotosServicio`. */
  fotos: FotoServicio[];
  /** Todas las omisiones de la operación (se filtran acá por fase). */
  omisiones: OmisionFoto[];
  /**
   * ¿A este servicio se le exigen las 8 casillas? (`operaciones.fotos_guiadas`).
   * Solo cambia el TEXTO: el bloqueo real lo hace el servidor. En los servicios
   * anteriores a las casillas las casillas se muestran igual —sirven para ordenar
   * el trabajo— pero no se anuncia un bloqueo que no existe para ellos.
   */
  exigidas: boolean;
  /** `capture="environment"` en el input: abre la cámara trasera directo (celular). */
  usarCamara?: boolean;
  /** Miniaturas más pequeñas para el panel del admin, que muestra dos fases por tarjeta. */
  compacto?: boolean;
  onFoto: (casilla: CasillaId, file: File) => Promise<void>;
  onQuitarFoto: (casilla: CasillaId) => Promise<void>;
  onOmitir: (casilla: CasillaId, motivo: string) => Promise<string | null>;
  onQuitarOmision: (casilla: CasillaId) => Promise<void>;
  /** Abre el visor a pantalla completa en esa URL (lo resuelve el padre). */
  onVer: (url: string) => void;
  /** Quitar una foto suelta, sin casilla, de una operación vieja. */
  onQuitarSuelta: (url: string) => Promise<void>;
};

export default function CasillasFotos({
  fase, titulo, fotos, omisiones, exigidas, usarCamara, compacto,
  onFoto, onQuitarFoto, onOmitir, onQuitarOmision, onVer, onQuitarSuelta,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Qué casilla disparó el selector de archivo. Un solo <input> para las 8: montar
  // ocho inputs de cámara en una pantalla que ya lista dos fases es desperdicio.
  const destino = useRef<CasillaId | null>(null);
  // Qué casillas tienen una operación en vuelo AHORA MISMO. Es un conjunto y no una
  // sola casilla porque las subidas son asíncronas y se solapan de verdad: subir una
  // foto tarda (se va a Cloudinary y pasa por el difuminado de placa), y en ese rato el
  // mensajero ya tocó la siguiente. Con una sola casilla, la primera en terminar
  // apagaba el "Subiendo…" de la segunda y reactivaba sus botones mientras todavía
  // estaba subiendo — o sea, invitaba a disparar la misma subida dos veces.
  const [ocupadas, setOcupadas] = useState<Record<string, boolean>>({});
  const marcarOcupada = (casilla: CasillaId, valor: boolean) =>
    setOcupadas(o => ({ ...o, [casilla]: valor }));
  const [motivando, setMotivando] = useState<CasillaId | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState('');

  const resumen = resumenFase(fotos, omisiones, fase);
  const sueltas = fotosSinCasilla(fotos);
  const mini = compacto ? 'w-16 h-16' : 'w-20 h-20';

  const pedirFoto = (casilla: CasillaId) => {
    destino.current = casilla;
    inputRef.current?.click();
  };

  const alElegirArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const casilla = destino.current;
    destino.current = null;
    if (inputRef.current) inputRef.current.value = '';
    if (!file || !casilla) return;
    marcarOcupada(casilla, true);
    try {
      await onFoto(casilla, file);
    } finally {
      marcarOcupada(casilla, false);
    }
  };

  const abrirMotivo = (casilla: CasillaId) => {
    setMotivando(casilla);
    setMotivo('');
    setErrorMotivo('');
  };

  const confirmarMotivo = async (casilla: CasillaId) => {
    setErrorMotivo('');
    marcarOcupada(casilla, true);
    try {
      const err = await onOmitir(casilla, motivo);
      if (err) { setErrorMotivo(err); return; }
      setMotivando(null);
      setMotivo('');
    } finally {
      marcarOcupada(casilla, false);
    }
  };

  const conAccion = async (casilla: CasillaId, fn: () => Promise<void>) => {
    marcarOcupada(casilla, true);
    try { await fn(); } finally { marcarOcupada(casilla, false); }
  };

  return (
    <div>
      {/* Encabezado: cuántas faltan, de un vistazo */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2">
        <p className="text-[11px] font-semibold text-ink uppercase tracking-wide">{titulo}</p>
        <p className={`text-[11px] font-semibold ${resumen.faltan === 0 ? 'text-success' : 'text-warning'}`}>
          {resumen.faltan === 0
            ? `✓ Completo (${resumen.tomadas} de ${resumen.total}${resumen.omitidas ? `, ${resumen.omitidas} omitida${resumen.omitidas === 1 ? '' : 's'}` : ''})`
            : `Faltan ${resumen.faltan} de ${resumen.total}`}
        </p>
      </div>
      {exigidas && resumen.faltan > 0 && (
        <p className="text-[11px] text-ink/50 mb-2">
          No se puede marcar esta tarea como hecha hasta que las {resumen.total} estén tomadas.
          Si de verdad no puedes tomar alguna, ábrela y escribe el motivo.
        </p>
      )}

      <ul className="space-y-1.5">
        {CASILLAS.map((c, i) => {
          const foto = fotoDeCasilla(fotos, c.id);
          const omitida = omisionDeCasilla(omisiones, fase, c.id);
          const trabajando = !!ocupadas[c.id];
          const estado: 'tomada' | 'omitida' | 'falta' = foto ? 'tomada' : omitida ? 'omitida' : 'falta';
          const borde = estado === 'tomada'
            ? 'border-success/40 bg-success/5'
            : estado === 'omitida'
              ? 'border-warning/40 bg-warning/5'
              : 'border-border bg-surface';
          return (
            <li key={c.id} className={`rounded-xl border p-2 ${borde}`}>
              <div className="flex gap-2.5">
                {/* Miniatura o casilla vacía: tocarla abre la cámara / el visor */}
                {foto ? (
                  <button
                    type="button"
                    onClick={() => onVer(foto.url)}
                    aria-label={`Ver en grande la foto de ${c.nombre.toLowerCase()}`}
                    className={`${mini} shrink-0 rounded-lg overflow-hidden border border-border`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={foto.url} alt={c.nombre} className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => pedirFoto(c.id)}
                    disabled={trabajando}
                    aria-label={`Tomar la foto de ${c.nombre.toLowerCase()}`}
                    className={`${mini} shrink-0 rounded-lg border-2 border-dashed ${estado === 'omitida' ? 'border-warning/40 text-warning' : 'border-border text-ink/40'} grid place-items-center text-xl disabled:opacity-50`}>
                    {trabajando ? '…' : estado === 'omitida' ? '!' : '📷'}
                  </button>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
                    <span className="text-ink/40 tabular-nums">{i + 1}.</span>
                    <span className="min-w-0">{c.nombre}</span>
                    {estado === 'tomada' && <span className="text-success shrink-0"><IconCheck size={13} /></span>}
                  </p>
                  <p className="text-[11px] text-ink/55 leading-snug mt-0.5">{c.instruccion}</p>

                  {omitida && !foto && (
                    <p className="text-[11px] text-warning mt-1">
                      Omitida: “{omitida.motivo}”
                      <span className="text-ink/45"> — {omitida.autor || 'sin nombre'}{omitida.fecha ? `, ${omitida.fecha}` : ''}</span>
                    </p>
                  )}

                  {/* Acciones. Apiladas y anchas: se usan de pie y con una mano. */}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <button
                      type="button"
                      onClick={() => pedirFoto(c.id)}
                      disabled={trabajando}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/20 transition disabled:opacity-40">
                      {trabajando ? 'Subiendo…' : foto ? '🔄 Repetir foto' : '📷 Tomar foto'}
                    </button>
                    {foto && (
                      <button
                        type="button"
                        onClick={() => conAccion(c.id, () => onQuitarFoto(c.id))}
                        disabled={trabajando}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition disabled:opacity-40">
                        Quitar
                      </button>
                    )}
                    {!foto && !omitida && motivando !== c.id && (
                      <button
                        type="button"
                        onClick={() => abrirMotivo(c.id)}
                        disabled={trabajando}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg bg-surface-2 text-ink/60 hover:text-ink transition disabled:opacity-40">
                        No puedo tomarla
                      </button>
                    )}
                    {omitida && !foto && (
                      <button
                        type="button"
                        onClick={() => conAccion(c.id, () => onQuitarOmision(c.id))}
                        disabled={trabajando}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg bg-surface-2 text-ink/60 hover:text-ink transition disabled:opacity-40">
                        Quitar el motivo
                      </button>
                    )}
                  </div>

                  {/* Motivo de la omisión: queda guardado con nombre y hora, y sale en el acta */}
                  {motivando === c.id && !foto && (
                    <div className="mt-2">
                      <label className="text-[11px] text-ink/60 block mb-1" htmlFor={`motivo-${fase}-${c.id}`}>
                        ¿Por qué no puedes tomar esta foto? Queda guardado con tu nombre y la hora.
                      </label>
                      <textarea
                        id={`motivo-${fase}-${c.id}`}
                        value={motivo}
                        onChange={e => setMotivo(e.target.value)}
                        maxLength={MOTIVO_MAX}
                        rows={2}
                        placeholder="Ej. El carro está encajonado en el parqueadero y no se puede dar la vuelta."
                        className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-[13px] text-ink placeholder:text-ink/40 resize-none" />
                      {errorMotivo && <p className="text-[11px] text-danger mt-1">{errorMotivo}</p>}
                      <div className="flex gap-1.5 mt-1.5">
                        <button
                          type="button"
                          onClick={() => confirmarMotivo(c.id)}
                          disabled={trabajando || motivo.trim().length < MOTIVO_MIN}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-warning/20 text-warning hover:bg-warning/30 transition disabled:opacity-40">
                          {trabajando ? 'Guardando…' : 'Guardar el motivo'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMotivando(null); setMotivo(''); setErrorMotivo(''); }}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-surface-2 text-ink/60 hover:text-ink transition">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Fotos de operaciones anteriores a las casillas: se siguen viendo y se pueden
          quitar, pero no cuentan para el bloqueo porque nadie sabe qué zona son. */}
      {sueltas.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[11px] text-ink/50 mb-1">
            Otras fotos de este servicio, sin casilla asignada ({sueltas.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sueltas.map((f, i) => (
              /* El botón de ver y el × de quitar son HERMANOS, no uno dentro del otro:
                 así tocar el × NO abre el visor (y un <button> no puede anidar otro). */
              <div key={f.url} className={`relative ${mini} rounded-lg overflow-hidden border border-border`}>
                <button
                  type="button"
                  onClick={() => onVer(f.url)}
                  aria-label={`Ver la foto sin casilla número ${i + 1} en grande`}
                  className="block w-full h-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={`Foto sin casilla ${i + 1}`} className="w-full h-full object-cover" />
                </button>
                <button
                  type="button"
                  onClick={() => onQuitarSuelta(f.url)}
                  aria-label={`Quitar la foto sin casilla número ${i + 1}`}
                  className="absolute top-1 right-1 z-10 bg-black/65 text-white w-5 h-5 rounded-full text-xs leading-none grid place-items-center">×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(usarCamara ? { capture: 'environment' as const } : {})}
        className="hidden"
        onChange={alElegirArchivo} />
    </div>
  );
}
