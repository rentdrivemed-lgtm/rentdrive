'use client';
// ── Carátula de la póliza del vehículo — editor del ADMIN ───────────────────
//
// El único documento del vehículo que NO sube el propietario: desde sep-2026 la
// póliza la expide DrivePass, así que la carátula la tiene la empresa. Ver
// lib/poliza-vehiculo.ts para el porqué y para las reglas que aplica el servidor.
//
// Lo que este componente NO decide: que solo el admin pueda escribirla. Eso lo
// impone PUT /api/vehiculos/[id] (acción `poliza`, con 403 para el propietario y
// con la clave `poliza` arrancada del JSON de `documentos` si viene de él). Acá
// solo está el formulario.
//
// A propósito NO tiene botones de aprobar/denegar como los demás documentos: la
// póliza la carga el propio equipo, no hay nada que revisarle al propietario, y
// tampoco entra en el estado agregado que habilita la publicación del vehículo.
import { useState } from 'react';
import DocUpload from '@/components/DocUpload';
import DocumentoVista from '@/components/DocumentoVista';
import { IconCheck } from '@/components/Icons';
import {
  POLIZA_LABEL, estadoPoliza, hoyColombia, esFechaISO,
  type PolizaVehiculo,
} from '@/lib/poliza-vehiculo';

type Props = {
  vehiculoId: number;
  /** JSON crudo de `vehiculos.documentos` tal como llegó del servidor. */
  documentos?: string;
  titulo: string;
  /** El padre guarda el JSON nuevo para que la lista quede al día sin recargar. */
  onGuardado: (documentosJson: string) => void;
};

function leerPolizaDe(documentosJson?: string): PolizaVehiculo | null {
  if (!documentosJson) return null;
  try {
    const docs = JSON.parse(documentosJson) as Record<string, unknown>;
    const p = docs?.poliza;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const { url, vence } = p as Record<string, unknown>;
    if (typeof url !== 'string' || !url.trim()) return null;
    return { url: url.trim(), vence: esFechaISO(vence) ? String(vence).trim() : '' };
  } catch {
    return null;
  }
}

const AVISO: Record<string, { texto: string; clase: string }> = {
  vencida:    { texto: '⚠ La póliza está VENCIDA', clase: 'text-danger' },
  por_vencer: { texto: '⚠ La póliza vence pronto', clase: 'text-warning' },
  vigente:    { texto: '✓ Vigente', clase: 'text-success' },
  sin_fecha:  { texto: 'Sin fecha de vencimiento registrada', clase: 'text-ink/50' },
};

export default function PolizaVehiculoAdmin({ vehiculoId, documentos, titulo, onGuardado }: Props) {
  // Lo que se MUESTRA sale siempre de las props, así que después de guardar se
  // refresca solo cuando el padre actualiza `documentos`.
  const actual = leerPolizaDe(documentos);
  const [editando, setEditando] = useState(false);
  const [url, setUrl] = useState(actual?.url || '');
  const [vence, setVence] = useState(actual?.vence || '');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  // Nota: NO hay un efecto que resiembre el formulario al cambiar de vehículo. El
  // padre monta este componente con `key={v.id}`, así que al abrir otro carro es una
  // instancia nueva y el estado nace ya sembrado con la póliza correcta — sin la
  // cascada de renders de un `setState` dentro de un efecto. Los campos del
  // formulario se resiembran al entrar a "Reemplazar", que es un evento.

  const enviar = async (cuerpo: { poliza: { url: string; vence: string } | null }) => {
    setGuardando(true);
    setMsg('');
    try {
      const res = await fetch(`/api/vehiculos/${vehiculoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data.error || 'No se pudo guardar.'); return; }
      onGuardado(String(data.documentos || '{}'));
      setEditando(false);
      setConfirmarQuitar(false);
      setMsg('✓ Guardado');
    } catch {
      setMsg('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const estado = actual ? estadoPoliza(actual.vence, hoyColombia()) : null;
  const aviso = estado ? AVISO[estado] : null;

  return (
    <div className="rounded-xl p-3 border bg-brand-muted/40 border-border">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-bold text-ink">{POLIZA_LABEL}</p>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/25 whitespace-nowrap">
          La carga DrivePass
        </span>
      </div>
      <p className="text-[11px] text-ink/50 mb-2">
        Este documento lo aporta la empresa, no el propietario. Él la ve y la descarga desde su panel,
        pero no puede cambiarla.
      </p>

      {actual && !editando && (
        <>
          <DocumentoVista
            label="Carátula"
            url={actual.url}
            titulo={titulo}
            className="bg-surface rounded-xl p-3 border border-border"
            nota={actual.vence ? `Vence: ${actual.vence}` : undefined}
          />
          {aviso && <p className={`text-[11px] font-semibold mt-1.5 ${aviso.clase}`}>{aviso.texto}</p>}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <button type="button" onClick={() => { setUrl(actual.url); setVence(actual.vence); setMsg(''); setEditando(true); }}
              className="text-[11px] font-bold bg-accent/15 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent/20 transition">
              Reemplazar
            </button>
            {confirmarQuitar ? (
              <>
                <button type="button" disabled={guardando} onClick={() => void enviar({ poliza: null })}
                  className="text-[11px] font-bold bg-danger text-white px-2.5 py-1.5 rounded-xl hover:bg-danger/90 transition disabled:opacity-50">
                  {guardando ? '…' : 'Sí, quitarla'}
                </button>
                <button type="button" onClick={() => setConfirmarQuitar(false)}
                  className="text-[11px] border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface-2 transition">
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmarQuitar(true)}
                className="text-[11px] font-bold border border-danger/25 text-danger px-2.5 py-1.5 rounded-xl hover:bg-danger/10 transition">
                Quitar
              </button>
            )}
          </div>
        </>
      )}

      {(!actual || editando) && (
        <div className="space-y-2">
          <DocUpload label="Carátula de la póliza (PDF o imagen)" value={url} onChange={setUrl} />
          <div>
            <label className="text-[11px] text-ink/50 block mb-1">Fecha de vencimiento *</label>
            <input type="date" value={vence} onChange={e => setVence(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
          </div>
          {/* Un botón apagado sin explicación es un callejón sin salida: el usuario no
              sabe si falta un campo, si algo falló o si la pantalla está rota. */}
          {(!url || !vence) && (
            <p className="text-[11px] text-warning">
              {!url && !vence ? 'Falta subir la carátula y poner la fecha de vencimiento.'
                : !url ? 'Falta subir la carátula de la póliza.'
                : 'Falta la fecha de vencimiento de la póliza.'}
            </p>
          )}
          <div className="flex gap-1.5 flex-wrap">
            <button type="button" disabled={guardando || !url || !vence}
              onClick={() => void enviar({ poliza: { url, vence } })}
              className="flex items-center gap-1 text-[11px] font-bold bg-accent text-white px-2.5 py-1.5 rounded-xl hover:bg-accent-hover transition disabled:opacity-50">
              <IconCheck size={11} /> {guardando ? 'Guardando…' : 'Guardar póliza'}
            </button>
            {actual && (
              <button type="button" onClick={() => { setEditando(false); setUrl(actual.url); setVence(actual.vence); setMsg(''); }}
                className="text-[11px] border border-border text-ink/60 px-2.5 py-1.5 rounded-xl hover:bg-surface-2 transition">
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {msg && <p className={`text-[11px] mt-1.5 ${msg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{msg}</p>}
    </div>
  );
}
