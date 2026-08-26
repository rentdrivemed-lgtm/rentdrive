'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { IconKey, IconCar, IconUser, IconArrowR, IconArrowL, IconShield, IconPhoto, IconCheck } from '@/components/Icons';
import { tomarDestino } from '@/lib/lugares';
import { validarCelular, validarDocumentoIdentidad, PAIS_TEL_DEFAULT } from '@/lib/validacion';
import TelefonoInput from '@/components/TelefonoInput';
import GoogleAuthButton from '@/components/GoogleAuthButton';
import { useSession } from '@/contexts/SessionContext';

type Rol = 'usuario' | 'propietario';
type SesionUser = { id: number; nombre: string; correo: string; rol: string };

// Mismo chequeo que hace GoogleAuthButton (para no dejar un divisor "o" colgando
// sin nada debajo mientras el dueño no haya configurado Google Cloud todavía).
const GOOGLE_ENABLED = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

const DOC_TIPOS = [
  { value: 'cedula',      label: 'Cédula de ciudadanía' },
  { value: 'cedula_ext',  label: 'Cédula de extranjería' },
  { value: 'pasaporte',   label: 'Pasaporte' },
];

function calcularEdad(fechaNac: string): number {
  if (!fechaNac) return 0;
  const hoy = new Date();
  const nac = new Date(fechaNac);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

// Campos que el atajo de la foto puede autocompletar. Se marcan en pantalla para
// que la persona sepa qué salió de la imagen y lo revise antes de enviar.
type CampoIA = 'nombre' | 'tipo_documento' | 'documento_identidad' | 'fecha_nacimiento' | 'numero_licencia';

type DatosDocumento = {
  nombre: string | null;
  tipo_documento: string | null;
  documento_identidad: string | null;
  fecha_nacimiento: string | null;
  numero_licencia: string | null;
  categoria_licencia: string | null;
};

/**
 * Reduce la foto antes de mandarla: menos megas por la red del celular y menos
 * costo de lectura. Si el navegador no puede decodificar el archivo (por ejemplo
 * un HEIC de iPhone en un navegador que no lo soporta), se manda tal cual y el
 * servidor responde con un mensaje claro.
 */
async function prepararImagen(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const LADO_MAX = 1600;
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto  = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement('canvas');
    canvas.width = ancho; canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>(resolver => canvas.toBlob(resolver, 'image/jpeg', 0.85));
    return blob || file;
  } catch {
    return file;
  }
}

const hoy = new Date();
const maxNacimiento = `${hoy.getFullYear() - 18}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

function RegistroForm() {
  const [rol, setRol] = useState<Rol>('usuario');
  const [paso, setPaso] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, refetch } = useSession();

  const [cuenta, setCuenta] = useState({
    nombre: '', correo: '', password: '', confirmar: '',
  });
  const [codigoReferido, setCodigoReferido] = useState('');
  // Registro corto: dirección, ciudad y contacto de emergencia se piden en la
  // reserva (que es cuando se necesitan), no aquí.
  const [perfil, setPerfil] = useState({
    tipo_documento: 'cedula',
    documento_identidad: '',
    fecha_nacimiento: '',
    celular: '',
    celular_indicativo: PAIS_TEL_DEFAULT,
    numero_licencia: '',
  });

  /* ── Atajo opcional: leer la foto del documento ──
     Es SIEMPRE opcional. Quien no tenga el documento a mano (o simplemente no
     quiera subirlo) llena el formulario a mano exactamente como antes.
     Y ojo: que la IA lea la cédula NO verifica la identidad de nadie — solo
     transcribe para ahorrar tipeo. La verificación real ocurre después, con los
     documentos de la reserva y la revisión del equipo. */
  const [iaDisponible, setIaDisponible] = useState(false);
  const [consiente, setConsiente] = useState(false);
  const [leyendo, setLeyendo] = useState<'cedula' | 'licencia' | null>(null);
  const [errorIA, setErrorIA] = useState('');
  const [avisoIA, setAvisoIA] = useState('');
  const [camposIA, setCamposIA] = useState<Set<CampoIA>>(new Set());
  const inputCedulaRef = useRef<HTMLInputElement>(null);
  const inputLicenciaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/registro/extraer-documento')
      .then(r => r.json())
      .then(d => { if (vivo) setIaDisponible(!!d?.disponible); })
      .catch(() => { /* sin atajo: el formulario manual funciona igual */ });
    return () => { vivo = false; };
  }, []);

  const desmarcarCampo = (campo: CampoIA) => {
    setCamposIA(prev => {
      if (!prev.has(campo)) return prev;
      const copia = new Set(prev);
      copia.delete(campo);
      return copia;
    });
  };

  const leerDocumento = async (file: File, tipo: 'cedula' | 'licencia') => {
    setErrorIA(''); setAvisoIA(''); setError('');
    setLeyendo(tipo);
    try {
      const imagen = await prepararImagen(file);
      const fd = new FormData();
      fd.append('file', imagen, 'documento.jpg');
      fd.append('tipo', tipo);
      // El botón ya está deshabilitado sin la casilla marcada, pero el
      // enforcement real vive en el servidor (ver route.ts): esto es lo que
      // ese endpoint valida, no la deshabilitación del botón.
      fd.append('consiente', String(consiente));
      const res = await fetch('/api/registro/extraer-documento', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorIA(data.error || 'No pudimos leer la foto. Puedes escribir tus datos a mano.');
        return;
      }

      const datos = (data.datos || {}) as DatosDocumento;
      const marcados = new Set(camposIA);

      if (datos.nombre) { setCuenta(c => ({ ...c, nombre: datos.nombre as string })); marcados.add('nombre'); }
      setPerfil(f => {
        const nuevo = { ...f };
        if (datos.tipo_documento && DOC_TIPOS.some(t => t.value === datos.tipo_documento)) {
          nuevo.tipo_documento = datos.tipo_documento; marcados.add('tipo_documento');
        }
        if (datos.documento_identidad) { nuevo.documento_identidad = datos.documento_identidad; marcados.add('documento_identidad'); }
        if (datos.fecha_nacimiento)    { nuevo.fecha_nacimiento = datos.fecha_nacimiento;       marcados.add('fecha_nacimiento'); }
        if (datos.numero_licencia)     { nuevo.numero_licencia = datos.numero_licencia;         marcados.add('numero_licencia'); }
        return nuevo;
      });
      setCamposIA(marcados);

      const noLeidos: string[] = Array.isArray(data.campos_no_leidos) ? data.campos_no_leidos : [];
      const etiqueta = tipo === 'cedula' ? 'tu documento' : 'tu licencia';
      let aviso = `Listo, leímos ${etiqueta}. Revisa los datos y corrige lo que haga falta.`;
      if (noLeidos.length) aviso += ` No pudimos leer: ${noLeidos.join(', ')}.`;
      if (data.confianza === 'baja') aviso += ' La foto quedó poco nítida, revisa con calma cada dato.';
      setAvisoIA(aviso);
    } catch {
      setErrorIA('Sin conexión — revisa tu internet o escribe tus datos a mano.');
    } finally {
      setLeyendo(null);
      if (inputCedulaRef.current) inputCedulaRef.current.value = '';
      if (inputLicenciaRef.current) inputLicenciaRef.current.value = '';
    }
  };

  useEffect(() => {
    if (searchParams.get('rol') === 'propietario') setRol('propietario');
    const nombre = searchParams.get('nombre');
    const correo = searchParams.get('correo');
    const celular = searchParams.get('celular');
    if (nombre || correo) setCuenta(c => ({ ...c, nombre: nombre || c.nombre, correo: correo || c.correo }));
    if (celular) setPerfil(p => ({ ...p, celular }));
    const ref = searchParams.get('ref');
    if (ref) setCodigoReferido(ref.toUpperCase());
  }, [searchParams]);

  /* ── Validación paso 1 ── */
  const validarPaso1 = (): string => {
    if (!cuenta.nombre.trim())  return 'Ingresa tu nombre completo.';
    if (!cuenta.correo.trim())  return 'Ingresa tu correo electrónico.';
    if (!/\S+@\S+\.\S+/.test(cuenta.correo)) return 'El correo no es válido.';
    if (cuenta.password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
    if (cuenta.password !== cuenta.confirmar) return 'Las contraseñas no coinciden.';
    return '';
  };

  /* ── Validación paso 2 ── */
  const validarPaso2 = (): string => {
    const errDoc = validarDocumentoIdentidad(perfil.tipo_documento, perfil.documento_identidad);
    if (errDoc) return errDoc;
    if (!perfil.fecha_nacimiento)           return 'Ingresa tu fecha de nacimiento.';
    if (calcularEdad(perfil.fecha_nacimiento) < 18) return 'Debes ser mayor de 18 años para registrarte.';
    const errCel = validarCelular(perfil.celular_indicativo, perfil.celular);
    if (errCel) return errCel;
    return '';
  };

  const avanzar = () => {
    const err = validarPaso1();
    if (err) { setError(err); return; }
    setError('');
    setPaso(2);
  };

  // Google crea (o vincula) la cuenta directo en el servidor, sin pasar por los 2
  // pasos del formulario (documento, celular, dirección quedan vacíos por ahora —
  // se pueden completar luego desde el perfil).
  const entrarConGoogle = (user: SesionUser) => {
    setUser(user);
    refetch();
    const destino = tomarDestino();
    if (destino && user.rol === 'usuario') { router.push(destino); return; }
    router.push(user.rol === 'propietario' ? '/dashboard/propietario' : '/dashboard/usuario');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validarPaso2();
    if (err) { setError(err); return; }
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cuenta, ...perfil, rol, codigo_referido: codigoReferido }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No pudimos completar el registro. Intenta de nuevo.'); return; }
      // Si venía de reservar, retoma el pago (solo arrendatarios).
      const destino = tomarDestino();
      if (destino && rol === 'usuario') { router.push(destino); return; }
      router.push(rol === 'propietario' ? '/dashboard/propietario' : '/dashboard/usuario');
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full border border-border rounded-xl px-4 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40";
  // Un campo que vino de la foto se resalta y se etiqueta: la persona tiene que
  // poder ver de un vistazo qué escribió la IA para revisarlo antes de enviar.
  const clsCampo = (campo: CampoIA) => `${inputCls} ${camposIA.has(campo) ? 'border-accent/50 bg-accent-light/40' : ''}`;
  const marcaIA = (campo: CampoIA) => camposIA.has(campo) ? (
    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-accent normal-case tracking-normal">
      <IconCheck size={10} /> de tu foto
    </span>
  ) : null;

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-md space-y-4">

        {/* Logo */}
        <div className="flex justify-center mb-1">
          <div className="flex flex-col items-center gap-2">
            <LogoMark size={48} />
            <span className="text-ink font-bold text-xl">Drive<span className="text-accent">Pass</span></span>
          </div>
        </div>

        {/* Selector de rol */}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => { setRol('usuario'); setPaso(1); setError(''); }}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition font-medium text-sm ${
              rol === 'usuario'
                ? 'border-accent bg-accent text-white shadow-lg shadow-accent/25'
                : 'border-border bg-surface-2 text-ink/60 hover:border-brand/30 hover:bg-surface'
            }`}>
            <IconKey size={22} />
            <span>Quiero alquilar</span>
          </button>
          <button type="button" onClick={() => { setRol('propietario'); setPaso(1); setError(''); }}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition font-medium text-sm ${
              rol === 'propietario'
                ? 'border-brand bg-brand text-white shadow-lg shadow-brand/25'
                : 'border-border bg-surface-2 text-ink/60 hover:border-brand/30 hover:bg-surface'
            }`}>
            <IconCar size={22} />
            <span>Soy propietario</span>
          </button>
        </div>

        {/* Formulario */}
        <div className="bg-surface-2 rounded-3xl shadow-sm border border-border p-5 sm:p-7">

          {/* Barra de progreso */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition ${
                paso >= 1 ? 'bg-accent text-white' : 'bg-surface text-ink/50 border border-border'
              }`}>
                {paso > 1 ? '✓' : '1'}
              </div>
              <div className={`h-1 flex-1 rounded-full transition ${paso > 1 ? 'bg-accent' : 'bg-border'}`} />
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition ${
                paso >= 2 ? 'bg-accent text-white' : 'bg-surface text-ink/50 border border-border'
              }`}>2</div>
            </div>
            <span className="text-xs text-ink/50 flex-shrink-0">Paso {paso} de 2</span>
          </div>

          {/* Encabezado del paso */}
          {paso === 1 ? (
            <>
              <h1 className="text-lg font-bold text-ink mb-0.5 flex items-center gap-2">
                <IconUser size={18} className="text-accent" /> Tu cuenta
              </h1>
              <p className="text-ink/50 text-sm mb-5">Datos de acceso a DrivePass</p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-ink mb-0.5 flex items-center gap-2">
                <IconShield size={18} className="text-accent" /> Tu identidad
              </h1>
              <p className="text-ink/50 text-sm mb-5">Información personal para verificación</p>
            </>
          )}

          {error && (
            <div className="bg-danger/10 text-danger px-4 py-2.5 rounded-xl mb-4 text-sm border border-danger/25">
              {error}
            </div>
          )}

          {/* ── PASO 1: Cuenta ── */}
          {paso === 1 && (
            <div className="space-y-4">

              {/* ── Atajo opcional: leer el documento con IA ──
                  Nunca obligatorio: es un acelerador. Si no está disponible (sin
                  clave de IA) simplemente no se muestra y el formulario manual
                  sigue igual. */}
              {iaDisponible && (
                <div className="rounded-2xl border-2 border-dashed border-accent/40 bg-accent-light/50 p-4">
                  <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
                      <IconPhoto size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-ink text-sm">Regístrate en 30 segundos</p>
                      <p className="text-xs text-ink/60 mt-0.5 leading-relaxed">
                        Toma una foto de tu cédula{rol === 'usuario' ? ' y de tu licencia' : ''} y llenamos el formulario por ti.
                        Después revisas los datos y corriges lo que haga falta.
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 mt-3 cursor-pointer select-none">
                    <input type="checkbox" checked={consiente}
                      onChange={e => setConsiente(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-accent flex-shrink-0" />
                    <span className="text-[11px] text-ink/60 leading-relaxed">
                      Autorizo a DrivePass a leer la foto de mi documento con un servicio de inteligencia artificial,
                      con el único fin de llenar este formulario. La imagen no se guarda: se usa para leer los datos y
                      se descarta. Esto no verifica mi identidad ni reemplaza los documentos que se piden al reservar.
                      Puedo registrarme sin subir ninguna foto, escribiendo mis datos a mano.
                      (Tratamiento de datos personales — Ley 1581 de 2012).
                    </span>
                  </label>

                  <input ref={inputCedulaRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) leerDocumento(f, 'cedula'); }} />
                  <input ref={inputLicenciaRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) leerDocumento(f, 'licencia'); }} />

                  <div className={`grid gap-2 mt-3 ${rol === 'usuario' ? 'sm:grid-cols-2' : ''}`}>
                    <button type="button"
                      onClick={() => inputCedulaRef.current?.click()}
                      disabled={!consiente || leyendo !== null}
                      className="flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-3 rounded-xl transition">
                      {leyendo === 'cedula' ? 'Leyendo tu documento…' : 'Foto de mi cédula'}
                    </button>
                    {rol === 'usuario' && (
                      <button type="button"
                        onClick={() => inputLicenciaRef.current?.click()}
                        disabled={!consiente || leyendo !== null}
                        className="flex items-center justify-center gap-2 border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 px-3 rounded-xl transition bg-surface-2">
                        {leyendo === 'licencia' ? 'Leyendo tu licencia…' : 'Foto de mi licencia'}
                      </button>
                    )}
                  </div>

                  {!consiente && (
                    <p className="text-[11px] text-ink/45 mt-2">Marca la casilla para poder subir la foto.</p>
                  )}
                  {avisoIA && (
                    <p className="text-[11px] text-success mt-2 flex items-start gap-1.5">
                      <IconCheck size={12} className="flex-shrink-0 mt-0.5" /> <span>{avisoIA}</span>
                    </p>
                  )}
                  {errorIA && (
                    <p className="text-[11px] text-danger mt-2">{errorIA}</p>
                  )}
                  <p className="text-[11px] text-ink/45 mt-2">
                    ¿Prefieres escribirlo tú? Llena el formulario de abajo, es igual de válido.
                  </p>
                </div>
              )}

              {GOOGLE_ENABLED && (
                <>
                  <GoogleAuthButton
                    rol={rol}
                    codigoReferido={codigoReferido}
                    onSuccess={entrarConGoogle}
                    onError={msg => setError(msg)}
                  />
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[11px] text-ink/40 uppercase tracking-wide">o con tu correo</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                  Nombre completo {marcaIA('nombre')}
                </label>
                <input type="text" required autoComplete="name" placeholder="Como aparece en tu documento"
                  className={clsCampo('nombre')} value={cuenta.nombre}
                  onChange={e => { desmarcarCampo('nombre'); setCuenta(f => ({ ...f, nombre: e.target.value })); }} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Correo electrónico</label>
                <input type="email" required autoComplete="email"
                  className={inputCls} value={cuenta.correo}
                  onChange={e => setCuenta(f => ({ ...f, correo: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Contraseña</label>
                <input type="password" required autoComplete="new-password" placeholder="Mínimo 6 caracteres"
                  className={inputCls} value={cuenta.password}
                  onChange={e => setCuenta(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Confirmar contraseña</label>
                <input type="password" required autoComplete="new-password"
                  className={`${inputCls} ${cuenta.confirmar && cuenta.confirmar !== cuenta.password ? 'border-danger/30 focus:ring-danger/40' : ''}`}
                  value={cuenta.confirmar}
                  onChange={e => setCuenta(f => ({ ...f, confirmar: e.target.value }))} />
                {cuenta.confirmar && cuenta.confirmar !== cuenta.password && (
                  <p className="text-[11px] text-danger mt-1">Las contraseñas no coinciden</p>
                )}
                {cuenta.confirmar && cuenta.confirmar === cuenta.password && (
                  <p className="text-[11px] text-success mt-1">✓ Las contraseñas coinciden</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                  Código de referido <span className="font-normal text-ink/40 normal-case">(opcional)</span>
                </label>
                <input type="text" placeholder="Ej. CAMILA4821"
                  className={inputCls} value={codigoReferido}
                  onChange={e => setCodigoReferido(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
                <p className="text-[11px] text-ink/50 mt-1">Si un amigo te invitó, pon su código y ambos ganan un descuento.</p>
              </div>
              <button type="button" onClick={avanzar}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-md shadow-accent/20 mt-2">
                Siguiente <IconArrowR size={16} />
              </button>
            </div>
          )}

          {/* ── PASO 2: Identidad ── */}
          {paso === 2 && (
            <form onSubmit={submit} className="space-y-4">

              {/* Documento */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                    Tipo de documento {marcaIA('tipo_documento')}
                  </label>
                  <select className={clsCampo('tipo_documento')} value={perfil.tipo_documento}
                    onChange={e => { desmarcarCampo('tipo_documento'); setPerfil(f => ({ ...f, tipo_documento: e.target.value })); }}>
                    {DOC_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                    Número {marcaIA('documento_identidad')}
                  </label>
                  <input type="text" required
                    placeholder={perfil.tipo_documento === 'pasaporte' ? 'AB1234567' : '1234567890'}
                    className={clsCampo('documento_identidad')} value={perfil.documento_identidad}
                    onChange={e => {
                      desmarcarCampo('documento_identidad');
                      // La cédula colombiana es solo dígitos; pasaporte/cédula de extranjería sí pueden traer letras.
                      const limpio = perfil.tipo_documento === 'cedula'
                        ? e.target.value.replace(/\D/g, '')
                        : e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                      setPerfil(f => ({ ...f, documento_identidad: limpio }));
                    }} />
                </div>
              </div>

              {/* Nacimiento + celular */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                    Fecha de nacimiento {marcaIA('fecha_nacimiento')}
                  </label>
                  <input type="date" required max={maxNacimiento}
                    className={clsCampo('fecha_nacimiento')} value={perfil.fecha_nacimiento}
                    onChange={e => { desmarcarCampo('fecha_nacimiento'); setPerfil(f => ({ ...f, fecha_nacimiento: e.target.value })); }} />
                  {perfil.fecha_nacimiento && (
                    <p className="text-[11px] text-ink/50 mt-1">{calcularEdad(perfil.fecha_nacimiento)} años</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Celular</label>
                  <TelefonoInput
                    indicativo={perfil.celular_indicativo}
                    numero={perfil.celular}
                    onChangeIndicativo={dial => setPerfil(f => ({ ...f, celular_indicativo: dial }))}
                    onChangeNumero={num => setPerfil(f => ({ ...f, celular: num }))}
                  />
                </div>
              </div>

              {/* Licencia — requerida para arrendatarios */}
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                  Número de licencia de conducción
                  {rol === 'usuario' && <span className="text-accent ml-1">*</span>}
                  {rol === 'propietario' && <span className="font-normal text-ink/40 ml-1">(opcional)</span>}
                  {marcaIA('numero_licencia')}
                </label>
                <input type="text" required={rol === 'usuario'} placeholder="Ej: 80123456"
                  className={clsCampo('numero_licencia')} value={perfil.numero_licencia}
                  onChange={e => { desmarcarCampo('numero_licencia'); setPerfil(f => ({ ...f, numero_licencia: e.target.value })); }} />
                <p className="text-[11px] text-ink/50 mt-1">
                  {rol === 'usuario'
                    ? 'Requerido para poder realizar reservas de vehículos.'
                    : 'Solo si también deseas alquilar vehículos de otros propietarios.'}
                </p>
              </div>

              {/* Botones */}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setPaso(1); setError(''); }}
                  className="flex items-center gap-1.5 border border-border text-ink/60 hover:text-ink hover:bg-surface px-4 py-2.5 rounded-xl text-sm font-medium transition">
                  <IconArrowL size={15} /> Anterior
                </button>
                <button type="submit" disabled={loading}
                  className={`flex-1 flex items-center justify-center gap-2 text-white py-2.5 rounded-xl font-bold transition shadow-md disabled:opacity-60 ${
                    rol === 'propietario'
                      ? 'bg-brand hover:bg-brand-hover shadow-brand/20'
                      : 'bg-accent hover:bg-accent-hover shadow-accent/20'
                  }`}>
                  <IconKey size={16} />
                  {loading ? 'Creando cuenta…' : 'Crear cuenta'}
                </button>
              </div>
            </form>
          )}

          <p className="text-center text-sm text-ink/50 mt-5">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-accent font-semibold hover:text-accent-hover transition">
              Inicia sesión
            </Link>
          </p>
        </div>

      </div>
    </div>
  );
}

export default function RegistroPage() {
  return (
    <Suspense>
      <RegistroForm />
    </Suspense>
  );
}
