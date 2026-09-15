// GET /api/operaciones/<id>/acta/<actaId> → descarga el PDF del acta.
//
// El PDF se arma EN EL SERVIDOR a partir del snapshot congelado en `actas_servicio`
// (ver lib/acta-servicio-pdf.ts), nunca desde los datos de hoy: aunque después se
// hayan quitado fotos de la operación o cambiado la reserva, este documento sigue
// mostrando lo que había cuando se generó.
//
// Permisos: los mismos que el historial de actas (ver ../route.ts) — admin con la
// sección "operaciones". El mensajero no descarga actas.
//
// La DESCARGA se audita, no solo la generación. El acta reúne en un solo archivo el
// documento de identidad del cliente, su celular, la dirección de entrega y el valor
// pagado: quién generó el respaldo ya quedaba registrado, pero quién se lo llevó —que
// es lo que importa si un documento aparece donde no debe— no quedaba en ningún lado.
import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { consumirIntento } from '@/lib/limite-tasa';
import { leerActa, numeroActa } from '@/lib/acta-servicio';
import { actaPDFBuffer } from '@/lib/acta-servicio-pdf';

export const dynamic = 'force-dynamic';
// Bajar y re-comprimir todas las fotos del servicio puede tardar: mismo tope que
// usan las rutas que llaman a la IA.
export const maxDuration = 60;

// Tope por administrador y por hora. Armar un acta baja y recomprime hasta 24 fotos:
// es cara en CPU y en memoria, y además es la vía por la que salen datos personales
// del archivo. Un empleado revisando servicios descarga unas pocas; 60 por hora no
// estorba a nadie y le pone techo a una sesión robada que quiera llevarse el archivo
// entero.
const MAX_DESCARGAS_HORA = 60;
const HORA_MS = 60 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; actaId: string }> }) {
  const g = await guardArea('operaciones');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const { id, actaId } = await params;
  const opId = Number(id);
  const aId = Number(actaId);
  if (!Number.isInteger(opId) || opId <= 0 || !Number.isInteger(aId) || aId <= 0) {
    return NextResponse.json({ error: 'Acta inválida' }, { status: 400 });
  }

  const espera = consumirIntento(`acta-descarga:${user.id}`, MAX_DESCARGAS_HORA, HORA_MS);
  if (espera !== null) {
    return NextResponse.json(
      { error: `Demasiadas descargas de respaldos seguidas. Intenta de nuevo en ${Math.ceil(espera / 60)} minuto(s).` },
      { status: 429 },
    );
  }

  const acta = leerActa(db, aId);
  // El acta tiene que ser de ESTE servicio: así un id de acta suelto no sirve para
  // sacar el respaldo de otro servicio por una ruta que no le corresponde.
  if (!acta || acta.operacion_id !== opId) {
    return NextResponse.json({ error: 'Acta no encontrada' }, { status: 404 });
  }

  let pdf: ArrayBuffer;
  try {
    pdf = await actaPDFBuffer(acta);
  } catch (e) {
    console.error('[acta] no se pudo armar el PDF:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No pudimos armar el PDF del respaldo. Intenta de nuevo.' }, { status: 500 });
  }

  // Se registra DESPUÉS de armarlo: una descarga que falló con 500 no se llevó nada.
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'operaciones',
    accion: 'descargar_acta_servicio',
    entidad: 'actas_servicio',
    entidad_id: acta.id,
    detalle: JSON.stringify({ operacion_id: opId, version: acta.version, numero: numeroActa(acta) }),
  });

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${numeroActa(acta)}.pdf"`,
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
