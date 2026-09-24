// ── Documentos de alta: títulos históricos y código de bloqueo ──────────────
//
// ⚠️ ESTE MÓDULO YA NO CONTIENE NINGÚN TEXTO LEGAL.
//
// Hasta sep-2026 guardaba dos contratos marco de vinculación —uno de usuario y otro de
// propietario— redactados por el equipo de desarrollo y nunca revisados por el abogado,
// desactivados por el interruptor `VINCULACION_REVISADA_POR_ABOGADO`.
//
// Se retiraron. Al compararlos con los seis documentos que sí entregó el abogado se vio
// que se solapaban con el contrato de agencia comercial y el de arrendamiento, que ya
// son los marcos de cada relación y se suscriben en la primera operación. Lo único que
// el alta necesitaba y aquellos no cubrían —la autorización de tratamiento de datos—
// sí tenía texto del abogado, y vive ahora en ./contratos-registro-texto.ts.
//
// El borrador se borró a propósito, y no por limpieza: era articulado legal sin revisar,
// en el repositorio, detrás de un interruptor de una línea. Mientras siguiera ahí,
// encenderlo por error seguía siendo posible. El histórico está en git.
//
// Lo que queda acá es lo que otros módulos siguen necesitando y que no tiene que ver
// con aquel texto.
//
// ⚠️ Módulo PURO (sin BD, sin `fs`): lo importan tanto las rutas de API como las
// pantallas 'use client'.

import { TIPO_REGISTRO, TITULO_REGISTRO } from './contratos-registro-texto';

/**
 * Títulos de los documentos de alta, para nombrarlos en pantallas y PDF.
 *
 * Incluye los DOS tipos retirados además del vigente: una base que tenga uno emitido
 * —la de desarrollo de alguien, por ejemplo— debe seguir mostrándolo con su nombre y no
 * con su clave cruda. Emitirlos ya no es posible; leerlos sí.
 */
export const TITULOS_VINCULACION: Record<string, string> = {
  [TIPO_REGISTRO]: TITULO_REGISTRO,
  'vinculacion-cliente': 'Contrato de vinculación de usuario (retirado)',
  'vinculacion-propietario': 'Contrato marco de vinculación de propietario (retirado)',
};

/**
 * Código que devuelven las rutas cuando la operación se frena porque falta la firma del
 * documento de alta. Lo reconocen `app/pago/page.tsx` y el alta de vehículos para mandar
 * a la persona a firmar en vez de mostrarle un error genérico.
 *
 * Conserva el nombre original: es parte del contrato con el navegador, y renombrarlo
 * cambiaría la palabra sin cambiar el significado.
 */
export const CODIGO_VINCULACION_PENDIENTE = 'vinculacion_pendiente';
