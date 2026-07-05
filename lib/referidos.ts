// Programa de referidos ("invita y gana"): quien invita gana un crédito cuando su
// referido completa su PRIMERA reserva pagada (evita premiar cuentas falsas que solo
// se registran); el referido gana su descuento de bienvenida de inmediato al
// registrarse, usable en su primera reserva. Los créditos son un descuento sobre el
// total (no hay pasarela de pago real), nunca generan pagos en efectivo.
import type Database from 'better-sqlite3';
import { getConfig } from './operaciones';

type DB = Database.Database;

export function referidoHabilitado(db: DB): boolean {
  return getConfig(db, 'referido_habilitado') === 'true';
}

export function montoRecompensaReferrer(db: DB): number {
  const n = Number(getConfig(db, 'referido_recompensa_referrer'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function montoRecompensaReferido(db: DB): number {
  const n = Number(getConfig(db, 'referido_recompensa_referido'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function generarCodigoUnico(db: DB, nombre: string): string {
  const base = (nombre.split(' ')[0] || 'AMIGO').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'AMIGO';
  for (let intento = 0; intento < 20; intento++) {
    const sufijo = Math.floor(1000 + Math.random() * 9000);
    const candidato = `${base}${sufijo}`;
    const existe = db.prepare('SELECT id FROM usuarios WHERE codigo_referido = ?').get(candidato);
    if (!existe) return candidato;
  }
  return `REF${Date.now()}`; // fallback, prácticamente nunca debería llegar aquí
}

/** Genera y guarda el código propio de un usuario recién registrado. */
export function asignarCodigoReferido(db: DB, usuarioId: number, nombre: string): string {
  const codigo = generarCodigoUnico(db, nombre);
  db.prepare('UPDATE usuarios SET codigo_referido = ? WHERE id = ?').run(codigo, usuarioId);
  return codigo;
}

/**
 * Se llama justo después de crear un usuario nuevo, si vino con un código de
 * referido. Valida el código, guarda la relación, y acredita de inmediato el
 * descuento de bienvenida al recién llegado.
 */
export function vincularReferido(db: DB, nuevoUsuarioId: number, codigo: string): void {
  if (!referidoHabilitado(db) || !codigo.trim()) return;

  const referrer = db.prepare('SELECT id FROM usuarios WHERE codigo_referido = ?').get(codigo.trim().toUpperCase()) as { id: number } | undefined;
  if (!referrer || referrer.id === nuevoUsuarioId) return; // código inválido o alguien intentando referirse a sí mismo

  const recompensaReferido = montoRecompensaReferido(db);
  db.prepare('UPDATE usuarios SET referido_por = ?, creditos_referido = creditos_referido + ? WHERE id = ?')
    .run(referrer.id, recompensaReferido, nuevoUsuarioId);

  db.prepare(`
    INSERT INTO referidos (referrer_id, referido_id, recompensa_referrer, recompensa_referido)
    VALUES (?, ?, ?, ?)
  `).run(referrer.id, nuevoUsuarioId, montoRecompensaReferrer(db), recompensaReferido);
}

/**
 * Se llama cuando una reserva pasa a pago_estado='pagado'. Si el usuario fue
 * referido y esta es su PRIMERA reserva pagada, acredita la recompensa al referrer.
 */
export function procesarRecompensaReferido(db: DB, usuarioId: number, reservaId: number): void {
  if (!referidoHabilitado(db)) return;

  const rel = db.prepare("SELECT id, referrer_id, recompensa_referrer FROM referidos WHERE referido_id = ? AND estado = 'pendiente'")
    .get(usuarioId) as { id: number; referrer_id: number; recompensa_referrer: number } | undefined;
  if (!rel) return;

  const reservasPagadas = db.prepare("SELECT COUNT(*) AS n FROM reservas WHERE usuario_id = ? AND pago_estado = 'pagado'")
    .get(usuarioId) as { n: number };
  if (reservasPagadas.n !== 1) return; // no es la primera reserva pagada de este usuario

  db.prepare('UPDATE usuarios SET creditos_referido = creditos_referido + ? WHERE id = ?').run(rel.recompensa_referrer, rel.referrer_id);
  db.prepare("UPDATE referidos SET estado = 'acreditado', reserva_id_disparador = ?, acreditado_en = datetime('now','localtime') WHERE id = ?")
    .run(reservaId, rel.id);
}

/** Descuenta hasta `montoSolicitado` del saldo de créditos del usuario (nunca más de lo disponible). Devuelve el monto realmente usado. */
export function consumirCreditos(db: DB, usuarioId: number, montoSolicitado: number): number {
  const u = db.prepare('SELECT creditos_referido FROM usuarios WHERE id = ?').get(usuarioId) as { creditos_referido: number } | undefined;
  const disponible = u?.creditos_referido || 0;
  const usado = Math.max(0, Math.min(montoSolicitado, disponible));
  if (usado > 0) {
    db.prepare('UPDATE usuarios SET creditos_referido = creditos_referido - ? WHERE id = ?').run(usado, usuarioId);
  }
  return usado;
}
