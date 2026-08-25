import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getConfig, setConfig } from '@/lib/operaciones';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';

export const dynamic = 'force-dynamic';

// Claves de configuración editables desde el panel admin.
const CLAVES = [
  'admin_whatsapp', 'pico_placa', 'comision_plataforma_pct', 'empresa_nombre', 'empresa_nit',
  'referido_habilitado', 'referido_recompensa_referrer', 'referido_recompensa_referido',
] as const;

// LECTURA COMÚN A CUALQUIER ADMIN — decidido a propósito, NO es un descuido.
// Este GET no se gatea con el área "config" porque lo consumen tres pantallas que no
// son la de Configuración: el dashboard admin al arrancar (resalta los carros con pico
// y placa hoy), OperacionesPanel y ContabilidadPanel. Atarlo a "config" —principal+socio—
// rompería esas tres vistas para la secretaría, que hoy las usa legítimamente, y el costo
// de eso supera el beneficio de ocultarle la comisión a alguien que ya es administrador.
// El riesgo real está en MODIFICAR, y el PUT de abajo sí exige `config_editar` (principal).
// MEJORA FUTURA: separar las claves sensibles (comision_plataforma_pct, empresa_nit) de
// las operativas (pico_placa) y devolver solo estas últimas a quien no tenga "config".
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  const db = getDb();
  const config: Record<string, string> = {};
  for (const c of CLAVES) config[c] = getConfig(db, c);
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const g = await guardArea('config_editar');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;
  const body = await req.json().catch(() => ({}));
  const cambiadas: string[] = [];
  for (const c of CLAVES) {
    if (typeof body[c] === 'string') { setConfig(db, c, body[c].trim()); cambiadas.push(c); }
  }
  if (cambiadas.length > 0) {
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'config', accion: 'editar_config', detalle: `Actualizó: ${cambiadas.join(', ')}`,
    });
  }
  const config: Record<string, string> = {};
  for (const c of CLAVES) config[c] = getConfig(db, c);
  return NextResponse.json({ ok: true, config });
}
