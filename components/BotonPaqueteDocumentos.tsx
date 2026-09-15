'use client';
// ── Botón "Descargar paquete completo" ──────────────────────────────────────
//
// COMPARTIDO por las tres pantallas que ofrecen el paquete de documentos de una
// persona: la ficha del propietario/cliente en el panel de administración
// (app/dashboard/admin/page.tsx, dos sitios) y el panel del propietario
// (app/dashboard/propietario/page.tsx), donde descarga el suyo.
//
// El zip lo arma el SERVIDOR (ver lib/paquete-documentos.ts). Acá solo se hacen
// dos cosas:
//
//  1. PREGUNTAR CUÁNTOS ARCHIVOS TRAE antes de bajarlo (`?info=1`, que solo
//     consulta la base y no descarga nada). Sin ese número el botón es una caja
//     negra: nadie sabe si va a bajar 3 archivos o 40, ni si vale la pena esperar.
//     El conteo se pide al hacer clic en "Ver qué trae" o al montar si `autoInfo`,
//     nunca en un efecto suelto.
//  2. Bajar el zip con `fetch` y no con un `<a href download>`. Con el enlace
//     directo, un 403/429/500 abre una pestaña con el JSON del error en la cara del
//     usuario; así el mensaje se muestra donde corresponde.
//
// Módulo de cliente puro: no importa nada de servidor.
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconExport } from '@/components/Icons';

type Info = { archivos: number; vehiculos: number; reservas: number; excedentes: number };

type Props = {
  /** Ruta del paquete SIN query: '/api/perfil/paquete' o '/api/admin/usuarios/12/paquete'. */
  endpoint: string;
  /** Texto del botón. Por defecto, "Descargar paquete completo". */
  etiqueta?: string;
  /** Pide el conteo apenas se monta (para fichas que ya están abiertas). */
  autoInfo?: boolean;
  /** Aclaración bajo el botón (ej. de quién es el paquete). */
  nota?: string;
  className?: string;
};

/**
 * Saca el nombre del archivo de `Content-Disposition`. El servidor ya lo sanea a
 * `[A-Za-z0-9._-]` (ver `nombreArchivoZip`), pero acá se vuelve a recortar: este
 * valor termina en el atributo `download` de un enlace, y no se confía en una
 * cabecera para construir un nombre de archivo local.
 */
function nombreDesdeCabecera(valor: string | null, respaldo: string): string {
  const m = valor ? /filename="?([^";]+)"?/i.exec(valor) : null;
  const crudo = m?.[1] ?? '';
  const limpio = crudo.replace(/[^A-Za-z0-9._-]/g, '');
  return limpio && limpio !== '.' && limpio !== '..' ? limpio : respaldo;
}

export default function BotonPaqueteDocumentos({ endpoint, etiqueta, autoInfo, nota, className }: Props) {
  const [info, setInfo] = useState<Info | null>(null);
  const [cargandoInfo, setCargandoInfo] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState('');
  // El componente puede desmontarse mientras la petición está en vuelo (el modal se
  // cierra): sin esto, el `setState` de después avisa en consola y no sirve de nada.
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  // Punto único donde aterriza la respuesta del conteo, venga del efecto de
  // `autoInfo` o del clic manual. No hace la petición: solo traduce la respuesta a
  // estado, así que nunca se llama de forma síncrona dentro de un efecto.
  const aplicarInfo = useCallback((ok: boolean, data: Record<string, unknown>) => {
    if (!vivo.current) return;
    setCargandoInfo(false);
    if (!ok) { setError(String(data.error || 'No pudimos consultar el paquete.')); return; }
    setInfo({
      archivos: Number(data.archivos) || 0,
      vehiculos: Number(data.vehiculos) || 0,
      reservas: Number(data.reservas) || 0,
      excedentes: Number(data.excedentes) || 0,
    });
  }, []);

  const fallo = useCallback(() => {
    if (!vivo.current) return;
    setCargandoInfo(false);
    setError('Sin conexión — revisa tu internet e intenta de nuevo.');
  }, []);

  const pedirInfo = () => {
    setCargandoInfo(true);
    setError('');
    fetch(`${endpoint}?info=1`)
      .then(async res => aplicarInfo(res.ok, await res.json().catch(() => ({}))))
      .catch(fallo);
  };

  // La petición va INLINE en el efecto (cadena de promesas), no en una función
  // auxiliar que se llame desde acá: así ningún `setState` cuelga de forma síncrona
  // del cuerpo del efecto y no se dispara la cascada de renders que marca
  // `react-hooks/set-state-in-effect`.
  useEffect(() => {
    if (!autoInfo) return;
    fetch(`${endpoint}?info=1`)
      .then(async res => aplicarInfo(res.ok, await res.json().catch(() => ({}))))
      .catch(fallo);
  }, [autoInfo, endpoint, aplicarInfo, fallo]);

  const descargar = async () => {
    setBajando(true);
    setError('');
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (vivo.current) setError(data.error || 'No pudimos armar el paquete.');
        return;
      }
      const blob = await res.blob();
      const nombre = nombreDesdeCabecera(res.headers.get('content-disposition'), 'documentos.zip');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // El objeto se libera después del clic: revocarlo de inmediato cancela la
      // descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      if (vivo.current) setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      if (vivo.current) setBajando(false);
    }
  };

  const texto = etiqueta || 'Descargar paquete completo';
  const vacio = info !== null && info.archivos === 0;

  return (
    <div className={className}>
      {info === null ? (
        <button
          type="button"
          onClick={pedirInfo}
          disabled={cargandoInfo}
          className="text-xs inline-flex items-center gap-1.5 bg-surface border border-border text-ink/70 px-3 py-2 rounded-xl font-semibold hover:text-ink transition disabled:opacity-60">
          <IconExport size={13} /> {cargandoInfo ? 'Consultando…' : `${texto}…`}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void descargar()}
          disabled={bajando || vacio}
          title={vacio ? 'No hay documentos cargados todavía.' : 'Se arma un .zip en el servidor con todos los documentos.'}
          className="text-xs inline-flex items-center gap-1.5 bg-accent/15 text-accent px-3 py-2 rounded-xl font-semibold hover:bg-accent/20 transition disabled:opacity-60">
          <IconExport size={13} />
          {bajando
            ? 'Armando el paquete…'
            : vacio
              ? 'Sin documentos para descargar'
              : `${texto} (${info.archivos} archivo${info.archivos === 1 ? '' : 's'})`}
        </button>
      )}

      {info !== null && !vacio && (
        <p className="text-[11px] text-ink/50 mt-1">
          {info.vehiculos > 0 && `${info.vehiculos} vehículo${info.vehiculos === 1 ? '' : 's'}`}
          {info.vehiculos > 0 && info.reservas > 0 && ' · '}
          {info.reservas > 0 && `${info.reservas} reserva${info.reservas === 1 ? '' : 's'}`}
          {(info.vehiculos > 0 || info.reservas > 0) && ' · '}
          Incluye un índice (LEEME.txt) con el detalle.
          {info.excedentes > 0 && ` Se dejarán por fuera ${info.excedentes} archivo(s) por el tope del paquete.`}
        </p>
      )}
      {nota && <p className="text-[11px] text-ink/40 mt-1">{nota}</p>}
      {error && <p className="text-[11px] text-danger mt-1">{error}</p>}
    </div>
  );
}
