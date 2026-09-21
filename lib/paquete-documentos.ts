// ── Paquete descargable con los documentos de una persona (solo servidor) ───
//
// Arma un .zip con TODO lo que el sistema guarda de una persona:
//
//   · Propietario → su cédula (frente y dorso), su licencia si la tiene, su
//     CERTIFICADO BANCARIO, y por cada vehículo suyo la tarjeta de propiedad
//     (frente y dorso), el SOAT, la tecno-mecánica, la carátula de la póliza que
//     expide DrivePass (ver lib/poliza-vehiculo.ts) y la clave legada
//     `todo_riesgo` de los vehículos que todavía la conservan.
//   · Cliente → su cédula y su licencia del perfil, más los documentos que subió
//     en cada reserva (documento de identidad y licencia, frente y dorso).
//   · CONTRATOS DIGITALES, según el papel que la persona tenga en cada uno (fase 3
//     del módulo de contratos): al PROPIETARIO, su contrato de agencia comercial y
//     los otrosí que son sus órdenes de servicio; al CLIENTE, su contrato de
//     arrendamiento, sus otrosí, el pagaré con su carta de instrucciones y las actas
//     de entrega y devolución. Cada uno va como PDF generado en el momento desde el
//     texto congelado (lib/contrato-pdf.ts), y si se firmó en el mostrador va también
//     el ejemplar escaneado tal como se subió.
//
// No hace falta decidir de antemano "es propietario" o "es cliente": se arma con lo
// que la persona TENGA. Un propietario que además alquiló un carro alguna vez sale
// con sus dos mitades, sin que nadie tenga que acordarse de pedir las dos.
//
// ── Por qué en el servidor y no en el navegador ─────────────────────────────
// Bajar los archivos desde el navegador exigiría que las URLs de Cloudinary fueran
// públicas y legibles desde cualquier origen, justo lo contrario del endurecimiento
// que viene después. Acá el servidor es el único que toca esas direcciones, y lo
// hace por `descargarAcotado` (sin seguir redirecciones, con tope de tiempo y de
// bytes) después de validar cada una con `esUrlFotoSegura`. Al navegador solo le
// llega el zip ya armado.
//
// ── Un archivo caído no tumba el paquete ────────────────────────────────────
// Cada descarga va en su propio try. Lo que no se pudo traer se OMITE y queda
// anotado en el índice (`LEEME.txt`) con el motivo: un paquete con 10 de 11
// documentos y una línea que explica el que falta sirve; un 500 no sirve para nada.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type Database from 'better-sqlite3';
import { descargarAcotado } from './descarga-remota';
import { urlEntregaDocumento } from './storage';
import { esUrlFotoSegura } from './fotos-servicio';
import { crearZip, type EntradaZip } from './zip';
import { leerPoliza, CLAVE_POLIZA, POLIZA_LABEL } from './poliza-vehiculo';
import { leerContrato, leerFirmas, tituloDocumento } from './contratos-firma';
import { leerEscaneo, extensionEscaneo, escaneoEsImagen } from './contratos-papel';
import { contratoPDFBuffer } from './contrato-pdf';
import { TIPOS_DOCUMENTO, type TipoDocumento } from './contratos-datos';

// ── Topes ───────────────────────────────────────────────────────────────────
//
// El contenedor de Railway corre TODO el sitio: un propietario con 10 vehículos son
// ~45 archivos y, sin techo, una sola descarga puede dejar cientos de megas en
// memoria mientras se serializa el zip. Los topes son duros y se anuncian en el
// índice cuando se aplican.

/** Máximo de archivos que entran a un paquete. Los que sobren se listan como omitidos. */
export const MAX_ARCHIVOS = 60;
/** Tope de peso por archivo individual (el mismo que acepta /api/upload/documento). */
export const MAX_BYTES_ARCHIVO = 15 * 1024 * 1024;
/**
 * Tope del paquete completo. Al alcanzarlo se deja de agregar y se anota.
 *
 * Bajado de 80 a 40 MB (sep-2026): el zip se arma ENTERO en memoria y durante
 * `Buffer.concat` coexisten los buffers de las entradas y el buffer del resultado, o sea
 * ~2× este número por petición. Con el semáforo de abajo (2 a la vez) el peor caso del
 * contenedor —que sirve TODO el sitio— queda en ~160 MB en vez de en medio giga. 40 MB
 * cubre de sobra un propietario con 10 vehículos (45 documentos, casi todos fotos de 1-3 MB)
 * y lo que sobra se anota en el índice en vez de tumbar el proceso.
 */
export const MAX_BYTES_TOTAL = 40 * 1024 * 1024;
/**
 * Máximo de contratos que se generan en un paquete.
 *
 * Cada PDF se arma ENTERO en memoria (jsPDF) antes de entrar al zip, así que este
 * número, y no el de archivos, es el que acota el pico de la generación. Una persona
 * con muchas reservas tiene seis documentos por reserva; 20 cubre varias operaciones
 * completas y lo que sobre queda anotado en el índice, como cualquier otro excedente.
 */
export const MAX_CONTRATOS = 20;

/** Descargas simultáneas. Suficiente para que no tarde y poco para no saturar la salida. */
const LOTE = 4;
const TIMEOUT_DESCARGA_MS = 15_000;
/**
 * Presupuesto de tiempo de TODA la fase de descarga. `maxDuration = 60` es lo que promete la
 * ruta, pero en Railway nada corta la petición: sin esto, 60 documentos lentos son 15 lotes
 * × 15 s = 225 s reteniendo decenas de MB. Al agotarse, lo que falta se OMITE y queda anotado
 * en el índice — un paquete incompleto con su explicación sirve; un contenedor caído no.
 */
const PRESUPUESTO_MS = 40_000;

// ── Semáforo de paquetes concurrentes ───────────────────────────────────────
//
// Los topes por hora (20 para el equipo, 6 por persona) NO limitan la concurrencia: veinte
// pestañas pidiendo a la vez son veinte paquetes armándose en memoria al mismo tiempo, y en
// Railway eso no tumba el feature sino el sitio entero. Contador en memoria del proceso, igual
// que lib/limite-tasa.ts (una sola instancia; con varias, el límite se multiplica por instancia).
const MAX_PAQUETES_CONCURRENTES = 2;
let paquetesEnCurso = 0;

/** Pide turno para armar un paquete. `false` = ya hay demasiados en curso (responder 503). */
export function tomarTurnoPaquete(): boolean {
  if (paquetesEnCurso >= MAX_PAQUETES_CONCURRENTES) return false;
  paquetesEnCurso++;
  return true;
}

/** Devuelve el turno. SIEMPRE en un `finally`: si no, un error deja el cupo cerrado para siempre. */
export function liberarTurnoPaquete(): void {
  paquetesEnCurso = Math.max(0, paquetesEnCurso - 1);
}

/** Mensaje único del 503, para que las dos rutas digan lo mismo. */
export const ERROR_OCUPADO =
  'Hay otras descargas de paquetes en curso. Espera unos segundos y vuelve a intentarlo.';

// ── Tipos ───────────────────────────────────────────────────────────────────

export type PersonaPaquete = {
  id: number; nombre: string; correo: string; rol: string;
  /** 'activa' | 'inactiva' | 'archivada' (ver lib/db.ts). Lo mira la ruta del propio usuario. */
  estado_cuenta: string;
};

/** Un documento candidato a entrar al zip. `ruta` ya viene legible y sin extensión. */
export type DocumentoPaquete = {
  /** Ruta dentro del zip SIN extensión: 'Nestor-Cano/KZR957-Hyundai-Tucson/soat'. */
  ruta: string;
  /** Descripción en español para el índice. */
  etiqueta: string;
  url: string;
};

/**
 * Un contrato digital que le corresponde a esta persona. NO trae ni el texto ni el
 * PDF: el documento se genera al armar el paquete, no al listarlo (igual que los
 * documentos de URL, que aquí solo se enumeran y se bajan después).
 */
export type ContratoPaquete = {
  /** Ruta dentro del zip SIN extensión. */
  ruta: string;
  etiqueta: string;
  contratoId: number;
  /** El papel que tiene ESTA persona en ESTE documento. */
  papel: 'propietario' | 'cliente';
  /** ¿Se firmó en el mostrador? Entonces también va su escaneado. */
  tieneEscaneado: boolean;
};

export type ListaPaquete = {
  persona: PersonaPaquete;
  documentos: DocumentoPaquete[];
  /** Cuántos vehículos y reservas se recorrieron (para el índice y para la interfaz). */
  vehiculos: number;
  reservas: number;
  /** Documentos detectados que NO entraron por el tope de `MAX_ARCHIVOS`. */
  excedentes: DocumentoPaquete[];
  /** Contratos digitales de la persona, ya repartidos por su papel en cada uno. */
  contratos: ContratoPaquete[];
  /** Contratos detectados que NO entraron por el tope de `MAX_CONTRATOS`. */
  contratosExcedentes: ContratoPaquete[];
};

export type OmisionPaquete = { ruta: string; etiqueta: string; motivo: string };

export type ResultadoPaquete = {
  zip: Buffer;
  nombreArchivo: string;
  incluidos: number;
  omitidos: OmisionPaquete[];
  bytes: number;
};

// ── Nombres legibles ────────────────────────────────────────────────────────

/**
 * Convierte un texto a un segmento de ruta seguro y legible: sin tildes, sin
 * espacios, solo `[A-Za-z0-9-]`. No es solo cosmético — es lo que impide que el
 * nombre de un vehículo o de una persona meta barras, `..` o caracteres de control
 * dentro de la ruta del zip.
 */
export function segmentoLegible(texto: string, max = 48): string {
  const limpio = String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return limpio;
}

/** Igual que `segmentoLegible` pero nunca devuelve vacío. */
function segmentoOFallback(texto: string, fallback: string, max = 48): string {
  return segmentoLegible(texto, max) || fallback;
}

const EXTENSIONES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

const EXT_CONOCIDAS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif']);

/**
 * Extensión real del archivo. Manda lo que RESPONDIÓ el servidor (Content-Type);
 * si no dijo nada útil se cae a la extensión de la URL, y si tampoco, a `bin`.
 * Nunca se usa el nombre que venga del cliente.
 */
export function extensionDe(url: string, contentType: string): string {
  const porTipo = EXTENSIONES[(contentType || '').toLowerCase().trim()];
  if (porTipo) return porTipo;
  const sinQuery = url.split('?')[0].split('#')[0];
  const ext = (sinQuery.split('/').pop() || '').split('.').pop()?.toLowerCase() || '';
  if (EXT_CONOCIDAS.has(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  return 'bin';
}

/**
 * Nombre del .zip. Se sanea a `[A-Za-z0-9._-]` a propósito: este valor viaja en la
 * cabecera `Content-Disposition`, donde un `"`, un salto de línea o un retorno de
 * carro permitirían cerrar el valor e inyectar cabeceras (CRLF injection). Al dejar
 * solo ese alfabeto el problema no existe, y de paso no hace falta `filename*`.
 */
export function nombreArchivoZip(persona: PersonaPaquete, fechaISO: string): string {
  const quien = segmentoOFallback(persona.nombre, `usuario-${persona.id}`, 40);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaISO) ? fechaISO : 'sin-fecha';
  return `documentos-${quien}-${persona.id}-${fecha}.zip`;
}

// ── Lectura de la base ──────────────────────────────────────────────────────

type FilaUsuario = {
  id: number; nombre: string; correo: string; rol: string; estado_cuenta: string | null;
  cedula_url: string | null; cedula_url_dorso: string | null;
  licencia_url: string | null; licencia_url_dorso: string | null;
  certificado_bancario_url: string | null;
};

type FilaVehiculo = {
  id: number; marca: string; modelo: string; anio: number;
  placa: string | null; documentos: string | null;
};

type FilaReserva = {
  id: number; fecha_inicio: string; fecha_fin: string;
  marca: string; modelo: string;
  documento_id_url: string | null; documento_id_url_dorso: string | null;
  licencia_url: string | null; licencia_url_dorso: string | null;
  documento_es_pasaporte: number | null;
};

function agregar(destino: DocumentoPaquete[], carpeta: string, nombre: string, etiqueta: string, url: unknown) {
  if (typeof url !== 'string') return;
  const u = url.trim();
  if (!u) return;
  destino.push({ ruta: `${carpeta}/${nombre}`, etiqueta, url: u });
}

/**
 * Arma la lista de documentos de una persona leyendo la base. NO descarga nada:
 * separada a propósito de `construirPaquete` para poder responder "este paquete
 * trae 11 archivos" antes de bajar un solo byte (es lo que muestra el botón).
 *
 * Devuelve `null` si la persona no existe.
 */
export function listarDocumentosPersona(db: Database.Database, personaId: number): ListaPaquete | null {
  if (!Number.isInteger(personaId) || personaId <= 0) return null;

  const persona = db.prepare(`
    SELECT id, nombre, correo, rol, estado_cuenta,
           cedula_url, cedula_url_dorso, licencia_url, licencia_url_dorso, certificado_bancario_url
    FROM usuarios WHERE id = ?
  `).get(personaId) as FilaUsuario | undefined;
  if (!persona) return null;

  const raiz = segmentoOFallback(persona.nombre, `usuario-${persona.id}`, 40);
  const docs: DocumentoPaquete[] = [];

  // ── Documentos del perfil ──
  agregar(docs, raiz, 'cedula-frente', 'Documento de identidad (frente)', persona.cedula_url);
  agregar(docs, raiz, 'cedula-dorso', 'Documento de identidad (dorso)', persona.cedula_url_dorso);
  agregar(docs, raiz, 'licencia-frente', 'Licencia de conducción (frente)', persona.licencia_url);
  agregar(docs, raiz, 'licencia-dorso', 'Licencia de conducción (dorso)', persona.licencia_url_dorso);
  agregar(docs, raiz, 'certificado-bancario', 'Certificado bancario', persona.certificado_bancario_url);

  // ── Vehículos de los que es propietario ──
  // `archivado` no filtra: un carro archivado sigue teniendo documentos que el
  // equipo puede necesitar (una reclamación posterior, por ejemplo).
  const vehiculos = db.prepare(`
    SELECT id, marca, modelo, anio, placa, documentos
    FROM vehiculos WHERE propietario_id = ? ORDER BY id
  `).all(persona.id) as FilaVehiculo[];

  for (const v of vehiculos) {
    const placa = segmentoLegible(v.placa || '', 12);
    const carro = segmentoOFallback(`${v.marca} ${v.modelo}`, 'vehiculo', 40);
    // El `id` va SIEMPRE en el nombre de la carpeta, no solo cuando falta la placa: la placa
    // no es única en la base (ni el POST la valida), así que dos vehículos de la misma persona
    // con la misma placa —un carro archivado y su republicación, por ejemplo— producían dos
    // carpetas idénticas y `crearZip` lanzaba por nombres repetidos. Resultado: esa persona se
    // quedaba SIN paquete para siempre, también para el admin, y fallando al final, después de
    // haber descargado los 45 archivos.
    const carpeta = `${raiz}/${placa ? `${placa}-${carro}` : carro}-id${v.id}`;
    const rotulo = `${v.marca} ${v.modelo} ${v.anio}${v.placa ? ` (${v.placa})` : ''}`;

    let documentos: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(v.documentos || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) documentos = parsed as Record<string, unknown>;
    } catch { /* JSON corrupto: el vehículo entra sin documentos, no rompe el paquete */ }

    const urlDe = (clave: string, campo: 'url' | 'url_dorso'): unknown => {
      const entrada = documentos[clave];
      if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return undefined;
      return (entrada as Record<string, unknown>)[campo];
    };

    agregar(docs, carpeta, 'tarjeta-de-propiedad-frente', `Tarjeta de propiedad (frente) — ${rotulo}`, urlDe('tarjeta', 'url'));
    agregar(docs, carpeta, 'tarjeta-de-propiedad-dorso', `Tarjeta de propiedad (dorso) — ${rotulo}`, urlDe('tarjeta', 'url_dorso'));
    agregar(docs, carpeta, 'soat', `SOAT — ${rotulo}`, urlDe('soat', 'url'));
    agregar(docs, carpeta, 'tecnomecanica', `Tecno-mecánica — ${rotulo}`, urlDe('tecno', 'url'));

    // Carátula de la póliza que expide DrivePass (la carga el admin, ver
    // lib/poliza-vehiculo.ts). Se etiqueta con su vencimiento porque es el único
    // documento del vehículo que lo guarda.
    const poliza = leerPoliza(documentos);
    if (poliza) {
      agregar(docs, carpeta, CLAVE_POLIZA, `${POLIZA_LABEL}${poliza.vence ? ` (vence ${poliza.vence})` : ''} — ${rotulo}`, poliza.url);
    }

    // Clave LEGADA: hasta sep-2026 el propietario subía su propio todo riesgo. Ya no
    // se pide, pero los vehículos que la tienen la conservan y debe salir en el paquete.
    agregar(docs, carpeta, 'todo-riesgo-antiguo', `Seguro todo riesgo aportado por el propietario (documento antiguo) — ${rotulo}`, urlDe('todo_riesgo', 'url'));
  }

  // ── Reservas en las que fue el cliente ──
  const reservas = db.prepare(`
    SELECT r.id, r.fecha_inicio, r.fecha_fin,
           r.documento_id_url, r.documento_id_url_dorso, r.licencia_url, r.licencia_url_dorso,
           r.documento_es_pasaporte,
           v.marca, v.modelo
    FROM reservas r
    LEFT JOIN vehiculos v ON r.vehiculo_id = v.id
    WHERE r.usuario_id = ?
    ORDER BY r.id
  `).all(persona.id) as FilaReserva[];

  for (const r of reservas) {
    const inicio = String(r.fecha_inicio || '').slice(0, 10);
    const carpeta = `${raiz}/Reserva-${String(r.id).padStart(4, '0')}${inicio ? `-${segmentoLegible(inicio, 10)}` : ''}`;
    const rotulo = `reserva #${r.id}${r.marca ? ` · ${r.marca} ${r.modelo}` : ''}${inicio ? ` · desde ${inicio}` : ''}`;
    const esPasaporte = Number(r.documento_es_pasaporte) === 1;
    const nombreId = esPasaporte ? 'pasaporte' : 'documento-identidad';
    const etiquetaId = esPasaporte ? 'Pasaporte' : 'Documento de identidad';

    agregar(docs, carpeta, `${nombreId}-frente`, `${etiquetaId} (frente) — ${rotulo}`, r.documento_id_url);
    agregar(docs, carpeta, `${nombreId}-dorso`, `${etiquetaId} (dorso) — ${rotulo}`, r.documento_id_url_dorso);
    agregar(docs, carpeta, 'licencia-frente', `Licencia de conducción (frente) — ${rotulo}`, r.licencia_url);
    agregar(docs, carpeta, 'licencia-dorso', `Licencia de conducción (dorso) — ${rotulo}`, r.licencia_url_dorso);
  }

  // ── Duplicados ──
  // La misma URL puede aparecer dos veces (el cliente reutilizó en la reserva la foto
  // de cédula de su perfil). Se conserva la PRIMERA aparición, que por el orden de
  // arriba es siempre la más general (perfil antes que reserva).
  const vistas = new Set<string>();
  const unicos = docs.filter(d => (vistas.has(d.url) ? false : (vistas.add(d.url), true)));

  // ── Contratos digitales ──
  // Tienen su PROPIO tope (`MAX_CONTRATOS`) y no consumen el de los archivos de URL:
  // son de otra naturaleza (no se descargan de ningún lado, se generan) y lo que acota
  // su costo es la memoria de jsPDF, no las conexiones de salida.
  const contratos = listarContratosPersona(db, persona.id, raiz);

  return {
    persona: {
      id: persona.id, nombre: persona.nombre, correo: persona.correo, rol: persona.rol,
      estado_cuenta: persona.estado_cuenta || 'activa',
    },
    documentos: unicos.slice(0, MAX_ARCHIVOS),
    excedentes: unicos.slice(MAX_ARCHIVOS),
    vehiculos: vehiculos.length,
    reservas: reservas.length,
    contratos: contratos.slice(0, MAX_CONTRATOS),
    contratosExcedentes: contratos.slice(MAX_CONTRATOS),
  };
}

// ── Contratos digitales: qué le toca a cada quien ───────────────────────────
//
// El reparto lo confirmó el dueño y es por PAPEL, no por rol de la cuenta: quien es
// propietario del vehículo de la operación se lleva la mitad de la agencia comercial;
// quien fue el arrendatario, la del arrendamiento. Una persona que sea las dos cosas
// —alquiló un carro ajeno y además tiene el suyo publicado— recibe las DOS mitades,
// con el mismo criterio que ya usa el resto de este módulo: el paquete se arma con lo
// que la persona TENGA, sin que nadie tenga que acordarse de pedir las dos.
//
// El papel se decide contra `contratos.propietario_id` / `contratos.cliente_id`, que
// son las columnas CONGELADAS al emitir. Si el vehículo cambió de dueño después, el que
// firmó sigue recibiendo lo que firmó y el dueño nuevo no hereda un contrato ajeno.

/** Documentos que le corresponden al PROPIETARIO del vehículo (EL EMPRESARIO). */
const TIPOS_PROPIETARIO: readonly TipoDocumento[] = ['agencia', 'otrosi-agencia'];
/** Documentos que le corresponden al CLIENTE (EL ARRENDATARIO / EL OTORGANTE). */
const TIPOS_CLIENTE: readonly TipoDocumento[] = ['arrendamiento', 'otrosi-arrendamiento', 'pagare', 'acta-entrega'];

/** Nombre corto y legible de cada documento, para el archivo dentro del zip. */
const NOMBRE_ARCHIVO_CONTRATO: Record<TipoDocumento, string> = {
  'agencia': 'contrato-de-agencia-comercial',
  'otrosi-agencia': 'otrosi-orden-de-servicio',
  'arrendamiento': 'contrato-de-arrendamiento',
  'otrosi-arrendamiento': 'otrosi-del-arrendamiento',
  'acta-entrega': 'acta-de-entrega-y-devolucion',
  'pagare': 'pagare-y-carta-de-instrucciones',
};

type FilaContratoPaquete = {
  id: number; reserva_id: number; tipo: TipoDocumento; numero: string; version: number;
  estado: string; via_firma: string; firmado_en: string; propietario_id: number; cliente_id: number;
};

/**
 * Los contratos digitales de una persona, ya repartidos por su papel en cada uno.
 *
 * Los ANULADOS entran también: son parte de lo que esa persona firmó y el PDF los marca
 * como tales en grande (mismo criterio que las cuentas de cobro anuladas de
 * contabilidad, que tampoco se borran). Van al final del orden para que, si se llega al
 * tope, lo primero que se conserve sea lo vigente.
 */
export function listarContratosPersona(db: Database.Database, personaId: number, raiz: string): ContratoPaquete[] {
  const filas = db.prepare(`
    SELECT id, reserva_id, tipo, numero, version, estado, via_firma, firmado_en, propietario_id, cliente_id
    FROM contratos
    WHERE (propietario_id = ? AND tipo IN (${TIPOS_PROPIETARIO.map(() => '?').join(',')}))
       OR (cliente_id = ? AND tipo IN (${TIPOS_CLIENTE.map(() => '?').join(',')}))
    ORDER BY CASE estado WHEN 'anulado' THEN 1 ELSE 0 END, reserva_id, id
  `).all(personaId, ...TIPOS_PROPIETARIO, personaId, ...TIPOS_CLIENTE) as FilaContratoPaquete[];

  return filas.flatMap(f => {
    // Blindaje contra un `tipo` que no esté en el catálogo (una fila escrita a mano en
    // la base): sin esto, `NOMBRE_ARCHIVO_CONTRATO[tipo]` sería `undefined` y la ruta
    // del zip quedaría con un "undefined" dentro.
    if (!(TIPOS_DOCUMENTO as readonly string[]).includes(f.tipo)) return [];
    const esPropietario = Number(f.propietario_id) === personaId && TIPOS_PROPIETARIO.includes(f.tipo);
    const papel: 'propietario' | 'cliente' = esPropietario ? 'propietario' : 'cliente';
    const carpeta = `${raiz}/${papel === 'propietario' ? 'Contratos-como-propietario' : 'Contratos-como-cliente'}`;
    const reserva = `reserva-${String(f.reserva_id).padStart(4, '0')}`;
    const numero = segmentoLegible(f.numero || `id${f.id}`, 24) || `id${f.id}`;
    const anulado = f.estado === 'anulado';
    const estadoTexto = anulado
      ? 'ANULADO'
      : f.estado === 'firmado'
        ? (f.via_firma === 'papel' ? `firmado en papel el ${String(f.firmado_en || '').slice(0, 10)}` : `firmado el ${String(f.firmado_en || '').slice(0, 10)}`)
        : 'pendiente de firma';
    return [{
      ruta: `${carpeta}/${reserva}-${NOMBRE_ARCHIVO_CONTRATO[f.tipo]}-${numero}${anulado ? '-anulado' : ''}`,
      etiqueta: `${tituloDocumento(f.tipo)} ${f.numero}${f.version > 1 ? ` (versión ${f.version})` : ''}`
        + ` — reserva #${f.reserva_id} — ${estadoTexto}`,
      contratoId: f.id,
      papel,
      tieneEscaneado: f.via_firma === 'papel',
    }];
  });
}

// ── Descarga y armado ───────────────────────────────────────────────────────

/**
 * Trae un documento. Acepta las dos formas que hay en producción: una URL https del
 * CDN y una ruta legada `/uploads/...` que quedó en el disco (mismo criterio que
 * lib/acta-servicio-pdf.ts). Devuelve `null` con el motivo si no se pudo.
 *
 * ⚠️ `esUrlFotoSegura` se vuelve a evaluar acá aunque las URLs ya se validaran al
 * guardarse: este es el punto donde el servidor se conecta de verdad, y una fila
 * vieja o envenenada no puede convertirse en una petición contra la red interna
 * (SSRF). La descarga va por `descargarAcotado`, que no sigue redirecciones.
 */
/**
 * Traduce el error de `descargarAcotado` a un motivo CERRADO para el índice.
 *
 * Los mensajes de esa función incluyen la URL completa de Cloudinary ("No se pudo descargar
 * https://res.cloudinary.com/…: 404"), y el índice viaja DENTRO de un zip que el equipo —y el
 * propio propietario— reenvía por correo o WhatsApp. Es la misma fuga que ya se cerró para la
 * rama de disco (donde el mensaje traía la ruta absoluta del servidor): el texto técnico
 * completo queda en `console.error`, y al archivo solo llega el motivo.
 */
function motivoDescargaRemota(e: unknown, ruta: string): string {
  const detalle = e instanceof Error ? e.message : String(e);
  console.error(`[paquete-documentos] no se pudo bajar ${ruta}:`, detalle);
  const nombre = e instanceof Error ? e.name : '';
  if (nombre === 'TimeoutError' || nombre === 'AbortError') return 'el almacenamiento tardó demasiado en responder';
  if (/pesa demasiado/i.test(detalle)) return 'el archivo pesa más de lo permitido';
  if (/redirecci/i.test(detalle)) return 'el almacenamiento respondió algo que no se pudo aceptar';
  return 'no se pudo descargar el archivo del almacenamiento';
}

async function traerDocumento(url: string, ruta: string): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  if (!esUrlFotoSegura(url)) return { error: 'la dirección guardada no es válida o no es de nuestro almacenamiento' };
  try {
    if (url.startsWith('/')) {
      const rel = url.split('?')[0].replace(/^\/+/, '');
      const base = path.join(process.cwd(), 'public');
      const abs = path.join(base, rel);
      if (!abs.startsWith(base + path.sep)) return { error: 'la ruta del archivo no es válida' };
      // El error de `fs` se atrapa AQUÍ y se reescribe: su mensaje trae la ruta
      // absoluta del servidor ('/app/public/uploads/…'), y este texto termina escrito
      // dentro del LEEME.txt de un zip que se descarga el equipo — y también el propio
      // propietario. No hay ninguna razón para contarle a nadie cómo está organizado el
      // disco del servidor.
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(abs);
      } catch {
        return { error: 'el archivo antiguo ya no está disponible en el servidor' };
      }
      if (buffer.length > MAX_BYTES_ARCHIVO) return { error: 'el archivo pesa más de lo permitido' };
      return { buffer, contentType: '' };
    }
    let descargado;
    try {
      // `urlEntregaDocumento` firma la petición si el archivo ya no es de entrega
      // pública en el storage, y devuelve la dirección intacta si lo sigue siendo.
      // Sin esto, el .zip se quedaría vacío el día que los documentos pasen a privados.
      descargado = await descargarAcotado(urlEntregaDocumento(url), {
        timeoutMs: TIMEOUT_DESCARGA_MS,
        maxBytes: MAX_BYTES_ARCHIVO,
      });
    } catch (e) {
      return { error: motivoDescargaRemota(e, ruta) };
    }
    if (!descargado.buffer.length) return { error: 'el archivo llegó vacío' };
    return { buffer: descargado.buffer, contentType: descargado.contentType };
  } catch (e) {
    console.error(`[paquete-documentos] fallo inesperado bajando ${ruta}:`, e instanceof Error ? e.message : e);
    return { error: 'no se pudo obtener el archivo' };
  }
}

/**
 * Genera el PDF de UN contrato (y, si se firmó en el mostrador, su escaneado) para
 * meterlos al zip.
 *
 * Nunca lanza: un documento que no se pueda generar se devuelve como `{ error }` y el
 * paquete sigue, igual que un archivo caído. Un contrato roto no puede dejar a una
 * persona sin su carpeta entera.
 *
 * ⚠️ Memoria: `doc.output('arraybuffer')` ya devuelve una copia propia del documento y
 * `Buffer.from(ArrayBuffer)` NO copia otra vez (envuelve el mismo bloque). El escaneado
 * sí se copia al decodificar el base64, y por eso se lee SOLO cuando hace falta y se
 * deja salir de alcance en cuanto entra al zip.
 */
async function generarContratoParaPaquete(
  db: Database.Database, cont: ContratoPaquete,
): Promise<{ archivos: Array<{ ruta: string; etiqueta: string; datos: Buffer }> } | { error: string }> {
  try {
    const contrato = leerContrato(db, cont.contratoId);
    if (!contrato) return { error: 'el documento ya no está en el sistema' };

    // El escaneado solo se lee cuando se va a incrustar (es una imagen): si es un PDF
    // se adjunta aparte y no hace falta traerlo dos veces a memoria.
    const escaneoParaPdf = cont.tieneEscaneado && escaneoEsImagen(contrato.papel_mime)
      ? leerEscaneo(db, cont.contratoId)
      : null;

    const pdf = await contratoPDFBuffer(
      { contrato, firmas: leerFirmas(db, cont.contratoId), escaneo: escaneoParaPdf },
      { generadoPara: 'el paquete de documentos de la persona' },
    );
    const archivos: Array<{ ruta: string; etiqueta: string; datos: Buffer }> = [
      { ruta: `${cont.ruta}.pdf`, etiqueta: cont.etiqueta, datos: Buffer.from(pdf) },
    ];

    if (cont.tieneEscaneado) {
      const escaneo = escaneoParaPdf ?? leerEscaneo(db, cont.contratoId);
      if (escaneo) {
        archivos.push({
          ruta: `${cont.ruta}-firmado-a-mano.${extensionEscaneo(escaneo.mime)}`,
          etiqueta: `${cont.etiqueta} — ejemplar firmado a mano (escaneado)`,
          datos: Buffer.from(escaneo.contenido_base64, 'base64'),
        });
      }
    }
    return { archivos };
  } catch (e) {
    console.error(`[paquete-documentos] no se pudo generar el contrato ${cont.contratoId}:`, e instanceof Error ? e.message : e);
    return { error: 'no se pudo generar el PDF de este documento' };
  }
}

function lineasIndice(titulo: string, filas: string[]): string[] {
  if (filas.length === 0) return [];
  return ['', titulo, ...filas.map(f => `  ${f}`)];
}

/**
 * Baja todos los documentos de `lista` y devuelve el zip listo para servir.
 * Nunca lanza por un archivo caído: lo anota en `omitidos` y sigue. Solo puede
 * lanzar `crearZip` si el resultado se sale del formato (tamaños imposibles con
 * los topes de arriba).
 */
export async function construirPaquete(
  lista: ListaPaquete,
  contexto: { generadoPor: string; fechaHora: string; fechaISO: string; db: Database.Database },
): Promise<ResultadoPaquete> {
  const entradas: EntradaZip[] = [];
  const omitidos: OmisionPaquete[] = [];
  const incluidos: { ruta: string; etiqueta: string; bytes: number }[] = [];
  const nombresUsados = new Set<string>();
  let bytesTotal = 0;
  let cortadoPorPeso = false;
  let cortadoPorTiempo = false;
  const limite = Date.now() + PRESUPUESTO_MS;

  // Lotes: el contenedor sirve el sitio entero, así que no se abren 45 conexiones
  // de salida a la vez. Dentro del lote las descargas sí van en paralelo.
  for (let i = 0; i < lista.documentos.length; i += LOTE) {
    const lote = lista.documentos.slice(i, i + LOTE);

    // Presupuesto de tiempo: se comprueba ANTES de abrir el lote (no se corta uno a medias).
    // Lo que queda se anota como omitido, igual que un archivo caído.
    if (Date.now() > limite) {
      cortadoPorTiempo = true;
      for (const doc of lista.documentos.slice(i)) {
        omitidos.push({ ruta: doc.ruta, etiqueta: doc.etiqueta, motivo: 'no dio tiempo de descargarlo, vuelve a pedir el paquete' });
      }
      break;
    }

    const resultados = await Promise.all(lote.map(async doc => ({ doc, res: await traerDocumento(doc.url, doc.ruta) })));

    for (const { doc, res } of resultados) {
      if ('error' in res) {
        omitidos.push({ ruta: doc.ruta, etiqueta: doc.etiqueta, motivo: res.error });
        continue;
      }
      if (bytesTotal + res.buffer.length > MAX_BYTES_TOTAL) {
        cortadoPorPeso = true;
        omitidos.push({ ruta: doc.ruta, etiqueta: doc.etiqueta, motivo: 'el paquete ya llegó a su tamaño máximo' });
        continue;
      }
      // Nombre único: `crearZip` LANZA ante dos entradas con el mismo nombre, y un paquete
      // entero perdido al final (después de bajar los 45 archivos) por una colisión de nombres
      // no es aceptable. La colisión de raíz —dos vehículos con la misma placa— ya se resolvió
      // metiendo el id del vehículo en la carpeta; esto es la red de seguridad.
      const base = `${doc.ruta}.${extensionDe(doc.url, res.contentType)}`;
      let nombre = base;
      for (let n = 2; nombresUsados.has(nombre); n++) nombre = base.replace(/(\.[^.]+)$/, `-${n}$1`);
      nombresUsados.add(nombre);
      entradas.push({ nombre, datos: res.buffer });
      incluidos.push({ ruta: nombre, etiqueta: doc.etiqueta, bytes: res.buffer.length });
      bytesTotal += res.buffer.length;
    }
  }

  for (const doc of lista.excedentes) {
    omitidos.push({ ruta: doc.ruta, etiqueta: doc.etiqueta, motivo: `el paquete admite como máximo ${MAX_ARCHIVOS} archivos` });
  }

  // ── Contratos digitales ──
  //
  // Van DESPUÉS de las descargas y de uno en uno a propósito: cada PDF se arma entero en
  // memoria (jsPDF) y generar cuatro en paralelo multiplicaría el pico por cuatro en el
  // único contenedor que sirve el sitio. Comparten el presupuesto de tiempo y el tope de
  // peso con el resto del paquete, y un documento que falle se anota y no tumba nada,
  // igual que un archivo caído.
  let contratosIncluidos = 0;
  for (const cont of lista.contratos) {
    if (Date.now() > limite) {
      cortadoPorTiempo = true;
      omitidos.push({ ruta: cont.ruta, etiqueta: cont.etiqueta, motivo: 'no dio tiempo de generarlo, vuelve a pedir el paquete' });
      continue;
    }
    if (bytesTotal >= MAX_BYTES_TOTAL) {
      cortadoPorPeso = true;
      omitidos.push({ ruta: cont.ruta, etiqueta: cont.etiqueta, motivo: 'el paquete ya llegó a su tamaño máximo' });
      continue;
    }

    const generado = await generarContratoParaPaquete(contexto.db, cont);
    if ('error' in generado) {
      omitidos.push({ ruta: cont.ruta, etiqueta: cont.etiqueta, motivo: generado.error });
      continue;
    }
    for (const archivo of generado.archivos) {
      if (bytesTotal + archivo.datos.length > MAX_BYTES_TOTAL) {
        cortadoPorPeso = true;
        omitidos.push({ ruta: archivo.ruta, etiqueta: archivo.etiqueta, motivo: 'el paquete ya llegó a su tamaño máximo' });
        continue;
      }
      let nombre = archivo.ruta;
      for (let n = 2; nombresUsados.has(nombre); n++) nombre = archivo.ruta.replace(/(\.[^.]+)$/, `-${n}$1`);
      nombresUsados.add(nombre);
      entradas.push({ nombre, datos: archivo.datos });
      incluidos.push({ ruta: nombre, etiqueta: archivo.etiqueta, bytes: archivo.datos.length });
      bytesTotal += archivo.datos.length;
    }
    contratosIncluidos++;
  }

  for (const cont of lista.contratosExcedentes) {
    omitidos.push({ ruta: cont.ruta, etiqueta: cont.etiqueta, motivo: `el paquete admite como máximo ${MAX_CONTRATOS} contratos` });
  }

  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const texto = [
    'PAQUETE DE DOCUMENTOS — DrivePass',
    '='.repeat(60),
    '',
    `Persona:   ${lista.persona.nombre} (${lista.persona.rol})`,
    `Correo:    ${lista.persona.correo}`,
    `Id:        ${lista.persona.id}`,
    `Generado:  ${contexto.fechaHora} (hora de Colombia)`,
    `Lo generó: ${contexto.generadoPor}`,
    '',
    `Vehículos a su nombre: ${lista.vehiculos}`,
    `Reservas como cliente: ${lista.reservas}`,
    `Contratos incluidos:   ${contratosIncluidos} de ${lista.contratos.length + lista.contratosExcedentes.length}`,
    `Archivos incluidos:    ${incluidos.length}`,
    `Archivos omitidos:     ${omitidos.length}`,
    `Peso total:            ${kb(bytesTotal)}`,
    ...lineasIndice(`CONTENIDO (${incluidos.length})`, incluidos.map(d => `${d.ruta} — ${d.etiqueta} [${kb(d.bytes)}]`)),
    ...lineasIndice(
      `NO SE PUDIERON INCLUIR (${omitidos.length})`,
      omitidos.map(d => `${d.ruta} — ${d.etiqueta}: ${d.motivo}`),
    ),
    ...(cortadoPorPeso ? ['', `Aviso: se alcanzó el tope de ${Math.round(MAX_BYTES_TOTAL / 1024 / 1024)} MB por paquete.`] : []),
    ...(cortadoPorTiempo ? ['', 'Aviso: se alcanzó el tiempo máximo de preparación. Vuelve a pedir el paquete para traer lo que falta.'] : []),
    '',
    '-'.repeat(60),
    'Este archivo contiene DATOS PERSONALES (documentos de identidad, licencias,',
    'certificados bancarios y documentos de vehículos). Trátalo como confidencial:',
    'no lo reenvíes ni lo guardes fuera de los medios autorizados por la empresa.',
    'Cada descarga queda registrada en la Bitácora con el nombre de quien la hizo.',
    '',
    'Nota: la carátula de la póliza del vehículo la expide y la carga DrivePass',
    '(no el propietario); aparece por vehículo cuando ya se cargó en el sistema.',
    '',
    'Contratos: cada PDF se genera desde el texto que quedó congelado al firmarlo, con',
    'las firmas en su sitio y una constancia de verificación al final. Los documentos',
    'anulados se incluyen marcados como tales: no están vigentes, se conservan como',
    'constancia de lo que decían. Los que se firmaron en el mostrador traen además el',
    'ejemplar escaneado tal como se subió.',
    '',
  ].join('\n');

  entradas.unshift({ nombre: 'LEEME.txt', datos: Buffer.from(texto, 'utf8') });

  const zip = crearZip(entradas);
  return {
    zip,
    nombreArchivo: nombreArchivoZip(lista.persona, contexto.fechaISO),
    incluidos: incluidos.length,
    omitidos,
    bytes: zip.length,
  };
}

/**
 * Cuerpo de la respuesta HTTP a partir del zip, SIN COPIAR los bytes.
 *
 * `new Uint8Array(buffer)` copia: con un paquete de 40 MB son 40 MB extra que conviven con el
 * original mientras se construye la respuesta (y eso se suma a los buffers que ya gastó
 * `Buffer.concat` al armarlo). Esto devuelve una VISTA sobre la misma memoria. Es un
 * `Uint8Array` y no el `Buffer` directamente solo porque el tipo `BodyInit` de TypeScript no
 * acepta `Buffer` (en tiempo de ejecución son la misma cosa).
 */
export function cuerpoZip(zip: Buffer): Uint8Array<ArrayBuffer> {
  // El `as ArrayBuffer` es solo de tipos: `Buffer.buffer` se declara `ArrayBufferLike` (podría
  // ser un SharedArrayBuffer, que `BodyInit` no acepta) pero el de un Buffer de Node nunca lo es.
  return new Uint8Array(zip.buffer as ArrayBuffer, zip.byteOffset, zip.byteLength);
}

/** Fecha y hora legibles en Colombia, para el encabezado del índice. */
export function fechaHoraColombia(d = new Date()): { fechaISO: string; fechaHora: string } {
  const fechaISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
  const hora = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return { fechaISO, fechaHora: `${fechaISO} ${hora}` };
}
