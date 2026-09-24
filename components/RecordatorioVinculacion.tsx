'use client';
// Recordatorio emergente de «tienes tu contrato de vinculación sin firmar».
//
// La decisión del dueño fue no cortarle el paso a nadie por esto: se insiste, pero se
// deja navegar. La exigencia dura vive donde tiene consecuencias —reservar y publicar—
// y la impone el servidor (`vinculacionAlDia` en POST /api/reservas y /api/vehiculos).
//
// «Insistir» acá significa: reaparece en cada navegación. `SessionContext` recarga
// /api/auth/me al cambiar de ruta, así que basta con recordar el cierre POR RUTA: se
// cierra, se sigue leyendo esa página tranquilo, y al ir a otra vuelve a aparecer.
// No se usa localStorage a propósito — un «no volver a mostrar» persistente dejaría a
// la persona sin enterarse hasta que le rebotara una reserva.
//
// No se pinta en la propia pantalla de firma (sería absurdo), ni encima del checkout
// —ahí el propio flujo ya lo exige— ni en las pantallas del alta.
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/contexts/SessionContext';
import { IconShield } from '@/components/Icons';

/** Rutas donde el recordatorio estorba en vez de ayudar. */
const RUTAS_SIN_RECORDATORIO = [
  '/contratos/',          // la pantalla de firma
  '/autorizacion-datos',  // la pantalla a la que lleva este mismo aviso
  '/verificar-correo',
  '/completar-perfil',
  '/registro',
  '/login',
];

export default function RecordatorioVinculacion() {
  const { user } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  // Ruta en la que se cerró el aviso. No hace falta limpiarlo al navegar: en cuanto
  // `pathname` cambia deja de coincidir y el aviso reaparece solo.
  const [cerradoEn, setCerradoEn] = useState<string | null>(null);

  const v = user?.vinculacion;
  // `contrato_id` puede ser null y eso NO significa «nada que hacer»: significa que la
  // cuenta todavía no ha autorizado, que es justo lo que hay que pedirle.
  if (!user || !v?.pendiente) return null;
  if (cerradoEn === pathname) return null;
  if (RUTAS_SIN_RECORDATORIO.some(r => pathname.startsWith(r))) return null;

  const faltanDatos = v.faltantes.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-4"
      role="dialog" aria-modal="true" aria-labelledby="recordatorio-vinculacion-titulo"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="shrink-0 mt-0.5 text-warning"><IconShield /></span>
          <div className="min-w-0 flex-1">
            <h2 id="recordatorio-vinculacion-titulo" className="text-base font-bold text-ink">
              {v.contrato_id ? 'Te falta firmar tu documento' : 'Nos falta tu autorización de datos'}
            </h2>
            <p className="text-sm text-ink/70 mt-1.5">
              {v.contrato_id
                ? `${v.titulo}${v.numero ? ` · ${v.numero}` : ''}. Ya está listo: solo falta tu firma.`
                : 'Necesitamos que autorices el tratamiento de tus datos para poder verificar tu identidad. Se lee y se marca en un minuto.'}
            </p>

            {faltanDatos ? (
              <p className="text-sm text-ink/70 mt-3">
                Antes necesitamos estos datos tuyos: <strong>{v.faltantes.join(', ')}</strong>.
              </p>
            ) : (
              <p className="text-xs text-ink/50 mt-3">
                Puedes seguir navegando, pero para
                {user.rol === 'propietario' ? ' publicar un vehículo' : ' reservar'} sí hace falta.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 mt-5">
          <button
            type="button"
            onClick={() => setCerradoEn(pathname)}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-ink/70 hover:bg-ink/5"
          >
            Ahora no
          </button>
          <button
            type="button"
            onClick={() => router.push(
              faltanDatos ? '/completar-perfil?next=/autorizacion-datos'
                : v.contrato_id ? `/contratos/${v.contrato_id}`
                  : '/autorizacion-datos',
            )}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            {faltanDatos ? 'Completar mis datos' : v.contrato_id ? 'Firmar ahora' : 'Leer y autorizar'}
          </button>
        </div>
      </div>
    </div>
  );
}
