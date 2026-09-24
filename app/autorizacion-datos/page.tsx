'use client';
// Pantalla donde una cuenta que YA EXISTÍA otorga su autorización de tratamiento de
// datos. Las cuentas nuevas la otorgan dentro del registro; estas no pasaron por ahí.
//
// Por qué existe: la autorización no se puede emitir sola en nombre de nadie, porque
// recoge consentimientos. Antes el recordatorio sabía que faltaba pero no tenía a dónde
// llevar a la persona — este es ese sitio.
//
// El documento COMPLETO se muestra antes de marcar nada: la ley pide que la
// autorización sea «previa, expresa, libre e informada» (art. 9 de la Ley 1581 de 2012),
// y eso no se cumple con un enlace a unos términos que nadie abre.
//
// Al confirmar se emite el documento con los consentimientos ya escritos dentro de su
// texto y se pasa a firmarlo, que es un acto distinto: marcar «autorizo» y poner la
// firma no son lo mismo.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/contexts/SessionContext';
import { IconShield } from '@/components/Icons';

type Estado = {
  tipo: string | null;
  titulo: string;
  contratoId: number | null;
  faltantes: { etiqueta: string }[];
};

export default function AutorizacionDatosPage() {
  const router = useRouter();
  const { refetch } = useSession();

  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [texto, setTexto] = useState('');
  const [borrador, setBorrador] = useState(false);

  const [general, setGeneral] = useState(false);
  const [sensibles, setSensibles] = useState(false);
  const [comerciales, setComerciales] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/contratos/vinculacion');
      if (r.status === 401) { router.push('/login'); return; }
      const d = await r.json().catch(() => ({}));
      setEstado(d?.estado ?? null);
      setTexto(d?.textoParaLeer || '');
      setBorrador(!!d?.borradorSinRevisar);
      // Ya lo tiene emitido: lo que falta es firmarlo, y eso vive en otra pantalla.
      if (d?.estado?.contratoId) router.replace(`/contratos/${d.estado.contratoId}`);
    } catch {
      setError('No pudimos cargar el documento. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [router]);

  // Traer el documento del servidor al montar es justo el caso que un efecto resuelve
  // (sincronizar con un sistema externo), y guardarlo exige setState. La regla apunta a
  // los setState que encadenan renders, no a esto: `cargar` corre una vez y el estado
  // que escribe no dispara otro efecto.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [cargar]);

  const confirmar = async () => {
    setError('');
    setEnviando(true);
    try {
      const r = await fetch('/api/contratos/vinculacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoriza_datos: general,
          autoriza_datos_sensibles: sensibles,
          autoriza_comerciales: comerciales,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'No pudimos registrar tu autorización. Intenta de nuevo.'); return; }
      refetch();
      // Emitida: ahora se firma. Son dos actos distintos a propósito.
      router.push(`/contratos/${d.contrato_id}`);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (cargando) {
    return <main className="max-w-2xl mx-auto px-4 py-10"><p className="text-sm text-ink/60">Cargando…</p></main>;
  }

  // A un admin no le toca: no es titular de datos tratados como cliente.
  if (!estado?.tipo) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-sm text-ink/70">Tu cuenta no necesita firmar este documento.</p>
      </main>
    );
  }

  const faltan = estado.faltantes ?? [];
  const listo = general && sensibles && faltan.length === 0;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
      <div className="flex items-start gap-3 mb-5">
        <span className="shrink-0 mt-0.5 text-accent"><IconShield /></span>
        <div>
          <h1 className="text-xl font-bold text-ink">{estado.titulo}</h1>
          <p className="text-sm text-ink/70 mt-1">
            Necesitamos tu autorización para tratar tus datos. Léela y, si estás de acuerdo,
            márcala abajo. Después la firmas.
          </p>
        </div>
      </div>

      {borrador && (
        <p className="text-[11px] text-ink/50 mb-3">
          El texto está en revisión legal; se te avisará si cambia antes de tu firma.
        </p>
      )}

      {faltan.length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 mb-5">
          <p className="text-sm text-ink">
            Antes de autorizar necesitamos completar tu perfil: <strong>{faltan.map(f => f.etiqueta).join(', ')}</strong>.
            Estos datos van dentro del documento y te identifican en él.
          </p>
          <button
            type="button"
            onClick={() => router.push('/completar-perfil?next=/autorizacion-datos')}
            className="mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Completar mis datos
          </button>
        </div>
      ) : (
        <>
          {/* El documento completo, para leer. Con su propio desplazamiento para que la
              página no se vuelva interminable en un celular. */}
          <div className="rounded-xl border border-border bg-surface max-h-[45vh] overflow-y-auto p-4 mb-5">
            <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink/80">{texto}</pre>
          </div>

          <div className="rounded-xl border border-border bg-surface/60 p-4 space-y-3 mb-5">
            <label className="flex items-start gap-2.5 text-xs text-ink/80 cursor-pointer">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={general}
                onChange={e => setGeneral(e.target.checked)} />
              <span>
                Autorizo a DRIVEPASS COL S.A.S. a tratar mis datos personales en los términos
                del documento anterior.<span className="text-accent ml-1">*</span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-xs text-ink/80 cursor-pointer">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={sensibles}
                onChange={e => setSensibles(e.target.checked)} />
              <span>
                Autorizo el tratamiento de las imágenes de mi documento de identidad y mi
                licencia, únicamente para verificar quién soy y prevenir fraude.
                <span className="text-accent ml-1">*</span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-xs text-ink/80 cursor-pointer">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={comerciales}
                onChange={e => setComerciales(e.target.checked)} />
              <span>Quiero recibir novedades y promociones. <span className="text-ink/45">(Opcional)</span></span>
            </label>
          </div>

          {error && <p className="text-sm text-danger mb-3">{error}</p>}

          <button
            type="button"
            disabled={!listo || enviando}
            onClick={confirmar}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {enviando ? 'Registrando…' : 'Autorizar y pasar a firmar'}
          </button>
          <p className="text-[11px] text-ink/50 mt-3 text-center">
            Puedes revocar esta autorización cuando quieras escribiendo a nuestro correo de
            habeas data.
          </p>
        </>
      )}
    </main>
  );
}
