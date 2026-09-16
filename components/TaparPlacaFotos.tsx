'use client';
import { useCallback, useEffect, useState } from 'react';

// ── Estado de placa de las fotos de un vehículo ─────────────────────────────
//
// Todo lo que el panel de admin necesita para (a) ver de un vistazo qué foto quedó
// RETENIDA por el detector automático de placas y (b) abrir el editor manual sobre la
// imagen correcta. Vive en su propio archivo a propósito: app/dashboard/admin/page.tsx es
// el archivo más disputado del proyecto y cada línea que se le mete ahí es un conflicto
// futuro para otra persona. Acá el cambio en esa página se reduce a un import, tres
// enganches en el JSX y el montaje del editor.
//
// Módulo de CLIENTE: solo habla con la API por fetch, no importa nada de servidor.

/** Estado de tapado de UNA foto, tal como lo devuelve GET /api/admin/tapar-placa. */
export type FotoPlacaEstado = {
  url: string;
  casilla: string | null;
  /** Imagen sobre la que hay que marcar: la ORIGINAL, sin tapados manuales previos. */
  origen_url: string;
  /** La foto está marcada en `fotos_moderacion` (contenido inapropiado O placa retenida). */
  marcada: boolean;
  /**
   * La marca es por PLACA: el detector automático se rindió y dejó la foto para revisión
   * humana (ver `revisionManual` en lib/blur-placas.ts). Es justo el caso que esta
   * herramienta resuelve — por eso se distingue de una marca por contenido.
   */
  retenida_placa: boolean;
  /**
   * La retención es DIFERIDA: el reproceso en lote (app/api/admin/reprocesar-placas con
   * `retencion: 'diferir'`) aplicó los sellos y dejó la revisión anotada SIN sacar el
   * vehículo del catálogo público. Cuenta como retenida a todos los efectos de esta
   * pantalla —es el mismo trabajo pendiente y se resuelve igual—; lo único distinto es que
   * el carro sigue alquilándose mientras tanto.
   */
  revision_pendiente?: boolean;
  motivo: string;
  sin_registro: boolean;
  tapada_a_mano: boolean;
  tapada_a_mano_por: string;
  tapada_a_mano_en: string;
};

export type EstadoPlacas = {
  /** null mientras carga (para no pintar "todo en orden" antes de saberlo). */
  fotos: FotoPlacaEstado[] | null;
  /** Estado de una foto por su URL publicada. */
  de: (url: string) => FotoPlacaEstado | undefined;
  /** Fotos retenidas por el detector automático de placas — las que hay que resolver acá. */
  retenidas: number;
  /** Fotos marcadas por cualquier motivo (incluye las retenidas por placa). */
  marcadas: number;
  /** De las retenidas, las que NO sacaron al vehículo de la vitrina (retención diferida). */
  diferidas: number;
  recargar: () => void;
};

/**
 * Pide el estado de placa de todas las fotos de un vehículo. `vehiculoId: null` (modal
 * cerrado) no dispara nada. Se recarga sola al cambiar de vehículo y a mano tras aplicar
 * un tapado (`recargar`).
 */
export function usePlacasVehiculo(vehiculoId: number | null): EstadoPlacas {
  // Se guarda de QUÉ vehículo son los datos, en vez de limpiarlos dentro del efecto: así el
  // efecto no llama a setState de forma síncrona (regla react-hooks/set-state-in-effect) y,
  // de paso, al recargar tras aplicar un tapado la lista no parpadea a "cargando" — se
  // queda la anterior hasta que llega la nueva.
  const [datos, setDatos] = useState<{ vehiculoId: number; fotos: FotoPlacaEstado[] } | null>(null);
  const [tick, setTick] = useState(0);
  const fotos = datos && datos.vehiculoId === vehiculoId ? datos.fotos : null;

  useEffect(() => {
    if (!vehiculoId) return;
    let vivo = true;
    fetch(`/api/admin/tapar-placa?vehiculo_id=${vehiculoId}`)
      .then(r => (r.ok ? r.json() : null))
      // Un 403 (admin sin el área "vehiculos") o un fallo de red dejan la lista VACÍA, no
      // colgada: el modal de fotos tiene que seguir siendo usable sin esta capa.
      .then(d => { if (vivo) setDatos({ vehiculoId, fotos: Array.isArray(d?.fotos) ? (d.fotos as FotoPlacaEstado[]) : [] }); })
      .catch(() => { if (vivo) setDatos({ vehiculoId, fotos: [] }); });
    return () => { vivo = false; };
  }, [vehiculoId, tick]);

  const de = useCallback((url: string) => fotos?.find(f => f.url === url), [fotos]);
  const recargar = useCallback(() => setTick(t => t + 1), []);

  return {
    fotos,
    de,
    retenidas: fotos?.filter(f => f.retenida_placa).length ?? 0,
    marcadas: fotos?.filter(f => f.marcada).length ?? 0,
    diferidas: fotos?.filter(f => f.revision_pendiente).length ?? 0,
    recargar,
  };
}

/**
 * Miniatura de una foto del vehículo con su estado de placa y el acceso al editor manual.
 * Sustituye al `<button><img/></button>` suelto que había en el modal de fotos, conservando
 * su comportamiento (clic en la imagen = abrir el visor grande).
 */
export function FotoPlaca({ url, label, alt, estado, onVer, onTapar }: {
  url: string;
  label?: string;
  alt: string;
  estado?: FotoPlacaEstado;
  onVer: () => void;
  onTapar: () => void;
}) {
  const retenida = !!estado?.retenida_placa;
  const marcadaOtro = !!estado?.marcada && !retenida;
  return (
    <div>
      {label && <p className="text-xs text-ink/50 mb-1 font-medium">{label}</p>}
      <button
        type="button" onClick={onVer} title="Clic para ver la foto en grande"
        className="block w-full rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url} alt={alt}
          className={`w-full h-28 object-cover rounded-xl border hover:opacity-85 transition ${
            retenida ? 'border-warning ring-2 ring-warning/40'
              : marcadaOtro ? 'border-danger ring-2 ring-danger/30'
              : 'border-border'
          }`}
        />
      </button>
      <div className="mt-1 flex items-center gap-1 flex-wrap">
        {retenida && (
          <span
            title={estado?.motivo || 'El tapado automático no pudo garantizar esta foto.'}
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/30"
          >
            ⚠️ Placa sin confirmar
          </span>
        )}
        {marcadaOtro && (
          <span
            title={estado?.motivo || 'Esta foto está marcada para revisión manual.'}
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25"
          >
            ⚠️ Revisar
          </span>
        )}
        {estado?.tapada_a_mano && (
          <span
            title={`Tapada a mano${estado.tapada_a_mano_por ? ` por ${estado.tapada_a_mano_por}` : ''}${estado.tapada_a_mano_en ? ` el ${estado.tapada_a_mano_en}` : ''}`}
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/30"
          >
            🛡️ Tapada a mano
          </span>
        )}
        <button
          type="button" onClick={onTapar}
          title="Marcar a mano las placas visibles en esta foto y taparlas con el sello de DrivePass"
          className="text-[10px] font-semibold px-2 py-1 rounded-full border border-accent/30 text-accent hover:bg-accent-light transition"
        >
          🛡️ Tapar placa
        </button>
      </div>
    </div>
  );
}

/**
 * Aviso de cabecera del modal de fotos: cuántas fotos dejó retenidas el detector automático
 * y qué hacer con ellas, más el resultado del último tapado aplicado.
 */
export function AvisoPlacas({ placas, mensaje }: { placas: EstadoPlacas; mensaje?: string }) {
  return (
    <>
      {mensaje && (
        <div className="mb-4 bg-success/10 border border-success/25 rounded-2xl px-3 py-2">
          <p className="text-xs font-medium text-success">{mensaje}</p>
        </div>
      )}
      {placas.retenidas > 0 && (
        <div className="mb-4 bg-warning/10 border border-warning/30 rounded-2xl px-3 py-2">
          <p className="text-xs font-bold text-warning">
            ⚠️ {placas.retenidas} foto{placas.retenidas !== 1 ? 's' : ''} retenida{placas.retenidas !== 1 ? 's' : ''} por el tapado automático
          </p>
          <p className="text-[11px] text-ink/60 mt-0.5 leading-snug">
            El sistema no pudo garantizar que la placa quedara tapada y prefirió no estampar nada a ciegas.
            Ábrela con “🛡️ Tapar placa”, marca cada placa visible (también las de terceros) y aplica el tapado.
            Después, si el vehículo quedó en revisión de contenido, apruébalo desde la lista.
          </p>
          {placas.diferidas > 0 && (
            <p className="text-[11px] text-ink/60 mt-1 leading-snug">
              De esas, {placas.diferidas} {placas.diferidas !== 1 ? 'vienen' : 'viene'} de un reproceso en lote que
              dejó la revisión pendiente <strong>sin sacar el vehículo de la vitrina</strong>: sigue publicado
              mientras nadie la mire.
            </p>
          )}
        </div>
      )}
      {placas.marcadas > placas.retenidas && (
        <div className="mb-4 bg-danger/5 border border-danger/25 rounded-2xl px-3 py-2">
          <p className="text-xs font-bold text-danger">
            ⚠️ {placas.marcadas - placas.retenidas} foto(s) marcadas por contenido
          </p>
          <p className="text-[11px] text-danger/80 mt-0.5 leading-snug">
            Esto no lo arregla el tapado de placa: revísalas y decide si se aprueban o se quitan.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Copia del vehículo con `vieja` reemplazada por `nueva` en `fotos` y `fotos_detalle`, para
 * que el modal abierto muestre la foto ya sellada sin recargar las listas enteras.
 * Genérica: el panel la aplica a sus cuatro listas de vehículos sin castear nada.
 */
export function vehiculoConFotoCambiada<T extends { fotos: string; fotos_detalle: string }>(
  v: T, vieja: string, nueva: string,
): T {
  let galeria: string[] = [];
  try { galeria = (JSON.parse(v.fotos || '[]') as string[]).map(u => (u === vieja ? nueva : u)); } catch { galeria = []; }
  let detalle: Record<string, string> = {};
  try {
    const d = JSON.parse(v.fotos_detalle || '{}') as Record<string, string>;
    detalle = Object.fromEntries(Object.entries(d).map(([k, u]) => [k, u === vieja ? nueva : u]));
  } catch { detalle = {}; }
  return { ...v, fotos: JSON.stringify(galeria), fotos_detalle: JSON.stringify(detalle) };
}
