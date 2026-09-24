'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { IconArrowL, IconShield, IconPin } from '@/components/Icons';
import DocUploadDoble from '@/components/DocUploadDoble';
import { LUGAR_VACIO, calcularRecargo, lugarResumen, cargarLugares, type Lugar } from '@/lib/lugares';
import { validarDireccion, validarCiudad, validarNombreContacto, validarTelefonoContacto } from '@/lib/validacion';
import { diasRestringidosEnRango, parsePicoPlaca, picoPlacaVacio, type PicoPlaca } from '@/lib/pico-placa';
import { factorDuracion, DESCUENTO_DURACION_PCT } from '@/lib/rentabilidad';
import { METODOS_PAGO_WEB, METODO_PAGO_WEB_LABEL, METODO_PAGO_WEB_AYUDA, type MetodoPagoWeb } from '@/lib/metodo-pago-web';
import { openCardTokenizer } from '@/lib/wompi-widget-client';

type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number;
  tipo: string; precio_dia: number; ubicacion: string;
  // Deciden qué días no se cobran por pico y placa (ver lib/pico-placa.ts).
  placa?: string; combustible?: string; exencion_pico_placa_inscrita?: number;
};
type User = {
  id: number; nombre: string; rol: string; creditos_referido?: number;
  direccion?: string; ciudad?: string; contacto_emergencia?: string;
  tipo_documento?: string;
  cedula_url?: string; cedula_url_dorso?: string; licencia_url?: string;
};

function PagoContent() {
  const params = useSearchParams();
  const router = useRouter();

  const vehiculo_id  = params.get('vehiculo_id');
  const fecha_inicio = params.get('fecha_inicio');
  const fecha_fin    = params.get('fecha_fin');

  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  // Config de pico y placa, igual que en la ficha del vehículo y en el calendario.
  const [pp, setPp] = useState<PicoPlaca>(picoPlacaVacio());
  const [user, setUser] = useState<User | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState('');
  const [errorCarga, setErrorCarga] = useState('');

  // Lugares de recogida/entrega (elegidos en el detalle del vehículo)
  const [recogida, setRecogida] = useState<Lugar>({ ...LUGAR_VACIO });
  const [entrega, setEntrega] = useState<Lugar>({ ...LUGAR_VACIO });

  // Step 1 — Documentos + datos de la operación
  // La dirección, la ciudad y el contacto de emergencia ya no se piden al crear la
  // cuenta (el registro quedó corto a propósito): se piden aquí, a quien no los tenga
  // guardados de una reserva anterior o los tenga guardados pero ya no cumplan las
  // reglas de validación actuales (datos legacy).
  const [faltanDatos, setFaltanDatos] = useState(false);
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [emNombre, setEmNombre] = useState('');
  const [emTel, setEmTel] = useState('');

  const [docIdUrl, setDocIdUrl] = useState('');
  const [docIdUrlDorso, setDocIdUrlDorso] = useState('');
  // "Mi documento es un pasaporte (sin dorso)". Ya NO es una casilla libre: el
  // servidor la contrasta con el `tipo_documento` registrado (POST /api/reservas),
  // porque antes cualquiera la marcaba y se saltaba el dorso. Acá se refleja esa
  // misma regla: solo se ofrece a quien de verdad se registró con pasaporte.
  const [docRegistradoEsPasaporte, setDocRegistradoEsPasaporte] = useState(false);
  const [esPasaporte, setEsPasaporte] = useState(false);
  const [licenciaUrl, setLicenciaUrl] = useState('');
  const [licenciaUrlDorso, setLicenciaUrlDorso] = useState('');

  // Step 2 — Contrato
  const [firmaNombre, setFirmaNombre] = useState('');
  const [aceptado, setAceptado] = useState(false);

  // Step 3 — Pago (el número/CVV los captura el widget de Wompi, nunca este componente).
  //
  // Cómo va a pagar el cliente. Con 'tarjeta' se abre el widget de Wompi y se cobra en
  // el momento; con 'efectivo' o 'transferencia' no se pasa por la pasarela y la reserva
  // nace pendiente de pago. La tarjeta dejó de ser obligatoria porque hay clientes que
  // pagan en efectivo, y exigirla los dejaba sin poder reservar.
  const [metodoPago, setMetodoPago] = useState<MetodoPagoWeb>('tarjeta');
  const [usarCreditos, setUsarCreditos] = useState(true);

  const cargarInicial = () => {
    setErrorCarga('');
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user) { router.push('/login'); return; }
      setUser(d.user);
      setFirmaNombre(d.user.nombre || '');
      let emergencia: { nombre?: string; telefono?: string } = {};
      try { emergencia = JSON.parse(d.user.contacto_emergencia || '{}') || {}; } catch { /* perfil viejo o vacío */ }
      const dir = (d.user.direccion || '').trim();
      const ciu = (d.user.ciudad || '').trim();
      const emN = (emergencia.nombre || '').trim();
      const emT = (emergencia.telefono || '').trim();
      setDireccion(dir); setCiudad(ciu); setEmNombre(emN); setEmTel(emT);
      // Precarga la cédula/licencia que ya se guardó antes (foto leída en el atajo
      // del registro, o de una reserva anterior) para no pedírsela de nuevo — el
      // recuadro de DocUpload ya sabe mostrar la miniatura cuando `value` no está
      // vacío. El dorso de la cédula también se precarga: el atajo del registro y
      // /completar-perfil ahora lo capturan (tipo 'cedula_dorso'), así que a quien ya
      // lo tenga guardado no se le vuelve a pedir; a quien no, el checkout se lo exige
      // igual que siempre. El dorso de la LICENCIA sigue sin precargarse (esa foto
      // nunca se guarda fuera de la reserva). Se usa el setter funcional para no pisar
      // algo que la persona ya haya subido en esta misma sesión si `cargarInicial` se
      // vuelve a llamar (botón Reintentar).
      if (d.user.cedula_url) setDocIdUrl(prev => prev || d.user.cedula_url);
      if (d.user.cedula_url_dorso) setDocIdUrlDorso(prev => prev || d.user.cedula_url_dorso);
      if (d.user.licencia_url) setLicenciaUrl(prev => prev || d.user.licencia_url);
      // Quien se registró con pasaporte no puede dar un dorso: se le deja marcada la
      // exención (y la puede desmarcar si quiere subir un reverso igual). A todos los
      // demás ni siquiera se les ofrece — el servidor se lo rechazaría.
      const esPasaporteRegistrado = (d.user.tipo_documento || '') === 'pasaporte';
      setDocRegistradoEsPasaporte(esPasaporteRegistrado);
      setEsPasaporte(prev => prev || esPasaporteRegistrado);
      // "Faltan" incluye tanto "nunca los llenó" como "los tiene guardados pero ya
      // no cumplen las reglas actuales" (datos legacy) — en ambos casos el usuario
      // necesita ver los campos para poder corregirlos.
      setFaltanDatos(
        validarDireccion(dir) !== null ||
        validarCiudad(ciu) !== null ||
        validarNombreContacto(emN) !== null ||
        validarTelefonoContacto(emT) !== null
      );
    }).catch(() => setErrorCarga('No pudimos verificar tu sesión. Revisa tu conexión.'));
    const { recogida: r, entrega: e } = cargarLugares();
    setRecogida(r);
    setEntrega(e);
    if (vehiculo_id) {
      fetch('/api/pico-placa')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) setPp(parsePicoPlaca(JSON.stringify(d))); })
        .catch(() => { /* si falla se cobran todos los días, igual que el servidor */ });
      fetch(`/api/vehiculos/${vehiculo_id}`)
        .then(r => r.json())
        .then(d => setVehiculo(d.vehiculo ?? null))
        .catch(() => setErrorCarga('No pudimos cargar el vehículo. Revisa tu conexión.'));
    }
  };
  useEffect(() => {
    cargarInicial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiculo_id, router]);

  if (!vehiculo_id || !fecha_inicio || !fecha_fin) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center text-ink/50">
        <p className="mb-4">Datos de reserva incompletos.</p>
        <Link href="/" className="text-accent font-medium">Volver al inicio</Link>
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <p className="text-ink/60 mb-4">{errorCarga}</p>
        <button onClick={cargarInicial} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
      </div>
    );
  }

  const inputPagoCls = 'w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40';

  const dias = Math.max(0, Math.ceil(
    (new Date(fecha_fin).getTime() - new Date(fecha_inicio).getTime()) / 86400000
  ));
  const recargo = calcularRecargo(recogida, entrega);
  // Mismas dos reglas que `calcularCobroReserva` del servidor, con las mismas funciones
  // puras: los días de pico y placa no se cobran, y desde DIAS_PARA_DESCUENTO_DURACION
  // días el canon baja DESCUENTO_DURACION_PCT %. Importa que cuadre: este total es el
  // que el cliente ve y el que se imprime en el texto del contrato que firma abajo.
  const diasPicoPlaca = vehiculo && fecha_inicio && fecha_fin
    ? diasRestringidosEnRango(pp, vehiculo.placa || '', fecha_inicio, fecha_fin,
        { combustible: vehiculo.combustible, inscrita: vehiculo.exencion_pico_placa_inscrita })
    : [];
  const diasCobrados = Math.max(0, dias - diasPicoPlaca.length);
  const subtotalSinDescuento = vehiculo ? diasCobrados * vehiculo.precio_dia : 0;
  const subtotal = Math.round(subtotalSinDescuento * factorDuracion(dias));
  const descuentoDuracion = subtotalSinDescuento - subtotal;
  const totalBruto = subtotal + recargo;
  const creditosDisponibles = user?.creditos_referido || 0;
  const creditosAplicados = usarCreditos ? Math.min(creditosDisponibles, totalBruto) : 0;
  const total = totalBruto - creditosAplicados;

  // Con el token que devuelve el widget de Wompi, crear la reserva: el backend
  // cobra el alquiler completo de una vez y guarda la tarjeta tokenizada para
  // cargos futuros (marca/últimos 4 los deriva el propio backend de la
  // respuesta de Wompi — el navegador ya no ve el número de la tarjeta).
  const crearReserva = async (cardToken: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehiculo_id,
          fecha_inicio,
          fecha_fin,
          documento_id_url: docIdUrl,
          documento_id_url_dorso: docIdUrlDorso,
          documento_es_pasaporte: esPasaporte,
          licencia_url: licenciaUrl,
          licencia_url_dorso: licenciaUrlDorso,
          direccion,
          ciudad,
          emergencia_nombre: emNombre,
          emergencia_tel: emTel,
          usar_creditos: usarCreditos,
          metodo_pago: metodoPago,
          recogida,
          entrega,
          card_token: cardToken,
          firma_contrato: JSON.stringify({
            nombre: firmaNombre,
            fecha: new Date().toISOString(),
            vehiculo: vehiculo ? `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}` : '',
            recogida: lugarResumen(recogida),
            entrega: lugarResumen(entrega),
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El servidor exige correo verificado antes de reservar (cuenta pendiente
        // de activación — ver lib/verificacion-correo.ts). Se manda a verificarlo
        // en vez de solo mostrar el error genérico.
        if (data.codigo === 'correo_no_verificado') {
          router.push(`/verificar-correo?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        // El servidor exige perfil completo (contraseña + documento + fecha de
        // nacimiento) antes de reservar — típico de cuentas creadas por Google.
        // Se manda a completarlo en vez de solo mostrar el error genérico.
        if (data.codigo === 'perfil_incompleto') {
          router.push(`/completar-perfil?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        setError(data.error || 'Error al procesar el pago. Intenta de nuevo.');
        return;
      }
      setExito(true);
    } catch {
      setError('Sin conexión — revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // Abre el formulario de tarjeta de Wompi (modal propio, nada del número/CVV
  // pasa por nuestra página). Si la persona lo cierra sin pagar, Wompi no
  // avisa — por eso, al recuperar el foco la ventana, si no llegó el token en
  // ese ratito, se libera el botón para que pueda reintentar.
  const pagar = async () => {
    setError('');
    // Sin tarjeta no hay nada que tokenizar: se crea la reserva directamente y queda
    // pendiente de pago, para cobrarla al recoger el vehículo o por transferencia.
    if (metodoPago !== 'tarjeta') { await crearReserva(''); return; }
    setLoading(true);
    let tokenRecibido = false;
    const liberarSiCierraSinPagar = () => {
      window.removeEventListener('focus', liberarSiCierraSinPagar);
      setTimeout(() => { if (!tokenRecibido) setLoading(false); }, 500);
    };
    try {
      const publicKey = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY || '';
      // Defensa en profundidad. Si esta clave llega vacía, el widget de Wompi falla con
      // un error genérico y el cliente se queda mirando «no se pudo abrir el formulario»
      // sin saber qué hacer — y como es la vía por defecto, se pierde la reserva.
      // Ocurrió en producción (sep-2026): la variable estaba en Railway pero no
      // declarada como build-arg en el Dockerfile, así que Next la inlineó vacía. Ahora
      // `npm run build` lo impide (scripts/verificar-env-publicas.mjs); esto es el
      // segundo cinturón, para que un fallo de configuración NO cueste una venta: se le
      // dice qué pasa y se le ofrece la salida que sí funciona.
      if (!publicKey) {
        console.error('[pago] NEXT_PUBLIC_WOMPI_PUBLIC_KEY vacía: el widget de Wompi no puede abrir.');
        setError('El pago con tarjeta no está disponible en este momento. Puedes elegir "Efectivo" y pagar al recoger el vehículo, o intentarlo más tarde.');
        setLoading(false);
        return;
      }
      await openCardTokenizer(publicKey, (source) => {
        tokenRecibido = true;
        window.removeEventListener('focus', liberarSiCierraSinPagar);
        crearReserva(source.token);
      });
      window.addEventListener('focus', liberarSiCierraSinPagar);
    } catch (e) {
      const detalle = e instanceof Error ? e.message : 'No se pudo abrir el formulario de pago.';
      setError(`${detalle} Si el problema sigue, elige "Efectivo" y paga al recoger el vehículo.`);
      setLoading(false);
    }
  };

  /* ── ÉXITO ── */
  if (exito) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="bg-surface-2 rounded-3xl shadow-sm border border-border p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⏳</span>
          </div>
          <h1 className="text-2xl font-bold text-ink mb-1">
            {metodoPago === 'tarjeta' ? '¡Pago exitoso!' : '¡Reserva registrada!'}
          </h1>
          <p className="text-ink/50 mb-0.5">{vehiculo?.marca} {vehiculo?.modelo} {vehiculo?.anio}</p>
          <p className="text-ink/50 text-sm mb-4">{fecha_inicio} → {fecha_fin} · {dias} día{dias !== 1 ? 's' : ''}</p>
          <p className="text-accent font-bold text-2xl mb-5">${total.toLocaleString('es-CO')}</p>

          <div className="bg-warning/10 border border-warning/25 rounded-2xl px-5 py-4 text-left mb-4">
            <p className="text-xs font-bold text-warning mb-1.5 uppercase tracking-wide">¿Qué sigue?</p>
            <p className="text-sm text-warning">
              {metodoPago === 'tarjeta'
                ? 'Ya cobramos el valor del alquiler a tu tarjeta. '
                : metodoPago === 'efectivo'
                  ? 'El pago lo haces en efectivo al recoger el vehículo. '
                  : 'Te enviamos los datos de la cuenta para la transferencia. '}
              Tu reserva está <strong>pendiente de aprobación operativa</strong>
              (documentos y disponibilidad) por el equipo DrivePass. Recibirás una notificación en tu chat cuando sea aprobada o rechazada,
              normalmente en menos de 24 horas.
              {metodoPago === 'tarjeta' && ' Si se rechaza, el cobro se anula automáticamente.'}
            </p>
          </div>

          <div className="bg-accent-light border border-accent/20 rounded-2xl px-5 py-4 text-left mb-6">
            <p className="text-xs font-bold text-accent mb-2 uppercase tracking-wide">Al confirmar, recuerda llevar:</p>
            <ul className="space-y-1.5 text-sm text-ink/70">
              <li className="flex items-center gap-2"><span className="text-success">✓</span> Cédula de ciudadanía o pasaporte vigente</li>
              <li className="flex items-center gap-2"><span className="text-success">✓</span> Pase de conducción original físico</li>
              <li className="flex items-center gap-2"><span className="text-success">✓</span> Tarjeta con la que realizaste el pago</li>
            </ul>
          </div>

          <div className="flex gap-3 justify-center">
            <Link href="/"
              className="px-5 py-2.5 border border-border rounded-xl text-sm text-ink/60 hover:bg-surface transition font-medium">
              Ir al inicio
            </Link>
            <Link href="/historial"
              className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-bold transition">
              Ver mis reservas
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ── STEP INDICATOR ── */
  const stepLabels = ['Documentos', 'Contrato', 'Pago'];

  return (
    <div className="max-w-lg mx-auto px-4 py-8">

      {/* Volver */}
      <Link href={`/vehiculos/${vehiculo_id}`}
        className="inline-flex items-center gap-1.5 text-accent hover:text-accent-hover text-sm mb-5 font-medium transition">
        <IconArrowL size={14} /> Volver al vehículo
      </Link>

      {/* Resumen reserva */}
      {vehiculo && (
        <div className="bg-surface-2 rounded-2xl border border-border p-4 mb-4">
          <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest mb-2">Resumen de reserva</p>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-ink truncate">{vehiculo.marca} {vehiculo.modelo} {vehiculo.anio}</p>
              <p className="text-xs text-ink/50 capitalize mt-0.5">{vehiculo.tipo} · {vehiculo.ubicacion}</p>
              <p className="text-sm text-ink/60 mt-1.5">
                {fecha_inicio} → {fecha_fin}
                <span className="ml-2 bg-brand-muted text-ink text-[11px] font-medium px-2 py-0.5 rounded-full">
                  {dias} día{dias !== 1 ? 's' : ''}
                </span>
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-2xl font-black text-accent">${total.toLocaleString('es-CO')}</p>
              <p className="text-[11px] text-ink/50">${vehiculo.precio_dia.toLocaleString('es-CO')}/día</p>
            </div>
          </div>

          {/* Recogida / entrega */}
          <div className="mt-3 pt-3 border-t border-border grid sm:grid-cols-2 gap-2 text-xs">
            <div className="flex items-start gap-1.5">
              <IconPin size={12} className="text-accent flex-shrink-0 mt-0.5" />
              <span className="text-ink/60"><span className="font-semibold text-ink/70">Recogida:</span> {lugarResumen(recogida)}</span>
            </div>
            <div className="flex items-start gap-1.5">
              <IconPin size={12} className="text-ink flex-shrink-0 mt-0.5" />
              <span className="text-ink/60"><span className="font-semibold text-ink/70">Entrega:</span> {lugarResumen(entrega)}</span>
            </div>
          </div>

          {/* Desglose con recargo y créditos */}
          {(recargo > 0 || creditosDisponibles > 0 || diasPicoPlaca.length > 0 || descuentoDuracion > 0) && (
            <div className="mt-2 pt-2 border-t border-border text-xs space-y-0.5">
              <div className="flex justify-between text-ink/50"><span>Subtotal ({diasCobrados} día{diasCobrados !== 1 ? 's' : ''})</span><span>${subtotalSinDescuento.toLocaleString('es-CO')}</span></div>
              {diasPicoPlaca.length > 0 && (
                <div className="flex justify-between text-success"><span>{diasPicoPlaca.length} día{diasPicoPlaca.length !== 1 ? 's' : ''} de pico y placa (no se cobra{diasPicoPlaca.length !== 1 ? 'n' : ''})</span><span>−${(diasPicoPlaca.length * (vehiculo?.precio_dia ?? 0)).toLocaleString('es-CO')}</span></div>
              )}
              {descuentoDuracion > 0 && (
                <div className="flex justify-between text-success"><span>Descuento {DESCUENTO_DURACION_PCT}% por {dias} días</span><span>−${descuentoDuracion.toLocaleString('es-CO')}</span></div>
              )}
              {recargo > 0 && (
                <div className="flex justify-between text-ink/50"><span>Recargo por lugar</span><span>+${recargo.toLocaleString('es-CO')}</span></div>
              )}
              {creditosDisponibles > 0 && (
                <label className="flex items-center justify-between gap-2 text-success cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <input type="checkbox" checked={usarCreditos} onChange={e => setUsarCreditos(e.target.checked)} />
                    Usar mis créditos (tienes ${creditosDisponibles.toLocaleString('es-CO')})
                  </span>
                  {creditosAplicados > 0 && <span>−${creditosAplicados.toLocaleString('es-CO')}</span>}
                </label>
              )}
              <div className="flex justify-between font-bold text-ink"><span>Total</span><span>${total.toLocaleString('es-CO')}</span></div>
            </div>
          )}
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-start mb-6">
        {stepLabels.map((label, i) => {
          const s = i + 1;
          const done = step > s;
          const active = step === s;
          return (
            <div key={s} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition
                  ${done ? 'bg-success/100 text-white' : active ? 'bg-accent text-white' : 'bg-border text-ink/40'}`}>
                  {done ? '✓' : s}
                </div>
                <span className={`text-[10px] mt-1 font-semibold uppercase tracking-wide
                  ${active ? 'text-accent' : done ? 'text-success' : 'text-ink/40'}`}>
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <div className={`h-0.5 flex-1 -mt-4 transition ${done ? 'bg-success/100' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: Documentos ── */}
      {step === 1 && (
        <div className="bg-surface-2 rounded-2xl border border-border p-5">
          <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest mb-1">Paso 1 de 3</p>
          <h2 className="font-bold text-ink text-base mb-1">Sube tus documentos</h2>
          <p className="text-sm text-ink/50 mb-5">
            Necesitamos verificar tu identidad antes de confirmar la reserva. Los originales también deben presentarse físicamente al recoger el vehículo.
          </p>

          {docRegistradoEsPasaporte ? (
            <label className="flex items-center gap-2 text-xs text-ink/60 mb-3">
              <input type="checkbox" checked={esPasaporte} onChange={e => setEsPasaporte(e.target.checked)} />
              Mi documento de identidad es un pasaporte (sin dorso)
            </label>
          ) : (
            <p className="text-[11px] text-ink/45 mb-3">
              Necesitamos tu documento de identidad por el <strong>frente y el dorso</strong>. Si tu documento
              es un pasaporte (que no tiene dorso), escríbenos por el chat de soporte para corregir el tipo
              de documento de tu cuenta.
            </p>
          )}

          <div className="space-y-4 mb-4">
            <DocUploadDoble
              label="Cédula o pasaporte"
              valueFrente={docIdUrl} valueDorso={docIdUrlDorso}
              onChangeFrente={setDocIdUrl} onChangeDorso={setDocIdUrlDorso}
              soloUnLado={esPasaporte}
              preferirCamara
              required
            />
            <DocUploadDoble
              label="Licencia de conducción"
              valueFrente={licenciaUrl} valueDorso={licenciaUrlDorso}
              onChangeFrente={setLicenciaUrl} onChangeDorso={setLicenciaUrlDorso}
              preferirCamara
              required
            />
          </div>

          <div className="bg-surface border border-border rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-ink/50">Foto clara o PDF — JPG, PNG, WebP o PDF · Máximo 15 MB por archivo. Si tu archivo ya trae las dos caras, marca la casilla y súbelo una sola vez.</p>
          </div>

          {/* Datos de la operación — solo para quien no los tiene guardados o los tiene guardados pero inválidos (legacy) */}
          {faltanDatos && (
            <div className="bg-surface border border-border rounded-xl p-4 mb-5 space-y-3">
              <div>
                <p className="text-sm font-bold text-ink">Un par de datos más</p>
                <p className="text-xs text-ink/50 mt-0.5">
                  Los necesitamos para el contrato y para saber a quién llamar si algo pasa en la vía.
                </p>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-ink/60 block mb-1 uppercase tracking-wide">Dirección de residencia</label>
                <input type="text" autoComplete="street-address" placeholder="Calle 10 # 43A-15, Apto 301"
                  value={direccion} onChange={e => setDireccion(e.target.value)}
                  className={inputPagoCls} />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-ink/60 block mb-1 uppercase tracking-wide">Ciudad / Municipio</label>
                <input type="text" autoComplete="address-level2" placeholder="Medellín"
                  value={ciudad} onChange={e => setCiudad(e.target.value)}
                  className={inputPagoCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-ink/60 block mb-1 uppercase tracking-wide">Contacto de emergencia</label>
                  <input type="text" placeholder="Familiar o amigo"
                    value={emNombre} onChange={e => setEmNombre(e.target.value)}
                    className={inputPagoCls} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-ink/60 block mb-1 uppercase tracking-wide">Su teléfono</label>
                  <input type="tel" inputMode="numeric" placeholder="3001234567"
                    value={emTel} onChange={e => setEmTel(e.target.value.replace(/\D/g, '').slice(0, 15))}
                    className={inputPagoCls} />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger mb-3 text-center">{error}</p>}

          {(() => {
            const faltaDocId = !docIdUrl || (!esPasaporte && !docIdUrlDorso);
            const faltaLicencia = !licenciaUrl || !licenciaUrlDorso;
            return (
              <button
                onClick={() => {
                  if (!docIdUrl) { setError('Debes subir tu documento de identidad.'); return; }
                  if (!esPasaporte && !docIdUrlDorso) { setError('Falta el dorso de tu documento de identidad.'); return; }
                  if (!licenciaUrl || !licenciaUrlDorso) { setError('Debes subir frente y dorso de tu licencia de conducción.'); return; }
                  if (faltanDatos) {
                    const errDir = validarDireccion(direccion);
                    if (errDir) { setError(errDir); return; }
                    const errCiu = validarCiudad(ciudad);
                    if (errCiu) { setError(errCiu); return; }
                    const errEmN = validarNombreContacto(emNombre);
                    if (errEmN) { setError(errEmN); return; }
                    const errEmT = validarTelefonoContacto(emTel);
                    if (errEmT) { setError(errEmT); return; }
                  }
                  setError('');
                  setStep(2);
                }}
                disabled={faltaDocId || faltaLicencia}
                className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-3 rounded-xl transition shadow-md shadow-accent/20 disabled:opacity-50 text-sm"
              >
                Continuar al contrato →
              </button>
            );
          })()}
        </div>
      )}

      {/* ── STEP 2: Contrato ── */}
      {step === 2 && (
        <div className="bg-surface-2 rounded-2xl border border-border p-5">
          <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest mb-1">Paso 2 de 3</p>
          <h2 className="font-bold text-ink text-base mb-4">Contrato de arrendamiento</h2>

          <div className="bg-surface border border-border rounded-xl p-4 mb-5 max-h-72 overflow-y-auto text-xs text-ink/70 space-y-3 leading-relaxed">
            <p className="font-bold text-ink text-sm text-center uppercase tracking-wide">Contrato de Alquiler de Vehículo</p>
            <p className="text-center text-ink/50 text-[11px]">DrivePass S.A.S. — Medellín, Colombia</p>

            <p>
              El presente contrato de arrendamiento se celebra entre <strong>DrivePass S.A.S.</strong> (en adelante "la Empresa")
              y el arrendatario <strong>{user?.nombre || '___________'}</strong> (en adelante "el Arrendatario"), para el uso del
              vehículo <strong>{vehiculo ? `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio}` : '___________'}</strong>,
              por el período del <strong>{fecha_inicio}</strong> al <strong>{fecha_fin}</strong> ({dias} día{dias !== 1 ? 's' : ''}),
              con un costo total de <strong>${total.toLocaleString('es-CO')} COP</strong>.
            </p>

            <div>
              <p className="font-bold text-ink mb-1">1. Responsabilidad por daños</p>
              <p>
                El Arrendatario se compromete a devolver el vehículo en las mismas condiciones en que fue entregado. En caso de
                presentarse cualquier daño, avería, accidente o deterioro durante el período de arrendamiento —independientemente
                de su causa— el Arrendatario autoriza expresamente a DrivePass S.A.S. a cobrar el valor total de los daños
                mediante el medio de pago registrado. El Arrendatario renuncia a reclamaciones por cargos realizados bajo
                este numeral.
              </p>
            </div>

            <div>
              <p className="font-bold text-ink mb-1">2. Fotomultas y comparendos</p>
              <p>
                El Arrendatario acepta ser el único responsable de cualquier infracción de tránsito, fotomulta, comparendo
                o sanción generada durante el período de alquiler. En caso de que exista un depósito de garantía, DrivePass S.A.S.
                dispondrá de un plazo máximo de <strong>ocho (8) días hábiles</strong> desde la fecha en que el organismo de
                tránsito registre la sanción en el sistema oficial, para efectuar el descuento correspondiente y devolver el saldo
                restante al Arrendatario.
              </p>
            </div>

            <div>
              <p className="font-bold text-ink mb-1">3. Documentos y conducción</p>
              <p>
                El Arrendatario declara contar con licencia de conducción vigente y se compromete a presentar los documentos
                originales (documento de identidad y licencia) al momento de recibir el vehículo. Queda prohibido
                subarrendar el vehículo o permitir que sea conducido por personas no autorizadas en este contrato.
              </p>
            </div>

            <div>
              <p className="font-bold text-ink mb-1">4. Validez de la firma digital</p>
              <p>
                Al firmar digitalmente mediante el ingreso de su nombre completo, el Arrendatario manifiesta su plena
                aceptación de todos los términos aquí establecidos, con plena validez legal conforme a la Ley 527 de 1999
                (Comercio Electrónico en Colombia).
              </p>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold text-ink/60 block mb-1.5 uppercase tracking-wide">
              Firma digital — Escribe tu nombre completo <span className="text-accent">*</span>
            </label>
            <input
              type="text"
              placeholder="Nombre completo tal como aparece en tu documento"
              value={firmaNombre}
              onChange={e => setFirmaNombre(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            {firmaNombre.trim() && (
              <p className="text-[11px] text-ink/50 mt-1 italic text-right">
                Firmado por: {firmaNombre} · {new Date().toLocaleDateString('es-CO')}
              </p>
            )}
          </div>

          <label className="flex items-start gap-3 cursor-pointer mb-5 select-none">
            <input
              type="checkbox"
              checked={aceptado}
              onChange={e => setAceptado(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-accent flex-shrink-0"
            />
            <span className="text-xs text-ink/70">
              He leído y acepto los términos del contrato, incluyendo la responsabilidad por daños al vehículo
              y el plazo de 8 días hábiles para el cobro de multas de tránsito.
            </span>
          </label>

          {error && <p className="text-sm text-danger mb-3 text-center">{error}</p>}

          <div className="flex gap-3">
            <button onClick={() => { setStep(1); setError(''); }}
              className="flex-1 border border-border text-ink/60 font-medium py-3 rounded-xl text-sm hover:bg-surface transition">
              ← Atrás
            </button>
            <button
              onClick={() => {
                if (!firmaNombre.trim()) { setError('Debes ingresar tu nombre completo como firma.'); return; }
                if (!aceptado) { setError('Debes aceptar los términos del contrato.'); return; }
                setError('');
                setStep(3);
              }}
              disabled={!firmaNombre.trim() || !aceptado}
              className="flex-1 bg-accent hover:bg-accent-hover text-white font-bold py-3 rounded-xl transition shadow-md shadow-accent/20 disabled:opacity-50 text-sm"
            >
              Continuar al pago →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Pago ── */}
      {step === 3 && (
        <div className="bg-surface-2 rounded-2xl border border-border p-5">
          <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest mb-4">Paso 3 de 3 — Cómo vas a pagar</p>

          {/* Selector de método. La tarjeta dejó de ser obligatoria: hay clientes que
              pagan en efectivo, y exigirla los dejaba sin poder reservar. Con 'tarjeta'
              se abre el widget de Wompi y se cobra en el momento; con 'efectivo' o
              'transferencia' no se pasa por la pasarela y la reserva queda pendiente
              de pago, para cobrarla al recoger el vehículo. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-5">
            {METODOS_PAGO_WEB.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMetodoPago(m); setError(''); }}
                className={`text-left p-3 rounded-xl border transition ${
                  metodoPago === m ? 'border-accent bg-accent-light' : 'border-border bg-surface hover:bg-surface-3'
                }`}
              >
                <p className="text-sm font-bold text-ink leading-tight">{METODO_PAGO_WEB_LABEL[m]}</p>
                <p className="text-[11px] text-ink/55 mt-0.5">{METODO_PAGO_WEB_AYUDA[m]}</p>
              </button>
            ))}
          </div>

          {metodoPago !== 'tarjeta' && (
            <div className="rounded-xl border border-accent/25 bg-accent-light/50 p-3 mb-5">
              <p className="text-sm font-semibold text-ink">
                {metodoPago === 'efectivo'
                  ? 'Pagas en efectivo al recoger el vehículo.'
                  : 'Te enviamos los datos de la cuenta cuando confirmemos la reserva.'}
              </p>
              <p className="text-[11px] text-ink/60 mt-1">
                Tu solicitud queda registrada y te avisamos apenas quede confirmada. No necesitas tarjeta.
              </p>
            </div>
          )}

          <div className={`relative rounded-2xl p-5 mb-5 bg-gradient-to-br from-brand to-accent text-white overflow-hidden ${metodoPago === 'tarjeta' ? '' : 'hidden'}`}
            style={{ minHeight: 130 }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
            <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-white/10" />
            <div className="relative z-10 h-full flex flex-col justify-center items-center text-center gap-2 py-4">
              <IconShield size={28} />
              <p className="text-sm font-semibold">Vas a ingresar los datos de tu tarjeta directo en el formulario seguro de Wompi</p>
              <p className="text-[11px] opacity-75">Nunca pasan por nuestra página — se abre en su propio formulario protegido</p>
            </div>
          </div>

          <div className="space-y-3">
            {/* El aviso del titular solo aplica a quien paga con tarjeta. */}
            <div className={`items-center gap-2 bg-surface rounded-xl px-3 py-2.5 border border-border ${metodoPago === 'tarjeta' ? 'flex' : 'hidden'}`}>
              <IconShield size={14} className="text-accent flex-shrink-0" />
              <p className="text-[11px] text-ink/50">
                La tarjeta debe estar a nombre de la persona que conducirá el vehículo
              </p>
            </div>

            {error && (
              <div className="bg-danger/10 border border-danger/25 text-danger text-sm px-3 py-2.5 rounded-xl">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setStep(2); setError(''); }}
                disabled={loading}
                className="flex-none border border-border text-ink/60 font-medium px-4 py-3 rounded-xl text-sm hover:bg-surface transition disabled:opacity-50">
                ← Atrás
              </button>
              <button type="button" onClick={pagar} disabled={loading || !vehiculo}
                className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold py-3 rounded-xl transition shadow-md shadow-accent/20 disabled:opacity-60 text-sm">
                {loading
                  ? 'Procesando…'
                  : metodoPago === 'tarjeta'
                    ? `Pagar $${total.toLocaleString('es-CO')}`
                    : `Confirmar reserva · $${total.toLocaleString('es-CO')}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PagoPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-ink/50">Cargando…</div>}>
      <PagoContent />
    </Suspense>
  );
}
