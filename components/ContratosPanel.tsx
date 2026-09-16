'use client';
// ── Los contratos digitales de UNA reserva ──────────────────────────────────
//
// Panel autónomo: recibe el id de la reserva y se encarga de todo (listar, emitir,
// abrir el documento para leerlo o firmarlo, y anularlo). Sirve igual dentro de la
// ficha de una reserva en el panel de administración que en una pantalla propia.
//
// ⚠️ DÓNDE MONTARLO — todavía NO está montado en ninguna pantalla, a propósito:
// app/dashboard/admin/page.tsx lo está tocando otra rama en paralelo y meterle mano
// habría garantizado un conflicto. Para engancharlo basta con una línea dentro del
// detalle de una reserva:
//
//     <ContratosPanel reservaId={reserva.id} />
//
// Los sitios naturales son la ficha de reserva del panel de administración
// (pestaña «Reservas») y el detalle de operación del Panel de Control.
//
// Componente de cliente puro: no importa módulos de servidor.
import { useCallback, useEffect, useState } from 'react';
import ContratoFirmar from '@/components/ContratoFirmar';

type ContratoResumen = {
  id: number; reserva_id: number; tipo: string; titulo: string; numero: string; version: number;
  estado: 'pendiente' | 'firmado' | 'anulado';
  /** '' = sin decidir · 'digital' = firma electrónica · 'papel' = mostrador (fase 4). */
  via_firma: '' | 'digital' | 'papel';
  papel_subido_en: string;
  created_at: string; firmado_en: string; anulado_en: string; motivo_anulacion: string;
  firmas_totales: number; firmas_puestas: number;
  faltantes_bloqueantes: number; faltantes_estructurales: number;
};

type TipoCatalogo = { tipo: string; titulo: string };

type Respuesta = {
  contratos: ContratoResumen[];
  tipos: TipoCatalogo[];
  permisos: { gestionar: boolean; firmar_agente: boolean; parte: string | null };
};

/** Resultado de una petición de la lista, antes de tocar el estado. */
type Cargado = { datos: Respuesta | null; error: string };

const ESTADO_ESTILO: Record<string, string> = {
  pendiente: 'bg-warning/15 text-warning',
  firmado: 'bg-success/15 text-success',
  anulado: 'bg-danger/15 text-danger',
};

export default function ContratosPanel({ reservaId }: { reservaId: number }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [tipo, setTipo] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [anulando, setAnulando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');

  // Traer la lista y GUARDARLA en el estado son dos pasos separados a propósito:
  // `cargar` solo hace la petición y devuelve el resultado, y `aplicar` es lo único que
  // toca el estado. Así el efecto no llama a un setState de forma síncrona (que es lo
  // que avisa `react-hooks/set-state-in-effect`).
  const cargar = useCallback(async (): Promise<Cargado> => {
    try {
      const res = await fetch(`/api/contratos?reserva_id=${reservaId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { datos: null, error: json.error || 'No se pudieron cargar los documentos.' };
      return { datos: json as Respuesta, error: '' };
    } catch {
      return { datos: null, error: 'No se pudieron cargar los documentos.' };
    }
  }, [reservaId]);

  const aplicar = useCallback((r: Cargado) => {
    setDatos(r.datos);
    setError(r.error);
    setCargando(false);
    // El selector se inicializa con el primer tipo del catálogo solo si todavía no hay
    // ninguno elegido; recargar la lista no debe pisar lo que el usuario acabe de elegir.
    if (r.datos?.tipos?.length) setTipo(prev => prev || r.datos!.tipos[0].tipo);
  }, []);

  const refrescar = useCallback(async () => { aplicar(await cargar()); }, [cargar, aplicar]);

  useEffect(() => {
    let vivo = true;
    cargar().then(r => { if (vivo) aplicar(r); });
    return () => { vivo = false; };
  }, [cargar, aplicar]);

  const emitir = async () => {
    if (!tipo) return;
    setEmitiendo(true);
    setError('');
    try {
      const res = await fetch('/api/contratos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reserva_id: reservaId, tipo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'No se pudo emitir el documento.');
        return;
      }
      await refrescar();
      setAbierto(json.contrato?.id ?? null);
    } catch {
      setError('No se pudo emitir el documento.');
    } finally {
      setEmitiendo(false);
    }
  };

  const anular = async (id: number) => {
    setError('');
    try {
      const res = await fetch(`/api/contratos/${id}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'No se pudo anular el documento.');
        return;
      }
      setAnulando(null);
      setMotivo('');
      await refrescar();
    } catch {
      setError('No se pudo anular el documento.');
    }
  };

  if (cargando) return <p className="text-sm text-ink/50">Cargando documentos…</p>;
  if (!datos) {
    return (
      <div className="bg-danger/5 border border-danger/25 rounded-2xl p-5 text-center">
        <p className="text-danger text-sm">{error || 'No se pudieron cargar los documentos.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-ink text-sm">Contratos digitales · reserva #{reservaId}</h3>
        {datos.permisos.gestionar && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value)}
              disabled={emitiendo}
              className="border border-border rounded-xl px-3 py-2 text-xs text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {datos.tipos.map(t => <option key={t.tipo} value={t.tipo}>{t.titulo}</option>)}
            </select>
            <button
              type="button"
              onClick={emitir}
              disabled={emitiendo || !tipo}
              className="bg-accent hover:bg-accent/85 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition disabled:opacity-50"
            >
              {emitiendo ? 'Emitiendo…' : 'Emitir documento'}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-xl px-3.5 py-2.5">{error}</p>}

      {datos.contratos.length === 0 ? (
        <div className="text-center py-8 bg-surface-2 rounded-2xl border border-border">
          <p className="text-ink/40 text-sm">Todavía no se ha emitido ningún documento de esta reserva.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {datos.contratos.map(c => (
            <div key={c.id} className="bg-surface-2 border border-border rounded-xl p-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{c.titulo}</p>
                  <p className="text-[11px] text-ink/50">
                    {c.numero}{c.version > 1 ? ` · versión ${c.version}` : ''}
                    {/* Un documento firmado en papel no tiene firmas electrónicas: decir
                        «0 de 2 firmas» sería engañoso, así que se cuenta lo que hay. */}
                    {c.via_firma === 'papel'
                      ? ` · firmado a mano${c.papel_subido_en ? ` el ${c.papel_subido_en.slice(0, 10)}` : ''} · escaneado registrado`
                      : ` · ${c.firmas_puestas} de ${c.firmas_totales} firmas`}
                    {c.faltantes_bloqueantes > 0 ? ` · ${c.faltantes_bloqueantes} dato(s) por completar` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${ESTADO_ESTILO[c.estado] || 'bg-surface-2 text-ink/60'}`}>
                    {c.estado === 'pendiente'
                      ? 'Pendiente de firma'
                      : c.estado === 'firmado'
                        ? (c.via_firma === 'papel' ? 'Firmado en papel' : 'Firmado electrónicamente')
                        : 'Anulado'}
                  </span>
                  <a
                    href={`/api/contratos/${c.id}/pdf`}
                    className="text-xs font-semibold text-accent hover:underline"
                  >
                    PDF
                  </a>
                  <button
                    type="button"
                    onClick={() => setAbierto(prev => (prev === c.id ? null : c.id))}
                    className="text-xs font-semibold text-accent hover:underline"
                  >
                    {abierto === c.id ? 'Cerrar' : 'Ver y firmar'}
                  </button>
                  {datos.permisos.gestionar && c.estado !== 'anulado' && (
                    <button
                      type="button"
                      onClick={() => { setAnulando(prev => (prev === c.id ? null : c.id)); setMotivo(''); }}
                      className="text-xs font-semibold text-danger hover:underline"
                    >
                      Anular
                    </button>
                  )}
                </div>
              </div>

              {anulando === c.id && (
                <div className="mt-3 border-t border-border pt-3 space-y-2">
                  <p className="text-[11px] text-ink/60">
                    Anular conserva este documento y sus firmas como constancia. Para reemplazarlo hay que emitir uno nuevo después.
                  </p>
                  <input
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                    placeholder="Motivo de la anulación"
                    maxLength={500}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <button
                    type="button"
                    onClick={() => anular(c.id)}
                    disabled={motivo.trim().length < 5}
                    className="bg-danger hover:bg-danger/85 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition disabled:opacity-50"
                  >
                    Confirmar anulación
                  </button>
                </div>
              )}

              {abierto === c.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <ContratoFirmar contratoId={c.id} onCambio={refrescar} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
