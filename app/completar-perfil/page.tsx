'use client';
import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogoMark } from '@/components/Logo';
import { IconShield, IconPhoto, IconCheck, IconKey } from '@/components/Icons';
import { validarDocumentoIdentidad } from '@/lib/validacion';
import { useSession } from '@/contexts/SessionContext';

// Pantalla "Completa tu perfil" — se muestra a cuentas creadas por Google (que
// entran con password vacía y sin documento/fecha de nacimiento) antes de poder
// reservar o publicar un vehículo. El resto del sitio (navegar, ver vehículos,
// chatear) sigue funcionando sin pasar por acá: la autoridad real que exige esto
// es el servidor, en app/api/reservas y app/api/vehiculos (lib/perfil.ts) — esta
// pantalla es solo la forma cómoda de resolverlo.
//
// El atajo de foto de cédula es SIEMPRE opcional (igual que en /registro): quien
// no quiera usarlo escribe los 3 campos a mano. Leerla con IA NO verifica la
// identidad de nadie, solo transcribe para ahorrar tipeo.

type MeUser = {
  id: number; nombre: string; correo: string; rol: string;
  tipo_documento?: string; documento_identidad?: string; fecha_nacimiento?: string;
  password_configurada?: boolean; perfil_completo?: boolean;
};

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

type CampoIA = 'tipo_documento' | 'documento_identidad' | 'fecha_nacimiento';
type DatosDocumento = { tipo_documento: string | null; documento_identidad: string | null; fecha_nacimiento: string | null };

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

function destinoPorRol(rol: string): string {
  if (rol === 'admin') return '/dashboard/admin';
  if (rol === 'propietario') return '/dashboard/propietario';
  return '/dashboard/usuario';
}

// El parámetro ?next= viene de la URL (potencialmente controlada por un
// atacante en un enlace compartido): solo se acepta si es una ruta interna
// (empieza por "/" y no por "//", que sería una protocol-relative URL hacia
// otro host) para evitar un open redirect tras autenticar/completar perfil.
function destinoSeguro(next: string | null, rol: string): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return destinoPorRol(rol);
}

function CompletarPerfilForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refetch } = useSession();

  const [cargando, setCargando] = useState(true);
  const [user, setUser] = useState<MeUser | null>(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [perfil, setPerfil] = useState({ tipo_documento: 'cedula', documento_identidad: '', fecha_nacimiento: '' });

  // ── Atajo opcional: leer la foto de la cédula ──
  const [iaDisponible, setIaDisponible] = useState(false);
  const [consiente, setConsiente] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [errorIA, setErrorIA] = useState('');
  const [avisoIA, setAvisoIA] = useState('');
  const [camposIA, setCamposIA] = useState<Set<CampoIA>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/registro/extraer-documento')
      .then(r => r.json())
      .then(d => { if (vivo) setIaDisponible(!!d?.disponible); })
      .catch(() => {});
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (!vivo) return;
        const u = d?.user as MeUser | null;
        if (!u) { router.replace('/login'); return; }
        if (u.rol === 'admin' || u.perfil_completo) {
          router.replace(destinoSeguro(searchParams.get('next'), u.rol));
          return;
        }
        setUser(u);
        setPerfil(p => ({
          ...p,
          tipo_documento: u.tipo_documento || 'cedula',
          documento_identidad: u.documento_identidad || '',
          fecha_nacimiento: u.fecha_nacimiento || '',
        }));
        setCargando(false);
      })
      .catch(() => { if (vivo) { setError('Sin conexión — revisa tu internet e intenta de nuevo.'); setCargando(false); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const desmarcarCampo = (campo: CampoIA) => {
    setCamposIA(prev => {
      if (!prev.has(campo)) return prev;
      const copia = new Set(prev);
      copia.delete(campo);
      return copia;
    });
  };

  const leerDocumento = async (file: File) => {
    setErrorIA(''); setAvisoIA(''); setError('');
    setLeyendo(true);
    try {
      const imagen = await prepararImagen(file);
      const fd = new FormData();
      fd.append('file', imagen, 'cedula.jpg');
      fd.append('tipo', 'cedula');
      fd.append('consiente', String(consiente));
      const res = await fetch('/api/registro/extraer-documento', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorIA(data.error || 'No pudimos leer la foto. Puedes escribir tus datos a mano.');
        return;
      }

      const datos = (data.datos || {}) as DatosDocumento;
      const marcados = new Set(camposIA);
      setPerfil(f => {
        const nuevo = { ...f };
        if (datos.tipo_documento && DOC_TIPOS.some(t => t.value === datos.tipo_documento)) {
          nuevo.tipo_documento = datos.tipo_documento; marcados.add('tipo_documento');
        }
        if (datos.documento_identidad) { nuevo.documento_identidad = datos.documento_identidad; marcados.add('documento_identidad'); }
        if (datos.fecha_nacimiento)    { nuevo.fecha_nacimiento = datos.fecha_nacimiento;       marcados.add('fecha_nacimiento'); }
        return nuevo;
      });
      setCamposIA(marcados);

      const noLeidos: string[] = Array.isArray(data.campos_no_leidos) ? data.campos_no_leidos : [];
      let aviso = 'Listo, leímos tu documento. Revisa los datos y corrige lo que haga falta.';
      if (noLeidos.length) aviso += ` No pudimos leer: ${noLeidos.join(', ')}.`;
      if (data.confianza === 'baja') aviso += ' La foto quedó poco nítida, revisa con calma cada dato.';
      setAvisoIA(aviso);
    } catch {
      setErrorIA('Sin conexión — revisa tu internet o escribe tus datos a mano.');
    } finally {
      setLeyendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const necesitaPassword = !user?.password_configurada;
    if (necesitaPassword) {
      if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
      if (password !== confirmar) { setError('Las contraseñas no coinciden.'); return; }
    }
    const errDoc = validarDocumentoIdentidad(perfil.tipo_documento, perfil.documento_identidad);
    if (errDoc) { setError(errDoc); return; }
    if (!perfil.fecha_nacimiento) { setError('Ingresa tu fecha de nacimiento.'); return; }
    if (calcularEdad(perfil.fecha_nacimiento) < 18) { setError('Debes ser mayor de 18 años.'); return; }

    setEnviando(true);
    try {
      const res = await fetch('/api/auth/completar-perfil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(necesitaPassword ? { password } : {}),
          tipo_documento: perfil.tipo_documento,
          documento_identidad: perfil.documento_identidad,
          fecha_nacimiento: perfil.fecha_nacimiento,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No pudimos guardar tu perfil. Intenta de nuevo.'); return; }
      refetch();
      router.push(destinoSeguro(searchParams.get('next'), user?.rol || 'usuario'));
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const inputCls = "w-full border border-border rounded-xl px-4 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40";
  const clsCampo = (campo: CampoIA) => `${inputCls} ${camposIA.has(campo) ? 'border-accent/50 bg-accent-light/40' : ''}`;
  const marcaIA = (campo: CampoIA) => camposIA.has(campo) ? (
    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-accent normal-case tracking-normal">
      <IconCheck size={10} /> de tu foto
    </span>
  ) : null;

  if (cargando) {
    return <div className="text-center py-20 text-ink/50">Cargando...</div>;
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center mb-1">
          <div className="flex flex-col items-center gap-2">
            <LogoMark size={48} />
            <span className="text-ink font-bold text-xl">Drive<span className="text-accent">Pass</span></span>
          </div>
        </div>

        <div className="bg-surface-2 rounded-3xl shadow-sm border border-border p-5 sm:p-7">
          <h1 className="text-lg font-bold text-ink mb-0.5 flex items-center gap-2">
            <IconShield size={18} className="text-accent" /> Completa tu perfil
          </h1>
          <p className="text-ink/50 text-sm mb-5">
            Creaste tu cuenta con Google — nos falta tu identidad para poder {user?.rol === 'propietario' ? 'publicar un vehículo' : 'confirmar una reserva'}.
          </p>

          {error && (
            <div className="bg-danger/10 text-danger px-4 py-2.5 rounded-xl mb-4 text-sm border border-danger/25">
              {error}
            </div>
          )}

          {iaDisponible && (
            <div className="rounded-2xl border-2 border-dashed border-accent/40 bg-accent-light/50 p-4 mb-4">
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
                  <IconPhoto size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-ink text-sm">Complétalo en 10 segundos</p>
                  <p className="text-xs text-ink/60 mt-0.5 leading-relaxed">
                    Toma una foto de tu cédula y llenamos el documento y la fecha de nacimiento por ti.
                    Revisas los datos y corriges lo que haga falta.
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
                  se descarta. Esto no verifica mi identidad. (Tratamiento de datos personales — Ley 1581 de 2012).
                </span>
              </label>

              <input ref={inputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) leerDocumento(f); }} />

              <button type="button"
                onClick={() => inputRef.current?.click()}
                disabled={!consiente || leyendo}
                className="w-full mt-3 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-3 rounded-xl transition">
                {leyendo ? 'Leyendo tu documento…' : 'Foto de mi cédula'}
              </button>

              {!consiente && (
                <p className="text-[11px] text-ink/45 mt-2">Marca la casilla para poder subir la foto.</p>
              )}
              {avisoIA && (
                <p className="text-[11px] text-success mt-2 flex items-start gap-1.5">
                  <IconCheck size={12} className="flex-shrink-0 mt-0.5" /> <span>{avisoIA}</span>
                </p>
              )}
              {errorIA && <p className="text-[11px] text-danger mt-2">{errorIA}</p>}
              <p className="text-[11px] text-ink/45 mt-2">¿Prefieres escribirlo tú? Llena los campos de abajo, es igual de válido.</p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {!user?.password_configurada && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Crea una contraseña</label>
                  <input type="password" required autoComplete="new-password" placeholder="Mínimo 6 caracteres"
                    className={inputCls} value={password} onChange={e => setPassword(e.target.value)} />
                  <p className="text-[11px] text-ink/50 mt-1">Te sirve para entrar sin Google si algún día lo necesitas.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Confirmar contraseña</label>
                  <input type="password" required autoComplete="new-password"
                    className={`${inputCls} ${confirmar && confirmar !== password ? 'border-danger/30 focus:ring-danger/40' : ''}`}
                    value={confirmar} onChange={e => setConfirmar(e.target.value)} />
                  {confirmar && confirmar !== password && (
                    <p className="text-[11px] text-danger mt-1">Las contraseñas no coinciden</p>
                  )}
                </div>
              </>
            )}

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
                    const limpio = perfil.tipo_documento === 'cedula'
                      ? e.target.value.replace(/\D/g, '')
                      : e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                    setPerfil(f => ({ ...f, documento_identidad: limpio }));
                  }} />
              </div>
            </div>

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

            <button type="submit" disabled={enviando}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 rounded-xl font-bold transition shadow-md shadow-accent/20 disabled:opacity-60 mt-2">
              <IconKey size={16} />
              {enviando ? 'Guardando…' : 'Guardar y continuar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function CompletarPerfilPage() {
  return (
    <Suspense>
      <CompletarPerfilForm />
    </Suspense>
  );
}
