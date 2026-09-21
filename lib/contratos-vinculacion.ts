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
import {
  PREFIJO_VINCULACION, ROL_TITULAR, TITULOS_VINCULACION, VINCULACION_REVISADA_POR_ABOGADO,
  generarTextoVinculacion, type DatosVinculacion, type TipoVinculacion,
} from './contratos-vinculacion-texto';

type DB = Database.Database;

/** Qué documento le toca a cada rol de cuenta. Un admin no firma vinculación. */
export const VINCULACION_POR_ROL: Record<string, TipoVinculacion | null> = {
  usuario: 'vinculacion-cliente',
  propietario: 'vinculacion-propietario',
  admin: null,
};

export function vinculacionQueLeToca(rol: string): TipoVinculacion | null {
  return VINCULACION_POR_ROL[(rol || '').trim()] ?? null;
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

export const BLOQUES_VINCULACION: Record<TipoVinculacion, DefBloqueVinculacion[]> = {
  'vinculacion-cliente': [
    { clave: 'usuario', etiqueta: 'EL USUARIO', rol: 'cliente', orden: 1 },
    { clave: 'agente', etiqueta: 'LA PLATAFORMA', rol: 'agente', orden: 2 },
  ],
  'vinculacion-propietario': [
    { clave: 'propietario', etiqueta: 'EL PROPIETARIO', rol: 'propietario', orden: 1 },
    { clave: 'agente', etiqueta: 'LA PLATAFORMA', rol: 'agente', orden: 2 },
  ],
};

// ── Datos ───────────────────────────────────────────────────────────────────

export function armarDatosVinculacion(db: DB, usuarioId: number): DatosVinculacion | null {
  const titular = personaDeUsuario(db, usuarioId);
  if (!titular) return null;
  return {
    fecha: new Date().toISOString(),
    ciudad: CIUDAD_CONTRATO,
    titular,
    agente: AGENTE,
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
export function faltantesVinculacion(d: DatosVinculacion): CampoFaltante[] {
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
  if (!VINCULACION_REVISADA_POR_ABOGADO && process.env.NODE_ENV === 'production') {
    return err(503, 'El contrato de vinculación todavía está pendiente de revisión legal y no se puede emitir.');
  }
  return { ok: true };
}

/** El documento de vinculación VIGENTE (no anulado) de una cuenta, si lo hay. */
export function vinculacionVigente(db: DB, usuarioId: number, tipo: TipoVinculacion): {
  id: number; numero: string; estado: string; version: number;
} | null {
  const columna = ROL_TITULAR[tipo] === 'cliente' ? 'cliente_id' : 'propietario_id';
  return (db.prepare(`
    SELECT id, numero, estado, version FROM contratos
    WHERE reserva_id IS NULL AND tipo = ? AND ${columna} = ? AND estado <> 'anulado'
    ORDER BY version DESC LIMIT 1
  `).get(tipo, Number(usuarioId)) as { id: number; numero: string; estado: string; version: number } | undefined) ?? null;
}

/**
 * Emite el contrato de vinculación de una cuenta. IDEMPOTENTE: si ya hay uno vigente
 * lo devuelve con `yaExistia: true` en vez de emitir otro —el registro puede
 * reintentarse, y el admin puede pulsar "habilitar" dos veces—. El índice único
 * parcial de la tabla es la última línea de defensa.
 */
export function generarContratoVinculacion(
  db: DB, usuarioId: number, tipo: TipoVinculacion, actor: ActorVinculacion,
): EmisionOk | EmisionError {
  const puerta = puedeEmitirVinculacion();
  if (!puerta.ok) return puerta;

  const cuenta = db.prepare('SELECT id, rol, estado_cuenta FROM usuarios WHERE id = ?')
    .get(Number(usuarioId)) as { id: number; rol: string; estado_cuenta: string } | undefined;
  if (!cuenta) return err(404, 'La cuenta no existe.');
  if (cuenta.estado_cuenta === 'archivada') return err(409, 'La cuenta está archivada.');
  if (vinculacionQueLeToca(cuenta.rol) !== tipo) {
    return err(409, `Este documento no corresponde al rol de la cuenta (${cuenta.rol}).`);
  }

  const vigente = vinculacionVigente(db, usuarioId, tipo);
  if (vigente) return { ok: true, contratoId: vigente.id, numero: vigente.numero, yaExistia: true };

  const datos = armarDatosVinculacion(db, usuarioId);
  if (!datos) return err(404, 'La cuenta no existe.');
  const texto = generarTextoVinculacion(tipo, datos);
  const faltantes = faltantesVinculacion(datos);

  const columna = ROL_TITULAR[tipo] === 'cliente' ? 'cliente_id' : 'propietario_id';
  const previa = db.prepare(
    `SELECT MAX(version) AS v FROM contratos WHERE reserva_id IS NULL AND tipo = ? AND ${columna} = ?`
  ).get(tipo, Number(usuarioId)) as { v: number | null };
  const version = (Number(previa?.v) || 0) + 1;

  try {
    const crear = db.transaction(() => {
      const res = db.prepare(`
        INSERT INTO contratos (
          reserva_id, vehiculo_id, propietario_id, cliente_id, tipo, numero, version, estado,
          texto, datos_json, faltantes_json, generado_por, generado_por_nombre
        ) VALUES (NULL, NULL, ?, ?, ?, '', ?, 'pendiente', ?, ?, ?, ?, ?)
      `).run(
        ROL_TITULAR[tipo] === 'propietario' ? Number(usuarioId) : null,
        ROL_TITULAR[tipo] === 'cliente' ? Number(usuarioId) : null,
        tipo, version, texto, JSON.stringify(datos), JSON.stringify(faltantes),
        actor.id, actor.nombre || '',
      );
      const id = Number(res.lastInsertRowid);

      // Igual que en los contratos de operación: toda la familia comparte el número
      // base y la reemisión añade el sufijo de versión (VUS-000012-R2).
      const raiz = db.prepare(
        `SELECT id FROM contratos WHERE reserva_id IS NULL AND tipo = ? AND ${columna} = ? ORDER BY version ASC LIMIT 1`
      ).get(tipo, Number(usuarioId)) as { id: number } | undefined;
      const base = `${PREFIJO_VINCULACION[tipo]}-${String(Number(raiz?.id) || id).padStart(6, '0')}`;
      const numero = version > 1 ? `${base}-R${version}` : base;
      db.prepare('UPDATE contratos SET numero = ? WHERE id = ?').run(numero, id);

      const insFirma = db.prepare(`
        INSERT INTO contrato_firmas (
          contrato_id, bloque, etiqueta, rol, momento, orden,
          usuario_esperado_id, nombre_esperado, documento_esperado
        ) VALUES (?, ?, ?, ?, 'suscripcion', ?, ?, ?, ?)
      `);
      for (const b of BLOQUES_VINCULACION[tipo]) {
        // EL AGENTE no tiene cuenta esperada: lo suscribe cualquier admin con el
        // permiso `contratos_firmar_agente`, igual que en el resto del módulo.
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
          detalle: `Emitió ${TITULOS_VINCULACION[tipo]} ${numero} de la cuenta #${usuarioId}`
            + (faltantes.length ? ` · ${faltantes.length} dato(s) del perfil en blanco` : ''),
        },
      );
      return { id, numero };
    })();
    return { ok: true, contratoId: crear.id, numero: crear.numero, yaExistia: false };
  } catch (e) {
    // Carrera entre dos emisiones simultáneas (el registro y un clic de "habilitar"):
    // el índice único parcial la corta y acá se devuelve el que ganó.
    const ya = vinculacionVigente(db, usuarioId, tipo);
    if (ya) return { ok: true, contratoId: ya.id, numero: ya.numero, yaExistia: true };
    return err(500, e instanceof Error ? e.message : 'No se pudo emitir el contrato de vinculación.');
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
): EmisionOk | EmisionError | null {
  const tipo = vinculacionQueLeToca(rol);
  if (!tipo) return null;                       // a un admin no le toca ninguno
  try {
    const r = generarContratoVinculacion(db, usuarioId, tipo, actor);
    if (!r.ok || r.yaExistia) return r;         // no se re-notifica lo ya notificado
    notificarUsuarios(db, [Number(usuarioId)], {
      tipo: 'contrato_vinculacion',
      titulo: 'Tienes un contrato pendiente de firma',
      mensaje: `Para poder ${tipo === 'vinculacion-cliente' ? 'reservar un vehículo' : 'publicar tu vehículo'} `
        + `necesitas firmar tu ${TITULOS_VINCULACION[tipo].toLowerCase()} (${r.numero}). `
        + 'Puedes firmarlo desde tu perfil, en cualquier momento.',
      referencia_id: r.contratoId,
      referencia_tipo: 'contrato',
    });
    return r;
  } catch (e) {
    console.error('[vinculacion] No se pudo emitir/notificar:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Estado de una cuenta ────────────────────────────────────────────────────

export type EstadoVinculacion = {
  /** `null` cuando al rol no le toca ninguno (admin). */
  tipo: TipoVinculacion | null;
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
    return { tipo: null, titulo: '', contratoId: null, numero: '', firmadoPorTitular: true, completo: true, faltantes: [] };
  }
  const vigente = vinculacionVigente(db, usuarioId, tipo);
  const datos = armarDatosVinculacion(db, usuarioId);
  const faltantes = datos ? faltantesVinculacion(datos) : [];

  if (!vigente) {
    return {
      tipo, titulo: TITULOS_VINCULACION[tipo], contratoId: null, numero: '',
      firmadoPorTitular: false, completo: false, faltantes,
    };
  }

  const bloqueTitular = ROL_TITULAR[tipo];
  const fila = db.prepare(
    "SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND rol = ? AND firmada_en <> ''"
  ).get(vigente.id, bloqueTitular) as { n: number };
  const pendientes = db.prepare(
    "SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND firmada_en = ''"
  ).get(vigente.id) as { n: number };

  return {
    tipo, titulo: TITULOS_VINCULACION[tipo], contratoId: vigente.id, numero: vigente.numero,
    firmadoPorTitular: (Number(fila?.n) || 0) > 0,
    completo: (Number(pendientes?.n) || 0) === 0,
    faltantes,
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
 *     (`VINCULACION_REVISADA_POR_ABOGADO`), en producción no se emite nada — así que
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
