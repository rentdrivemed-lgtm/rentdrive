'use client';
// ── Personas: clientes, propietarios y equipo ───────────────────────────────
//
// La sección «Usuarios» del panel de siempre, extraída TAL CUAL de
// app/dashboard/admin/page.tsx (3.356 líneas) para que las DOS pantallas monten el
// mismo componente: /dashboard/admin (pestaña Usuarios) y /panel (sección Personas).
// No hay dos copias que se puedan desincronizar: lo que se arregle acá se arregla en
// las dos. El comportamiento no cambió — filtros, orden por fecha de llegada,
// archivadas, perfil, permisos por casilla y reseteo de contraseña son los mismos.
//
// DE DÓNDE SALEN LOS DATOS: de `useDatosAdmin()` (components/panel/DatosAdmin.tsx), que
// guarda la lista una sola vez por pantalla; el badge "documentos pendientes" necesita
// además la lista de vehículos, por eso también la asegura.
//
// PERMISOS: `usuarios_gestion` (solo el administrador principal) sigue gobernando crear
// cuentas de equipo, cambiar nivel, repartir secciones, archivar/desarchivar, eliminar y
// resetear contraseñas — y NADIE puede editar sus propios permisos (el servidor lo
// vuelve a verificar y responde 403).
import { Fragment, useEffect, useState } from 'react';
import DocumentoVista from '@/components/DocumentoVista';
import BotonPaqueteDocumentos from '@/components/BotonPaqueteDocumentos';
import {
  FiltroCampo, BotonOrdenLlegada, ResumenFiltros, CLASE_CONTROL_FILTRO,
} from '@/components/FiltrosLista';
import { useDatosAdmin } from '@/components/panel/DatosAdmin';
import { plano, type Usuario } from '@/components/panel/tipos-admin';
import {
  puede, normalizarNivel, NIVEL_LABEL, NIVELES, GRUPOS_AREAS, areaLabel,
  parsePermisosExtra, type AdminNivel, type PermisosExtra, type PermisosExtraDelta,
} from '@/lib/permisos';
import {
  fechaRegistroCorta, fechaRegistroLarga, ordenarPorLlegada, enRangoRegistro,
  type OrdenLlegada,
} from '@/lib/fecha-registro';
import { IconUser, IconX, IconCheck } from '@/components/Icons';
import { MIN_NOCHES_RESERVA } from '@/lib/disponibilidad-reglas';

const rolColor: Record<string, string> = {
  admin:       'bg-accent/10 text-accent',
  propietario: 'bg-brand-muted text-ink',
  usuario:     'bg-surface text-ink/60',
};

function calcularEdad(fechaNac: string) {
  if (!fechaNac) return null;
  const hoy = new Date();
  const nac = new Date(fechaNac);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

const TIPO_DOC_LABELS: Record<string, string> = {
  cedula: 'Cédula de ciudadanía',
  pasaporte: 'Pasaporte',
  extranjeria: 'Cédula de extranjería',
};
const ROL_FILTRO_LABELS: Record<string, string> = {
  usuario: 'Cliente', propietario: 'Propietario', admin: 'Administrador',
};
const ESTADO_CUENTA_LABELS: Record<string, string> = {
  activa: 'Activa', inactiva: 'Inactiva', archivada: 'Archivada',
};
/**
 * ¿Esta cuenta tiene al día los documentos que el sistema le pide a su rol?
 *
 * No es un criterio inventado acá: es lo que cada flujo ya exige como obligatorio.
 *   · Todos (menos admin): tipo y número de documento — `perfilIncompleto` (lib/perfil.ts).
 *   · Cédula por frente Y dorso: la piden el registro y el perfil del propietario
 *     (app/dashboard/propietario/page.tsx, "es obligatoria para verificar que la tarjeta
 *     de propiedad esté a tu nombre").
 *   · Propietario, además: banco, número de cuenta y certificado bancario — los tres
 *     obligatorios para poder pagarle (mismo formulario de perfil).
 * Las cuentas del EQUIPO (rol 'admin') no tienen documentación que subir, así que nunca
 * salen como incompletas.
 */
function docsUsuarioCompletos(u: Usuario): boolean {
  if (u.rol === 'admin') return true;
  const lleno = (v?: string) => !!(v || '').trim();
  if (!lleno(u.tipo_documento) || !lleno(u.documento_identidad)) return false;
  // Antes se miraba si la URL venía llena. Ya no llega ninguna URL: llega el mapa de
  // documentos subidos (ver GET /api/admin/usuarios), que dice exactamente lo mismo.
  const docs = u.documentos_id || {};
  if (!docs.cedula_frente || !docs.cedula_dorso) return false;
  if (u.rol === 'propietario') {
    return lleno(u.banco) && lleno(u.numero_cuenta) && !!docs.certificado_bancario;
  }
  return true;
}
// Firma estable de un mapa de excepciones, para saber si hay cambios sin guardar.
const firmaPermisos = (p: PermisosExtra) =>
  JSON.stringify(Object.entries(p).sort((a, b) => a[0].localeCompare(b[0])));

// Casillas de secciones por empleado. El NIVEL es la plantilla base; aquí solo se
// guardan las EXCEPCIONES (lo que se aparta de esa plantilla). Por eso, si vuelves a
// marcar/desmarcar hasta el valor del nivel, la excepción desaparece sola y la casilla
// vuelve a decir "nivel": así se ve de un vistazo qué es heredado y qué es a la medida.
function PermisosSecciones({ u, draft, baseline, onToggle, onReset, onGuardar, guardando, msg }: {
  u: Usuario;
  draft: PermisosExtra;
  // Snapshot que tenía este panel al abrirse (no necesariamente el u.permisos_extra
  // más reciente, que puede haber cambiado por otra sesión). Contra esto se calcula
  // el delta que se manda al guardar, para no pisar cambios ajenos.
  baseline: PermisosExtra;
  onToggle: (area: string) => void;
  onReset: () => void;
  onGuardar: () => void;
  guardando: boolean;
  msg: string;
}) {
  const nivelU = normalizarNivel(u.admin_nivel);
  const cambiado = firmaPermisos(draft) !== firmaPermisos(baseline);
  const nExcepciones = Object.keys(draft).length;

  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">🔐 Secciones de {u.nombre}</p>
          <p className="text-[11px] text-ink/50 max-w-2xl">
            Parte de <strong>{NIVEL_LABEL[nivelU]}</strong>: lo que dice <span className="text-ink/40 font-semibold">nivel</span> es lo que le toca por su rol.
            Al marcar o desmarcar, esa sección queda como <span className="text-warning font-semibold">excepción</span> solo para esta persona.
            Para devolverla a lo normal, vuelve a dejarla como estaba (o usa “Volver todo al nivel”).
            La <strong>gestión del equipo</strong> (esta pantalla) no se puede marcar: es exclusiva del administrador principal.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onReset} disabled={nExcepciones === 0}
            className="text-xs px-3 py-1.5 rounded-xl border border-border text-ink/70 hover:bg-surface transition font-medium disabled:opacity-40">
            ↺ Volver todo al nivel
          </button>
          <button onClick={onGuardar} disabled={!cambiado || guardando}
            className="bg-accent hover:bg-accent-hover text-white px-4 py-1.5 rounded-xl font-semibold text-xs transition disabled:opacity-40">
            {guardando ? 'Guardando…' : cambiado ? 'Guardar cambios' : 'Sin cambios'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
        {GRUPOS_AREAS.map(g => (
          <div key={g.titulo}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink/40 mb-1.5">{g.titulo}</p>
            <div className="space-y-0.5">
              {g.areas.map(area => {
                const base = puede(nivelU, area);
                const efectivo = puede(nivelU, area, draft);
                const esExcepcion = efectivo !== base;
                return (
                  <label key={area}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface transition cursor-pointer">
                    <input type="checkbox" checked={efectivo} onChange={() => onToggle(area)}
                      className="w-4 h-4 rounded accent-[var(--color-accent)] flex-shrink-0" />
                    <span className={`text-xs flex-1 truncate ${efectivo ? 'text-ink' : 'text-ink/40'}`}>{areaLabel(area)}</span>
                    {esExcepcion ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 flex-shrink-0">excepción</span>
                    ) : (
                      <span className="text-[9px] text-ink/30 flex-shrink-0">nivel</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink/40">
        Ojo: esto controla qué secciones ve y qué APIs puede usar. El contenido marcado
        “solo socios” (tareas, eventos y documentos reservados) sigue dependiendo del nivel, no de estas casillas.
      </p>
      {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{msg}</p>}
    </div>
  );
}

export default function PersonasSeccion({ miNivel, miId }: { miNivel: AdminNivel; miId: number | null }) {
  const {
    usuarios, setUsuarios, vehiculos, errorListas,
    cargarUsuarios, asegurarUsuarios, asegurarVehiculos,
  } = useDatosAdmin();

  // ── Filtros de la lista de USUARIOS ──
  //
  // DÓNDE SE FILTRA: en el NAVEGADOR, sobre la lista que esta sección ya trae completa
  // (`/api/admin/usuarios`). Dos razones: 1) la pantalla YA necesita la lista entera en
  // memoria para los contadores (`stats`, `archivadasUsuariosCount`); 2) hoy son pocas
  // filas. CUÁNDO HAY QUE MOVERLO AL SERVIDOR: a partir del orden de las 500–1.000
  // cuentas, paginando en el servidor y dejando los contadores en un endpoint de resumen.
  const [usrBusq, setUsrBusq] = useState('');
  const [usrRol, setUsrRol] = useState('');
  // '' = todas menos las archivadas; 'archivada' es la vista que antes abría el botón
  // "🗄️ Ver archivadas" (ese botón ahora escribe acá: una sola fuente de verdad).
  const [usrEstado, setUsrEstado] = useState('');
  const [usrDocs, setUsrDocs] = useState('');   // '' | completos | incompletos
  const [usrDesde, setUsrDesde] = useState('');
  const [usrHasta, setUsrHasta] = useState('');
  const [usrOrden, setUsrOrden] = useState<OrdenLlegada>('recientes');
  const [perfilModal, setPerfilModal] = useState<{ u: Usuario } | null>(null);
  const [eliminandoUsuario, setEliminandoUsuario] = useState<number | null>(null);
  // Enlace para que el cliente guarde su tarjeta SIN cobrarle (ver
  // app/api/admin/enlaces-tarjeta y app/guardar-tarjeta/[token]). Se genera acá
  // y el admin lo copia para mandarlo por su cuenta — nada se envía solo.
  const [enlaceTarjeta, setEnlaceTarjeta] = useState<{ uid: number; link: string } | null>(null);
  const [generandoEnlace, setGenerandoEnlace] = useState(false);
  const [errorEnlace, setErrorEnlace] = useState('');

  const generarEnlaceTarjeta = async (u: Usuario) => {
    setErrorEnlace('');
    setEnlaceTarjeta(null);
    setGenerandoEnlace(true);
    try {
      const res = await fetch('/api/admin/enlaces-tarjeta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: u.id }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorEnlace(data.error || 'No se pudo generar el enlace.'); return; }
      setEnlaceTarjeta({ uid: u.id, link: data.link });
    } catch {
      setErrorEnlace('Sin conexión — intenta de nuevo.');
    } finally {
      setGenerandoEnlace(false);
    }
  };
  const [resetPass, setResetPass] = useState<{ uid: number; nueva: string; confirmar: string; guardando: boolean; ok: string } | null>(null);

  useEffect(() => {
    asegurarUsuarios();
    // El badge "📄 Docs pendientes" de cada propietario sale de SUS VEHÍCULOS, no de su
    // cuenta: sin esta lista el badge no aparecería nunca. Es la misma petición que hace
    // la sección Vehículos y la comparten (ver components/panel/DatosAdmin.tsx).
    asegurarVehiculos();
  }, [asegurarUsuarios, asegurarVehiculos]);

  const toggleEstado = async (u: Usuario) => {
    const nuevo = u.estado_cuenta === 'activa' ? 'inactiva' : 'activa';
    const res = await fetch('/api/admin/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, estado_cuenta: nuevo }),
    });
    if (res.ok) setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, estado_cuenta: nuevo } : x));
  };

  // Eliminar cuenta (borrado inteligente, ver lib/eliminar.ts): el servidor decide solo
  // entre borrado real y archivado reversible según si la cuenta tiene historial de negocio.
  const eliminarUsuario = async (u: Usuario) => {
    if (!window.confirm(
      `¿Eliminar la cuenta de ${u.nombre} (${u.correo})?\n\n` +
      'Si nunca tuvo actividad (reservas, vehículos, pagos, chat…) se borra para siempre. ' +
      'Si sí tuvo, se archivará (queda oculta pero se puede recuperar).'
    )) return;
    setEliminandoUsuario(u.id);
    try {
      const res = await fetch(`/api/admin/usuarios?id=${u.id}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({})) as { resultado?: string; error?: string };
      if (!res.ok) { alert(d.error || 'No se pudo eliminar la cuenta.'); return; }
      if (d.resultado === 'borrado') {
        setUsuarios(prev => prev.filter(x => x.id !== u.id));
        alert(`✓ Se eliminó por completo la cuenta de ${u.nombre} (no tenía historial).`);
      } else {
        setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, estado_cuenta: 'archivada' } : x));
        alert(`✓ ${u.nombre} tenía historial de negocio, así que se archivó (no se borró) — puedes desarchivarla desde "Ver archivadas".`);
      }
    } catch {
      alert('Error de conexión, intenta de nuevo.');
    } finally {
      setEliminandoUsuario(null);
    }
  };

  // ── Autorización de alquiler por UN DÍA ────────────────────────────────────
  // Levanta, para UN cliente, el mínimo de 2 noches de la vía web. Es de un solo uso:
  // se gasta al crear la reserva (ver `consumirAutorizacionDiaSuelto`). El motivo es
  // obligatorio porque es una excepción a una regla del negocio y queda en la bitácora
  // a nombre de quien la concede.
  // Un motivo POR CLIENTE: con un solo string, el motivo escrito en una ficha se
  // enviaba con la autorización de otra si había dos abiertas, y el motivo es la
  // única justificación auditable de la excepción.
  const [diaSueltoMotivo, setDiaSueltoMotivo] = useState<Record<number, string>>({});
  const [diaSueltoGuardando, setDiaSueltoGuardando] = useState<number | null>(null);

  const cambiarDiaSuelto = async (u: Usuario, autorizar: boolean) => {
    const motivo = (diaSueltoMotivo[u.id] || '').trim();
    if (autorizar && !motivo) return;
    setDiaSueltoGuardando(u.id);
    try {
      const res = await fetch('/api/admin/clientes/dia-suelto', {
        method: autorizar ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(autorizar ? { usuario_id: u.id, motivo } : { usuario_id: u.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || 'No se pudo cambiar la autorización.'); return; }
      // Se refleja en la lista sin recargar toda la sección.
      setUsuarios(prev => prev.map(x => x.id === u.id ? {
        ...x,
        dia_suelto_autorizado: autorizar ? 1 : 0,
        dia_suelto_motivo: autorizar ? motivo : '',
        dia_suelto_autorizado_por_nombre: autorizar ? (x.dia_suelto_autorizado_por_nombre || '') : '',
      } : x));
      if (autorizar) setDiaSueltoMotivo(prev => ({ ...prev, [u.id]: '' }));
    } finally {
      setDiaSueltoGuardando(null);
    }
  };

  const desarchivarUsuario = async (u: Usuario) => {
    const res = await fetch('/api/admin/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, accion: 'desarchivar' }),
    });
    if (res.ok) setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, estado_cuenta: 'inactiva' } : x));
    else alert('No se pudo desarchivar la cuenta.');
  };
  // ── Equipo y roles (solo nivel principal) ──────────────────────────────────
  const [nuevoEquipo, setNuevoEquipo] = useState<{ nombre: string; correo: string; password: string; admin_nivel: AdminNivel }>({ nombre: '', correo: '', password: '', admin_nivel: 'secretaria' });
  const [creandoEquipo, setCreandoEquipo] = useState(false);
  const [equipoMsg, setEquipoMsg] = useState('');

  const crearEquipo = async () => {
    setCreandoEquipo(true); setEquipoMsg('');
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nuevoEquipo),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setEquipoMsg('✓ Cuenta creada.');
        setNuevoEquipo({ nombre: '', correo: '', password: '', admin_nivel: 'secretaria' });
        cargarUsuarios();
        setTimeout(() => setEquipoMsg(''), 4000);
      } else {
        setEquipoMsg(d.error || 'No se pudo crear la cuenta.');
      }
    } catch {
      setEquipoMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setCreandoEquipo(false);
    }
  };

  const cambiarNivel = async (u: Usuario, nivel: AdminNivel) => {
    const res = await fetch('/api/admin/usuarios', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: u.id, admin_nivel: nivel }),
    });
    if (res.ok) setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, admin_nivel: nivel } : x));
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'No se pudo cambiar el nivel.'); }
  };
  // ── Permisos por sección (casillas por empleado) ───────────────────────────
  // Solo se envían al servidor las excepciones; el servidor revalida todo (lista
  // blanca de áreas, no editarse a uno mismo, `usuarios_gestion` prohibida).
  const [permisosAbierto, setPermisosAbierto] = useState<number | null>(null);
  const [permisosDraft, setPermisosDraft] = useState<Record<number, PermisosExtra>>({});
  // Snapshot de permisos_extra que tenía cada panel al abrirse. Se usa para calcular
  // el DELTA a enviar (solo lo que esta sesión cambió), en vez de mandar el mapa
  // completo del draft y arriesgarse a pisar cambios de otra sesión concurrente.
  const [permisosBaseline, setPermisosBaseline] = useState<Record<number, PermisosExtra>>({});
  const [permisosMsg, setPermisosMsg] = useState('');
  const [guardandoPermisos, setGuardandoPermisos] = useState(false);

  const abrirPermisos = (u: Usuario) => {
    setPermisosMsg('');
    if (permisosAbierto === u.id) { setPermisosAbierto(null); return; }
    const actual = parsePermisosExtra(u.permisos_extra);
    setPermisosDraft(prev => ({ ...prev, [u.id]: actual }));
    setPermisosBaseline(prev => ({ ...prev, [u.id]: actual }));
    setPermisosAbierto(u.id);
  };

  // Diferencia entre lo que había al abrir el panel y lo que quedó en el draft:
  // solo esas claves se mandan al servidor (null = "quitar la excepción, volver al nivel").
  const deltaPermisos = (baseline: PermisosExtra, draft: PermisosExtra): PermisosExtraDelta => {
    const delta: PermisosExtraDelta = {};
    const claves = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
    for (const clave of claves) {
      const antes = baseline[clave];
      const despues = draft[clave];
      if (antes === despues) continue;
      delta[clave] = despues === undefined ? null : despues;
    }
    return delta;
  };

  const alternarArea = (u: Usuario, area: string) => {
    const nivelU = normalizarNivel(u.admin_nivel);
    setPermisosDraft(prev => {
      const actual = prev[u.id] ?? parsePermisosExtra(u.permisos_extra);
      const valor = !puede(nivelU, area, actual);
      const nuevo = { ...actual };
      // Si el valor elegido coincide con el del nivel, no es excepción: se hereda.
      if (valor === puede(nivelU, area)) delete nuevo[area];
      else nuevo[area] = valor;
      return { ...prev, [u.id]: nuevo };
    });
  };

  const restablecerPermisos = (u: Usuario) => setPermisosDraft(prev => ({ ...prev, [u.id]: {} }));

  const guardarPermisos = async (u: Usuario) => {
    const draft = permisosDraft[u.id] ?? parsePermisosExtra(u.permisos_extra);
    const baseline = permisosBaseline[u.id] ?? parsePermisosExtra(u.permisos_extra);
    const delta = deltaPermisos(baseline, draft);
    setGuardandoPermisos(true); setPermisosMsg('');
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, permisos_extra: delta }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const guardados = parsePermisosExtra(d.permisos_extra ?? draft);
        setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, permisos_extra: JSON.stringify(guardados) } : x));
        setPermisosDraft(prev => ({ ...prev, [u.id]: guardados }));
        setPermisosBaseline(prev => ({ ...prev, [u.id]: guardados }));
        setPermisosMsg('✓ Permisos guardados.');
        setTimeout(() => setPermisosMsg(''), 4000);
      } else {
        setPermisosMsg(d.error || 'No se pudieron guardar los permisos.');
      }
    } catch {
      setPermisosMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setGuardandoPermisos(false);
    }
  };
  const guardarNuevaContrasena = async () => {
    if (!resetPass) return;
    if (resetPass.nueva.length < 6) return;
    if (resetPass.nueva !== resetPass.confirmar) return;
    const nueva = resetPass.nueva;
    setResetPass(r => r ? { ...r, guardando: true, ok: '' } : r);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resetPass.uid, nueva_contrasena: nueva }),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) {
        setResetPass(r => r ? { ...r, guardando: false, ok: nueva } : r);
      } else {
        setResetPass(r => r ? { ...r, guardando: false, ok: `Error: ${d.error || res.status}` } : r);
      }
    } catch {
      setResetPass(r => r ? { ...r, guardando: false, ok: 'Error: sin conexión' } : r);
    }
  };

  // Propietarios con AL MENOS UN vehículo con documentos en revisión (badge de la lista).
  const propietariosConDocsEnRevision = new Set(
    vehiculos.filter(v => v.documentos_estado === 'en_revision').map(v => v.propietario_id)
  );

  // Las cuentas archivadas (ver lib/eliminar.ts) se ocultan del listado normal — solo se
  // ven al activar "Ver archivadas", que hoy no es un estado aparte sino el valor
  // 'archivada' del filtro de estado (así el botón y el `select` nunca se contradicen).
  const archivadasUsuariosCount = usuarios.filter(u => u.estado_cuenta === 'archivada').length;
  // La misma condición que gatea el botón y la opción del `select`, repetida acá a
  // propósito: si mañana alguien siembra este estado desde otro lado (una URL, un preset),
  // la lista no debe destaparle cuentas archivadas a quien no gestiona el equipo.
  const verArchivadosUsuarios = usrEstado === 'archivada' && puede(miNivel, 'usuarios_gestion');

  // Universo sobre el que se cuenta "de cuántos": las archivadas solo entran cuando se
  // están pidiendo a propósito, igual que antes.
  const usuariosVisibles = usuarios.filter(u =>
    verArchivadosUsuarios ? u.estado_cuenta === 'archivada' : u.estado_cuenta !== 'archivada'
  );
  const hayFiltrosUsuarios = !!(usrBusq.trim() || usrRol || usrEstado || usrDocs || usrDesde || usrHasta);
  const limpiarFiltrosUsuarios = () => {
    setUsrBusq(''); setUsrRol(''); setUsrEstado(''); setUsrDocs(''); setUsrDesde(''); setUsrHasta('');
  };
  const usuariosFiltrados = ordenarPorLlegada(
    usuariosVisibles.filter(u => {
      if (usrRol && u.rol !== usrRol) return false;
      if (usrEstado && u.estado_cuenta !== usrEstado) return false;
      if (usrDocs === 'completos' && !docsUsuarioCompletos(u)) return false;
      if (usrDocs === 'incompletos' && docsUsuarioCompletos(u)) return false;
      if (!enRangoRegistro(u.created_at, usrDesde, usrHasta)) return false;
      const q = plano(usrBusq.trim());
      if (q) {
        // Nombre, correo, documento y celular (con y sin indicativo, para que sirva tanto
        // "3001234567" como "+573001234567").
        const celular = `${u.celular_indicativo || ''}${u.celular || ''}`;
        const campos = [u.nombre, u.correo, u.documento_identidad, u.celular, celular];
        if (!campos.some(c => plano(c).includes(q))) return false;
      }
      return true;
    }),
    usrOrden,
  );
  return (
    <>
      {errorListas.usuarios && (
        <div className="bg-danger/10 border border-danger/25 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-danger">No pudimos cargar los usuarios. Revisa tu conexión.</span>
          <button onClick={cargarUsuarios} className="text-xs font-semibold text-danger underline">Reintentar</button>
        </div>
      )}
      {puede(miNivel, 'usuarios_gestion') && (
        <div className="bg-surface-2 rounded-2xl border border-border p-5 mb-4 space-y-4">
          <div>
            <p className="text-sm font-bold text-ink">👥 Equipo y roles</p>
            <p className="text-[11px] text-ink/50">Crea cuentas con acceso limitado. La <strong>secretaría</strong> solo ve Reservas, Leads y Soporte aquí, más el <strong>Panel de control</strong> (Operaciones, Tareas, Calendario, Documentos y Tableros) — sin plata, usuarios ni configuración. Los <strong>socios</strong> ven todo pero no gestionan el equipo ni la configuración.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input value={nuevoEquipo.nombre} onChange={e => setNuevoEquipo(s => ({ ...s, nombre: e.target.value }))}
              placeholder="Nombre" className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            <input value={nuevoEquipo.correo} onChange={e => setNuevoEquipo(s => ({ ...s, correo: e.target.value }))}
              placeholder="Correo" className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            <input value={nuevoEquipo.password} onChange={e => setNuevoEquipo(s => ({ ...s, password: e.target.value }))}
              placeholder="Contraseña (mín. 6)" type="text" className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink" />
            <select value={nuevoEquipo.admin_nivel} onChange={e => setNuevoEquipo(s => ({ ...s, admin_nivel: e.target.value as AdminNivel }))}
              className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink">
              {NIVELES.map(n => <option key={n} value={n}>{NIVEL_LABEL[n]}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={crearEquipo} disabled={creandoEquipo}
              className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl font-semibold text-sm transition disabled:opacity-60">
              {creandoEquipo ? 'Creando…' : 'Crear cuenta de equipo'}
            </button>
            {equipoMsg && <span className={`text-xs ${equipoMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{equipoMsg}</span>}
          </div>
        </div>
      )}
      {/* Filtros de la lista de usuarios. Mismo estilo que los de la pestaña Reservas. */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <FiltroCampo label="Buscar" className="flex-1 min-w-48">
            <input
              type="search" placeholder="Nombre, correo, documento o celular…"
              className={CLASE_CONTROL_FILTRO}
              value={usrBusq}
              onChange={e => setUsrBusq(e.target.value)}
            />
          </FiltroCampo>
          <FiltroCampo label="Rol">
            <select className={CLASE_CONTROL_FILTRO} value={usrRol} onChange={e => setUsrRol(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(ROL_FILTRO_LABELS).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </FiltroCampo>
          <FiltroCampo label="Estado de la cuenta">
            <select className={CLASE_CONTROL_FILTRO} value={usrEstado} onChange={e => setUsrEstado(e.target.value)}>
              <option value="">Todas (sin archivadas)</option>
              {/* 'Archivada' se ofrece SOLO a quien ya podía abrir esa vista con el botón
                  "🗄️ Ver archivadas" (usuarios_gestion). No es un dato nuevo —el listado
                  de GET /api/admin/usuarios siempre las manda, a cualquier admin con el
                  área 'usuarios'— pero el panel no se las mostraba, y este filtro no es
                  el lugar para cambiar quién ve qué. */}
              {Object.entries(ESTADO_CUENTA_LABELS)
                .filter(([valor]) => valor !== 'archivada' || puede(miNivel, 'usuarios_gestion'))
                .map(([valor, label]) => (
                  <option key={valor} value={valor}>
                    {label}{valor === 'archivada' ? ` (${archivadasUsuariosCount})` : ''}
                  </option>
                ))}
            </select>
          </FiltroCampo>
          <FiltroCampo label="Documentos">
            <select className={CLASE_CONTROL_FILTRO} value={usrDocs} onChange={e => setUsrDocs(e.target.value)}>
              <option value="">Todos</option>
              <option value="completos">Completos</option>
              <option value="incompletos">Incompletos</option>
            </select>
          </FiltroCampo>
          <FiltroCampo label="Registrados desde" className="min-w-36">
            <input type="date" className={CLASE_CONTROL_FILTRO} value={usrDesde} max={usrHasta || undefined}
              onChange={e => setUsrDesde(e.target.value)} />
          </FiltroCampo>
          <FiltroCampo label="hasta" className="min-w-36">
            <input type="date" className={CLASE_CONTROL_FILTRO} value={usrHasta} min={usrDesde || undefined}
              onChange={e => setUsrHasta(e.target.value)} />
          </FiltroCampo>
          <BotonOrdenLlegada orden={usrOrden} onCambiar={setUsrOrden} titulo="fecha de registro" />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ResumenFiltros
            mostrados={usuariosFiltrados.length}
            total={usuariosVisibles.length}
            hayFiltros={hayFiltrosUsuarios}
            onLimpiar={limpiarFiltrosUsuarios}
            etiqueta={verArchivadosUsuarios ? 'cuentas archivadas' : 'cuentas'}
          />
          {puede(miNivel, 'usuarios_gestion') && (
            <button onClick={() => setUsrEstado(e => e === 'archivada' ? '' : 'archivada')}
              className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                verArchivadosUsuarios ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface'
              }`}>
              {verArchivadosUsuarios ? '← Ver cuentas activas' : `🗄️ Ver archivadas (${archivadasUsuariosCount})`}
            </button>
          )}
        </div>
      </div>
      <div className="bg-surface-2 rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-muted">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Nombre</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide hidden sm:table-cell">Correo</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Rol</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Estado</th>
                {/* Fecha de llegada de esa persona a la plataforma. Es clicable: cambia
                    el orden entre "más recientes primero" y "más antiguos primero",
                    igual que el botón de la barra de filtros. */}
                <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">
                  <button type="button"
                    onClick={() => setUsrOrden(o => o === 'recientes' ? 'antiguos' : 'recientes')}
                    title="Clic para invertir el orden"
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-accent transition">
                    Se registró
                    <span aria-hidden="true" className="text-accent">{usrOrden === 'recientes' ? '↓' : '↑'}</span>
                    <span className="sr-only">
                      {usrOrden === 'recientes' ? 'más recientes primero' : 'más antiguos primero'}
                    </span>
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-ink/60 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usuariosFiltrados.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-ink/40">
                  {hayFiltrosUsuarios
                    ? 'Ningún usuario coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                    : verArchivadosUsuarios ? 'No hay cuentas archivadas.' : 'No hay usuarios.'}
                </td></tr>
              )}
              {usuariosFiltrados.map(u => (
                <Fragment key={u.id}>
                <tr className="hover:bg-surface transition">
                  <td className="px-4 py-3 font-semibold text-ink">
                    <span className="flex items-center gap-2">
                      {u.nombre}
                      {u.rol === 'propietario' && propietariosConDocsEnRevision.has(u.id) && (
                        <span title="Tiene documentos pendientes de revisión" className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 whitespace-nowrap">📄 Docs pendientes</span>
                      )}
                      {/* Distinto del badge de arriba: aquel habla de los documentos de
                          SUS VEHÍCULOS; este, de los de SU CUENTA (ver docsUsuarioCompletos). */}
                      {!docsUsuarioCompletos(u) && (
                        <span title={u.rol === 'propietario'
                          ? 'Le falta cédula (frente y dorso), datos bancarios o certificado bancario'
                          : 'Le falta el documento de identidad o la foto de la cédula (frente y dorso)'}
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ink/10 text-ink/60 border border-border whitespace-nowrap">
                          🪪 Documentos incompletos
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink/60 hidden sm:table-cell">{u.correo}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${rolColor[u.rol] || 'bg-surface'}`}>{u.rol}</span>
                    {u.rol === 'admin' && <span className="block mt-1 text-[10px] text-ink/50">{NIVEL_LABEL[normalizarNivel(u.admin_nivel)]}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      u.estado_cuenta === 'activa' ? 'bg-success/15 text-success'
                        : u.estado_cuenta === 'archivada' ? 'bg-warning/15 text-warning'
                        : 'bg-danger/15 text-danger'
                    }`}>
                      {u.estado_cuenta}
                    </span>
                  </td>
                  {/* `created_at` está en UTC: fechaRegistroCorta lo pasa a hora de
                      Medellín antes de mostrarlo (ver lib/fecha-registro.ts). */}
                  <td className="px-4 py-3 text-ink/60 whitespace-nowrap"
                    title={`Se registró el ${fechaRegistroLarga(u.created_at)}`}>
                    {fechaRegistroCorta(u.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap items-center">
                      <button onClick={() => setPerfilModal({ u })}
                        className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                        <IconUser size={11} /> Perfil
                      </button>
                      {u.estado_cuenta === 'archivada' ? (
                        puede(miNivel, 'usuarios_gestion') && (
                          <button onClick={() => desarchivarUsuario(u)}
                            className="text-xs px-3 py-1.5 rounded-xl border border-success/30 text-success hover:bg-success/10 transition font-medium">
                            📤 Desarchivar
                          </button>
                        )
                      ) : (
                        <>
                          {u.rol === 'admin' && puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                            <select value={normalizarNivel(u.admin_nivel)} onChange={e => cambiarNivel(u, e.target.value as AdminNivel)}
                              className="text-xs border border-border rounded-xl px-2 py-1.5 bg-surface text-ink" title="Nivel de acceso">
                              {NIVELES.map(n => <option key={n} value={n}>{NIVEL_LABEL[n]}</option>)}
                            </select>
                          )}
                          {u.rol === 'admin' && puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                            <button onClick={() => abrirPermisos(u)} title="Elegir qué secciones ve esta persona"
                              className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                                permisosAbierto === u.id ? 'border-accent text-accent bg-accent-light' : 'border-border text-ink/70 hover:bg-surface'
                              }`}>
                              🔐 Secciones
                              {Object.keys(parsePermisosExtra(u.permisos_extra)).length > 0 && (
                                <span className="ml-1 text-[10px] font-bold text-warning">
                                  ({Object.keys(parsePermisosExtra(u.permisos_extra)).length})
                                </span>
                              )}
                            </button>
                          )}
                          {(u.rol !== 'admin' || (puede(miNivel, 'usuarios_gestion') && u.id !== miId)) && (
                            <button onClick={() => toggleEstado(u)}
                              className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                                u.estado_cuenta === 'activa'
                                  ? 'border-danger/25 text-danger hover:bg-danger/10'
                                  : 'border-success/30 text-success hover:bg-success/10'
                              }`}>
                              {u.estado_cuenta === 'activa' ? 'Desactivar' : 'Activar'}
                            </button>
                          )}
                          {/* Eliminar cuenta: exclusiva de usuarios_gestion, sin excepción — nunca sobre uno mismo. */}
                          {puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                            <button onClick={() => eliminarUsuario(u)} disabled={eliminandoUsuario === u.id}
                              title="Borra la cuenta si nunca tuvo actividad; si tuvo, la archiva"
                              className="text-xs px-3 py-1.5 rounded-xl border border-danger/30 text-danger hover:bg-danger/10 transition font-medium disabled:opacity-50">
                              {eliminandoUsuario === u.id ? 'Eliminando…' : '🗑️ Eliminar'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {u.rol === 'admin' && puede(miNivel, 'usuarios_gestion') && u.id !== miId && permisosAbierto === u.id && (
                  <tr className="bg-surface">
                    <td colSpan={6} className="px-4 py-4">
                      <PermisosSecciones
                        u={u}
                        draft={permisosDraft[u.id] ?? parsePermisosExtra(u.permisos_extra)}
                        baseline={permisosBaseline[u.id] ?? parsePermisosExtra(u.permisos_extra)}
                        onToggle={area => alternarArea(u, area)}
                        onReset={() => restablecerPermisos(u)}
                        onGuardar={() => guardarPermisos(u)}
                        guardando={guardandoPermisos}
                        msg={permisosMsg}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal perfil usuario */}
      {perfilModal && (() => {
        const u = perfilModal.u;
        // Documentos de identidad de esta persona: el servidor manda qué hay subido y
        // su referencia, nunca la dirección del archivo (ver GET /api/admin/usuarios).
        const docsId = u.documentos_id || {};
        let emergencia = { nombre: '', telefono: '' };
        try { emergencia = JSON.parse(u.contacto_emergencia || '{}'); } catch { /* */ }
        const edad = calcularEdad(u.fecha_nacimiento || '');

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPerfilModal(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex justify-between items-start mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center flex-shrink-0">
                    <IconUser size={20} className="text-ink" />
                  </div>
                  <div>
                    <h3 className="font-bold text-ink">{u.nombre}</h3>
                    <p className="text-xs text-ink/50">{u.correo}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${rolColor[u.rol] || 'bg-surface'}`}>{u.rol}</span>
                  <button onClick={() => setPerfilModal(null)} aria-label="Cerrar" className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                    <IconX size={18} />
                  </button>
                </div>
              </div>

              {/* Sección: Identidad */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest">Documento de identidad</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Tipo</p>
                    <p className="text-sm font-semibold text-ink">{TIPO_DOC_LABELS[u.tipo_documento || ''] || u.tipo_documento || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Número</p>
                    <p className="text-sm font-semibold text-ink font-mono">{u.documento_identidad || '—'}</p>
                  </div>
                </div>

                {/* Foto de la cédula (frente y dorso).
                    Ya no se le pasa una URL del CDN sino la REFERENCIA del documento: cada
                    apertura pasa por /api/documentos/..., que comprueba el permiso y la
                    anota en la Bitácora. */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Cédula (frente)', doc: docsId.cedula_frente },
                    { label: 'Cédula (dorso)',  doc: docsId.cedula_dorso },
                  ].map(d => (
                    <DocumentoVista key={d.label} label={d.label} doc={d.doc} titulo={u.nombre} />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Fecha de nacimiento</p>
                    <p className="text-sm font-semibold text-ink">{u.fecha_nacimiento || '—'}</p>
                    {edad !== null && <p className="text-[11px] text-ink/50 mt-0.5">{edad} años</p>}
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Celular</p>
                    <p className="text-sm font-semibold text-ink font-mono">{u.celular ? `${u.celular_indicativo || '+57'} ${u.celular}` : '—'}</p>
                  </div>
                </div>

                {/* Sección: Licencia — solo para quien la necesita.
                    `usuarios.numero_licencia` es UNA sola columna compartida: es obligatoria
                    para el arrendatario (rol 'usuario') y desde sep-2026 ya no se le pide al
                    propietario en el registro, así que a un propietario le llegaría siempre
                    vacía y mostrar la sección solo confundía. Se sigue mostrando si el dato
                    existe (cuentas viejas de propietario que alcanzaron a llenarlo). La
                    columna NO se tocó: la usa la verificación con IA de los documentos del
                    arrendatario (ver app/api/verificar-documentos/route.ts). */}
                {(u.rol !== 'propietario' || !!u.numero_licencia || !!docsId.licencia_frente) && (
                  <>
                    <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Licencia de conducción</p>
                    <div className="bg-surface rounded-xl p-3 border border-border">
                      <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Número de licencia</p>
                      <p className="text-sm font-semibold text-ink font-mono">{u.numero_licencia || '—'}</p>
                    </div>
                    {/* Las fotos de la licencia del PERFIL (`usuarios.licencia_url`) tampoco se
                        mostraban acá: solo se veían las de cada reserva. */}
                    {(docsId.licencia_frente || docsId.licencia_dorso) && (
                      <div className="grid grid-cols-2 gap-3">
                        <DocumentoVista label="Licencia (frente)" doc={docsId.licencia_frente} titulo={u.nombre} />
                        <DocumentoVista label="Licencia (dorso)" doc={docsId.licencia_dorso} titulo={u.nombre} />
                      </div>
                    )}
                  </>
                )}

                {/* Sección: Alquiler de UN DÍA con autorización previa.
                    Por la web el mínimo son 2 noches (`MIN_NOCHES_POR_VIA`), para que nadie
                    pida un día suelto a ciegas por internet. Acá el equipo levanta esa regla
                    para UN cliente concreto. La autorización es de UN SOLO USO: se gasta al
                    crear la reserva (`consumirAutorizacionDiaSuelto`) y hay que volver a
                    concederla. Solo aplica a cuentas de cliente. */}
                {u.rol === 'usuario' && (
                  <>
                    <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Alquiler de un día</p>
                    <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                      {Number(u.dia_suelto_autorizado) === 1 ? (
                        <>
                          <p className="text-sm font-semibold text-success">Autorizado para alquilar por 1 día</p>
                          <p className="text-[11px] text-ink/60">
                            {u.dia_suelto_autorizado_por_nombre ? `Autorizó ${u.dia_suelto_autorizado_por_nombre}` : 'Autorizado'}
                            {u.dia_suelto_autorizado_en ? ` · ${u.dia_suelto_autorizado_en}` : ''}
                            {u.dia_suelto_motivo ? ` · ${u.dia_suelto_motivo}` : ''}
                          </p>
                          <p className="text-[11px] text-ink/45">Se usa una sola vez: al reservar, la autorización se consume.</p>
                          <button
                            type="button"
                            onClick={() => cambiarDiaSuelto(u, false)}
                            disabled={diaSueltoGuardando === u.id}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-danger/30 text-danger hover:bg-danger/5 disabled:opacity-50"
                          >
                            {diaSueltoGuardando === u.id ? 'Retirando…' : 'Retirar autorización'}
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-[11px] text-ink/60">
                            Este cliente solo puede reservar desde {MIN_NOCHES_RESERVA} noches. Autorízalo para que
                            pueda pedir un día suelto por la web.
                          </p>
                          <input
                            type="text"
                            value={diaSueltoMotivo[u.id] || ''}
                            onChange={e => setDiaSueltoMotivo(prev => ({ ...prev, [u.id]: e.target.value.slice(0, 300) }))}
                            placeholder="Motivo (obligatorio)"
                            className="w-full border border-border rounded-lg px-2.5 py-1.5 text-xs bg-surface-2 text-ink"
                          />
                          <button
                            type="button"
                            onClick={() => cambiarDiaSuelto(u, true)}
                            disabled={diaSueltoGuardando === u.id || !(diaSueltoMotivo[u.id] || '').trim()}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {diaSueltoGuardando === u.id ? 'Autorizando…' : 'Autorizar 1 día'}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}

                {/* Sección: Datos bancarios (propietarios).
                    El certificado bancario se le pide al propietario como OBLIGATORIO al
                    completar su perfil y se guarda en `usuarios.certificado_bancario_url`,
                    pero hasta ahora no se mostraba en ninguna pantalla del equipo: no había
                    forma de verificarlo ni de descargarlo para hacer la transferencia. */}
                {(u.rol === 'propietario' || !!docsId.certificado_bancario || !!u.banco) && (
                  <>
                    <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Datos bancarios</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-surface rounded-xl p-3 border border-border">
                        <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Banco</p>
                        <p className="text-sm font-semibold text-ink">{u.banco || '—'}</p>
                      </div>
                      <div className="bg-surface rounded-xl p-3 border border-border">
                        <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Número de cuenta</p>
                        <p className="text-sm font-semibold text-ink font-mono break-all">{u.numero_cuenta || '—'}</p>
                      </div>
                    </div>
                    <DocumentoVista
                      label="Certificado bancario"
                      doc={docsId.certificado_bancario}
                      titulo={`${u.nombre} — certificado bancario`}
                      vacio="No lo ha subido todavía."
                      nota="Emitido por el banco, máximo 3 meses de antigüedad."
                    />
                  </>
                )}

                {/* Paquete completo: un solo .zip con la cédula, la licencia, el certificado
                    bancario y los documentos de todos sus vehículos y reservas. Se arma en el
                    servidor y cada descarga queda en la Bitácora. */}
                <div className="pt-1">
                  <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest mb-2">Todos sus documentos</p>
                  <BotonPaqueteDocumentos
                    endpoint={`/api/admin/usuarios/${u.id}/paquete`}
                    autoInfo
                    nota="Contiene datos personales. La descarga queda registrada en la Bitácora."
                  />
                </div>

                {/* Sección: Dirección */}
                <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Dirección</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border col-span-2">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Dirección</p>
                    <p className="text-sm font-semibold text-ink">{u.direccion || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Ciudad</p>
                    <p className="text-sm font-semibold text-ink">{u.ciudad || '—'}</p>
                  </div>
                </div>

                {/* Sección: Contacto de emergencia */}
                <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Contacto de emergencia</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Nombre</p>
                    <p className="text-sm font-semibold text-ink">{emergencia.nombre || '—'}</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 border border-border">
                    <p className="text-[10px] text-ink/50 uppercase tracking-wide mb-0.5">Teléfono</p>
                    <p className="text-sm font-semibold text-ink font-mono">{emergencia.telefono || '—'}</p>
                  </div>
                </div>

                {/* Tarjeta guardada sin cobrar — para clientes presenciales que llegan
                    sin pagar en línea pero quedan con una tarjeta de respaldo (garantía,
                    multas/daños vía "Cargos extra"). Ver app/guardar-tarjeta/[token]. */}
                {u.rol === 'usuario' && (
                  <>
                    <p className="text-[10px] font-bold text-ink/50 uppercase tracking-widest pt-1">Guardar tarjeta sin cobrar</p>
                    <div className="bg-surface rounded-xl p-3 border border-border space-y-2">
                      <p className="text-xs text-ink/50">
                        Genera un enlace de un solo uso para que el cliente guarde su tarjeta desde su celular — no se le cobra nada. Tú se lo mandas por WhatsApp o donde prefieras.
                      </p>
                      <button
                        onClick={() => generarEnlaceTarjeta(u)}
                        disabled={generandoEnlace}
                        className="text-xs font-semibold bg-accent/15 text-accent px-3 py-1.5 rounded-lg hover:bg-accent/20 transition disabled:opacity-50"
                      >
                        {generandoEnlace ? 'Generando…' : 'Generar enlace'}
                      </button>
                      {errorEnlace && <p className="text-xs text-danger">{errorEnlace}</p>}
                      {enlaceTarjeta && enlaceTarjeta.uid === u.id && (
                        <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-2.5 py-2">
                          <input
                            readOnly
                            value={enlaceTarjeta.link}
                            onFocus={e => e.currentTarget.select()}
                            className="flex-1 min-w-0 text-xs font-mono text-ink/70 bg-transparent focus:outline-none"
                          />
                          <button
                            onClick={() => navigator.clipboard?.writeText(enlaceTarjeta.link)}
                            className="text-[11px] font-semibold text-accent flex-shrink-0"
                          >
                            Copiar
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Estado de cuenta */}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <div>
                    {/* `created_at` viene en UTC y se mostraba en crudo ('2026-09-16 01:00:00'):
                        un registro de las 8 p. m. en Medellín se leía como del día siguiente. */}
                    <p className="text-xs text-ink/50" title={fechaRegistroLarga(u.created_at)}>
                      Registrado el {fechaRegistroCorta(u.created_at)}
                    </p>
                    <p className="text-xs text-ink/50">Estado: <span className={u.estado_cuenta === 'activa' ? 'text-success font-semibold' : 'text-danger font-semibold'}>{u.estado_cuenta}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.rol !== 'admin' && u.estado_cuenta !== 'archivada' && (
                      <button onClick={() => { toggleEstado(u); setPerfilModal(p => p ? { u: { ...p.u, estado_cuenta: p.u.estado_cuenta === 'activa' ? 'inactiva' : 'activa' } } : null); }}
                        className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                          u.estado_cuenta === 'activa'
                            ? 'border-danger/25 text-danger hover:bg-danger/10'
                            : 'border-success/30 text-success hover:bg-success/10'
                        }`}>
                        {u.estado_cuenta === 'activa' ? 'Desactivar cuenta' : 'Activar cuenta'}
                      </button>
                    )}
                    {puede(miNivel, 'usuarios_gestion') && u.id !== miId && (
                      u.estado_cuenta === 'archivada' ? (
                        <button onClick={() => { desarchivarUsuario(u); setPerfilModal(null); }}
                          className="text-xs px-3 py-1.5 rounded-xl border border-success/30 text-success hover:bg-success/10 transition font-medium">
                          📤 Desarchivar
                        </button>
                      ) : (
                        <button onClick={async () => { await eliminarUsuario(u); setPerfilModal(null); }}
                          className="text-xs px-3 py-1.5 rounded-xl border border-danger/30 text-danger hover:bg-danger/10 transition font-medium">
                          🗑️ Eliminar
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Resetear contraseña */}
                <div className="pt-2 border-t border-border">
                  {resetPass?.uid !== u.id ? (
                    <button
                      onClick={() => setResetPass({ uid: u.id, nueva: '', confirmar: '', guardando: false, ok: '' })}
                      className="text-xs border border-warning/30 text-warning px-3 py-1.5 rounded-xl hover:bg-warning/10 transition font-medium">
                      🔑 Resetear contraseña
                    </button>
                  ) : resetPass.ok && !resetPass.ok.startsWith('Error') ? (
                    /* Contraseña establecida — mostrarla una sola vez */
                    <div className="bg-success/10 border border-success/30 rounded-xl p-4 space-y-2">
                      <p className="text-xs font-bold text-success">✓ Contraseña actualizada</p>
                      <p className="text-xs text-ink/60">Comparte esta contraseña temporal con el usuario:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-ink tracking-wider">
                          {resetPass.ok}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(resetPass.ok)}
                          className="text-xs border border-border text-ink/50 px-2.5 py-2 rounded-lg hover:border-accent/40 hover:text-accent transition">
                          Copiar
                        </button>
                      </div>
                      <button onClick={() => setResetPass(null)}
                        className="text-xs text-ink/50 hover:text-ink transition">Cerrar</button>
                    </div>
                  ) : (
                    /* Formulario de nueva contraseña */
                    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
                      <p className="text-xs font-bold text-ink">Nueva contraseña para {u.nombre}</p>
                      <div className="space-y-2">
                        <input
                          type="password"
                          placeholder="Nueva contraseña (mín. 6 caracteres)"
                          value={resetPass.nueva}
                          onChange={e => setResetPass(r => r ? { ...r, nueva: e.target.value, ok: '' } : r)}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-warning/40"
                        />
                        <input
                          type="password"
                          placeholder="Confirmar contraseña"
                          value={resetPass.confirmar}
                          onChange={e => setResetPass(r => r ? { ...r, confirmar: e.target.value, ok: '' } : r)}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-warning/40"
                        />
                        {resetPass.nueva && resetPass.confirmar && resetPass.nueva !== resetPass.confirmar && (
                          <p className="text-xs text-danger">Las contraseñas no coinciden</p>
                        )}
                        {resetPass.ok?.startsWith('Error') && (
                          <p className="text-xs text-danger">{resetPass.ok}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={guardarNuevaContrasena}
                          disabled={
                            resetPass.guardando ||
                            resetPass.nueva.length < 6 ||
                            resetPass.nueva !== resetPass.confirmar
                          }
                          className="flex items-center gap-1.5 bg-warning hover:bg-warning/80 text-white text-xs font-bold px-3 py-2 rounded-xl transition disabled:opacity-50">
                          <IconCheck size={13} />
                          {resetPass.guardando ? 'Guardando…' : 'Establecer contraseña'}
                        </button>
                        <button onClick={() => setResetPass(null)}
                          className="text-xs border border-border text-ink/50 px-3 py-2 rounded-xl hover:border-ink/30 transition">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
