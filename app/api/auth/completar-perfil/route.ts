import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { validarDocumentoIdentidad } from '@/lib/validacion';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { esUrlDeStorageValida } from '@/lib/storage';

// ── Completar perfil tras registro con Google ────────────────────────────────
//
// El login con Google (app/api/auth/google) crea la cuenta con `password: ''` y
// sin tipo_documento/documento_identidad/fecha_nacimiento — nadie validó ahí que
// esa persona sea mayor de edad ni le dejó una forma de entrar sin Google. Este
// endpoint es la ÚNICA vía para cerrar ese hueco: exige sesión activa y guarda
// los 3 campos de identidad (mismas reglas que el registro manual) más, si aplica,
// una contraseña nueva.
//
// Esto NO es un endpoint de "cambiar contraseña": solo permite ESTABLECER una
// contraseña si la cuenta hoy no tiene ninguna (password vacía en BD). Si ya
// tiene una, cualquier intento de mandar `password` aquí se rechaza — el cambio
// de contraseña normal es otro flujo (app/api/auth/restablecer-password, por
// token de correo) y no se toca desde acá.
//
// Igual que el registro manual: la mayoría de edad y el formato del documento se
// validan en el servidor sin importar si el dato llegó escrito a mano o leído de
// una foto con IA (app/api/registro/extraer-documento) — esa lectura solo
// pre-llena el formulario, nunca se confía en ella ciegamente.

function calcularEdad(fechaNac: string): number {
  if (!fechaNac) return 0;
  const hoy = new Date();
  const nac = new Date(fechaNac);
  if (Number.isNaN(nac.getTime())) return 0;
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

export async function POST(req: NextRequest) {
  const csrfError = bloqueadoPorCsrf(req);
  if (csrfError) return csrfError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { password, tipo_documento, documento_identidad, fecha_nacimiento, cedula_url, licencia_url } = body as {
    password?: unknown; tipo_documento?: unknown; documento_identidad?: unknown; fecha_nacimiento?: unknown;
    cedula_url?: unknown; licencia_url?: unknown;
  };

  const db = getDb();
  const fila = db.prepare('SELECT password FROM usuarios WHERE id = ?').get(user.id) as { password: string } | undefined;
  if (!fila) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const passwordActualVacia = !fila.password;

  // Validación completa ANTES de escribir nada: si algo falla, no se guarda nada
  // (ni la contraseña ni los datos de identidad quedan a medias).
  let hashNuevo: string | null = null;
  const passwordEnviada = typeof password === 'string' ? password : '';
  if (passwordEnviada) {
    if (!passwordActualVacia) {
      // Defensa contra usar este endpoint como bypass de "cambiar contraseña":
      // solo se puede ESTABLECER cuando hoy está vacía.
      return NextResponse.json(
        { error: 'Tu cuenta ya tiene una contraseña configurada. Esto no es para cambiarla.' },
        { status: 409 },
      );
    }
    if (passwordEnviada.length < 6) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
    }
    hashNuevo = bcrypt.hashSync(passwordEnviada, 10);
  } else if (passwordActualVacia) {
    return NextResponse.json({ error: 'Debes crear una contraseña para completar tu perfil.' }, { status: 400 });
  }

  const tipoDoc = typeof tipo_documento === 'string' ? tipo_documento : '';
  const numeroDoc = typeof documento_identidad === 'string' ? documento_identidad : '';
  const errDoc = validarDocumentoIdentidad(tipoDoc || 'cedula', numeroDoc);
  if (errDoc) return NextResponse.json({ error: errDoc }, { status: 400 });

  const nacimiento = typeof fecha_nacimiento === 'string' ? fecha_nacimiento : '';
  // La mayoría de edad NO se relaja, sin importar por qué camino llegó el dato.
  if (!nacimiento || calcularEdad(nacimiento) < 18) {
    return NextResponse.json({ error: 'Debes ser mayor de 18 años.' }, { status: 400 });
  }

  const sets = ['tipo_documento = ?', 'documento_identidad = ?', 'fecha_nacimiento = ?'];
  const valores: unknown[] = [tipoDoc || 'cedula', numeroDoc, nacimiento];
  if (hashNuevo) { sets.push('password = ?'); valores.push(hashNuevo); }
  // cedula_url / licencia_url (opcionales): vienen del atajo de foto de esta misma
  // pantalla (app/completar-perfil/page.tsx → POST /api/registro/extraer-documento,
  // que ya subió la imagen y devolvió `urlGuardada`). Igual que en el registro
  // manual, se valida que la URL venga realmente de nuestro storage antes de
  // guardarla; si no, se ignora en silencio (no bloquea el resto del guardado).
  if (typeof cedula_url === 'string' && cedula_url && esUrlDeStorageValida(cedula_url)) {
    sets.push('cedula_url = ?'); valores.push(cedula_url);
  }
  if (typeof licencia_url === 'string' && licencia_url && esUrlDeStorageValida(licencia_url)) {
    sets.push('licencia_url = ?'); valores.push(licencia_url);
  }
  valores.push(user.id);

  db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...valores);

  return NextResponse.json({ ok: true });
}
