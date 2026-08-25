import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { guardArea } from '@/lib/guard';
import { getConfig } from '@/lib/operaciones';
import { parsePicoPlaca, placaRestringida, ultimoDigitoPlaca, fechaISOLocal } from '@/lib/pico-placa';
import { enviarWhatsapp } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

type Afectada = {
  reserva_id: number; placa: string; digito: number;
  marca: string; modelo: string;
  usuario_id: number; usuario_nombre: string; usuario_celular: string;
  propietario_id: number; propietario_nombre: string; propietario_celular: string;
};

// Doble puerta (mismo patrón que /api/admin/mercado/check): el cron entra con su
// secreto y sin sesión; una persona entra solo si es admin Y tiene la sección "config".
//
// ¿Por qué "config" y no "operaciones"? Por dos razones:
//  1) El POST dispara WhatsApp MASIVO a clientes y propietarios reales: es un efecto
//     externo e irreversible (no se puede "des-enviar"). Entre las dos áreas candidatas,
//     "config" es la MÁS restrictiva —principal+socio— frente a "operaciones", que
//     además incluye a la secretaría; se elige a propósito la que limita más quién
//     puede lanzar mensajería masiva.
//  2) La única entrada desde la interfaz es PicoPlacaConfig, que vive en la pestaña
//     Configuración. Gatear por "config" evita la incoherencia de "ves el panel pero
//     la API te contesta 403".
// Devuelve null si puede pasar, o la respuesta de error que debe retornar la ruta.
async function puertaDeEntrada(req: NextRequest): Promise<NextResponse | null> {
  const secret = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (process.env.CRON_SECRET && secret === process.env.CRON_SECRET) return null;
  const g = await guardArea('config');
  return 'error' in g ? g.error : null;
}

// Reservas activas hoy cuyo vehículo está restringido por pico y placa hoy.
function afectadasHoy(db: ReturnType<typeof getDb>, hoy: Date): Afectada[] {
  const pp = parsePicoPlaca(getConfig(db, 'pico_placa'));
  if (!pp.activo) return [];
  const iso = fechaISOLocal(hoy);
  const filas = db.prepare(`
    SELECT r.id AS reserva_id, COALESCE(v.placa,'') AS placa, v.marca, v.modelo,
           r.usuario_id, u.nombre AS usuario_nombre, COALESCE(u.celular,'') AS usuario_celular,
           v.propietario_id, p.nombre AS propietario_nombre, COALESCE(p.celular,'') AS propietario_celular
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios  u ON r.usuario_id  = u.id
    JOIN usuarios  p ON v.propietario_id = p.id
    WHERE r.estado IN ('confirmada','en_curso')
      AND r.fecha_inicio <= ? AND r.fecha_fin >= ?
  `).all(iso, iso) as Omit<Afectada, 'digito'>[];

  return filas
    .filter(f => placaRestringida(pp, f.placa, hoy))
    .map(f => ({ ...f, digito: ultimoDigitoPlaca(f.placa) ?? -1 }));
}

// GET: previsualizar a quién afectaría hoy (sin enviar).
export async function GET(req: NextRequest) {
  const veto = await puertaDeEntrada(req);
  if (veto) return veto;
  const db = getDb();
  const hoy = new Date();
  return NextResponse.json({ fecha: fechaISOLocal(hoy), afectadas: afectadasHoy(db, hoy) });
}

// POST: enviar los avisos (idempotente por reserva+día).
export async function POST(req: NextRequest) {
  const veto = await puertaDeEntrada(req);
  if (veto) return veto;

  const db = getDb();
  const hoy = new Date();
  const iso = fechaISOLocal(hoy);
  const diaTxt = DIAS[hoy.getDay()];
  const afectadas = afectadasHoy(db, hoy);

  const yaEnviado = db.prepare('SELECT 1 FROM pico_placa_avisos WHERE reserva_id = ? AND fecha = ?');
  const marcar = db.prepare('INSERT OR IGNORE INTO pico_placa_avisos (reserva_id, fecha) VALUES (?, ?)');
  const notif = db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)');

  let enviados = 0;
  const detalle: { reserva_id: number; placa: string; cliente: string; propietario: string }[] = [];

  for (const a of afectadas) {
    if (yaEnviado.get(a.reserva_id, iso)) continue;

    const titulo = '🚦 Pico y placa hoy';
    const msgCliente = `🚦 *Pico y placa — DrivePass*\nHoy ${diaTxt} el vehículo que tienes alquilado, ${a.marca} ${a.modelo} (placa ${a.placa}), tiene *pico y placa* en Medellín por terminar en ${a.digito}. Evita circular en el horario restringido para no recibir multas.`;
    const msgProp = `🚦 *Pico y placa — DrivePass*\nHoy ${diaTxt} tu vehículo ${a.marca} ${a.modelo} (placa ${a.placa}), actualmente alquilado, tiene pico y placa por terminar en ${a.digito}.`;

    // Notificación in-app (siempre) + WhatsApp (si está habilitado).
    notif.run(a.usuario_id, 'pico_placa', titulo, msgCliente, a.reserva_id, 'reserva');
    notif.run(a.propietario_id, 'pico_placa', titulo, msgProp, a.reserva_id, 'reserva');
    const rc = await enviarWhatsapp(a.usuario_celular, msgCliente);
    const rp = await enviarWhatsapp(a.propietario_celular, msgProp);

    marcar.run(a.reserva_id, iso);
    enviados++;
    detalle.push({ reserva_id: a.reserva_id, placa: a.placa, cliente: rc.detalle, propietario: rp.detalle });
  }

  return NextResponse.json({ fecha: iso, total_afectadas: afectadas.length, enviados, detalle });
}
