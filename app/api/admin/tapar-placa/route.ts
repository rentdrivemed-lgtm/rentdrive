import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { uploadFile } from '@/lib/storage';
import { registrarFotoModeracion, normalizarUrlFoto } from '@/lib/moderacion';
import { validarZonas, prepararZonas, esRetencionPorPlaca, type ZonaPlaca } from '@/lib/tapar-placa';
import {
  descargarFotoParaTapar,
  taparPlacasManual,
  tomarTurnoTapado,
  liberarTurnoTapado,
} from '@/lib/tapar-placa-imagen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Baja una foto de hasta 12 MB, la decodifica con sharp (una de 3024×4032 son ~36 MB de
// píxeles crudos), compone y vuelve a subir a Cloudinary. Con una foto por request esto
// no pasa de unos segundos, pero el tope evita que una red lenta deje la petición colgada.
export const maxDuration = 120;

// ── Tapado MANUAL de placas ─────────────────────────────────────────────────
//
// Red de seguridad para cuando la detección automática (lib/blur-placas.ts) no tapa la
// placa: el admin la marca a mano sobre la foto (components/TaparPlacaManual.tsx) y acá
// se estampa el MISMO sello opaco de marca que usa el camino automático.
//
// PERMISOS: `guardArea('vehiculos')`, que hoy (lib/permisos.ts, AREA_NIVELES) es
// principal + socio — la secretaria NO. Esta ruta reescribe la foto publicada de un
// vehículo real, así que va con la misma llave que el resto de la sección Vehículos. El
// modelo de permisos no se toca acá: si mañana alguien le asigna la casilla "vehiculos"
// a otra cuenta por excepción (usuarios.permisos_extra), entra por la misma puerta.
//
// LA ORIGINAL SE CONSERVA: el tapado se aplica siempre sobre `placa_origen_url` (la foto
// tal como estaba antes del PRIMER tapado manual), nunca sobre la ya sellada. Así,
// rehacer un tapado que quedó mal no apila sellos, y la original sigue en Cloudinary —
// solo deja de estar referenciada por `vehiculos.fotos`.

type VehiculoRow = {
  id: number;
  propietario_id: number;
  marca: string;
  modelo: string;
  anio: number;
  placa: string;
  fotos: string;
  fotos_detalle: string;
};

type RegistroFoto = {
  url: string;
  contenido_inapropiado: number;
  motivo: string;
  placa_origen_url: string;
  placa_manual: number;
  placa_manual_usuario_id: number | null;
  placa_manual_at: string;
};

const SELECT_VEHICULO =
  'SELECT id, propietario_id, marca, modelo, anio, placa, fotos, fotos_detalle FROM vehiculos WHERE id = ?';

const SELECT_REGISTRO = `
  SELECT url, contenido_inapropiado, motivo, placa_origen_url, placa_manual,
         placa_manual_usuario_id, placa_manual_at
    FROM fotos_moderacion WHERE url_normalizada = ?`;

function parseFotos(json: string): string[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string' && !!u) : [];
  } catch {
    return [];
  }
}

function parseFotosDetalle(json: string): Record<string, string> {
  try {
    const obj = JSON.parse(json || '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && !!e[1],
      ),
    );
  } catch {
    return {};
  }
}

/** Todas las fotos del vehículo, sin repetir, con la casilla a la que pertenecen (si alguna). */
function fotosDelVehiculo(v: VehiculoRow): { url: string; casilla: string | null }[] {
  const detalle = parseFotosDetalle(v.fotos_detalle);
  const salida: { url: string; casilla: string | null }[] = [];
  const vistas = new Set<string>();
  for (const [casilla, url] of Object.entries(detalle)) {
    const n = normalizarUrlFoto(url);
    if (!n || vistas.has(n)) continue;
    vistas.add(n);
    salida.push({ url, casilla });
  }
  for (const url of parseFotos(v.fotos)) {
    const n = normalizarUrlFoto(url);
    if (!n || vistas.has(n)) continue;
    vistas.add(n);
    salida.push({ url, casilla: null });
  }
  return salida;
}

// ── GET /api/admin/tapar-placa?vehiculo_id=N ────────────────────────────────
//
// Estado de tapado de CADA foto del vehículo, para que el panel pueda pintar la señal de
// "esta foto hay que revisarla" y saber sobre qué imagen abrir el editor (la original,
// no la ya sellada).
export async function GET(req: NextRequest) {
  const g = await guardArea('vehiculos');
  if ('error' in g) return g.error;
  const { db } = g;

  const vehiculoId = Number(new URL(req.url).searchParams.get('vehiculo_id'));
  if (!Number.isInteger(vehiculoId) || vehiculoId <= 0) {
    return NextResponse.json({ error: 'vehiculo_id inválido' }, { status: 400 });
  }

  const vehiculo = db.prepare(SELECT_VEHICULO).get(vehiculoId) as VehiculoRow | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'Vehículo no encontrado' }, { status: 404 });

  const leerRegistro = db.prepare(SELECT_REGISTRO);
  const nombres = new Map<number, string>();

  const fotos = fotosDelVehiculo(vehiculo).map(f => {
    const reg = leerRegistro.get(normalizarUrlFoto(f.url)) as RegistroFoto | undefined;
    let manualPor = '';
    if (reg?.placa_manual_usuario_id) {
      const cacheado = nombres.get(reg.placa_manual_usuario_id);
      if (cacheado !== undefined) {
        manualPor = cacheado;
      } else {
        const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(reg.placa_manual_usuario_id) as
          | { nombre: string }
          | undefined;
        manualPor = u?.nombre || '';
        nombres.set(reg.placa_manual_usuario_id, manualPor);
      }
    }
    return {
      url: f.url,
      casilla: f.casilla,
      // Sobre esta imagen se abre el editor y sobre ella se estampa: si ya hubo un tapado
      // manual, es la de ANTES de ese tapado (si no, se apilarían sellos y además la
      // persona no podría ver la placa que tiene que marcar).
      origen_url: reg?.placa_origen_url || f.url,
      // `false` también cuando no hay registro (fotos anteriores al modelo allow-list de
      // lib/moderacion.ts): que no esté marcada no significa que se haya revisado.
      marcada: !!reg?.contenido_inapropiado,
      // RETENIDA POR PLACA: el detector automático se rindió en esta foto y la dejó marcada
      // para que un humano la mire (ver `revisionManual` en lib/blur-placas.ts y el camino
      // fail-closed de app/api/upload/route.ts). Es exactamente el caso que esta herramienta
      // existe para resolver, así que se distingue de una marca por contenido inapropiado
      // —que cae en la MISMA columna `contenido_inapropiado`— leyendo el prefijo del motivo.
      retenida_placa: !!reg?.contenido_inapropiado && esRetencionPorPlaca(reg?.motivo),
      motivo: reg?.motivo || '',
      sin_registro: !reg,
      tapada_a_mano: !!reg?.placa_manual,
      tapada_a_mano_por: manualPor,
      tapada_a_mano_en: reg?.placa_manual_at || '',
    };
  });

  return NextResponse.json({
    vehiculo: {
      id: vehiculo.id,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      anio: vehiculo.anio,
      placa: vehiculo.placa,
    },
    fotos,
  });
}

// ── POST /api/admin/tapar-placa ─────────────────────────────────────────────
// Body: { vehiculo_id: number, url: string, zonas: [{x,y,w,h}], proporcion_placa?: boolean }
//   · `url`   : la foto TAL COMO ESTÁ PUBLICADA hoy en el vehículo (no la de origen). Se
//               exige que pertenezca a ese vehículo: así nadie puede pedirle al servidor
//               que descargue y reprocese una dirección arbitraria.
//   · `zonas` : rectángulos en FRACCIONES (0..1) sobre la foto de origen ya normalizada
//               por EXIF. Los valida lib/tapar-placa.ts (cantidad, límites, tamaño mínimo
//               y máximo, área total).
export async function POST(req: NextRequest) {
  const g = await guardArea('vehiculos');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  let body: { vehiculo_id?: unknown; url?: unknown; zonas?: unknown; proporcion_placa?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const vehiculoId = Number(body.vehiculo_id);
  if (!Number.isInteger(vehiculoId) || vehiculoId <= 0) {
    return NextResponse.json({ error: 'vehiculo_id inválido' }, { status: 400 });
  }
  if (typeof body.url !== 'string' || !body.url.trim()) {
    return NextResponse.json({ error: 'Falta la foto a tapar' }, { status: 400 });
  }
  const urlPedida = body.url.trim();

  const validacion = validarZonas(body.zonas);
  if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 });
  const zonas: ZonaPlaca[] = validacion.zonas;
  // Por defecto sí: el dueño pidió que el tapado parezca "la placa de DrivePass", y una
  // placa colombiana es 2:1 (ver ASPECTO_PLACA en lib/tapar-placa.ts).
  const proporcionPlaca = body.proporcion_placa !== false;

  const vehiculo = db.prepare(SELECT_VEHICULO).get(vehiculoId) as VehiculoRow | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'Vehículo no encontrado' }, { status: 404 });

  const urlNormalizada = normalizarUrlFoto(urlPedida);
  const fotoDelVehiculo = fotosDelVehiculo(vehiculo).find(f => normalizarUrlFoto(f.url) === urlNormalizada);
  if (!fotoDelVehiculo) {
    return NextResponse.json({ error: 'Esa foto no pertenece a este vehículo.' }, { status: 400 });
  }

  const registro = db.prepare(SELECT_REGISTRO).get(urlNormalizada) as RegistroFoto | undefined;
  // Siempre sobre la ORIGINAL: si esta foto ya salió de un tapado manual anterior, se
  // vuelve a la de antes de aquel tapado. Si no, la publicada es su propia original.
  const urlOrigen = registro?.placa_origen_url || fotoDelVehiculo.url;

  if (!tomarTurnoTapado()) {
    return NextResponse.json(
      { error: 'Hay otro tapado de foto en curso. Espera unos segundos y vuelve a intentar.' },
      { status: 503 },
    );
  }

  try {
    const { buffer, mediaType } = await descargarFotoParaTapar(urlOrigen);
    const resultado = await taparPlacasManual(buffer, mediaType, zonas, proporcionPlaca);

    const nombre = `placa-manual-${vehiculo.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { url: nuevaUrl } = await uploadFile(nombre, 'image/jpeg', resultado.buffer);

    // Zonas finales (con el ajuste a proporción de placa ya aplicado) — se guardan para
    // poder auditar/rehacer exactamente lo que se estampó.
    const zonasFinales = prepararZonas(zonas, resultado.ancho, resultado.alto, proporcionPlaca);

    const aplicar = db.transaction(() => {
      // Relectura FRESCA dentro de la transacción: entre que empezó este request y ahora
      // hubo descarga + sharp + subida a Cloudinary (varios segundos), y el propietario
      // pudo haber editado sus fotos mientras tanto. Mismo criterio que
      // app/api/admin/reprocesar-placas. Si la foto ya no está, no hay nada que reemplazar.
      const fresco = db.prepare('SELECT fotos, fotos_detalle FROM vehiculos WHERE id = ?').get(vehiculo.id) as
        | { fotos: string; fotos_detalle: string }
        | undefined;
      if (!fresco) return { reemplazada: false };

      const fotosFrescas = parseFotos(fresco.fotos);
      const detalleFresco = parseFotosDetalle(fresco.fotos_detalle);
      let reemplazada = false;

      const nuevasFotos = fotosFrescas.map(u => {
        if (normalizarUrlFoto(u) !== urlNormalizada) return u;
        reemplazada = true;
        return nuevaUrl;
      });
      const nuevoDetalle: Record<string, string> = {};
      for (const [clave, u] of Object.entries(detalleFresco)) {
        if (normalizarUrlFoto(u) === urlNormalizada) {
          reemplazada = true;
          nuevoDetalle[clave] = nuevaUrl;
        } else {
          nuevoDetalle[clave] = u;
        }
      }

      if (reemplazada) {
        db.prepare('UPDATE vehiculos SET fotos = ?, fotos_detalle = ? WHERE id = ?').run(
          JSON.stringify(nuevasFotos),
          JSON.stringify(nuevoDetalle),
          vehiculo.id,
        );
      }

      // Registro allow-list de la URL nueva (ver lib/moderacion.ts): sin él, la próxima
      // vez que el PROPIETARIO edite este vehículo el guardado se rechazaría por tener una
      // foto "sin registro". Se registra a su nombre, no al del admin — igual que hace
      // app/api/admin/reprocesar-placas.
      //
      // ── QUÉ PASA CON EL VEREDICTO DE MODERACIÓN ──────────────────────────────────────
      // Por defecto se HEREDA tal cual: tapar una placa no dice absolutamente nada sobre si
      // la foto tiene contenido sexual, así que borrar esa marca automáticamente sería
      // fail-open. Quitarla sigue siendo una decisión humana explícita.
      //
      // La ÚNICA excepción es la retención por placa (`esRetencionPorPlaca`): esa marca no
      // significa "esta foto es inapropiada", significa "puede haber quedado una placa a la
      // vista, que la mire un humano" (ver `revisionManual` en lib/blur-placas.ts). Acabamos
      // de hacer exactamente eso —una persona con permiso de Vehículos abrió la foto, marcó
      // las placas y estampó el sello—, así que la retención queda resuelta y se levanta.
      //
      // No levantarla sería un callejón sin salida, no un detalle cosmético: POST/PUT
      // /api/vehiculos RECALCULA `vehiculos.contenido_revision` a partir de estas marcas cada
      // vez que el propietario guarda, y nada en el sistema limpia nunca
      // `fotos_moderacion.contenido_inapropiado`. Con la marca puesta, el vehículo volvería a
      // caer en revisión de contenido en la siguiente edición del propietario, deshaciendo el
      // "✓ Aprobar y publicar" del admin — para siempre y sin forma de salir.
      //
      // Ojo con lo que NO entra en la excepción, a propósito: "no se pudo evaluar el
      // contenido" y "se alcanzó el límite de detección" tienen sus propios motivos (ver
      // app/api/upload/route.ts) y significan que la moderación NUNCA corrió sobre esta foto.
      // Esas se mantienen marcadas: siguen siendo fail-closed.
      const eraRetencionPlaca = !!registro?.contenido_inapropiado && esRetencionPorPlaca(registro?.motivo);
      registrarFotoModeracion(
        db,
        nuevaUrl,
        vehiculo.propietario_id,
        eraRetencionPlaca ? false : !!registro?.contenido_inapropiado,
        eraRetencionPlaca ? '' : (registro?.motivo || ''),
      );
      db.prepare(
        `UPDATE fotos_moderacion
            SET placa_origen_url = ?, placa_manual = 1, placa_manual_usuario_id = ?,
                placa_manual_at = datetime('now', 'localtime'), placa_manual_zonas = ?
          WHERE url_normalizada = ?`,
      ).run(urlOrigen, user.id, JSON.stringify(zonasFinales), normalizarUrlFoto(nuevaUrl));

      return { reemplazada, retencionLevantada: eraRetencionPlaca };
    });

    const { reemplazada, retencionLevantada } = aplicar();

    registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
      area: 'vehiculos',
      accion: 'tapar_placa_manual',
      entidad: 'vehiculo',
      entidad_id: vehiculo.id,
      detalle: JSON.stringify({
        vehiculo: `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}${vehiculo.placa ? ` (${vehiculo.placa})` : ''}`,
        casilla: fotoDelVehiculo.casilla,
        url_anterior: fotoDelVehiculo.url,
        url_origen: urlOrigen,
        url_nueva: nuevaUrl,
        zonas: resultado.rectangulos,
        proporcion_placa: proporcionPlaca,
        imagen: `${resultado.ancho}x${resultado.alto}`,
        reemplazada,
        retencion_levantada: retencionLevantada,
      }),
    });

    return NextResponse.json(
      {
        url: nuevaUrl,
        origen_url: urlOrigen,
        zonas: resultado.rectangulos,
        ancho: resultado.ancho,
        alto: resultado.alto,
        reemplazada,
        retencion_levantada: retencionLevantada,
        aviso: !reemplazada
          ? 'La foto ya no estaba en la publicación cuando se guardó (alguien la cambió mientras tanto), así que no se reemplazó nada.'
          : retencionLevantada
            ? 'Listo: la placa quedó tapada y la foto ya no está retenida por el tapado automático. La original se conserva por si hay que rehacerlo.'
            : undefined,
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'No se pudo tapar la placa';
    console.error('[tapar-placa] fallo al tapar la placa a mano:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    liberarTurnoTapado();
  }
}
