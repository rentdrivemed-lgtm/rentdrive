import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { tieneClaveAnthropic } from '@/lib/anthropic';
import { verificarDocumentos, decisionHibrida, type DocEntrada } from '@/lib/verificacion-docs';
import { tecnoRequerida } from '@/lib/tecnomecanica';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VEH_DOCS: [string, string][] = [
  ['soat', 'SOAT'],
  ['tecno', 'Tecnomecánica'],
  ['tarjeta', 'Tarjeta de propiedad'],
  ['todo_riesgo', 'Seguro todo riesgo'],
];

// El SDK de Anthropic arma el mensaje de error como "<status> <json crudo>"
// (p. ej. `400 {"type":"error","error":{"type":"invalid_request_error",
// "message":"Could not process image"},"request_id":"..."}`) — mostrar eso
// tal cual en la UI es una mala experiencia. Extraemos solo el mensaje
// interno y, para el caso reportado, damos una explicación accionable.
function mensajeAmigable(e: unknown): string {
  const raw = e instanceof Error ? e.message : 'Error en la verificación';
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { error?: { message?: string } };
      const interno = parsed?.error?.message;
      if (interno === 'Could not process image') {
        return 'Uno de los documentos no se pudo procesar (imagen dañada o formato no compatible). Vuelve a subir ese documento e intenta de nuevo.';
      }
      if (interno) return interno;
    } catch { /* no era JSON válido, se usa el mensaje crudo abajo */ }
  }
  return raw;
}

// `anio` (año-modelo, aproximación de la fecha de matrícula) decide si `tecno` cuenta dentro
// del estado agregado — ver lib/tecnomecanica.ts (Ley 2294 de 2023). `todo_riesgo` es un
// seguro opcional: nunca debe poder bloquear ni denegar el estado agregado, esté subido o no.
function computeEstado(docs: Record<string, { url?: string } | undefined>, revs: Record<string, { estado?: string }>, anio: number | null | undefined): string {
  const claves = VEH_DOCS.map(([k]) => k).filter(k => k !== 'todo_riesgo' && (k !== 'tecno' || tecnoRequerida(anio)));
  const subidos = claves.filter(k => docs[k]?.url);
  if (subidos.length === 0) return 'sin_documentos';
  if (subidos.some(k => revs[k]?.estado === 'denegado')) return 'denegado';
  if (subidos.every(k => revs[k]?.estado === 'aprobado')) return 'aprobado';
  return 'en_revision';
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  if (!tieneClaveAnthropic()) {
    return NextResponse.json({ error: 'El verificador con IA no está configurado: falta ANTHROPIC_API_KEY en el entorno.' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const vehiculoId = body.vehiculo_id;
  const reservaId = body.reserva_id;
  const db = getDb();

  try {
    // ── Documentos del vehículo (+ datos del arrendador) ──
    if (vehiculoId) {
      const v = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(Number(vehiculoId)) as Record<string, unknown> | undefined;
      if (!v) return NextResponse.json({ error: 'Vehículo no encontrado' }, { status: 404 });
      // Ruta compartida (propietario del carro / admin). Al admin se le exige la
      // sección desde la que se dispara esta verificación: la ficha del vehículo.
      if (user.rol === 'admin') {
        if (!adminTieneArea(db, user.id, 'vehiculos')) return sinPermisoArea();
      } else if (Number(v.propietario_id) !== user.id) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
      }

      const prop = db.prepare('SELECT nombre, documento_identidad, cedula_url FROM usuarios WHERE id = ?').get(Number(v.propietario_id)) as { nombre?: string; documento_identidad?: string; cedula_url?: string } | undefined;
      let docs: Record<string, { url?: string }> = {};
      try { docs = JSON.parse((v.documentos as string) || '{}'); } catch { docs = {}; }

      const entradas: DocEntrada[] = VEH_DOCS
        .filter(([k]) => docs[k]?.url)
        .map(([k, etiqueta]) => ({ clave: k, etiqueta, url: docs[k]!.url! }));
      if (entradas.length === 0) {
        return NextResponse.json({ error: 'Este vehículo no tiene documentos cargados para verificar.' }, { status: 400 });
      }

      // Si el propietario subió la foto de su cédula, la incluimos para que la IA
      // contraste la tarjeta de propiedad contra la cédula real (no solo el texto registrado).
      if (prop?.cedula_url) {
        entradas.push({ clave: 'cedula_propietario', etiqueta: 'Cédula del propietario (arrendador)', url: prop.cedula_url });
      }

      const resultado = await verificarDocumentos(
        { placa: (v.placa as string) || undefined, propietario: { nombre: prop?.nombre, documento: prop?.documento_identidad } },
        entradas,
      );

      // Híbrido: persistir solo las auto-aprobaciones de alta confianza.
      let revs: Record<string, { estado?: string; nota?: string }> = {};
      try { revs = JSON.parse((v.documentos_revisiones as string) || '{}'); } catch { revs = {}; }
      const clavesVehiculo = new Set(VEH_DOCS.map(([k]) => k));
      const autoAprobados: string[] = [];
      for (const d of resultado.documentos) {
        if (!clavesVehiculo.has(d.clave)) continue; // la cédula del propietario no entra al estado de docs del vehículo
        if (decisionHibrida(d) === 'auto_aprobado') {
          revs[d.clave] = { estado: 'aprobado', nota: 'Verificado automáticamente por IA' };
          autoAprobados.push(d.clave);
        }
      }
      const estado = computeEstado(docs, revs, v.anio as number | null | undefined);
      db.prepare('UPDATE vehiculos SET documentos_revisiones = ?, documentos_estado = ? WHERE id = ?')
        .run(JSON.stringify(revs), estado, Number(vehiculoId));

      return NextResponse.json({
        verificacion: resultado,
        auto_aprobados: autoAprobados,
        documentos_estado: estado,
        documentos_revisiones: JSON.stringify(revs),
      });
    }

    // ── Documentos del arrendatario (cédula + licencia de la reserva) ──
    if (reservaId) {
      const r = db.prepare(`
        SELECT r.usuario_id, r.documento_id_url, r.licencia_url, v.propietario_id
        FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id WHERE r.id = ?
      `).get(Number(reservaId)) as { usuario_id: number; documento_id_url?: string; licencia_url?: string; propietario_id: number } | undefined;
      if (!r) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
      // Igual que arriba, pero los documentos del arrendatario se revisan desde la
      // tarjeta de la reserva -> el admin necesita la sección "reservas".
      if (user.rol === 'admin') {
        if (!adminTieneArea(db, user.id, 'reservas')) return sinPermisoArea();
      } else if (r.propietario_id !== user.id) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
      }

      const u = db.prepare('SELECT nombre, documento_identidad, numero_licencia FROM usuarios WHERE id = ?').get(r.usuario_id) as { nombre?: string; documento_identidad?: string; numero_licencia?: string } | undefined;
      const entradas: DocEntrada[] = [];
      if (r.documento_id_url) entradas.push({ clave: 'cedula', etiqueta: 'Cédula', url: r.documento_id_url });
      if (r.licencia_url) entradas.push({ clave: 'licencia', etiqueta: 'Licencia de conducción', url: r.licencia_url });
      if (entradas.length === 0) {
        return NextResponse.json({ error: 'La reserva no tiene documentos del arrendatario para verificar.' }, { status: 400 });
      }

      const resultado = await verificarDocumentos(
        { arrendatario: { nombre: u?.nombre, documento: u?.documento_identidad, licencia: u?.numero_licencia } },
        entradas,
      );
      return NextResponse.json({ verificacion: resultado });
    }

    return NextResponse.json({ error: 'Indica vehiculo_id o reserva_id.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: `Falló la verificación con IA: ${mensajeAmigable(e)}` }, { status: 502 });
  }
}
