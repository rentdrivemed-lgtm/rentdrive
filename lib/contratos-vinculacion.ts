// ── Contratos de vinculación: emisión, estado y consulta ────────────────────
//
// Los dos documentos que se firman AL CREAR LA CUENTA (uno para el cliente, otro
// para el propietario). Comparten tabla y motor de firmas con los seis contratos de
// operación —bloques, sellos HMAC, anulación con reemisión, vía papel— pero tienen
// su propio texto y su propio conjunto de datos, porque se suscriben antes de que
// exista ninguna reserva ni ningún vehículo.
//
// Cómo se guardan las partes (ver lib/db.ts → migrarContratosVinculacion):
//   · vinculacion-cliente      → cliente_id = titular · propietario_id = NULL
//   · vinculacion-propietario  → propietario_id = titular · cliente_id = NULL
// `reserva_id` y `vehiculo_id` van en NULL, que es lo que distingue un documento de
// vinculación de uno de operación en cualquier consulta.
//
// ⚠️ Server-only (lee y escribe la BD): no importar desde un componente 'use client'.
// Para los tipos y el texto, importar de ./contratos-vinculacion-texto, que es puro.

import type Database from 'better-sqlite3';
import { AGENTE, CIUDAD_CONTRATO, esPendiente, type CampoFaltante } from './contratos-datos';
import { personaDeUsuario } from './contratos';
import { registrarAuditoriaEstricta } from './permisos';
import { notificarUsuarios } from './panel';
import { sellarBloquesDelAgente } from './contratos-sello-agente';
import {
  PREFIJO_REGISTRO, TIPO_REGISTRO, TITULO_REGISTRO, REGISTRO_REVISADO_POR_ABOGADO,
  generarTextoRegistro, type ConsentimientosRegistro, type DatosRegistro, type TipoRegistro,
} from './contratos-registro-texto';

type DB = Database.Database;

/**
 * Qué documento le toca a cada rol de cuenta.
 *
 * Desde sep-2026 es UNO SOLO y el mismo para clientes y propietarios: la autorización
 * de tratamiento de datos. Los dos contratos marco que había antes se solapaban con el
 * de agencia comercial y el de arrendamiento, que el abogado sí redactó y que se
 * suscriben en la primera operación. Ver lib/contratos-registro-texto.ts.
 *
 * Un admin no firma ninguno: no es titular de datos tratados como cliente.
 */
export function vinculacionQueLeToca(rol: string): TipoRegistro | null {
  const r = (rol || '').trim();
  return (r === 'usuario' || r === 'propietario') ? TIPO_REGISTRO : null;
}

/**
 * En qué columna de `contratos` va el titular.
 *
 * Antes lo decidía el TIPO de documento (había uno por rol); ahora que el documento es
 * único lo decide el ROL DE LA CUENTA. Se conserva la separación cliente_id /
 * propietario_id para no tocar el esquema ni las consultas que ya la usan.
 */
export function rolTitularDeCuenta(rol: string): 'cliente' | 'propietario' {
  return (rol || '').trim() === 'propietario' ? 'propietario' : 'cliente';
}

/** La calidad en que firma, que es la casilla «Arrendatario / Propietario» del texto. */
function calidadDe(rol: string): 'Arrendatario' | 'Propietario' {
  return rolTitularDeCuenta(rol) === 'propietario' ? 'Propietario' : 'Arrendatario';
}

// ── Bloques de firma ────────────────────────────────────────────────────────
//
// Dos por documento y en este orden a propósito: primero el titular, después EL
// AGENTE. Al revés, el documento quedaría suscrito por la empresa antes de que la
// persona lo lea, y el estado 'firmado' del contrato se alcanzaría con la firma de
// la propia empresa.
export type DefBloqueVinculacion = {
  clave: string; etiqueta: string; rol: 'cliente' | 'propietario' | 'agente'; orden: number;
};

export function bloquesDelRegistro(rolCuenta: string): DefBloqueVinculacion[] {
  const esPropietario = rolTitularDeCuenta(rolCuenta) === 'propietario';
  return [
    {
      clave: esPropietario ? 'propietario' : 'usuario',
      etiqueta: 'EL TITULAR DE LOS DATOS',
      rol: esPropietario ? 'propietario' : 'cliente',
      orden: 1,
    },
    { clave: 'agente', etiqueta: 'EL RESPONSABLE', rol: 'agente', orden: 2 },
  ];
}

// ── Datos ───────────────────────────────────────────────────────────────────

export function armarDatosVinculacion(db: DB, usuarioId: number, rolCuenta: string): DatosRegistro | null {
  const titular = personaDeUsuario(db, usuarioId);
  if (!titular) return null;
  return {
    fecha: new Date().toISOString(),
    ciudad: CIUDAD_CONTRATO,
    titular,
    agente: AGENTE,
    calidad: calidadDe(rolCuenta),
    origen: { usuarioId: Number(usuarioId) },
  };
}

/**
 * Campos en blanco del titular. Todos son SUBSANABLES —la persona puede completar su
 * perfil— así que TODOS bloquean la firma: un contrato de vinculación que identifica
 * a su titular con «PENDIENTE» no identifica a nadie.
 *
 * Es la diferencia con los contratos de operación, donde hay faltantes estructurales
 * que solo se advierten (ver faltantesDe en lib/contratos-datos.ts).
 */
export function faltantesVinculacion(d: DatosRegistro): CampoFaltante[] {
  // Mismo tipo que los faltantes de los contratos de operación (`CampoFaltante`), para
  // que la pantalla de firma pueda pintarlos con el componente que ya existe. Van todos
  // con `enBD: true` porque todos bloquean, y con `documentos: []` porque ese campo
  // enumera los SEIS documentos de operación, a los que estos no pertenecen.
  const CAMPOS: { ruta: string; etiqueta: string; fuente: string; valor: string }[] = [
    { ruta: 'titular.nombre', etiqueta: 'Nombre completo', fuente: 'usuarios.nombre', valor: d.titular.nombre },
    { ruta: 'titular.documento', etiqueta: 'Número de documento', fuente: 'usuarios.documento_identidad', valor: d.titular.documento },
    { ruta: 'titular.ciudad', etiqueta: 'Ciudad de residencia', fuente: 'usuarios.ciudad', valor: d.titular.ciudad },
    { ruta: 'titular.direccion', etiqueta: 'Dirección', fuente: 'usuarios.direccion', valor: d.titular.direccion },
    { ruta: 'titular.correo', etiqueta: 'Correo electrónico', fuente: 'usuarios.correo', valor: d.titular.correo },
  ];
  return CAMPOS
    .filter(c => esPendiente(c.valor))
    .map(c => ({ ruta: c.ruta, etiqueta: c.etiqueta, fuente: c.fuente, enBD: true, documentos: [], valor: c.valor }));
}

// ── Emisión ─────────────────────────────────────────────────────────────────

export type ActorVinculacion = { id: number | null; nombre: string; correo?: string; nivel?: string };

export type EmisionOk = { ok: true; contratoId: number; numero: string; yaExistia: boolean };
export type EmisionError = { ok: false; status: number; error: string };

function err(status: number, error: string): EmisionError {
  return { ok: false, status, error };
}

/**
 * Puerta de seguridad del borrador. Mientras el texto no lo haya revisado el abogado
 * NO se emite en producción: se prefiere no tener contrato a tener firmado un texto
 * que nadie validó. En desarrollo sí se emite, para poder probar el flujo completo.
 */
export function puedeEmitirVinculacion(): { ok: true } | EmisionError {
  if (!REGISTRO_REVISADO_POR_ABOGADO && process.env.NODE_ENV === 'production') {
    return err(503, 'El contrato de vinculación todavía está pendiente de revisión legal y no se puede emitir.');
  }
  return { ok: true };
}

/** El documento de vinculación VIGENTE (no anulado) de una cuenta, si lo hay. */
export function vinculacionVigente(db: DB, usuarioId: number, rolCuenta: string): {
  id: number; numero: string; estado: string; version: number;
} | null {
  const columna = rolTitularDeCuenta(rolCuenta) === 'cliente' ? 'cliente_id' : 'propietario_id';
  return (db.prepare(`
    SELECT id, numero, estado, version FROM contratos
    WHERE reserva_id IS NULL AND tipo = ? AND ${columna} = ? AND estado <> 'anulado'
    ORDER BY version DESC LIMIT 1
  `).get(TIPO_REGISTRO, Number(usuarioId)) as { id: number; numero: string; estado: string; version: number } | undefined) ?? null;
}

/**
 * Emite el contrato de vinculación de una cuenta. IDEMPOTENTE: si ya hay uno vigente
 * lo devuelve con `yaExistia: true` en vez de emitir otro —el registro puede
 * reintentarse, y el admin puede pulsar "habilitar" dos veces—. El índice único
 * parcial de la tabla es la última línea de defensa.
 */
export function generarContratoVinculacion(
  db: DB, usuarioId: number, rolCuenta: string, actor: ActorVinculacion,
  consentimientos: ConsentimientosRegistro,
): EmisionOk | EmisionError {
  const puerta = puedeEmitirVinculacion();
  if (!puerta.ok) return puerta;

  const cuenta = db.prepare('SELECT id, rol, estado_cuenta FROM usuarios WHERE id = ?')
    .get(Number(usuarioId)) as { id: number; rol: string; estado_cuenta: string } | undefined;
  if (!cuenta) return err(404, 'La cuenta no existe.');
  if (cuenta.estado_cuenta === 'archivada') return err(409, 'La cuenta está archivada.');
  if (!vinculacionQueLeToca(cuenta.rol)) {
    return err(409, `A una cuenta de rol «${cuenta.rol}» no le corresponde este documento.`);
  }

  // El consentimiento general y el reforzado de la cláusula CUARTA son condición para
  // tener cuenta (decisión del dueño, sep-2026). Se comprueba también acá y no solo en
  // el registro: esta función la llaman además el panel y la reemisión.
  //
  // ⚖️ REVISAR: el texto del abogado declara en su cláusula TERCERA que «ninguna
  // actividad se condiciona a la entrega de datos sensibles» y en la CUARTA informa de
  // que es facultativo. Exigirlos contradice esas dos cláusulas. Pendiente de que el
  // abogado las reformule para decir que sin esa autorización no se puede verificar la
  // identidad y por tanto no se puede prestar el servicio.
  if (!consentimientos.general) return err(400, 'Falta la autorización de tratamiento de datos.');
  if (!consentimientos.datosSensibles) {
    return err(400, 'Falta la autorización para tratar las imágenes de tus documentos de identidad.');
  }

  // El rol de la CUENTA manda, no el que traiga quien llama: es lo que decide en qué
  // columna queda el titular y en qué calidad firma.
  const rolCuentaReal = cuenta.rol;
  const esPropietario = rolTitularDeCuenta(rolCuentaReal) === 'propietario';
  const columna = esPropietario ? 'propietario_id' : 'cliente_id';

  const vigente = vinculacionVigente(db, usuarioId, rolCuentaReal);
  if (vigente) return { ok: true, contratoId: vigente.id, numero: vigente.numero, yaExistia: true };

  const datos = armarDatosVinculacion(db, usuarioId, rolCuentaReal);
  if (!datos) return err(404, 'La cuenta no existe.');
  // Los consentimientos van DENTRO del texto: el sello HMAC se calcula sobre él, así
  // que una vez firmado no se puede cambiar después lo que la persona autorizó.
  const texto = generarTextoRegistro(datos, consentimientos);
  const faltantes = faltantesVinculacion(datos);

  const previa = db.prepare(
    `SELECT MAX(version) AS v FROM contratos WHERE reserva_id IS NULL AND tipo = ? AND ${columna} = ?`
  ).get(TIPO_REGISTRO, Number(usuarioId)) as { v: number | null };
  const version = (Number(previa?.v) || 0) + 1;

  try {
    const crear = db.transaction(() => {
      const res = db.prepare(`
        INSERT INTO contratos (
          reserva_id, vehiculo_id, propietario_id, cliente_id, tipo, numero, version, estado,
          texto, datos_json, faltantes_json, generado_por, generado_por_nombre
        ) VALUES (NULL, NULL, ?, ?, ?, '', ?, 'pendiente', ?, ?, ?, ?, ?)
      `).run(
        esPropietario ? Number(usuarioId) : null,
        esPropietario ? null : Number(usuarioId),
        TIPO_REGISTRO, version, texto,
        // Los consentimientos se guardan también en el snapshot, aparte del texto:
        // el texto es la prueba, esto es lo consultable (p. ej. a quién se le puede
        // escribir con comunicaciones comerciales) sin tener que leer el documento.
        JSON.stringify({ ...datos, consentimientos }),
        JSON.stringify(faltantes),
        actor.id, actor.nombre || '',
      );
      const id = Number(res.lastInsertRowid);

      // Igual que en los contratos de operación: toda la familia comparte el número
      // base y la reemisión añade el sufijo de versión (ADP-000012-R2).
      const raiz = db.prepare(
        `SELECT id FROM contratos WHERE reserva_id IS NULL AND tipo = ? AND ${columna} = ? ORDER BY version ASC LIMIT 1`
      ).get(TIPO_REGISTRO, Number(usuarioId)) as { id: number } | undefined;
      const base = `${PREFIJO_REGISTRO}-${String(Number(raiz?.id) || id).padStart(6, '0')}`;
      const numero = version > 1 ? `${base}-R${version}` : base;
      db.prepare('UPDATE contratos SET numero = ? WHERE id = ?').run(numero, id);

      const insFirma = db.prepare(`
        INSERT INTO contrato_firmas (
          contrato_id, bloque, etiqueta, rol, momento, orden,
          usuario_esperado_id, nombre_esperado, documento_esperado
        ) VALUES (?, ?, ?, ?, 'suscripcion', ?, ?, ?, ?)
      `);
      for (const b of bloquesDelRegistro(rolCuentaReal)) {
        // EL RESPONSABLE no tiene cuenta esperada: lo suscribe el sello institucional
        // de la sociedad (lib/contratos-sello-agente.ts).
        const esAgente = b.rol === 'agente';
        insFirma.run(
          id, b.clave, b.etiqueta, b.rol, b.orden,
          esAgente ? null : Number(usuarioId),
          esAgente ? datos.agente.representante : datos.titular.nombre,
          esAgente ? datos.agente.representanteCedula : datos.titular.documento,
        );
      }

      // Bitácora estricta, mismo criterio que la emisión de los contratos de
      // operación: si el rastro no se puede escribir, la emisión se revierte.
      registrarAuditoriaEstricta(
        db,
        { id: actor.id, nombre: actor.nombre, correo: actor.correo, nivel: actor.nivel },
        {
          area: 'contratos', accion: 'emitir_vinculacion', entidad: 'contrato', entidad_id: id,
          detalle: `Emitió ${TITULO_REGISTRO} ${numero} de la cuenta #${usuarioId}`
            + ` · datos sensibles: sí · comerciales: ${consentimientos.comunicacionesComerciales ? 'sí' : 'no'}`
            + (faltantes.length ? ` · ${faltantes.length} dato(s) del perfil en blanco` : ''),
        },
      );
      return { id, numero };
    })();
    return { ok: true, contratoId: crear.id, numero: crear.numero, yaExistia: false };
  } catch (e) {
    // Carrera entre dos emisiones simultáneas: el índice único parcial la corta y acá
    // se devuelve el que ganó.
    const ya = vinculacionVigente(db, usuarioId, cuenta.rol);
    if (ya) return { ok: true, contratoId: ya.id, numero: ya.numero, yaExistia: true };
    return err(500, e instanceof Error ? e.message : 'No se pudo emitir la autorización de datos.');
  }
}

/**
 * Emite el contrato de vinculación y deja la notificación en la campana del titular.
 *
 * Es lo que se llama al terminar el registro y lo que llama el botón «habilitar» del
 * panel. NUNCA lanza: si la emisión falla, el registro de la cuenta no se revierte —
 * quedarse sin cuenta por no poder emitir un contrato sería peor que emitirlo después,
 * y el panel puede reintentarlo. Devuelve el resultado para quien quiera reportarlo.
 */
export function emitirYNotificarVinculacion(
  db: DB, usuarioId: number, rol: string, actor: ActorVinculacion,
  consentimientos: ConsentimientosRegistro,
): EmisionOk | EmisionError | null {
  if (!vinculacionQueLeToca(rol)) return null;  // a un admin no le toca ninguno
  try {
    const r = generarContratoVinculacion(db, usuarioId, rol, actor, consentimientos);
    if (!r.ok || r.yaExistia) return r;         // no se re-notifica lo ya notificado

    // La sociedad suscribe su bloque en el acto. Antes quedaba esperando a que un
    // administrador firmara documento por documento, y el orden de los bloques hacía
    // que el titular viera «pendiente de LA PLATAFORMA» en su propio contrato.
    //
    // No se revierte la emisión si el sello falla: el contrato existe, el titular ya
    // puede firmarlo, y el bloque de la sociedad se puede sellar después desde el
    // panel. Quedarse sin contrato por no poder sellar sería peor.
    const sello = sellarBloquesDelAgente(db, r.contratoId, {
      momento: 'suscripcion',
      motivo: `emisión automática al registrarse la cuenta #${usuarioId}`,
    });
    if (!sello.ok) {
      console.error('[vinculacion] Emitido sin sello de la sociedad:', r.numero, sello.error);
    }
    // Notificación por PERSONA (tabla `notificaciones`), no por el chat compartido
    // entre propietario y cliente: un aviso de firma pendiente es asunto de su
    // destinatario y nadie más tiene por qué leerlo.
    notificarUsuarios(db, [Number(usuarioId)], {
      tipo: 'contrato_vinculacion',
      titulo: 'Tienes un documento pendiente de firma',
      mensaje: `Para poder ${rolTitularDeCuenta(rol) === 'propietario' ? 'publicar tu vehículo' : 'reservar un vehículo'} `
        + `necesitas firmar tu ${TITULO_REGISTRO.toLowerCase()} (${r.numero}). `
        + 'Puedes firmarla desde tu perfil, en cualquier momento.',
      referencia_id: r.contratoId,
      referencia_tipo: 'contrato',
    });
    return r;
  } catch (e) {
    console.error('[vinculacion] No se pudo emitir/notificar:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * ¿Hay que pedirle a esta cuenta que autorice, porque todavía no tiene documento?
 *
 * SUSTITUYE a la emisión automática que había antes. Ya no se puede emitir sola: el
 * documento recoge consentimientos —el general y el reforzado de la cláusula CUARTA—
 * y un consentimiento no se puede fabricar en nombre de nadie. Las cuentas anteriores
 * a esta función tienen que pasar por la pantalla de autorización y marcarlos ellas.
 *
 * Solo dice si hay que pedirlo; no emite nada.
 */
export function faltaAutorizacionDeDatos(db: DB, usuarioId: number, rol: string): boolean {
  if (!vinculacionQueLeToca(rol)) return false;
  if (!puedeEmitirVinculacion().ok) return false;    // texto pendiente de revisión legal
  return vinculacionVigente(db, usuarioId, rol) === null;
}

// ── Estado de una cuenta ────────────────────────────────────────────────────

export type EstadoVinculacion = {
  /** `null` cuando al rol no le toca ninguno (admin). */
  tipo: TipoRegistro | null;
  titulo: string;
  /** El documento vigente, si ya se emitió. */
  contratoId: number | null;
  numero: string;
  /** ¿Ya puso su trazo el titular? Es lo que decide si se bloquea o no. */
  firmadoPorTitular: boolean;
  /** ¿Está completo (titular + agente)? */
  completo: boolean;
  /** Datos del perfil que faltan y que impiden firmar. */
  faltantes: CampoFaltante[];
  /**
   * ¿Queda algo por hacer? Cubre los DOS casos: que no se haya emitido todavía
   * (hay que autorizar) y que esté emitido sin firmar (hay que firmar).
   */
  pendiente: boolean;
};

/**
 * Estado del contrato de vinculación de una cuenta. Es la función que consultan el
 * aviso del dashboard, la notificación y las puertas de "no puede reservar / no puede
 * publicar".
 *
 * Mira la firma DEL TITULAR y no el estado del contrato a propósito: al titular no se
 * le puede bloquear la operación porque falte la firma de la propia empresa.
 */
export function estadoVinculacion(db: DB, usuarioId: number, rol: string): EstadoVinculacion {
  const tipo = vinculacionQueLeToca(rol);
  if (!tipo) {
    return {
      tipo: null, titulo: '', contratoId: null, numero: '',
      firmadoPorTitular: true, completo: true, faltantes: [], pendiente: false,
    };
  }
  const vigente = vinculacionVigente(db, usuarioId, rol);
  const datos = armarDatosVinculacion(db, usuarioId, rol);
  const faltantes = datos ? faltantesVinculacion(datos) : [];

  if (!vigente) {
    return {
      tipo, titulo: TITULO_REGISTRO, contratoId: null, numero: '',
      firmadoPorTitular: false, completo: false, faltantes,
      // Sin emitir: pendiente solo si de verdad se puede emitir hoy. Con el texto en
      // revisión legal no hay nada que pedirle a nadie.
      pendiente: puedeEmitirVinculacion().ok,
    };
  }

  const bloqueTitular = rolTitularDeCuenta(rol);
  const fila = db.prepare(
    "SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND rol = ? AND firmada_en <> ''"
  ).get(vigente.id, bloqueTitular) as { n: number };
  const pendientes = db.prepare(
    "SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND firmada_en = ''"
  ).get(vigente.id) as { n: number };

  const firmadoPorTitular = (Number(fila?.n) || 0) > 0;
  return {
    tipo, titulo: TITULO_REGISTRO, contratoId: vigente.id, numero: vigente.numero,
    firmadoPorTitular,
    completo: (Number(pendientes?.n) || 0) === 0,
    faltantes,
    pendiente: !firmadoPorTitular,
  };
}

/**
 * Puerta de operación: ¿esta cuenta puede operar?
 *
 * La usan el POST de reservas (el cliente no reserva sin contrato firmado) y la
 * publicación de vehículos (el propietario no publica sin firmarlo).
 *
 * ⚠️ SOLO BLOQUEA A QUIEN YA TIENE UN CONTRATO EMITIDO Y SIN FIRMAR. Si la cuenta no
 * tiene documento de vinculación, pasa. Es deliberado y son dos casos reales:
 *
 *   · Las cuentas ANTERIORES a esta función —todas las que hay hoy en producción—
 *     no tienen contrato de vinculación. Bloquearlas el día del despliegue dejaría a
 *     la plataforma entera sin poder reservar ni publicar hasta que alguien, una por
 *     una, les emitiera el documento. Se les emite desde el panel y, desde ese
 *     momento, sí se les exige.
 *   · Mientras el texto esté pendiente de revisión legal
 *     (`REGISTRO_REVISADO_POR_ABOGADO`), en producción no se emite nada — así que
 *     nadie tiene contrato y nadie queda bloqueado.
 *
 * O sea: la exigencia entra en vigor cuenta por cuenta, a medida que se les emite el
 * documento, y nunca antes. No se puede exigir la firma de algo que no existe.
 */
export function vinculacionAlDia(db: DB, usuarioId: number, rol: string): boolean {
  const e = estadoVinculacion(db, usuarioId, rol);
  if (!e.tipo) return true;            // a este rol no le toca ninguno (admin)
  if (e.contratoId === null) return true; // todavía no se le ha emitido: no se le exige
  return e.firmadoPorTitular;
}
