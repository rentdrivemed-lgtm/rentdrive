import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { enviarCorreo } from '@/lib/email';
import { origenNoPermitido } from '@/lib/csrf';
import { consumirIntento, ipCliente } from '@/lib/limite-tasa';
import {
  generarCodigoCorreo, expiraEnMinutos, mensajeCodigoCorreo,
  CODIGO_VIGENCIA_MIN, REENVIO_COOLDOWN_SEGUNDOS,
} from '@/lib/verificacion-correo';

// Reenvío de código con cooldown — mismo patrón que
// app/api/leads-propietarios/reenviar (cooldown guardado en la propia fila,
// no en lib/limite-tasa.ts, que ese endpoint tampoco usa).
//
// No parsea body (el frontend llama fetch(..., { method: 'POST' }) sin
// Content-Type, igual que app/api/auth/logout) — por eso aquí NO exigimos
// application/json como en verificar-correo/route.ts, solo el chequeo de Origin.
type FilaReenvio = { nombre: string; correo: string; correo_codigo_generado_at: string | null; correo_verificado: number };

// El cooldown de abajo (REENVIO_COOLDOWN_SEGUNDOS) es por CUENTA. Este límite es
// por IP: sin él, alguien con muchas cuentas (o que abusa de crear cuentas,
// ver app/api/auth/registro) podría disparar reenvíos de correo en paralelo
// desde una sola conexión. 10/hora por IP es holgado para un usuario real
// reintentando un código que no le llegó.
const IP_MAX_REENVIOS = 10;
const IP_VENTANA_MS = 60 * 60 * 1000; // 1 hora

export async function POST(req: NextRequest) {
  const origenError = origenNoPermitido(req);
  if (origenError) return origenError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const espera = consumirIntento(`verificar-correo-reenviar:${ipCliente(req)}`, IP_MAX_REENVIOS, IP_VENTANA_MS);
  if (espera !== null) {
    return NextResponse.json(
      { error: `Demasiados reenvíos seguidos desde tu conexión. Intenta de nuevo en ${Math.ceil(espera / 60)} minuto(s).` },
      { status: 429 },
    );
  }

  const db = getDb();
  const fila = db.prepare(
    'SELECT nombre, correo, correo_codigo_generado_at, correo_verificado FROM usuarios WHERE id = ?'
  ).get(user.id) as FilaReenvio | undefined;

  if (!fila) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
  if (fila.correo_verificado) return NextResponse.json({ enviado: true, detalle: 'ya estaba verificado' });

  if (fila.correo_codigo_generado_at) {
    const segundosDesdeUltimo = (Date.now() - new Date(fila.correo_codigo_generado_at).getTime()) / 1000;
    if (segundosDesdeUltimo < REENVIO_COOLDOWN_SEGUNDOS) {
      return NextResponse.json({ error: `Espera ${Math.ceil(REENVIO_COOLDOWN_SEGUNDOS - segundosDesdeUltimo)}s antes de pedir otro código.` }, { status: 429 });
    }
  }

  const codigo = generarCodigoCorreo();
  const ahora = new Date();
  const expira = expiraEnMinutos(CODIGO_VIGENCIA_MIN, ahora);

  db.prepare(
    'UPDATE usuarios SET correo_codigo = ?, correo_codigo_expira = ?, correo_codigo_generado_at = ?, correo_codigo_intentos = 0 WHERE id = ?'
  ).run(codigo, expira, ahora.toISOString(), user.id);

  const envio = await enviarCorreo(fila.correo, 'Tu código de verificación RentDrive', mensajeCodigoCorreo(fila.nombre, codigo));
  if (!envio.enviado) {
    console.log(`[verificar-correo] Código reenviado para usuario ${user.id}: ${codigo} (envío real falló: ${envio.detalle})`);
  }

  return NextResponse.json({ enviado: envio.enviado, detalle: envio.detalle });
}
