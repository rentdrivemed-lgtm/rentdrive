// A dónde mandar a alguien después de autenticarse, en un solo sitio.
//
// La cadena «correo sin verificar → perfil incompleto → destino» estaba escrita tres
// veces (registro, login y la vuelta de verificar-correo), con el riesgo obvio de que
// un eslabón nuevo se añadiera en dos de los tres. Ahora se añade acá.
//
// Puro y sin dependencias: lo importan componentes 'use client'.

/** Lo que de `/api/auth/me` necesita esta decisión. */
export type UsuarioParaRuta = {
  correo_pendiente?: boolean;
  perfil_completo?: boolean;
  vinculacion?: { pendiente?: boolean; contrato_id?: number | null } | null;
} | null | undefined;

export type OpcionesSiguientePaso = {
  /**
   * Incluir el eslabón de la firma del contrato de vinculación.
   *
   * `true` en el REGISTRO: a quien acaba de crear su cuenta se le pide la firma ahí
   * mismo, como un paso más del alta, que es donde tiene sentido pedirla.
   *
   * `false` al INICIAR SESIÓN: a quien ya tenía cuenta no se le corta el paso. Se le
   * insiste con el recordatorio emergente y se le exige la firma solo cuando va a
   * reservar o a publicar, que es donde el servidor la exige de verdad. Mandarlo a
   * firmar nada más entrar sería cambiarle la aplicación por sorpresa.
   */
  incluirFirma: boolean;
};

const enc = encodeURIComponent;

export function rutaSiguientePaso(
  user: UsuarioParaRuta,
  destinoFinal: string,
  opts: OpcionesSiguientePaso,
): string {
  if (!user) return destinoFinal;

  // El orden importa y es el del alta: primero se prueba que el correo es suyo,
  // después se completan los datos, y solo entonces se firma — un contrato emitido
  // con el perfil a medias no se puede firmar (ver lib/contratos-vinculacion.ts).
  if (user.correo_pendiente === true) return `/verificar-correo?next=${enc(destinoFinal)}`;
  if (user.perfil_completo === false) return `/completar-perfil?next=${enc(destinoFinal)}`;

  if (opts.incluirFirma && user.vinculacion?.pendiente && user.vinculacion.contrato_id) {
    return `/contratos/${user.vinculacion.contrato_id}?bienvenida=1&next=${enc(destinoFinal)}`;
  }

  return destinoFinal;
}
