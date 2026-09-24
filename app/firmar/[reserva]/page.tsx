'use client';
// «Firmar todo lo pendiente», en una sola pantalla y en orden.
//
// Es el destino del enlace único que se manda en el aviso. Antes, una persona con
// cuatro documentos pendientes tenía que encontrarlos uno por uno; aquí los ve juntos,
// firma el primero y vuelve a esta lista con el siguiente ya señalado.
//
// Solo muestra lo que le toca a QUIEN MIRA: el filtro lo hace el servidor, porque un
// propietario no tiene por qué saber qué le falta firmar al cliente.
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { IconShield } from '@/components/Icons';

type Pendiente = {
  contratoId: number;
  numero: string;
  titulo: string;
  bloque: string;
  etiqueta: string;
};

export default function FirmarPendientesPage() {
  const params = useParams<{ reserva: string }>();
  const router = useRouter();
  const reservaId = Number(params?.reserva);

  const [cargando, setCargando] = useState(true);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/reservas/${reservaId}/firmas-pendientes`);
      if (r.status === 401) { router.push('/login'); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'No pudimos cargar tus documentos.'); return; }
      setPendientes(d.pendientes ?? []);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [reservaId, router]);

  // Cargar al montar y al volver de firmar uno: `focus` es lo que dispara la
  // actualización cuando la persona regresa con el documento ya firmado.
  useEffect(() => {
    // Traer la lista del servidor es justo lo que un efecto resuelve, y guardarla exige
    // setState. La regla apunta a los setState que encadenan renders, no a esto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
    window.addEventListener('focus', cargar);
    return () => window.removeEventListener('focus', cargar);
  }, [cargar]);

  if (cargando) {
    return <main className="max-w-2xl mx-auto px-4 py-10"><p className="text-sm text-ink/60">Cargando…</p></main>;
  }

  if (error) {
    return <main className="max-w-2xl mx-auto px-4 py-10"><p className="text-sm text-danger">{error}</p></main>;
  }

  if (pendientes.length === 0) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-xl font-bold text-ink">No te falta firmar nada</h1>
        <p className="text-sm text-ink/70 mt-2">
          Los documentos de tu reserva #{reservaId} ya están firmados por tu parte.
        </p>
      </main>
    );
  }

  // Agrupado por documento: un mismo contrato puede pedir dos trazos de la misma
  // persona (el de agencia pide el del propietario y, aparte, el del anexo de la póliza).
  const porDocumento = new Map<number, { numero: string; titulo: string; bloques: Pendiente[] }>();
  for (const p of pendientes) {
    const actual = porDocumento.get(p.contratoId)
      ?? { numero: p.numero, titulo: p.titulo, bloques: [] as Pendiente[] };
    actual.bloques.push(p);
    porDocumento.set(p.contratoId, actual);
  }
  const documentos = [...porDocumento.entries()];

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
      <div className="flex items-start gap-3 mb-5">
        <span className="shrink-0 mt-0.5 text-accent"><IconShield /></span>
        <div>
          <h1 className="text-xl font-bold text-ink">
            {documentos.length === 1 ? 'Te falta firmar un documento' : `Te faltan ${documentos.length} documentos`}
          </h1>
          <p className="text-sm text-ink/70 mt-1">
            De tu reserva #{reservaId}. Fírmalos en orden; al terminar cada uno vuelves aquí.
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        {documentos.map(([contratoId, doc], i) => (
          <li key={contratoId} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  <span className="text-ink/40 tabular-nums mr-1.5">{i + 1}.</span>
                  {doc.titulo}
                </p>
                <p className="text-xs text-ink/55 mt-0.5">{doc.numero}</p>
                {doc.bloques.length > 1 && (
                  <p className="text-[11px] text-ink/50 mt-1">
                    Te pide {doc.bloques.length} firmas: {doc.bloques.map(b => b.etiqueta).join(' y ')}.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/contratos/${contratoId}`)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold shrink-0 ${
                  i === 0 ? 'bg-accent text-white hover:opacity-90' : 'border border-border text-ink/70 hover:bg-ink/5'
                }`}
              >
                {i === 0 ? 'Firmar ahora' : 'Abrir'}
              </button>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-[11px] text-ink/50 mt-5">
        Si prefieres firmarlos en papel, escríbenos: puedes imprimirlos, firmarlos a mano y
        subir el escaneado. Las dos vías no se mezclan en un mismo documento.
      </p>
    </main>
  );
}
