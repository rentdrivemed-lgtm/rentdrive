import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { guardArea } from '@/lib/guard';
import { secretoCronValido } from '@/lib/cron-secret';
import { listarRecursosPorPrefijo, borrarRecursos, mensajeErrorCloudinary, type RecursoCloudinary } from '@/lib/storage';
import { clasificarRecursos } from '@/lib/limpieza-documentos';
import { registrarAuditoria } from '@/lib/permisos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Limpieza de fotos de cédula/licencia huérfanas (registro-temp) ──────────
//
// `app/api/registro/extraer-documento/route.ts` (el atajo "sube tu cédula y te lleno
// el formulario" del registro) sube la foto a Cloudinary ANTES de que exista cualquier
// cuenta — no hay a quién asociarla todavía. Por eso esas subidas quedan bajo la
// carpeta `registro-temp/` (ver `uploadFile(..., { folder: 'registro-temp' })` en ese
// archivo) en vez de la carpeta normal de documentos (`docs/`). Si la persona completa
// el registro, la URL queda guardada en `usuarios.cedula_url`/`licencia_url` (o
// `licencia_url_dorso`, etc.) — "reclamada". Si abandona el registro (cierra la
// pestaña, el correo ya existe → 409, cambia de opinión, retoma la foto una segunda
// vez y la primera queda suelta...) esa imagen queda huérfana: subida, pero sin
// ningún `usuario_id` que la referencie, para siempre, si nadie la borra.
//
// Este endpoint (admin-only) hace ese trabajo:
//   1. Lista los recursos de Cloudinary bajo `registro-temp/` con más de
//      `HORAS_ANTIGUEDAD` horas de antigüedad (48h por defecto — tiempo de sobra para
//      completar un registro normal, incluso con reintentos).
//   2. Para cada uno, comprueba si su URL coincide con algún
//      `usuarios.cedula_url` / `cedula_url_dorso` / `licencia_url` / `licencia_url_dorso`
//      existente. Si coincide, el documento SÍ fue reclamado por una cuenta real — no
//      se toca, sin importar su antigüedad (la carpeta no se limpia sola por completo,
//      solo lo que nunca se reclamó).
//   3. Borra (`destroy`, vía la Admin API de Cloudinary) los que no coincidieron.
//
// Dry-run por defecto: sin `?confirmar=true` en la URL, el endpoint SOLO reporta qué
// haría (revisados/huérfanos detectados/conservados) sin borrar nada — mismo patrón
// que `POST /api/admin/reprocesar-placas` (ahí es un flag en el body; acá, al no
// necesitar ningún otro parámetro, es un query param, pero el criterio "sin el flag
// explícito no se muta nada" es el mismo).
//
// ⚠️ ACCIÓN PENDIENTE — NO hay cron real montado para esto todavía (fuera de alcance
// de este cambio, requiere acceso al dashboard de Railway): este endpoint necesita ser
// invocado PERIÓDICAMENTE desde afuera — un cron job programado en Railway golpeando
// `POST /api/admin/limpiar-documentos-huerfanos?confirmar=true` con el header
// `x-cron-secret: $CRON_SECRET` (mismo secreto que ya usan pico-placa/mercado/
// reprocesar-placas; ver `scripts/pico-placa-cron.sh` como referencia del patrón), o
// una llamada manual programada por el equipo.
//
// El texto de consentimiento de app/(auth)/registro/page.tsx y
// app/completar-perfil/page.tsx se redactó a propósito SIN prometer un plazo exacto
// (p. ej. "máximo 48 horas"), justamente porque ESTE endpoint no se dispara solo
// todavía. Hasta que alguien programe este cron en Railway (o equivalente), ese texto
// de consentimiento NO puede considerarse 100% preciso operativamente si se le
// agregara un plazo garantizado — y mientras tanto, alguien del equipo debe correr
// este endpoint manualmente de forma periódica (con `?confirmar=true`) para que la
// carpeta `registro-temp/` de Cloudinary no acumule huérfanos indefinidamente.

const PREFIJO_REGISTRO_TEMP = 'registro-temp/';
const HORAS_ANTIGUEDAD = 48;

// Actor sintético para la bitácora cuando dispara el cron (x-cron-secret), no una
// sesión real — mismo criterio documentado en app/api/admin/reprocesar-placas/route.ts.
const ACTOR_CRON = { id: 0, nombre: 'cron', correo: '', nivel: 'cron' };

type Actor = { id: number; nombre?: string; correo?: string; nivel?: string };

// Doble puerta (mismo patrón que reprocesar-placas y mercado/check): el cron entra con
// su secreto y sin sesión; una persona entra solo si es admin Y tiene la sección
// "usuarios" (esta acción borra fotos de documentos de identidad reales en Cloudinary).
async function puertaDeEntrada(req: NextRequest): Promise<{ actor: Actor } | { error: NextResponse }> {
  const secret = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secretoCronValido(secret, process.env.CRON_SECRET)) return { actor: ACTOR_CRON };
  const g = await guardArea('usuarios');
  if ('error' in g) return { error: g.error };
  return { actor: { id: g.user.id, nombre: g.user.nombre, correo: g.user.correo, nivel: g.nivel } };
}

type DetalleResultado = {
  public_id: string;
  url: string;
  creado: string;
  estado: 'huerfano_borrado' | 'huerfano_detectado' | 'conservado_reclamado' | 'huerfano_error_borrado';
};

// POST /api/admin/limpiar-documentos-huerfanos
// Query params:
//  - confirmar=true: OBLIGATORIO para borrar de verdad. Sin este flag, modo dry-run
//    (reporta qué borraría, no toca nada en Cloudinary).
//  - horas: opcional, sobrescribe HORAS_ANTIGUEDAD (para pruebas puntuales; en uso
//    normal no hace falta pasarlo).
export async function POST(req: NextRequest) {
  const puerta = await puertaDeEntrada(req);
  if ('error' in puerta) return puerta.error;
  const actor = puerta.actor;

  const { searchParams } = new URL(req.url);
  const confirmar = searchParams.get('confirmar') === 'true';
  const horasParam = Number(searchParams.get('horas'));
  const horasAntiguedad = Number.isFinite(horasParam) && horasParam > 0 ? horasParam : HORAS_ANTIGUEDAD;

  const db = getDb();

  let recursos: RecursoCloudinary[];
  try {
    recursos = await listarRecursosPorPrefijo(PREFIJO_REGISTRO_TEMP);
  } catch (err) {
    return NextResponse.json(
      { error: 'No se pudo listar los recursos de Cloudinary: ' + mensajeErrorCloudinary(err) },
      { status: 502 },
    );
  }

  // `clasificarRecursos` LANZA si no puede comprobar qué fotos están protegidas por
  // un acta de respaldo (lib/limpieza-documentos.ts): en ese caso no se borra nada.
  let clasificacion: ReturnType<typeof clasificarRecursos>;
  try {
    clasificacion = clasificarRecursos(db, recursos, horasAntiguedad);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudo clasificar los recursos; no se borró nada.' },
      { status: 500 },
    );
  }
  const { candidatos, huerfanos, conservados } = clasificacion;

  let borrados: string[] = [];
  let errorBorrado: string | undefined;
  if (confirmar && huerfanos.length > 0) {
    const resultado = await borrarRecursos(huerfanos.map(h => h.public_id));
    borrados = resultado.borrados;
    errorBorrado = resultado.error;
  }

  const detalle: DetalleResultado[] = huerfanos.map(h => ({
    public_id: h.public_id,
    url: h.secure_url,
    creado: h.created_at,
    estado: !confirmar
      ? 'huerfano_detectado'
      : borrados.includes(h.public_id)
      ? 'huerfano_borrado'
      : 'huerfano_error_borrado',
  }));

  // Bitácora: este endpoint borra archivos reales de Cloudinary (o, en dry-run, solo
  // reporta qué borraría) — mismo criterio de auditoría que reprocesar-placas/mercado.
  registrarAuditoria(db, actor, {
    area: 'usuarios',
    accion: 'limpiar_documentos_huerfanos',
    entidad: 'cloudinary_registro_temp',
    detalle: JSON.stringify({
      modo: confirmar ? 'confirmar' : 'dry-run',
      horas_antiguedad: horasAntiguedad,
      revisados: recursos.length,
      candidatos: candidatos.length,
      conservados,
      huerfanos_detectados: huerfanos.length,
      borrados: borrados.length,
      ...(errorBorrado ? { error_borrado: errorBorrado } : {}),
    }),
  });

  return NextResponse.json({
    modo: confirmar ? 'confirmado' : 'dry-run',
    prefijo: PREFIJO_REGISTRO_TEMP,
    horas_antiguedad: horasAntiguedad,
    revisados: recursos.length,
    conservados,
    huerfanos_detectados: huerfanos.length,
    borrados: borrados.length,
    ...(errorBorrado ? { error_borrado: errorBorrado } : {}),
    detalle,
  });
}
