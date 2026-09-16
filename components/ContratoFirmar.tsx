'use client';
// ── Leer un contrato entero y firmarlo ──────────────────────────────────────
//
// Lo usan las TRES partes con la misma pantalla: el cliente, el propietario y el
// equipo de DrivePass. Cada uno ve el mismo documento y solo puede firmar los
// bloques que le corresponden (lo decide el servidor; aquí solo se pinta).
//
// Tres cosas que NO son decorativas:
//
//  1. Se muestra el TEXTO ÍNTEGRO del documento, no un resumen. Es un contrato.
//  2. El formulario de firma no se habilita hasta que el texto se ha recorrido
//     hasta el final. No prueba que se haya leído —nada lo prueba—, pero evita el
//     «firmar sin bajar» de un clic.
//  3. La casilla de aceptación es explícita y va aparte del nombre confirmado.
//     El servidor la exige igual (`acepta: true`), no es solo interfaz.
//  4. FASE 4 — EL MOSTRADOR. Un contrato firmado en papel NO es lo mismo que uno
//     firmado electrónicamente, y la pantalla lo dice con esas palabras: distingue el
//     estado, explica qué comprueba el sistema en cada caso y no pinta un «firmado»
//     verde sin aclarar por qué vía. Las dos vías son EXCLUYENTES, así que cuando una
//     está en marcha la otra ni siquiera se ofrece.
//
// Componente de cliente puro: no importa módulos de servidor.
import { useCallback, useEffect, useRef, useState } from 'react';
import FirmaEntrada, { type MetodoFirmaUI } from '@/components/FirmaEntrada';
import ContratoDatos from '@/components/ContratoDatos';

type Integridad = { ok: boolean; motivo: string };

type Firma = {
  bloque: string;
  etiqueta: string;
  rol: 'agente' | 'cliente' | 'propietario' | 'codeudor';
  momento: string;
  orden: number;
  nombre_esperado: string;
  documento_esperado: string;
  firmada_en: string;
  firma_nombre_confirmado: string;
  firma_metodo: string;
  firma_imagen: string;
  integridad: Integridad | null;
  puedo_firmar: boolean;
};

type Faltante = { ruta: string; etiqueta: string; fuente: string; enBD: boolean };

/** Ficha del ejemplar firmado a mano (fase 4). Nunca trae el contenido del archivo. */
type Papel = {
  firmado_en_papel: boolean;
  subido_en: string;
  subido_por_nombre: string;
  nombre_archivo: string;
  mime: string;
  bytes: number;
  sha256: string;
  integridad: Integridad | null;
};

type Detalle = {
  contrato: {
    id: number; reserva_id: number; tipo: string; titulo: string; numero: string; version: number;
    estado: 'pendiente' | 'firmado' | 'anulado'; texto: string; created_at: string;
    generado_por_nombre: string; firmado_en: string; anulado_en: string;
    anulado_por_nombre: string; motivo_anulacion: string;
    /** '' = sin decidir · 'digital' = firma electrónica · 'papel' = mostrador. */
    via_firma: '' | 'digital' | 'papel';
    /** Sube +1 cada vez que se completan los DATOS y el texto se vuelve a generar. */
    datos_revision: number;
    datos_editados_en: string;
    datos_editados_por_nombre: string;
  };
  papel: Papel;
  firmas: Firma[];
  faltantes: { bloqueantes: Faltante[]; estructurales: Faltante[] };
  permisos: {
    gestionar: boolean; firmar_agente: boolean; parte: string | null;
    /** ¿Se pueden completar los DATOS? (sin firmar, sin vía elegida y con el área). */
    editar_datos: boolean;
    /** Si no se puede, por qué. */
    motivo_no_editable: string;
  };
};

/** Resultado de una petición del documento, antes de tocar el estado. */
type Cargado = { detalle: Detalle | null; error: string };

type Props = {
  contratoId: number;
  /** Se llama tras firmar o anular, por si el contenedor quiere refrescar su lista. */
  onCambio?: () => void;
};

const ESTADO_ESTILO: Record<string, string> = {
  pendiente: 'bg-warning/15 text-warning',
  firmado: 'bg-success/15 text-success',
  anulado: 'bg-danger/15 text-danger',
};

/**
 * Espejo de `ESCANEO_MAX_BYTES` (lib/contratos-papel.ts). Está repetido a mano y no
 * importado porque ese módulo es de SERVIDOR (better-sqlite3, crypto) y esta pantalla
 * es 'use client'. Si cambia allá, hay que cambiarlo aquí: el de allá es el que manda.
 */
const ESCANEO_MAX_BYTES = 8 * 1024 * 1024;

const MOMENTO_LABEL: Record<string, string> = {
  suscripcion: 'Al suscribir',
  entrega: 'En la entrega',
  devolucion: 'En la devolución',
};

export default function ContratoFirmar({ contratoId, onCambio }: Props) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [leido, setLeido] = useState(false);
  const [bloqueAbierto, setBloqueAbierto] = useState('');
  const [firmaImagen, setFirmaImagen] = useState('');
  const [metodo, setMetodo] = useState<MetodoFirmaUI>('trazo');
  const [nombre, setNombre] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [errorFirma, setErrorFirma] = useState('');

  // Mostrador: subir el escaneado del ejemplar firmado a mano.
  // Panel de DATOS (completar lo que falta). No edita el texto: lo regenera.
  const [datosAbierto, setDatosAbierto] = useState(false);

  const [subiendoPapel, setSubiendoPapel] = useState(false);
  const [errorPapel, setErrorPapel] = useState('');
  const [confirmaPapel, setConfirmaPapel] = useState(false);
  const [archivoPapel, setArchivoPapel] = useState<{ dataUrl: string; nombre: string; bytes: number } | null>(null);

  const textoRef = useRef<HTMLPreElement>(null);

  // Traer el documento y GUARDARLO en el estado son dos pasos separados a propósito:
  // `cargar` solo hace la petición y devuelve el resultado, y `aplicar` es lo único que
  // toca el estado. Así el efecto no llama a un setState de forma síncrona (que es lo
  // que avisa `react-hooks/set-state-in-effect`) y la misma petición sirve para el
  // montaje y para los refrescos posteriores a firmar.
  const cargar = useCallback(async (): Promise<Cargado> => {
    try {
      const res = await fetch(`/api/contratos/${contratoId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { detalle: null, error: json.error || 'No se pudo cargar el documento.' };
      return { detalle: json as Detalle, error: '' };
    } catch {
      return { detalle: null, error: 'No se pudo cargar el documento.' };
    }
  }, [contratoId]);

  const aplicar = useCallback((r: Cargado) => {
    setDetalle(r.detalle);
    setError(r.error);
    setCargando(false);
  }, []);

  const refrescar = useCallback(async () => { aplicar(await cargar()); }, [cargar, aplicar]);

  useEffect(() => {
    let vivo = true;
    cargar().then(r => { if (vivo) aplicar(r); });
    return () => { vivo = false; };
  }, [cargar, aplicar]);

  // El botón de firmar espera a que el texto se haya recorrido hasta el final. Si el
  // documento cabe entero en pantalla (no hay scroll), se da por recorrido.
  const revisarScroll = () => {
    const el = textoRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setLeido(true);
  };
  useEffect(() => {
    const el = textoRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 4) setLeido(true);
  }, [detalle]);

  const abrirBloque = (bloque: string) => {
    setBloqueAbierto(prev => (prev === bloque ? '' : bloque));
    setFirmaImagen('');
    setNombre('');
    setAcepta(false);
    setErrorFirma('');
  };

  const firmar = async (bloque: string) => {
    if (!detalle) return;
    setFirmando(true);
    setErrorFirma('');
    try {
      const res = await fetch(`/api/contratos/${contratoId}/firmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bloque,
          nombre_confirmado: nombre,
          firma_imagen: firmaImagen,
          metodo,
          acepta,
          version: detalle.contrato.version,
          // Si alguien completó un dato mientras se leía el documento, el texto se
          // regeneró: el servidor rechaza la firma y hay que releerlo.
          revision: detalle.contrato.datos_revision,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorFirma(json.error || 'No se pudo firmar.');
        return;
      }
      setBloqueAbierto('');
      setFirmaImagen('');
      setNombre('');
      setAcepta(false);
      await refrescar();
      onCambio?.();
    } catch {
      setErrorFirma('No se pudo firmar.');
    } finally {
      setFirmando(false);
    }
  };

  const elegirArchivoPapel = (archivo: File | null) => {
    setErrorPapel('');
    setArchivoPapel(null);
    if (!archivo) return;
    // Tope en el navegador para no subir 40 MB y que el servidor los rechace después.
    // NO es el control de verdad: el servidor valida tamaño y BYTES (lib/contratos-papel.ts).
    if (archivo.size > ESCANEO_MAX_BYTES) {
      setErrorPapel('El archivo pesa más de 8 MB. Vuelve a escanearlo con menos resolución.');
      return;
    }
    const lector = new FileReader();
    lector.onerror = () => setErrorPapel('No se pudo leer el archivo.');
    lector.onload = () => {
      const dataUrl = typeof lector.result === 'string' ? lector.result : '';
      if (!dataUrl.startsWith('data:')) { setErrorPapel('No se pudo leer el archivo.'); return; }
      setArchivoPapel({ dataUrl, nombre: archivo.name, bytes: archivo.size });
    };
    lector.readAsDataURL(archivo);
  };

  const subirPapel = async () => {
    if (!detalle || !archivoPapel) return;
    setSubiendoPapel(true);
    setErrorPapel('');
    try {
      const res = await fetch(`/api/contratos/${contratoId}/escaneo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archivo: archivoPapel.dataUrl,
          nombre_archivo: archivoPapel.nombre,
          version: detalle.contrato.version,
          confirma: confirmaPapel,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorPapel(json.error || 'No se pudo registrar el escaneado.'); return; }
      setArchivoPapel(null);
      setConfirmaPapel(false);
      await refrescar();
      onCambio?.();
    } catch {
      setErrorPapel('No se pudo registrar el escaneado.');
    } finally {
      setSubiendoPapel(false);
    }
  };

  if (cargando) return <p className="text-sm text-ink/50">Cargando el documento…</p>;
  if (error || !detalle) {
    return (
      <div className="bg-danger/5 border border-danger/25 rounded-2xl p-5 text-center">
        <p className="text-danger text-sm">{error || 'No se pudo cargar el documento.'}</p>
      </div>
    );
  }

  const c = detalle.contrato;
  const puedeFirmarAlgo = detalle.firmas.some(f => f.puedo_firmar);
  // Las dos vías son excluyentes, así que la del mostrador solo se ofrece mientras
  // nadie haya empezado a firmar electrónicamente. El servidor lo vuelve a comprobar.
  const sinViaElegida = c.estado === 'pendiente' && c.via_firma === '';
  const puedeImprimirParaFirmar = sinViaElegida && detalle.faltantes.bloqueantes.length === 0;
  const puedeSubirEscaneado = detalle.permisos.gestionar && puedeImprimirParaFirmar;
  const listo = leido && !!firmaImagen && nombre.trim().length > 0 && acepta && !firmando;
  // Completar datos: lo decide el servidor (área de contratos + sin firmar + sin vía
  // elegida). Aquí solo se pinta.
  const puedeEditarDatos = detalle.permisos.editar_datos === true;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-bold text-ink text-base">{c.titulo}</h2>
          <p className="text-xs text-ink/50">
            {c.numero}{c.version > 1 ? ` · versión ${c.version}` : ''} · reserva #{c.reserva_id} · emitido el {c.created_at?.slice(0, 16)}
            {c.generado_por_nombre ? ` por ${c.generado_por_nombre}` : ''}
          </p>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${ESTADO_ESTILO[c.estado] || 'bg-surface-2 text-ink/60'}`}>
          {c.estado === 'pendiente'
            ? 'Pendiente de firma'
            : c.estado === 'firmado'
              // El estado NO se resume en «Firmado»: la vía cambia lo que el sistema
              // puede afirmar del documento, y quien lo mira tiene que verlo de entrada.
              ? (c.via_firma === 'papel' ? 'Firmado en papel' : 'Firmado electrónicamente')
              : 'Anulado'}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={`/api/contratos/${contratoId}/pdf`}
          className="text-xs font-semibold text-accent hover:underline"
        >
          Descargar PDF
        </a>
        {puedeImprimirParaFirmar && (
          <a
            href={`/api/contratos/${contratoId}/pdf?modo=papel`}
            className="text-xs font-semibold text-accent hover:underline"
          >
            Descargar para imprimir y firmar a mano
          </a>
        )}
        {detalle.papel.firmado_en_papel && (
          <a
            href={`/api/contratos/${contratoId}/escaneo`}
            className="text-xs font-semibold text-accent hover:underline"
          >
            Descargar el ejemplar escaneado
          </a>
        )}
      </div>

      {detalle.papel.firmado_en_papel && (
        <div className="text-xs bg-info/10 border border-info/25 rounded-xl px-3.5 py-2.5 space-y-1">
          <p className="font-semibold text-ink">Este documento se firmó en papel, no electrónicamente.</p>
          <p className="text-ink/70">
            Se imprimió, se firmó a mano y su escaneado quedó registrado el {detalle.papel.subido_en?.slice(0, 16)}
            {detalle.papel.subido_por_nombre ? ` por ${detalle.papel.subido_por_nombre}` : ''}
            {detalle.papel.nombre_archivo ? ` («${detalle.papel.nombre_archivo}»)` : ''}.
          </p>
          <p className="text-ink/60">
            Lo que el sistema puede comprobar es que ese archivo corresponde a este texto y que no ha cambiado desde
            que se registró. <strong>No comprueba quién trazó las firmas del papel</strong>: no hay firma electrónica.
          </p>
          {detalle.papel.integridad && (
            detalle.papel.integridad.ok
              ? <p className="text-success font-semibold">Sello del escaneado verificado.</p>
              : <p className="text-danger font-semibold">Atención: {detalle.papel.integridad.motivo}</p>
          )}
          <p className="text-ink/40 break-all">SHA-256 del escaneado: {detalle.papel.sha256 || '—'}</p>
        </div>
      )}

      {c.estado === 'anulado' && (
        <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-xl px-3.5 py-2.5">
          Documento anulado el {c.anulado_en?.slice(0, 16)}{c.anulado_por_nombre ? ` por ${c.anulado_por_nombre}` : ''}.
          {c.motivo_anulacion ? ` Motivo: ${c.motivo_anulacion}` : ''} Se conserva como constancia de lo que decía.
        </p>
      )}

      {detalle.faltantes.bloqueantes.length > 0 && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-xl px-3.5 py-2.5">
          <p className="font-semibold mb-1">Este documento no se puede firmar todavía: faltan datos que sí se pueden completar.</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {detalle.faltantes.bloqueantes.map(f => <li key={f.ruta}>{f.etiqueta}</li>)}
          </ul>
          <p className="mt-1">
            {puedeEditarDatos
              ? 'Complétalos abajo, en «Completar los datos del documento»: el texto se vuelve a generar con ellos.'
              : 'Complétalos, anula este documento y emítelo de nuevo.'}
          </p>
        </div>
      )}

      {detalle.faltantes.estructurales.length > 0 && (
        <details className="text-xs text-warning bg-warning/10 border border-warning/25 rounded-xl px-3.5 py-2.5">
          <summary className="font-semibold cursor-pointer">
            {detalle.faltantes.estructurales.length} dato(s) van en blanco en este documento
          </summary>
          <ul className="list-disc pl-4 space-y-0.5 mt-1.5">
            {detalle.faltantes.estructurales.map(f => <li key={f.ruta}>{f.etiqueta}</li>)}
          </ul>
          <p className="mt-1.5">
            {puedeEditarDatos
              ? 'Todavía no se han llenado, así que salen como espacios en blanco. No impiden firmar, pero se pueden completar abajo, en «Completar los datos del documento».'
              : 'Todavía no se han llenado, así que salen como espacios en blanco en el texto. Míralos en el documento antes de firmar.'}
          </p>
        </details>
      )}

      {/* ── Completar los DATOS ───────────────────────────────────────────────
          Lo que se edita son los datos, NUNCA el texto: al guardar, el documento se
          vuelve a generar desde la plantilla del abogado. Solo mientras esté sin
          firmar y sin vía de firma elegida; el servidor lo vuelve a comprobar. */}
      {detalle.permisos.gestionar && (
        puedeEditarDatos ? (
          <div className="border border-border rounded-xl">
            <button
              type="button"
              onClick={() => setDatosAbierto(v => !v)}
              className="w-full text-left px-3.5 py-2.5 text-sm font-semibold text-accent"
            >
              {datosAbierto ? 'Cerrar los datos del documento' : 'Completar los datos del documento'}
            </button>
            {datosAbierto && (
              <div className="border-t border-border p-3.5">
                <ContratoDatos
                  contratoId={contratoId}
                  onGuardado={async () => { await refrescar(); onCambio?.(); }}
                />
              </div>
            )}
          </div>
        ) : (
          detalle.permisos.motivo_no_editable && (
            <p className="text-[11px] text-ink/50">
              Los datos de este documento ya no se pueden modificar: {detalle.permisos.motivo_no_editable}
            </p>
          )
        )
      )}

      <div>
        <p className="text-[10px] font-semibold text-ink/50 uppercase tracking-wide mb-1.5">Documento completo</p>
        <pre
          ref={textoRef}
          onScroll={revisarScroll}
          className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink bg-surface border border-border rounded-2xl p-4 max-h-[60vh] overflow-y-auto"
        >{c.texto}</pre>
        {!leido && (
          <p className="text-[11px] text-ink/50 mt-1.5">Desplázate hasta el final del documento para poder firmarlo.</p>
        )}
      </div>

      <div>
        <p className="text-[10px] font-semibold text-ink/50 uppercase tracking-wide mb-1.5">Firmas</p>
        <div className="space-y-2">
          {detalle.firmas.map(f => (
            <div key={f.bloque} className="bg-surface-2 border border-border rounded-xl p-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{f.etiqueta}</p>
                  <p className="text-[11px] text-ink/50">
                    {f.nombre_esperado || 'Sin nombre registrado'}
                    {f.documento_esperado ? ` · ${f.documento_esperado}` : ''} · {MOMENTO_LABEL[f.momento] || f.momento}
                  </p>
                </div>
                {f.firmada_en ? (
                  <span className="text-[11px] font-bold text-success">✓ Firmada el {f.firmada_en.slice(0, 16)}</span>
                ) : (
                  <span className="text-[11px] font-bold text-warning">Pendiente</span>
                )}
              </div>

              {f.firmada_en && (
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                  {f.firma_imagen && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.firma_imagen} alt={`Firma de ${f.etiqueta}`} className="h-12 bg-white rounded border border-border px-2" />
                  )}
                  <div className="text-[11px] text-ink/50">
                    <p>Confirmó llamarse: {f.firma_nombre_confirmado}</p>
                    <p>Vía: {f.firma_metodo === 'carga' ? 'imagen cargada' : 'trazo en pantalla'}</p>
                  </div>
                  {f.integridad && !f.integridad.ok && (
                    <p className="text-[11px] text-danger font-semibold">⚠ {f.integridad.motivo}</p>
                  )}
                  {f.integridad?.ok && <p className="text-[11px] text-success">Sello de integridad verificado</p>}
                </div>
              )}

              {f.puedo_firmar && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => abrirBloque(f.bloque)}
                    className="text-xs font-semibold text-accent hover:underline"
                  >
                    {bloqueAbierto === f.bloque ? 'Cancelar' : 'Firmar este bloque'}
                  </button>

                  {bloqueAbierto === f.bloque && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <FirmaEntrada
                        disabled={firmando}
                        onChange={(dataUrl, m) => { setFirmaImagen(dataUrl); setMetodo(m); }}
                      />

                      <div>
                        <label className="text-xs font-medium text-ink/60 block mb-1">Confirma tu nombre completo</label>
                        <input
                          value={nombre}
                          onChange={e => setNombre(e.target.value)}
                          disabled={firmando}
                          placeholder="Nombre y apellidos"
                          maxLength={120}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
                        />
                      </div>

                      <label className="flex items-start gap-2 text-xs text-ink/70 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acepta}
                          onChange={e => setAcepta(e.target.checked)}
                          disabled={firmando}
                          className="mt-0.5"
                        />
                        <span>
                          Leí el documento completo, entiendo su contenido y lo acepto como <strong>{f.etiqueta}</strong>.
                        </span>
                      </label>

                      {errorFirma && <p className="text-[11px] text-danger">{errorFirma}</p>}

                      <button
                        type="button"
                        onClick={() => firmar(f.bloque)}
                        disabled={!listo}
                        className="w-full bg-success hover:bg-success/80 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50"
                      >
                        {firmando ? 'Firmando…' : 'Firmar'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {!puedeFirmarAlgo && c.estado === 'pendiente' && (
          <p className="text-[11px] text-ink/50 mt-2">
            {c.via_firma === 'papel'
              ? 'Este documento se firmó en papel: ya no admite firma electrónica.'
              : 'No tienes ninguna firma pendiente en este documento.'}
          </p>
        )}
      </div>

      {/* ── Mostrador: registrar el ejemplar firmado a mano ───────────────────
          Solo para el equipo con el área de contratos, y solo mientras nadie haya
          empezado a firmar electrónicamente. Registrar el papel deja el documento
          FIRMADO y cierra la vía digital, así que se pide una confirmación aparte. */}
      {puedeSubirEscaneado && (
        <div className="bg-surface-2 border border-border rounded-xl p-3.5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-ink">Mostrador: firma en papel</p>
            <p className="text-[11px] text-ink/60 mt-0.5">
              Imprime el documento con el enlace de arriba, recoge las firmas a mano, escanéalo o fotografíalo y
              súbelo aquí. Queda ligado a este mismo documento y se guarda en el sistema.
            </p>
            <p className="text-[11px] text-warning mt-1">
              Al registrarlo, este documento queda <strong>firmado en papel</strong> y ya no se podrá firmar
              electrónicamente. Si el escaneado queda mal, hay que anular el documento y emitirlo de nuevo.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Archivo escaneado (PDF o imagen, hasta 8 MB)</label>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
              disabled={subiendoPapel}
              onChange={e => elegirArchivoPapel(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-ink/70 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent"
            />
            {archivoPapel && (
              <p className="text-[11px] text-ink/50 mt-1">
                {archivoPapel.nombre} · {Math.max(1, Math.round(archivoPapel.bytes / 1024))} KB
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-xs text-ink/70 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmaPapel}
              onChange={e => setConfirmaPapel(e.target.checked)}
              disabled={subiendoPapel}
              className="mt-0.5"
            />
            <span>
              Confirmo que este archivo es el escaneado de <strong>este mismo documento</strong>, firmado a mano
              por quienes debían firmarlo.
            </span>
          </label>

          {errorPapel && <p className="text-[11px] text-danger">{errorPapel}</p>}

          <button
            type="button"
            onClick={subirPapel}
            disabled={!archivoPapel || !confirmaPapel || subiendoPapel}
            className="w-full bg-accent hover:bg-accent/85 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50"
          >
            {subiendoPapel ? 'Registrando…' : 'Registrar el contrato firmado en papel'}
          </button>
        </div>
      )}
    </div>
  );
}
