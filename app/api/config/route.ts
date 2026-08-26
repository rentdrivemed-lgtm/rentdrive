import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getConfig, setConfig } from '@/lib/operaciones';
import { permisosDe, puede, registrarAuditoria } from '@/lib/permisos';

export const dynamic = 'force-dynamic';

// Claves de configuración editables desde el panel admin.
const CLAVES = [
  'admin_whatsapp', 'pico_placa', 'comision_plataforma_pct', 'empresa_nombre', 'empresa_nit',
  'referido_habilitado', 'referido_recompensa_referrer', 'referido_recompensa_referido',
] as const;

// Cada clave de config pertenece a UN grupo, y cada grupo exige SU PROPIO permiso.
// `config_editar` (todo-o-nada) se partió en dos casillas para que dar acceso a ajustar
// pico y placa no implique también poder cambiar la comisión de la plataforma o el NIT.
// Si el body trae claves de ambos grupos a la vez, se exigen AMBOS permisos: tener solo
// uno no alcanza para escribir claves del otro grupo (ver PUT más abajo).
const CAMPO_PERMISO: Record<(typeof CLAVES)[number], 'config_editar_operativo' | 'config_editar_financiero'> = {
  admin_whatsapp: 'config_editar_operativo',
  pico_placa: 'config_editar_operativo',
  comision_plataforma_pct: 'config_editar_financiero',
  empresa_nombre: 'config_editar_financiero',
  empresa_nit: 'config_editar_financiero',
  referido_habilitado: 'config_editar_financiero',
  referido_recompensa_referrer: 'config_editar_financiero',
  referido_recompensa_referido: 'config_editar_financiero',
};

// LECTURA COMÚN A CUALQUIER ADMIN — decidido a propósito, NO es un descuido.
// Este GET no se gatea con el área "config" porque lo consumen tres pantallas que no
// son la de Configuración: el dashboard admin al arrancar (resalta los carros con pico
// y placa hoy), OperacionesPanel y ContabilidadPanel. Atarlo a "config" —principal+socio—
// rompería esas tres vistas para la secretaría, que hoy las usa legítimamente, y el costo
// de eso supera el beneficio de ocultarle la comisión a alguien que ya es administrador.
// El riesgo real está en MODIFICAR, y el PUT de abajo ya exige el permiso específico de
// cada clave (`config_editar_operativo` / `config_editar_financiero`, ver CAMPO_PERMISO).
// MEJORA FUTURA: ahora que existe esa separación operativo/financiero, si se quiere cerrar
// también este GET, se puede devolver solo `pico_placa`/`admin_whatsapp` a quien tenga
// "config" pero no "config_editar_financiero", y ocultar comision_plataforma_pct/empresa_nit
// al resto — hoy se deja abierto a cualquier admin a propósito (ver razones arriba).
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  const db = getDb();
  const config: Record<string, string> = {};
  for (const c of CLAVES) config[c] = getConfig(db, c);
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  const db = getDb();
  const { nivel, extra } = permisosDe(db, user.id);
  const body = await req.json().catch(() => ({}));

  // Solo las claves reconocidas y presentes como string en el body.
  const presentes = CLAVES.filter(c => typeof body[c] === 'string');

  // Cada campo del body se valida contra SU PROPIO permiso antes de aplicar ningún
  // UPDATE: si el body mezcla claves operativas y financieras, se exigen los DOS
  // permisos a la vez (tener solo uno no alcanza para escribir claves del otro grupo).
  // Si falta cualquiera de los permisos requeridos, no se escribe nada (todo o nada).
  const permisosRequeridos = new Set(presentes.map(c => CAMPO_PERMISO[c]));
  for (const permiso of permisosRequeridos) {
    if (!puede(nivel, permiso, extra)) {
      return NextResponse.json({ error: 'No tienes permiso para esta sección.' }, { status: 403 });
    }
  }

  const cambiadas: string[] = [];
  for (const c of presentes) { setConfig(db, c, body[c].trim()); cambiadas.push(c); }
  if (cambiadas.length > 0) {
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'config', accion: 'editar_config', detalle: `Actualizó: ${cambiadas.join(', ')}`,
    });
  }
  const config: Record<string, string> = {};
  for (const c of CLAVES) config[c] = getConfig(db, c);
  return NextResponse.json({ ok: true, config });
}
