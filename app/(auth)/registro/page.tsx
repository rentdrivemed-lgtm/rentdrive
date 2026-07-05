'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { IconKey, IconCar, IconUser, IconArrowR, IconArrowL, IconShield } from '@/components/Icons';
import { tomarDestino } from '@/lib/lugares';
import { validarCelular, validarDireccion, validarDocumentoIdentidad, PAIS_TEL_DEFAULT } from '@/lib/validacion';
import TelefonoInput from '@/components/TelefonoInput';

type Rol = 'usuario' | 'propietario';

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

const hoy = new Date();
const maxNacimiento = `${hoy.getFullYear() - 18}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

function RegistroForm() {
  const [rol, setRol] = useState<Rol>('usuario');
  const [paso, setPaso] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cuenta, setCuenta] = useState({
    nombre: '', correo: '', password: '', confirmar: '',
  });
  const [codigoReferido, setCodigoReferido] = useState('');
  const [perfil, setPerfil] = useState({
    tipo_documento: 'cedula',
    documento_identidad: '',
    fecha_nacimiento: '',
    celular: '',
    celular_indicativo: PAIS_TEL_DEFAULT,
    direccion: '',
    ciudad: 'Medellín',
    numero_licencia: '',
    emergencia_nombre: '',
    emergencia_tel: '',
  });

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
    const errDir = validarDireccion(perfil.direccion);
    if (errDir) return errDir;
    if (!perfil.ciudad.trim())              return 'Ingresa tu ciudad.';
    return '';
  };

  const avanzar = () => {
    const err = validarPaso1();
    if (err) { setError(err); return; }
    setError('');
    setPaso(2);
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
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Nombre completo</label>
                <input type="text" required autoComplete="name" placeholder="Como aparece en tu documento"
                  className={inputCls} value={cuenta.nombre}
                  onChange={e => setCuenta(f => ({ ...f, nombre: e.target.value }))} />
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
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Tipo de documento</label>
                  <select className={inputCls} value={perfil.tipo_documento}
                    onChange={e => setPerfil(f => ({ ...f, tipo_documento: e.target.value }))}>
                    {DOC_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Número</label>
                  <input type="text" required
                    placeholder={perfil.tipo_documento === 'pasaporte' ? 'AB1234567' : '1234567890'}
                    className={inputCls} value={perfil.documento_identidad}
                    onChange={e => {
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
                  <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Fecha de nacimiento</label>
                  <input type="date" required max={maxNacimiento}
                    className={inputCls} value={perfil.fecha_nacimiento}
                    onChange={e => setPerfil(f => ({ ...f, fecha_nacimiento: e.target.value }))} />
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

              {/* Dirección */}
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Dirección residencial</label>
                <input type="text" required placeholder="Calle 10 # 43A-15, Apto 301"
                  className={inputCls} value={perfil.direccion}
                  onChange={e => setPerfil(f => ({ ...f, direccion: e.target.value }))} />
              </div>

              {/* Ciudad */}
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">Ciudad / Municipio</label>
                <input type="text" required placeholder="Medellín"
                  className={inputCls} value={perfil.ciudad}
                  onChange={e => setPerfil(f => ({ ...f, ciudad: e.target.value }))} />
              </div>

              {/* Licencia — requerida para arrendatarios */}
              <div>
                <label className="block text-xs font-semibold text-ink/60 mb-1.5 uppercase tracking-wide">
                  Número de licencia de conducción
                  {rol === 'usuario' && <span className="text-accent ml-1">*</span>}
                  {rol === 'propietario' && <span className="font-normal text-ink/40 ml-1">(opcional)</span>}
                </label>
                <input type="text" required={rol === 'usuario'} placeholder="Ej: 80123456"
                  className={inputCls} value={perfil.numero_licencia}
                  onChange={e => setPerfil(f => ({ ...f, numero_licencia: e.target.value }))} />
                <p className="text-[11px] text-ink/50 mt-1">
                  {rol === 'usuario'
                    ? 'Requerido para poder realizar reservas de vehículos.'
                    : 'Solo si también deseas alquilar vehículos de otros propietarios.'}
                </p>
              </div>

              {/* Contacto de emergencia */}
              <div className="bg-surface rounded-xl p-3 border border-border space-y-3">
                <p className="text-xs font-bold text-ink/60 uppercase tracking-wide">Contacto de emergencia</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-ink/50 mb-1">Nombre</label>
                    <input type="text" placeholder="Familiar o amigo"
                      className={inputCls} value={perfil.emergencia_nombre}
                      onChange={e => setPerfil(f => ({ ...f, emergencia_nombre: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-ink/50 mb-1">Teléfono</label>
                    <input type="tel" placeholder="3001234567"
                      className={inputCls} value={perfil.emergencia_tel}
                      onChange={e => setPerfil(f => ({ ...f, emergencia_tel: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                  </div>
                </div>
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
