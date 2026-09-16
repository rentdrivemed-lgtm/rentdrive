// GET /api/admin/usuarios/<id>/paquete → .zip con TODOS los documentos de esa persona.
// GET /api/admin/usuarios/<id>/paquete?info=1 → solo el conteo, sin descargar nada.
//
// El paquete lo arma el SERVIDOR (lib/paquete-documentos.ts): baja cada archivo con
// `descargarAcotado` (sin seguir redirecciones, con tope de tiempo y de bytes) tras
// validar la dirección con `esUrlFotoSegura`, y lo mete en un zip "store"
// (lib/zip.ts). El navegador nunca toca las URLs de Cloudinary.
//
// ── Permisos ────────────────────────────────────────────────────────────────
// Área `usuarios`, que es la que ya protege la ficha de la persona y la lista del
// panel de administración. Hoy la tienen `principal` y `socio`; la `secretaria` NO
// (ver AREA_NIVELES en lib/permisos.ts), y encima puede haber excepciones por
// empleado en `usuarios.permisos_extra`. No se toca el modelo de permisos acá.
//
// El propietario o el cliente descargan SU PROPIO paquete por otra ruta
// (GET /api/perfil/paquete), que no admite un id ajeno. Esta ruta es solo del equipo.
//
// ── Por qué se audita la DESCARGA ───────────────────────────────────────────
// Un solo zip reúne la cédula, la licencia, el certificado bancario y los documentos
// de todos los vehículos de una persona. Es exactamente el archivo que hay que poder
// rastrear si aparece donde no debe, así que queda en la Bitácora quién lo bajó, de
// quién y cuántos archivos se llevó (mismo criterio que el acta de servicio, ver
// app/api/operaciones/[id]/acta/[actaId]/route.ts).
import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { consumirIntento } from '@/lib/limite-tasa';
import {
  listarDocumentosPersona, construirPaquete, fechaHoraColombia,
  tomarTurnoPaquete, liberarTurnoPaquete, cuerpoZip, ERROR_OCUPADO,
  MAX_ARCHIVOS, MAX_CONTRATOS,
} from '@/lib/paquete-documentos';

export const dynamic = 'force-dynamic';
// Bajar hasta 60 archivos de a 4 en 4 puede tardar: mismo techo que usan las otras rutas
// pesadas (acta, IA). El valor NO basta por sí solo —en Railway nada corta la petición al
// llegar a `maxDuration`—, así que la fase de descarga tiene su propio presupuesto de tiempo
// dentro de `construirPaquete` (ver PRESUPUESTO_MS en lib/paquete-documentos.ts): lo que no
// alcance se omite y se anota en el índice, en vez de retener la memoria del zip cinco minutos.
export const maxDuration = 60;

/**
 * Tope por empleado y por hora. Es la vía por la que salen datos personales del
 * archivo en bloque, y cada descarga baja decenas de archivos: 20 por hora le
 * alcanza de sobra a quien está atendiendo casos reales y le pone techo a una
 * sesión robada que quiera llevarse el archivo completo de la empresa.
 */
const MAX_DESCARGAS_HORA = 20;
const HORA_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('usuarios');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const { id } = await params;
  const personaId = Number(id);
  if (!Number.isInteger(personaId) || personaId <= 0) {
    return NextResponse.json({ error: 'Usuario inválido' }, { status: 400 });
  }

  const lista = listarDocumentosPersona(db, personaId);
  if (!lista) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  // ── Solo el conteo ──
  // Lo pide el botón para poder decir "Descargar paquete completo (11 archivos)"
  // antes de bajar nada. Es una consulta a la base, no descarga ni un byte, así que
  // no consume cuota ni se audita como descarga.
  if (req.nextUrl.searchParams.get('info') === '1') {
    // Se audita aunque no baje ni un byte: con este parámetro se puede recorrer la lista de
    // ids y mapear quién tiene cuántos documentos y cuántos vehículos —un inventario útil
    // para elegir a quién exportar después— sin dejar ningún rastro. Queda con una acción
    // propia (`consultar_…`) para no confundirla con una descarga real en la Bitácora.
    registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
      area: 'usuarios',
      accion: 'consultar_paquete_documentos',
      entidad: 'usuario',
      entidad_id: lista.persona.id,
      detalle: JSON.stringify({
        persona: lista.persona.nombre,
        correo: lista.persona.correo,
        archivos: lista.documentos.length,
        contratos: lista.contratos.length,
      }),
    });
    return NextResponse.json({
      persona: lista.persona,
      archivos: lista.documentos.length,
      vehiculos: lista.vehiculos,
      reservas: lista.reservas,
      excedentes: lista.excedentes.length,
      contratos: lista.contratos.length,
      contratos_excedentes: lista.contratosExcedentes.length,
      max_archivos: MAX_ARCHIVOS,
      max_contratos: MAX_CONTRATOS,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Los contratos cuentan: una persona puede no tener ni una foto subida y sí tener sus
  // contratos digitales firmados, y ese paquete sí tiene sentido.
  if (lista.documentos.length === 0 && lista.contratos.length === 0) {
    return NextResponse.json({ error: 'Esta persona no tiene documentos cargados todavía.' }, { status: 404 });
  }


  // Semáforo de concurrencia: el zip se arma entero en memoria y los topes de arriba son por
  // HORA, no simultáneos. Sin esto, varias peticiones a la vez multiplican decenas de MB en el
  // único contenedor que sirve todo el sitio. Ver lib/paquete-documentos.ts.
  if (!tomarTurnoPaquete()) {
    return NextResponse.json({ error: ERROR_OCUPADO }, { status: 503, headers: { 'Retry-After': '20' } });
  }

  const espera = consumirIntento(`paquete-docs:${user.id}`, MAX_DESCARGAS_HORA, HORA_MS);
  if (espera !== null) {
    liberarTurnoPaquete(); // el 503/429 no puede dejar el cupo tomado
    return NextResponse.json(
      { error: `Demasiadas descargas de paquetes seguidas. Intenta de nuevo en ${Math.ceil(espera / 60)} minuto(s).` },
      { status: 429 },
    );
  }

  const { fechaISO, fechaHora } = fechaHoraColombia();
  let paquete;
  try {
    paquete = await construirPaquete(lista, {
      generadoPor: `${user.nombre} (${user.correo})`,
      fechaHora,
      fechaISO,
      // `db` va en el contexto porque los CONTRATOS no se descargan de ningún lado: se
      // generan leyendo su texto congelado (lib/contrato-pdf.ts).
      db,
    });
  } catch (e) {
    console.error('[paquete-documentos] no se pudo armar el zip:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No pudimos armar el paquete. Intenta de nuevo.' }, { status: 500 });
  } finally {
    // SIEMPRE: un error que no libere el turno deja el cupo cerrado hasta el próximo redeploy.
    liberarTurnoPaquete();
  }

  // Se registra DESPUÉS de armarlo: una descarga que terminó en 500 no se llevó nada.
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'usuarios',
    accion: 'descargar_paquete_documentos',
    entidad: 'usuario',
    entidad_id: lista.persona.id,
    detalle: JSON.stringify({
      persona: lista.persona.nombre,
      correo: lista.persona.correo,
      rol: lista.persona.rol,
      archivos: paquete.incluidos,
      omitidos: paquete.omitidos.length,
      bytes: paquete.bytes,
    }),
  });

  // `cuerpoZip` es una VISTA sobre el mismo buffer, no una copia: `new Uint8Array(buffer)`
  // duplicaba los bytes y las dos copias coexistían mientras se construía la respuesta — con
  // un paquete de 40 MB, 40 MB regalados por petición.
  return new NextResponse(cuerpoZip(paquete.zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      // El nombre ya viene saneado a [A-Za-z0-9._-] desde `nombreArchivoZip`, así que
      // no puede cerrar el valor ni inyectar un salto de línea en la cabecera.
      'Content-Disposition': `attachment; filename="${paquete.nombreArchivo}"`,
      'Content-Length': String(paquete.zip.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
