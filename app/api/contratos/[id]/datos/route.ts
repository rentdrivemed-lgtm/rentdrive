// Los DATOS de un contrato: verlos y completarlos.
//
//   GET /api/contratos/[id]/datos → los datos agrupados (partes, vehículo, póliza,
//        operación), qué falta, qué bloquea la firma, dónde queda guardado cada uno y
//        cómo va a salir IMPRESO cada valor.
//   PUT /api/contratos/[id]/datos → los guarda, REGENERA el texto del documento desde
//        la plantilla del abogado y recalcula lo derivado (canon total, IVA, penas,
//        comisión) y los campos que siguen en blanco.
//
// Lo que se edita son los DATOS. El TEXTO LEGAL no: se vuelve a generar. Y solo
// mientras el documento esté SIN FIRMAR y sin vía de firma elegida — uno firmado se
// anula y se reemite (POST /api/contratos/[id]/anular), que ya estaba implementado.
//
// Permiso: el área `contratos` (la misma que emite y anula), o sea los niveles
// `principal` y `socio` (lib/permisos.ts → AREA_NIVELES). Ni el cliente ni el
// propietario pueden tocar los datos de su propio contrato aunque puedan verlo.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { accesoContrato } from '@/lib/contratos-acceso';
import { leerContrato } from '@/lib/contratos-firma';
import { guardarDatosContrato, leerDatosContrato } from '@/lib/contratos-edicion';

export const dynamic = 'force-dynamic';

/** Máximo de campos por petición. El catálogo entero no llega a 40. */
const MAX_CAMPOS = 60;

function idValido(id: string): number {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const contratoId = idValido(id);
  if (!contratoId) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  // Mismo 404 que si no existiera: a quien no es parte ni tiene el área no se le
  // confirma siquiera que el documento exista.
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  if (!acceso.puedeGestionar) {
    return NextResponse.json({ error: 'No tienes permiso para ver los datos de este documento.' }, { status: 403 });
  }

  const datos = leerDatosContrato(db, contratoId);
  if (!datos) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  return NextResponse.json(datos);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF: cambiar los datos de un contrato es al menos tan consecuente como emitirlo,
  // y esa ruta ya lo aplica. SameSite=Lax no basta.
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const contratoId = idValido(id);
  if (!contratoId) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    campos?: unknown; conductores?: unknown; revision?: unknown;
  };

  const campos = body.campos;
  if (campos !== undefined && (typeof campos !== 'object' || campos === null || Array.isArray(campos))) {
    return NextResponse.json({ error: 'Los campos enviados no tienen un formato válido.' }, { status: 400 });
  }
  const mapa = (campos ?? {}) as Record<string, unknown>;
  if (Object.keys(mapa).length > MAX_CAMPOS) {
    return NextResponse.json({ error: 'Demasiados campos en una sola petición.' }, { status: 400 });
  }
  if (Object.keys(mapa).length === 0 && body.conductores === undefined) {
    return NextResponse.json({ error: 'No hay ningún cambio que guardar.' }, { status: 400 });
  }

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  if (!acceso.puedeGestionar) {
    return NextResponse.json({ error: 'No tienes permiso para modificar los datos de este documento.' }, { status: 403 });
  }

  const revision = body.revision === undefined ? undefined : Number(body.revision);
  if (revision !== undefined && !Number.isInteger(revision)) {
    return NextResponse.json({ error: 'La revisión enviada no es válida.' }, { status: 400 });
  }

  const resultado = guardarDatosContrato(db, contratoId, {
    id: user.id, nombre: user.nombre, correo: user.correo, nivel: 'admin',
  }, { campos: mapa, conductores: body.conductores, revision });
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  return NextResponse.json({
    ok: true,
    // Lo que cambió, campo por campo y con su valor anterior: lo mismo que quedó en la
    // bitácora, para que quien edita vea exactamente qué acaba de hacer.
    cambios: resultado.cambios,
    faltantes: resultado.faltantes,
    avisos: resultado.avisos,
    contrato: {
      id: resultado.contrato.id,
      numero: resultado.contrato.numero,
      version: resultado.contrato.version,
      estado: resultado.contrato.estado,
      datos_revision: resultado.contrato.datos_revision,
      datos_editados_en: resultado.contrato.datos_editados_en,
      datos_editados_por_nombre: resultado.contrato.datos_editados_por_nombre,
    },
    // Los datos ya releídos: la pantalla no tiene que pedirlos otra vez.
    datos: leerDatosContrato(db, contratoId),
  });
}
