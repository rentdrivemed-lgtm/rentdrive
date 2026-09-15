import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { consumirIntento } from '@/lib/limite-tasa';
import {
  pistaDato, pistaCorreo, inicialesNombre,
  camposDePerfilQueFaltan, faltanDatosDeOperacion, motivoNoReservable,
} from '@/lib/cliente-mostrador';

export const dynamic = 'force-dynamic';

// Búsqueda del titular para una reserva de mostrador (ver app/api/admin/reservas).
// Exige la sección "reservas" — es justo el permiso del nivel `secretaria`
// ("Secretaría / punto de atención", lib/permisos.ts), que es quien atiende al
// cliente que llega en persona.
//
// ── Por qué la coincidencia es EXACTA y no un LIKE ──────────────────────────
// Esta ruta responde sobre datos personales de clientes reales. Con un LIKE se
// convertiría en un buscador libre del padrón de usuarios (escribir "a" listaría
// medio sistema). La secretaria tiene a la persona enfrente con su cédula en la
// mano: sabe el número exacto o el correo exacto. Así el endpoint solo confirma
// "esta cuenta existe", que es lo único que el flujo necesita.
//
// ── Por qué la respuesta va enmascarada ─────────────────────────────────────
// Precedente directo en este proyecto: lib/vehiculo-publico.ts, escrito para
// cerrar una fuga de PII por serializar filas completas. Aquí NO se devuelven ni
// la dirección, ni el contacto de emergencia, ni las URLs de los documentos, ni
// el documento/celular completos: el área "reservas" no da acceso a la ficha de
// usuario (eso es el área "usuarios", que la secretaria NO tiene).
//
// Tampoco salen el NOMBRE ni el CORREO completos, aunque la búsqueda sea exacta.
// El motivo: los números de cédula colombianos son secuenciales y circulan en
// listas filtradas, así que un endpoint que traduce "cédula → nombre + correo"
// es, con una lista en la mano, una fuente de identidades — justo lo que la
// separación de áreas pretendía negarle al nivel `secretaria`. El proyecto ya
// tiene el precedente contrario y deliberado en POST /api/auth/olvide-password,
// que responde genérico para no permitir enumeración. Del nombre salen las
// iniciales, del correo la primera letra y el dominio, y del documento y el
// celular los últimos 4: con la persona enfrente eso confirma de sobra que la
// cuenta es la suya, y a quien solo tenga una lista de cédulas no le entrega
// ninguna identidad nueva. El resto va como banderas booleanas: qué le falta a la
// cuenta para poder reservar, sin exponer el valor de nada. `rol` y
// `estado_cuenta` tampoco se devuelven: `motivo_no_reservable` ya dice lo único
// que el flujo necesita saber, en texto para el empleado.
//
// Además: límite de tasa por empleado (evita el barrido de una lista completa) y
// una entrada de auditoría por búsqueda, con el término consultado, para que un
// uso masivo quede visible en el panel de Auditoría.

// ~1 búsqueda por cliente atendido. 20 en 10 minutos cubre de sobra un mostrador
// con cola; el tope diario es el que de verdad corta un barrido de cédulas.
const MAX_CORTO = 20;
const VENTANA_CORTA_MS = 10 * 60_000;
const MAX_DIARIO = 120;
const DIA_MS = 24 * 3600_000;

type FilaCliente = {
  id: number; nombre: string; correo: string; rol: string; estado_cuenta: string;
  password: string | null;
  tipo_documento: string | null; documento_identidad: string | null; fecha_nacimiento: string | null;
  celular: string | null;
  direccion: string | null; ciudad: string | null; contacto_emergencia: string | null;
};

export async function GET(req: NextRequest) {
  const g = await guardArea('reservas');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 120);
  if (q.length < 4) {
    return NextResponse.json({ error: 'Escribe el número de documento completo o el correo del cliente.' }, { status: 400 });
  }

  // El límite es por EMPLEADO (no por IP): todos los del mostrador pueden salir por
  // la misma IP de la oficina, y lo que se quiere acotar es cuánto padrón puede
  // barrer una sola sesión.
  const esperaCorta = consumirIntento(`admin-clientes:corto:${user.id}`, MAX_CORTO, VENTANA_CORTA_MS);
  if (esperaCorta !== null) {
    return NextResponse.json(
      { error: `Demasiadas búsquedas seguidas. Intenta de nuevo en ${Math.ceil(esperaCorta / 60)} minuto(s).` },
      { status: 429 },
    );
  }
  const esperaDiaria = consumirIntento(`admin-clientes:dia:${user.id}`, MAX_DIARIO, DIA_MS);
  if (esperaDiaria !== null) {
    return NextResponse.json(
      { error: 'Alcanzaste el máximo de búsquedas de clientes por hoy. Pídele a un administrador que lo revise.' },
      { status: 429 },
    );
  }

  // Un solo SELECT con las dos llaves posibles (correo o documento), ambas exactas
  // y parametrizadas. El correo se compara sin distinguir mayúsculas porque el
  // registro lo guarda tal cual lo escribió el usuario. El ORDER BY prioriza una
  // cuenta de cliente si por accidente hubiera dos filas con el mismo documento.
  const fila = db.prepare(`
    SELECT id, nombre, correo, rol, estado_cuenta, password,
           tipo_documento, documento_identidad, fecha_nacimiento, celular,
           direccion, ciudad, contacto_emergencia
    FROM usuarios
    WHERE LOWER(correo) = LOWER(?) OR documento_identidad = ?
    ORDER BY CASE WHEN rol = 'usuario' THEN 0 ELSE 1 END, id
    LIMIT 1
  `).get(q, q) as FilaCliente | undefined;

  // Se audita SIEMPRE (haya resultado o no): un barrido de cédulas se reconoce
  // justamente por la ristra de búsquedas fallidas. Se guarda el término tal cual
  // se consultó porque sin él la entrada no sirve para investigar nada.
  registrarAuditoria(db, { ...user, nivel }, {
    area: 'reservas', accion: 'buscar_cliente_mostrador',
    entidad: 'usuario', entidad_id: fila?.id ?? null,
    detalle: `Buscó "${q}" en el punto de atención — ${fila ? `cuenta #${fila.id}` : 'sin resultados'}`,
  });

  if (!fila) return NextResponse.json({ encontrado: false });

  return NextResponse.json({
    encontrado: true,
    cliente: {
      id: fila.id,
      nombre_iniciales: inicialesNombre(fila.nombre),
      correo_pista: pistaCorreo(fila.correo),
      documento_pista: pistaDato(fila.documento_identidad),
      celular_pista: pistaDato(fila.celular),
      motivo_no_reservable: motivoNoReservable(fila),
      faltan_perfil: camposDePerfilQueFaltan(fila),
      // La cuenta nunca fijó contraseña (típico de un registro por Google). No es
      // algo que el admin deba llenar: el servidor le manda al cliente un enlace
      // para crearla al confirmar la reserva. Se informa solo para poder avisarle.
      sin_contrasena: !String(fila.password ?? '').trim(),
      faltan_datos_operacion: faltanDatosDeOperacion(fila),
    },
  });
}
