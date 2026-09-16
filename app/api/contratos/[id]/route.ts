// Un contrato digital completo: su TEXTO ÍNTEGRO, sus bloques de firma y el veredicto
// de integridad de cada firma ya recogida.
//
// El texto completo va entero a propósito: quien firma tiene que VER el documento, no
// un resumen. Es un contrato.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { accesoContrato } from '@/lib/contratos-acceso';
import {
  leerContrato, leerFirmas, parsearFaltantes, faltantesQueBloquean, puedeFirmarBloque,
  tituloDocumento, verificarSelloFirma,
} from '@/lib/contratos-firma';
import { resumenPapel } from '@/lib/contratos-papel';
import { motivoNoEditable } from '@/lib/contratos-edicion';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const contratoId = Number(id);
  if (!Number.isInteger(contratoId) || contratoId <= 0) {
    return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  }

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  // Mismo 404 que si no existiera: a quien no es parte ni tiene el área no se le
  // confirma siquiera que el documento exista.
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const quien = {
    usuarioId: user.id,
    nombre: user.nombre,
    correo: user.correo,
    rolCuenta: user.rol,
    puedeFirmarComoAgente: acceso.puedeFirmarComoAgente,
  };

  const firmas = leerFirmas(db, contratoId).map(f => {
    const puesta = !!f.firmada_en;
    return {
      bloque: f.bloque,
      etiqueta: f.etiqueta,
      rol: f.rol,
      momento: f.momento,
      orden: f.orden,
      nombre_esperado: f.nombre_esperado,
      documento_esperado: f.documento_esperado,
      firmada_en: f.firmada_en,
      firma_nombre_confirmado: f.firma_nombre_confirmado,
      firma_metodo: f.firma_metodo,
      // El trazo se devuelve para poder pintarlo al pie del documento. La IP y el
      // user-agent NO: son metadatos del acto de firma que solo necesita la bitácora,
      // y publicarlos le daría al cliente la IP del propietario y viceversa.
      firma_imagen: f.firma_imagen,
      // `firma_hash` nunca sale: el sello es interno. Lo que se publica es su veredicto.
      integridad: puesta ? verificarSelloFirma(contrato, f) : null,
      // Si ESTA cuenta podría poner este trazo. Es solo para pintar la interfaz; la
      // decisión de verdad la vuelve a tomar el endpoint de firma.
      // Un documento firmado en papel no admite firma electrónica: la vía ya está
      // elegida y las dos son excluyentes.
      puedo_firmar: !puesta && contrato.estado !== 'anulado' && contrato.via_firma !== 'papel'
        && puedeFirmarBloque(f, quien).ok,
    };
  });

  const faltantes = parsearFaltantes(contrato.faltantes_json);
  const bloqueantes = faltantesQueBloquean(faltantes);

  // ¿Se pueden COMPLETAR los datos de este documento? Solo el equipo con el área de
  // contratos, y solo mientras esté sin firmar y sin vía de firma elegida. Cuando no
  // se puede, la pantalla tiene que poder decir POR QUÉ (lo dice `motivoNoEditable`).
  const motivoNoEdita = motivoNoEditable(contrato, firmas.filter(f => !!f.firmada_en).length);

  return NextResponse.json({
    contrato: {
      id: contrato.id,
      reserva_id: contrato.reserva_id,
      tipo: contrato.tipo,
      titulo: tituloDocumento(contrato.tipo),
      numero: contrato.numero,
      version: contrato.version,
      estado: contrato.estado,
      texto: contrato.texto,
      created_at: contrato.created_at,
      generado_por_nombre: contrato.generado_por_nombre,
      firmado_en: contrato.firmado_en,
      anulado_en: contrato.anulado_en,
      anulado_por_nombre: contrato.anulado_por_nombre,
      motivo_anulacion: contrato.motivo_anulacion,
      // Por qué vía se firmó: '' (sin decidir), 'digital' o 'papel'. La pantalla tiene
      // que poder decirlo con claridad — un contrato firmado a mano NO es lo mismo que
      // uno con firma electrónica verificada.
      via_firma: contrato.via_firma,
      // Contador de ediciones de DATOS. Viaja hasta el formulario de firma: si alguien
      // completa un dato mientras el firmante lee, el texto se regenera y la firma se
      // rechaza hasta que lo relea (ver lib/contratos-firma.ts → firmarBloqueContrato).
      datos_revision: Number(contrato.datos_revision) || 0,
      datos_editados_en: contrato.datos_editados_en || '',
      datos_editados_por_nombre: contrato.datos_editados_por_nombre || '',
    },
    // Ficha del ejemplar firmado a mano, cuando lo hay. Nunca el contenido del archivo:
    // eso se pide aparte, en GET /api/contratos/[id]/escaneo.
    papel: resumenPapel(contrato),
    firmas,
    // Los huecos se muestran de frente: los estructurales no impiden firmar, pero el
    // firmante tiene que saber qué espacios van en blanco antes de poner el trazo.
    faltantes: { bloqueantes, estructurales: faltantes.filter(f => !f.enBD) },
    permisos: {
      gestionar: acceso.puedeGestionar,
      firmar_agente: acceso.puedeFirmarComoAgente,
      parte: acceso.parte,
      editar_datos: acceso.puedeGestionar && motivoNoEdita === '',
      motivo_no_editable: motivoNoEdita,
    },
  });
}
