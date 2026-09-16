'use client';
// ── Ficha de UN documento ya subido: verlo y descargarlo ────────────────────
//
// Hasta ahora había tres copias distintas de este mismo bloque (documentos del
// cliente, cédula en la ficha del usuario, documentos del vehículo) y el
// CERTIFICADO BANCARIO del propietario no tenía ninguna: se guardaba en
// `usuarios.certificado_bancario_url` y no se mostraba en ninguna pantalla — ni el
// equipo ni el propio propietario podían verlo después de subirlo.
//
// Acá el comportamiento es uno solo:
//   · PDF   → enlace "Ver PDF" (pestaña nueva) + "Descargar".
//   · Imagen → miniatura que ABRE `components/VisorFotos.tsx` a pantalla completa
//     (con zoom, que es lo que hace falta para leer un número de cuenta) +
//     "Descargar".
//
// La descarga suelta pasa por `urlDescarga()` (lib/cloudinary-descarga.ts), que le
// mete el flag `fl_attachment` a la URL del CDN: sin eso el navegador abre el
// archivo en vez de bajarlo, porque el atributo `download` se ignora cross-origin.
//
// Módulo de cliente puro: solo importa módulos puros (`cloudinary-descarga`,
// `fotos-servicio`) y componentes de cliente.
import { useState } from 'react';
import VisorFotos from '@/components/VisorFotos';
import { IconExport } from '@/components/Icons';
import { urlDescarga } from '@/lib/cloudinary-descarga';
import { esPdfUrl } from '@/lib/documento-tipo';

type Props = {
  label: string;
  url?: string | null;
  /** Texto bajo el documento (vencimiento, quién lo gestiona, etc.). */
  nota?: string;
  /** Encabezado del visor a pantalla completa (de quién / de qué carro es). */
  titulo?: string;
  /** Qué decir cuando no hay nada subido. */
  vacio?: string;
  className?: string;
};

// El criterio vive en lib/documento-tipo.ts: los PDF de este proyecto se suben como
// `raw` y hasta hace poco llegaban SIN extensión, así que mirar solo `.pdf` daba
// falso siempre y el documento se pintaba como <img> roto.
const esPdf = esPdfUrl;

export default function DocumentoVista({ label, url, nota, titulo, vacio, className }: Props) {
  const [visor, setVisor] = useState(false);
  const u = (url || '').trim();

  return (
    <div className={className || 'bg-surface rounded-xl p-3 border border-border'}>
      <p className="text-[10px] font-semibold text-ink/50 uppercase tracking-wide mb-1.5">{label}</p>

      {!u ? (
        <p className="text-sm text-ink/50">{vacio || 'No subido.'}</p>
      ) : esPdf(u) ? (
        <div className="flex items-center gap-3 flex-wrap">
          <a href={u} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-accent hover:underline">
            📄 Ver PDF
          </a>
          <a href={urlDescarga(u)} download
            className="inline-flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
            <IconExport size={12} /> Descargar
          </a>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => setVisor(true)} className="block w-full text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={label} className="w-full max-h-44 object-contain rounded-lg border border-border hover:opacity-90 transition" />
            <span className="text-[11px] text-ink/50 mt-1 inline-block">Clic para ampliar</span>
          </button>
          <a href={urlDescarga(u)} download
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
            <IconExport size={12} /> Descargar
          </a>
          {visor && (
            <VisorFotos
              fotos={[{ url: u, grupo: label.toUpperCase() }]}
              indice={0}
              onIndice={() => { /* un solo documento: no hay a dónde moverse */ }}
              onCerrar={() => setVisor(false)}
              titulo={titulo}
            />
          )}
        </>
      )}

      {nota && <p className="text-[11px] text-ink/50 mt-1.5">{nota}</p>}
    </div>
  );
}
