// ── Referencia a un documento privado (módulo PURO) ─────────────────────────
//
// Un documento de identidad ya no se identifica ante el navegador por su URL de
// Cloudinary, sino por una REFERENCIA de tres partes: ámbito + id del registro +
// clave. `usuario/12/cedula_frente`, `reserva/340/licencia_dorso`.
//
// POR QUÉ UNA REFERENCIA Y NO LA URL (ni un enlace firmado).
//   · La URL de Cloudinary, aunque esté firmada, NO caduca (la firma `s--xxx--` es un
//     HMAC del public_id, sin componente temporal; solo caducan los enlaces con
//     `auth_token`, que es función de plan Advanced). Entregarle al navegador una URL
//     firmada sería repetir el problema actual: un enlace permanente, compartible por
//     WhatsApp, imposible de revocar.
//   · La referencia, en cambio, no sirve de nada fuera de una sesión con permiso: la
//     resuelve `/api/documentos/...`, que comprueba quién pide y de quién es el
//     documento ANTES de devolver un solo byte, y deja el acceso en la bitácora.
//   · Además la referencia es ESTABLE: migrar el archivo en Cloudinary (de público a
//     privado) le cambia la URL, pero no la referencia. Las pantallas no se enteran.
//
// Módulo PURO (sin Node, sin BD, sin el SDK de Cloudinary) para poder importarse
// igual desde componentes 'use client' y desde el servidor, como `lib/pico-placa.ts`
// o `lib/documento-tipo.ts`. El mapeo clave → columna vive en lib/documentos-acceso.ts
// (servidor), que es donde hace falta la base de datos.

import { esPdfUrl } from './documento-tipo';

export type AmbitoDocumento = 'usuario' | 'reserva' | 'vehiculo';

export const AMBITOS: readonly AmbitoDocumento[] = ['usuario', 'reserva', 'vehiculo'] as const;

/** Claves válidas por ámbito, con la etiqueta que ve la persona. */
export const CLAVES_DOCUMENTO: Record<AmbitoDocumento, Record<string, string>> = {
  usuario: {
    cedula_frente:        'Documento de identidad (frente)',
    cedula_dorso:         'Documento de identidad (dorso)',
    licencia_frente:      'Licencia de conducción (frente)',
    licencia_dorso:       'Licencia de conducción (dorso)',
    certificado_bancario: 'Certificado bancario',
  },
  reserva: {
    documento_frente: 'Documento de identidad (frente)',
    documento_dorso:  'Documento de identidad (dorso)',
    licencia_frente:  'Licencia de conducción (frente)',
    licencia_dorso:   'Licencia de conducción (dorso)',
  },
  vehiculo: {
    tarjeta_frente: 'Tarjeta de propiedad (frente)',
    tarjeta_dorso:  'Tarjeta de propiedad (dorso)',
    soat:           'SOAT',
    tecno:          'Tecno-mecánica',
    poliza:         'Póliza',
    todo_riesgo:    'Seguro todo riesgo (documento antiguo)',
  },
};

export function esAmbitoDocumento(v: unknown): v is AmbitoDocumento {
  return typeof v === 'string' && (AMBITOS as readonly string[]).includes(v);
}

export function esClaveDocumento(ambito: AmbitoDocumento, clave: unknown): clave is string {
  return typeof clave === 'string'
    && Object.prototype.hasOwnProperty.call(CLAVES_DOCUMENTO[ambito], clave);
}

export function etiquetaDocumento(ambito: AmbitoDocumento, clave: string): string {
  return CLAVES_DOCUMENTO[ambito][clave] || 'Documento';
}

/**
 * Dirección por la que una pantalla pide un documento. Siempre del PROPIO sitio:
 * ninguna pantalla vuelve a recibir una dirección del CDN.
 *
 * `descargar` añade el parámetro que hace que la respuesta llegue con
 * `Content-Disposition: attachment` (antes esto lo hacía `urlDescarga()` metiéndole
 * `fl_attachment` a la URL pública de Cloudinary; ya no hay URL pública que tocar).
 */
export function rutaDocumento(
  ambito: AmbitoDocumento,
  id: number | string,
  clave: string,
  opts?: { descargar?: boolean },
): string {
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return '';
  if (!esClaveDocumento(ambito, clave)) return '';
  return `/api/documentos/${ambito}/${idNum}/${clave}${opts?.descargar ? '?descargar=1' : ''}`;
}

// ── Lo que el servidor le cuenta al navegador sobre un documento ────────────
//
// Ni una sola URL. Solo: existe, dónde pedirlo (la referencia) y si es un PDF —
// ese último dato lo necesita la pantalla para decidir entre pintar una miniatura
// o un enlace «Ver PDF», y antes lo deducía mirando la URL del CDN
// (`esPdfUrl`), que ya no va a tener.
export type DocumentoDisponible = {
  ambito: AmbitoDocumento;
  id: number;
  clave: string;
  etiqueta: string;
  pdf: boolean;
};

/** Mapa `clave -> documento` con SOLO los que están subidos. */
export type MapaDocumentos = Record<string, DocumentoDisponible>;

/**
 * Construye el mapa a partir de las URLs guardadas. Lo llama el SERVIDOR justo antes
 * de responder, y el resultado sustituye a las columnas `*_url` en el JSON: a partir
 * de ahí el navegador no tiene forma de conocer la dirección real del archivo.
 *
 * `urls` es `{ clave_de_referencia: url_guardada }`. Las claves desconocidas para el
 * ámbito se ignoran, y una URL vacía (o que no sea texto) significa «no subido» y no
 * entra en el mapa.
 */
export function mapaDocumentos(
  ambito: AmbitoDocumento,
  id: unknown,
  urls: Record<string, unknown>,
): MapaDocumentos {
  const idNum = Number(id);
  const out: MapaDocumentos = {};
  if (!Number.isInteger(idNum) || idNum <= 0) return out;
  for (const [clave, url] of Object.entries(urls)) {
    if (!esClaveDocumento(ambito, clave)) continue;
    if (typeof url !== 'string' || !url.trim()) continue;
    out[clave] = { ambito, id: idNum, clave, etiqueta: etiquetaDocumento(ambito, clave), pdf: esPdfUrl(url) };
  }
  return out;
}
