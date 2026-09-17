'use client';
import Link from 'next/link';
import { useLang } from '@/contexts/LanguageContext';
import { IconArrowR, IconCheck } from '@/components/Icons';

// ── Respaldo asegurador: Seguros SURA ───────────────────────────────────────
//
// El seguro de la operación lo contrata DrivePass con SEGUROS GENERALES
// SURAMERICANA S.A. Todo lo que este bloque afirma está tomado del clausulado
// que las partes firman (ver `lib/contratos-plantillas.ts`): DrivePass figura
// como tomador y paga la prima, el propietario es el asegurado respecto del
// vehículo y el arrendatario queda incorporado al amparo de responsabilidad
// civil extracontractual.
//
// NO se promete cobertura total, porque el contrato dice lo contrario: el
// deducible, la franquicia, el faltante de la indemnización, el infraseguro y
// los hechos que el clausulado excluye —entre ellos la no restitución del
// vehículo— quedan por fuera del amparo. Por eso cada bloque cierra con un
// aviso que lo dice con todas las letras. Si alguien quiere «endurecer» el
// mensaje de marketing, tiene que cambiar antes el contrato, no este archivo.
//
// El número de póliza y su vigencia NO se publican aquí a propósito: son datos
// por vehículo, viven en `vehiculos.poliza_*`, cambian con cada renovación y
// salen impresos en el contrato que recibe cada parte. Una cifra desactualizada
// en la web sería peor que ninguna.
//
// Sobre el logo: SURA lo entrega en su versión corporativa —el logotipo «sura»
// en azul #0033A0 y el ala en cian #00AEC7—, no en blanco. Sobre los fondos
// oscuros del sitio (#0F1E33 / #16263F) ese azul queda ilegible, así que la
// marca va SIEMPRE sobre una placa blanca: es la práctica habitual de manual de
// marca, conserva los colores originales sin retocarlos y asegura el contraste.
// El SVG original venía de Inkscape (metadatos `sodipodi`/`inkscape`, 7,4 kB);
// aquí quedan solo los dos trazados, con las coordenadas redondeadas a tres
// decimales (4,5 kB, sin diferencia visible a 1000 px de ancho).

const RATIO = 1000 / 388.086;

/** Logotipo de Seguros SURA. Va sobre fondo claro; ver `PlacaSura`. */
export function LogoSura({ height = 26, className = '' }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 1000 388.086"
      width={Math.round(height * RATIO)}
      height={height}
      role="img"
      aria-label="Seguros SURA"
      className={className}
    >
      <g transform="matrix(6.4189189,0,0,6.4189189,25.000001,25.00015)">
        <path fill="#00AEC7" d="m114.063,4.248 c0.38,0.485 0.759,0.809 1.464,1.241 0.271,0.162 0.488,0.324 0.759,0.432 l1.735,0.917 c1.03,0.485 15.83,7.552 17.998,8.63 2.548,1.295 5.096,2.535 6.289,3.128 0.108,0 0.162,0 0.108,-0.162-2.765,-1.78-13.39,-8.576-20.926,-13.323 L116.015,1.767 115.039,1.173 113.196,0.04 c-0.109,-0.054-0.163,-0.054-0.163,0-0.054,0-0.108,0.054-0.108,0.108 0,0.27-0.055,1.672 0.379,2.751 0.217,0.432 0.434,0.917 0.759,1.349 zm-0.867,7.66 c0.759,0.809 1.68,1.349 2.819,1.726 l0.108,0.054 c0.325,0.108 19.571,5.286 24.667,6.689 2.222,0.593 4.011,1.079 4.825,1.349 0.108,0 0.162,0 0.162,-0.108 0,0 0,-0.054-0.054,-0.054-3.198,-1.349-23.04,-9.062-30.521,-12.029 l-3.145,-1.241 c-0.108,0-0.162,0-0.162,0.054-0.055,0.054-0.055,0.108-0.055,0.108 0.055,0.27 0.163,1.726 0.814,2.751 0.162,0.216 0.325,0.431 0.542,0.701 zm33.394,13.485 c-0.921,0-2.819,0-5.204,0-2.711,0-6.126,0-9.27,0-4.229,0-11.005,0-11.005,0 0,0-0.055,0-0.109,0.054-0.054,0.054-0.054,0.108 0,0.162 0.109,0.27 0.488,1.025 0.922,1.456 0.813,0.863 1.789,1.349 2.71,1.456 0.109,0 0.217,0 0.326,0 0.108,0 0.217,0 0.325,-0.054 0.108,0 20.167,-2.751 21.251,-2.913 0.054,0 0.109,-0.054 0.109,-0.108 0.054,-0.054 0,-0.054-0.055,-0.054 zm-11.167,9.763 c-1.735,1.079-3.904,2.265-5.042,2.967-0.108,0.108-0.217,0.108-0.163,0.432 0,0 0.055,0.324 0.109,0.701 0.108,1.672 0.813,1.51 1.789,0.755 l0.108,-0.108 c3.47,-2.859 9.921,-8.307 11.331,-9.493 0.054,-0.108 0,-0.162-0.055,-0.162-1.409,0.863-5.041,3.075-8.077,4.909 zm9.65,-7.713 c-1.247,0.378-5.964,1.564-10.138,2.589-3.632,0.917-7.698,2.05-7.698,2.05-0.38,0.108-0.271,0.27-0.217,0.324 0.108,0.162 0.379,0.539 0.596,1.025 0.651,1.079 1.518,0.971 2.331,0.647 0.109,-0.054 14.529,-6.041 15.18,-6.473 0.108,-0.054 0.054,-0.108 0.054,-0.108 0.054,-0.054-0.054,-0.054-0.108,-0.054 zm2.819,-3.884 c-2.548,-0.485-33.612,-6.149-33.612,-6.149-0.054,0-0.108,0-0.163,0.054-0.054,0.054-0.054,0.108 0,0.162 0.488,1.618 1.681,3.29 3.795,3.938 0.217,0.054 0.434,0.108 0.705,0.108 0,0 26.347,1.834 29.275,2.05 0.054,0 0.108,0 0.108,-0.054 0,0-0.054,-0.108-0.108,-0.108 zm-27.269,24.489 c-2.982,1.025-6.289,1.942-9.813,2.481-0.054,0-0.108,0.054-0.108,0.108 0,0.054 0,0.108 0,0.108 0.596,0.485 1.355,0.755 2.277,0.863 1.138,0.162 2.494,0 4.12,-0.432 1.409,-0.378 2.765,-0.971 4.283,-1.726 1.409,-0.701 2.819,-1.51 4.011,-2.32 1.193,-0.863 2.115,-1.672 2.657,-2.427 0.054,-0.108 0,-0.162-0.054,-0.162-1.898,1.295-4.392,2.481-7.373,3.506 zm18.107,-10.572-0.055,0.054 c-1.951,1.564-4.824,4.099-7.806,6.689-0.271,0.216-0.434,0.647-0.542,1.187-0.163,0.863-0.651,1.996-0.651,1.996-0.054,0.216 0.054,0.324 0.271,0.108 2.331,-2.481 7.482,-8.199 8.837,-9.817 0.054,-0.162 0,-0.216-0.054,-0.216 zm-11.114,5.34 c0.054,-0.108 0,-0.162-0.054,-0.162-2.873,1.133-9.216,2.265-13.174,2.859-3.415,0.485-6.342,0.593-7.969,0.701 h-0.705 c-0.108,0.054-0.162,0.108-0.162,0.162 0,0.054 0.054,0.108 0.054,0.162 0.271,0.324 1.247,1.241 3.144,1.51 2.223,0.324 5.476,-0.216 9.542,-1.402 3.469,-0.971 7.427,-2.643 9.324,-3.83 zm-0.325,5.07 c0,0-0.054,0-0.109,0.054-2.493,2.427-6.126,3.776-7.318,4.153-0.054,0-0.109,0.054-0.109,0.108 0,0.054 0.055,0.162 0.109,0.162 0.217,0.108 1.68,0.863 4.445,-0.485 1.572,-0.809 2.386,-2.104 3.09,-3.83 0,-0.054-0.054,-0.108-0.108,-0.162 z" />
        <path fill="#0033A0" d="M15.18,25.716 8.891,23.99 c-1.735,-0.485-3.307,-1.241-3.307,-3.398 0,-2.212 1.355,-3.29 4.12,-3.29 h5.584 c2.494,0 5.421,-0.809 5.421,-4.909 H10.192 C3.741,12.447 0,15.683 0,20.43 c0,4.423 2.765,6.85 7.698,8.199 l5.475,1.456 c2.277,0.593 3.09,2.05 3.09,3.506 0,2.212-1.409,3.56-4.771,3.56 L1.03,37.259 v4.801 H11.656 c6.505,0 10.192,-3.506 10.192,-8.145 0,-4.585-1.789,-6.85-6.668,-8.199 zM88.691,12.447 h-1.301 c-6.831,0-13.228,5.07-13.499,14.941-0.271,8.954 4.391,15.265 12.252,15.265 6.451,0 8.728,-4.531 8.728,-4.531 0.38,3.021 2.006,3.938 5.204,3.938 V12.393 Zm5.855,17.477 c0,4.099-2.331,7.983-7.427,7.983-4.554,0-7.807,-3.075-7.59,-10.464 0.217,-7.12 3.578,-10.249 8.078,-10.249 0.38,0 0.705,0 0.976,-0.054 h5.963 zM43.912,12.447 v20.551 c0,2.967-2.44,4.477-5.692,4.477-3.415,0-5.692,-1.51-5.692,-4.477 L32.473,17.625 c0,-4.369-2.711,-5.178-5.096,-5.178 v21.846 c0,5.502 4.879,8.199 10.626,8.199 5.584,0 11.059,-2.697 11.005,-8.199 V18.326 c0.054,-4.369-1.572,-5.879-5.096,-5.879 zm22.823,0 c-6.343,0-10.734,3.722-10.734,11.327 v18.34 h5.15 V23.612 c0,-3.938 2.114,-6.311 6.072,-6.311 h1.518 c4.5,0 5.259,-2.32 5.259,-4.909 h-7.264 z" />
      </g>
    </svg>
  );
}

/** El logotipo sobre su placa blanca, que es lo que le da contraste. */
export function PlacaSura({ height = 26, className = '' }: { height?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-xl bg-white px-3 py-2 ring-1 ring-black/5 shadow-sm ${className}`}>
      <LogoSura height={height} />
    </span>
  );
}

/**
 * Franja de confianza para la portada: una línea, sin bajar del primer scroll.
 * El peso visual lo manda DrivePass; esto es un respaldo, no una segunda marca.
 */
export function FranjaSura() {
  const { t } = useLang();
  const s = t.sura;
  return (
    <section aria-labelledby="sura-franja-titulo" className="bg-brand-muted border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-x-5 gap-y-3">
        <PlacaSura height={24} className="self-start flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-accent mb-0.5">{s.etiqueta}</p>
          <p id="sura-franja-titulo" className="text-sm text-ink leading-snug">{s.franja}</p>
          <p className="text-xs text-ink-soft mt-1 leading-snug">{s.franjaNota}</p>
        </div>
        <Link
          href="/para-usuarios#seguro"
          className="inline-flex items-center gap-1.5 self-start sm:self-center flex-shrink-0 text-sm font-semibold text-accent border border-accent/25 bg-accent-light rounded-xl px-3.5 py-2 transition hover:bg-accent/10"
        >
          {s.franjaLink} <IconArrowR size={14} />
        </Link>
      </div>
    </section>
  );
}

/**
 * Bloque largo. `perfil` cambia el ángulo, no la verdad: al arrendatario le
 * importa bajo qué amparo queda y qué paga él; al propietario, quién es el
 * asegurado, quién paga la prima y qué se queda por fuera.
 */
export function BloqueSura({ perfil }: { perfil: 'usuario' | 'propietario' }) {
  const { t } = useLang();
  const s = t.sura;
  const b = s[perfil];
  return (
    <section id="seguro" className="max-w-5xl mx-auto px-6 py-14 scroll-mt-24">
      <div className="rounded-3xl border border-border bg-surface-2 p-6 sm:p-9 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-5">
          <PlacaSura height={30} className="flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-accent mb-0.5">{s.etiqueta}</p>
            <h2 className="text-xl sm:text-2xl font-bold text-ink leading-tight">{b.titulo}</h2>
          </div>
        </div>
        <p className="text-ink-soft text-sm sm:text-base leading-relaxed mb-6">{b.intro}</p>
        <ul className="space-y-3 mb-6">
          {b.puntos.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-ink/75 leading-relaxed">
              <IconCheck size={16} className="text-success flex-shrink-0 mt-0.5" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-2xl border border-border-strong bg-surface p-4 sm:p-5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1.5">{s.avisoTitulo}</p>
          <p className="text-xs sm:text-sm text-ink-soft leading-relaxed">{b.aviso}</p>
        </div>
      </div>
    </section>
  );
}
