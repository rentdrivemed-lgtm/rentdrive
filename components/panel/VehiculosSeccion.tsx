'use client';
// ── Vehículos: la flota, sus fotos, sus documentos y su calendario ──────────
//
// La pestaña «Vehículos» del panel de siempre, extraída TAL CUAL de
// app/dashboard/admin/page.tsx (3.356 líneas) para que las DOS pantallas monten el
// mismo componente: /dashboard/admin y /panel (sección Vehículos, grupo Catálogo).
// Una sola copia, sin riesgo de que las dos se desincronicen.
//
// QUÉ TRAE (todo igual que antes): las tres vistas de la lista (activos, archivados y
// en revisión de contenido) con sus filtros compartidos y el orden por fecha de
// publicación; precio, vitrina y disponibilidad; el visor de fotos a pantalla completa
// y el marcado MANUAL de placas; el modal de documentos con el verificador de IA y la
// carátula de la póliza; y el editor del calendario de disponibilidad.
//
// DE DÓNDE SALEN LOS DATOS: de `useDatosAdmin()` (components/panel/DatosAdmin.tsx). Las
// RESERVAS se aseguran desde acá porque el calendario necesita saber qué días están ya
// comprometidos: si no se pudieron cargar (403 del área `reservas`), el calendario queda
// en SOLO LECTURA en vez de dejar editar a ciegas.
import { useEffect, useRef, useState } from 'react';
import { esPdfUrl } from '@/lib/documento-tipo';
import CalendarioDisponibilidad from '@/components/CalendarioDisponibilidad';
import PolizaVehiculoAdmin from '@/components/PolizaVehiculoAdmin';
import VisorFotos, { type FotoVisor } from '@/components/VisorFotos';
import TaparPlacaManual from '@/components/TaparPlacaManual';
import { FotoPlaca, AvisoPlacas, usePlacasVehiculo, vehiculoConFotoCambiada } from '@/components/TaparPlacaFotos';
import ResultadoIA from '@/components/ResultadoIA';
import FotoUpload from '@/components/FotoUpload';
import {
  CASILLAS_FOTO, conCasilla, conSuelta, leerFotos, serializarFotos, sinSuelta,
  type EfectoFotos,
} from '@/lib/fotos-vehiculo';
import {
  FiltroCampo, BotonOrdenLlegada, ResumenFiltros, CLASE_CONTROL_FILTRO,
} from '@/components/FiltrosLista';
import { useDatosAdmin } from '@/components/panel/DatosAdmin';
import { plano, type DocItem, type DocRevision, type Documentos, type Vehiculo } from '@/components/panel/tipos-admin';
import { parsePicoPlaca, picoPlacaVacio, placaRestringida, type PicoPlaca } from '@/lib/pico-placa';
import { conDiasOcupados, diasOcupadosPorReservas, parseDiasGuardados } from '@/lib/dias-disponibles';
import { tecnoRequerida } from '@/lib/tecnomecanica';
import { fechaRegistroCorta, fechaRegistroLarga, ordenarPorLlegada, enRangoRegistro, type OrdenLlegada } from '@/lib/fecha-registro';
import { COMBUSTIBLE_LABELS, COMBUSTIBLES } from '@/lib/vehiculo-campos';
import { IconCar, IconX, IconCheck, IconShield, IconExport } from '@/components/Icons';
import { urlDescarga } from '@/lib/cloudinary-descarga';
import type { VerificacionResultado } from '@/lib/verificacion-docs';

const FOTOS_LABELS: Record<string, string> = {
  lado_izquierdo: 'Lado izq.', lado_derecho: 'Lado der.',
  frente: 'Frente', trasera: 'Trasera',
  cojineria: 'Cojinería', baul: 'Baúl', tablero: 'Tablero',
};

const DOC_ESTADO_FILTRO_LABELS: Record<string, string> = {
  sin_documentos: 'Sin documentos', en_revision: 'En revisión',
  aprobado: 'Aprobados', denegado: 'Denegados',
};
/**
 * Miniatura de la tarjeta del vehículo. Es un BOTÓN: abre `components/VisorFotos.tsx`
 * (el mismo visor a pantalla completa de Operaciones y de la pantalla del mensajero,
 * con zoom, flechas y cierre con Escape) en vez de dejar la foto recortada por el
 * `object-cover`, que es justo lo que no deja ver un rayón o una placa.
 *
 * Si el vehículo no tiene ninguna foto abrible se pinta la imagen suelta, sin botón:
 * un botón que no hace nada es peor que no tenerlo.
 */
function MiniaturaVehiculo({ portada, alt, cantidad, onAbrir, atenuada }: {
  portada: string; alt: string; cantidad: number; onAbrir: () => void; atenuada?: boolean;
}) {
  if (!portada) return null;
  const clasesImg = `w-20 h-14 object-cover rounded-xl flex-shrink-0 ${atenuada ? 'opacity-70' : ''}`;
  /* eslint-disable-next-line @next/next/no-img-element */
  const img = <img src={portada} alt={alt} className={clasesImg} />;
  if (cantidad === 0) return img;
  return (
    <button type="button" onClick={onAbrir} title="Clic para ver las fotos en grande"
      aria-label={`Ver en grande ${cantidad === 1 ? 'la foto' : `las ${cantidad} fotos`} de ${alt}`}
      className="relative flex-shrink-0 rounded-xl group focus:outline-none focus:ring-2 focus:ring-accent/50">
      {img}
      <span aria-hidden="true"
        className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/35 transition flex items-center justify-center text-white text-[10px] font-bold opacity-0 group-hover:opacity-100">
        🔍 Ampliar
      </span>
      {cantidad > 1 && (
        <span aria-hidden="true"
          className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-ink text-white text-[9px] font-bold grid place-items-center">
          {cantidad}
        </span>
      )}
    </button>
  );
}

export default function VehiculosSeccion({ miId, vehiculoInicial }: {
  /** Id de MI cuenta: decide si el calendario que se edita es propio o ajeno. */
  miId: number | null;
  /** Deep link `?vehiculo=<id>`: abre el modal de documentos de ese vehículo (notificaciones). */
  vehiculoInicial?: string | null;
}) {
  const {
    vehiculos, setVehiculos,
    vehiculosArchivados, setVehiculosArchivados,
    vehiculosRevisionContenido, setVehiculosRevisionContenido,
    reservas, reservasOk, errorListas,
    cargarVehiculos, cargarVehiculosArchivados, cargarVehiculosRevisionContenido,
    asegurarVehiculos, asegurarReservas, asegurarVehiculosRevisionContenido,
  } = useDatosAdmin();

  const [picoPlaca, setPicoPlaca] = useState<PicoPlaca>(picoPlacaVacio());
  const [precioEdit, setPrecioEdit] = useState<Record<number, string>>({});
  const [fotoModal, setFotoModal] = useState<{ v: Vehiculo } | null>(null);
  // ── Edición de fotos desde el panel (agregar / reemplazar / eliminar) ──────
  // Apagada por defecto: el modal abre en la vista de SIEMPRE (mirar, ampliar, tapar
  // placa). Hay que pedir "✏️ Editar fotos" para que aparezcan los botones que suben y
  // borran — borrar una foto no se puede deshacer y este modal se abre muchas veces al
  // día solo para mirar.
  const [fotosEdit, setFotosEdit] = useState(false);
  /** Ranura con un guardado en curso ('casilla:frente', 'suelta:<url>', 'nueva'), o null. */
  const [fotosOcupado, setFotosOcupado] = useState<string | null>(null);
  const [fotosMsg, setFotosMsg] = useState('');
  const [fotosError, setFotosError] = useState('');
  const [placaEditor, setPlacaEditor] = useState<{ v: Vehiculo; url: string; origenUrl: string } | null>(null);
  const [placaMsg, setPlacaMsg] = useState('');
  const [docModal, setDocModal] = useState<{ v: Vehiculo } | null>(null);
  // Editor de calendario del admin (mismas capacidades que el propietario, ver modal abajo).
  const [dispModal, setDispModal] = useState<{ v: Vehiculo } | null>(null);
  const [dispDias, setDispDias] = useState<string[]>([]);
  // Copia de lo que hay GUARDADO en BD para este vehículo: el calendario del modal edita
  // `dispDias` en local y solo se persiste al tocar "Guardar", así que hace falta con qué
  // comparar para saber si quedan cambios pendientes (antes cada clic disparaba un PUT, y
  // cada PUT le mandaba una notificación al propietario).
  const [dispOriginal, setDispOriginal] = useState<string[]>([]);
  const [dispMsg, setDispMsg] = useState('');
  const [dispGuardando, setDispGuardando] = useState(false);
  // ── Filtros de la lista de VEHÍCULOS (en el navegador, sobre la lista ya cargada) ──
  const [vehBusq, setVehBusq] = useState('');
  const [vehPropietario, setVehPropietario] = useState('');   // id del propietario, como texto
  const [vehDocs, setVehDocs] = useState('');                 // documentos_estado
  const [vehDisponible, setVehDisponible] = useState('');     // '' | '1' | '0'
  const [vehCombustible, setVehCombustible] = useState('');   // '' | gasolina | … | 'sin'
  const [vehDesde, setVehDesde] = useState('');
  const [vehHasta, setVehHasta] = useState('');
  const [vehOrden, setVehOrden] = useState<OrdenLlegada>('recientes');
  // Visor de fotos a pantalla completa (components/VisorFotos.tsx), el MISMO que usan
  // Operaciones y la pantalla del mensajero. Acá lo abren las miniaturas de la lista de
  // vehículos y las del modal de fotos.
  const [visorFotos, setVisorFotos] = useState<{ fotos: FotoVisor[]; indice: number; titulo: string } | null>(null);
  const [verArchivadosVehiculos, setVerArchivadosVehiculos] = useState(false);
  // ── Moderación de contenido: vehículos con fotos marcadas por la IA, pendientes de revisión manual ──
  const [verRevisionContenido, setVerRevisionContenido] = useState(false);
  const [aprobandoContenido, setAprobandoContenido] = useState<number | null>(null);
  const [eliminandoVehiculo, setEliminandoVehiculo] = useState<number | null>(null);
  const [docRevisiones, setDocRevisiones] = useState<Record<string, DocRevision>>({});
  const [iaVerif, setIaVerif] = useState<{ vid: number; res: VerificacionResultado; auto: string[] } | null>(null);
  const [iaCargando, setIaCargando] = useState(false);
  const [iaError, setIaError] = useState('');
  const [revisandoDoc, setRevisandoDoc] = useState<{ key: string; nota: string } | null>(null);
  const [docAccionando, setDocAccionando] = useState<string | null>(null);

  useEffect(() => {
    asegurarVehiculos();
    // Los días ya comprometidos del calendario de cada vehículo salen de las reservas.
    asegurarReservas();
    // Carga silenciosa solo para el contador del badge ("🔞 Ver en revisión de contenido").
    // Si el 403 llega por falta de permiso del área "vehiculos" simplemente no se muestra.
    asegurarVehiculosRevisionContenido();
    fetch('/api/config').then(r => r.json()).then(d => setPicoPlaca(parsePicoPlaca(d.config?.pico_placa || ''))).catch(() => {});
  }, [asegurarVehiculos, asegurarReservas, asegurarVehiculosRevisionContenido]);

  // ── Tapado manual de placas (components/TaparPlacaFotos.tsx) ─────────────
  // Estado de placa de las fotos del vehículo abierto en el modal "Fotos"; se pide solo
  // cuando hay modal abierto y se recarga tras aplicar un tapado.
  const placas = usePlacasVehiculo(fotoModal?.v.id ?? null);

  // ── Modal de fotos: abrir/cerrar y editar el juego de fotos ────────────────
  const abrirFotoModal = (v: Vehiculo) => {
    setFotosEdit(false);
    setFotosOcupado(null);
    setFotosMsg('');
    setFotosError('');
    setPlacaMsg('');
    setFotoModal({ v });
  };

  /** Copia del vehículo con las dos columnas de fotos ya reemplazadas. */
  const conFotosNuevas = <T extends { fotos: string; fotos_detalle: string }>(x: T, cols: { fotos: string; fotos_detalle: string }): T =>
    ({ ...x, fotos: cols.fotos, fotos_detalle: cols.fotos_detalle });

  /**
   * Persiste un cambio de fotos del admin y deja la pantalla coherente.
   *
   * Cada acción se guarda SOLA (un PUT por foto agregada o borrada), sin botón "Guardar":
   * así no hay forma de cerrar el modal creyendo que algo se guardó, y cada confirmación
   * de borrado corresponde exactamente a un cambio en la base.
   *
   * El servidor puede responder que el vehículo quedó EN REVISIÓN DE CONTENIDO por culpa
   * de la foto recién subida (hoy pasa siempre: sin saldo en la API de IA el difuminado de
   * placa no corre y la foto se marca para revisión manual). En ese caso el vehículo sale
   * del catálogo público y cambia de lista dentro de esta misma pestaña, así que se
   * recargan ambas listas y se avisa con todas las letras.
   */
  const guardarFotos = async (v: Vehiculo, efecto: EfectoFotos, ranura: string, resumen: string) => {
    const cols = serializarFotos(efecto.fotos);
    setFotosOcupado(ranura);
    setFotosMsg('');
    setFotosError('');
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cols),
      });
      const d = await res.json().catch(() => ({})) as {
        error?: string; contenido_revision?: number; contenido_revision_motivo?: string;
      };
      if (!res.ok) {
        setFotosError(d.error || 'No se pudo guardar el cambio. Las fotos quedaron como estaban.');
        return;
      }
      const enRevision = Number(d.contenido_revision) === 1;
      const parche = (x: Vehiculo): Vehiculo => ({
        ...conFotosNuevas(x, cols),
        ...(enRevision ? { contenido_revision: 1, contenido_revision_motivo: d.contenido_revision_motivo || '' } : {}),
      });
      setFotoModal(fm => (fm && fm.v.id === v.id ? { v: parche(fm.v) } : fm));
      setVehiculos(vs => vs.map(x => (x.id === v.id ? parche(x) : x)));
      setVehiculosArchivados(vs => vs.map(x => (x.id === v.id ? parche(x) : x)));
      setVehiculosRevisionContenido(vs => vs.map(x => (x.id === v.id ? parche(x) : x)));
      // El estado de placa de la foto nueva (o la desaparición de la borrada) lo sabe el
      // servidor, no nosotros: se vuelve a pedir en vez de inventarlo.
      placas.recargar();

      const avisos = [
        efecto.quedaVacio
          ? '⚠️ El vehículo se quedó SIN NINGUNA foto: su ficha se ve vacía y en el catálogo sale la silueta genérica.'
          : '',
        efecto.portadaPromovida
          ? '🖼️ La galería se quedó sin fotos sueltas, así que la portada del catálogo pasó a ser una de las casillas.'
          : (efecto.portadaDespues !== efecto.portadaAntes && !efecto.quedaVacio
              ? '🖼️ Cambió la foto de portada (la que se ve en el catálogo).'
              : ''),
      ].filter(Boolean).join(' ');
      setFotosMsg(`✓ ${resumen}.${avisos ? ` ${avisos}` : ''}`);

      if (enRevision) {
        setFotosError(
          '🔞 La foto quedó marcada para revisión manual, así que el vehículo salió del catálogo público y pasó a '
          + '“Ver en revisión de contenido”. Revísala ahí y usa “✓ Aprobar y publicar” para devolverlo a la vitrina.'
          + (d.contenido_revision_motivo ? ` Motivo: ${d.contenido_revision_motivo}` : ''),
        );
        cargarVehiculos();
        cargarVehiculosRevisionContenido();
      }
    } catch {
      setFotosError('Sin conexión — el cambio no se guardó. Intenta de nuevo.');
    } finally {
      setFotosOcupado(null);
    }
  };

  /** Sube/reemplaza la foto de una de las siete casillas de `fotos_detalle`. */
  const ponerFotoCasilla = (v: Vehiculo, clave: string, label: string, url: string) => {
    const actuales = leerFotos(v);
    const habia = !!(actuales.detalle[clave] || '').trim();
    const efecto = conCasilla(actuales, clave, url, CASILLAS_FOTO);
    return guardarFotos(v, efecto, `casilla:${clave}`, `${habia ? 'Reemplazaste' : 'Agregaste'} la foto de “${label}”`);
  };

  /** Borra la foto de una casilla. Destructivo: confirma nombrando qué se va a borrar. */
  const borrarFotoCasilla = (v: Vehiculo, clave: string, label: string) => {
    const actuales = leerFotos(v);
    if (!(actuales.detalle[clave] || '').trim()) return;
    const efecto = conCasilla(actuales, clave, '', CASILLAS_FOTO);
    if (!confirmarBorrado(v, `la foto de “${label}”`, actuales, efecto)) return;
    return guardarFotos(v, efecto, `casilla:${clave}`, `Eliminaste la foto de “${label}”`);
  };

  /** Agrega una foto suelta a la galería (`vehiculos.fotos`). */
  const agregarFotoSuelta = (v: Vehiculo, url: string) => {
    const efecto = conSuelta(leerFotos(v), url, CASILLAS_FOTO);
    return guardarFotos(v, efecto, 'nueva', 'Agregaste una foto a la publicación');
  };

  /** Borra una foto suelta. Destructivo: confirma nombrando cuál es. */
  const borrarFotoSuelta = (v: Vehiculo, url: string, posicion: number) => {
    const actuales = leerFotos(v);
    const efecto = sinSuelta(actuales, url, CASILLAS_FOTO);
    if (!confirmarBorrado(v, `la foto ${posicion} de “otras fotos de la publicación”`, actuales, efecto)) return;
    return guardarFotos(v, efecto, `suelta:${url}`, `Eliminaste una foto de la publicación`);
  };

  /**
   * Confirmación de un borrado, nombrando QUÉ se borra y QUÉ se rompe: si era la portada
   * del catálogo, si el carro se queda sin ninguna foto. Borrar no se puede deshacer desde
   * acá (el archivo sigue en Cloudinary y la bitácora guarda su URL, pero la publicación
   * pierde la referencia).
   */
  function confirmarBorrado(v: Vehiculo, queSeBorra: string, actuales: ReturnType<typeof leerFotos>, efecto: EfectoFotos): boolean {
    const lineas = [
      `¿Eliminar ${queSeBorra} de ${v.marca} ${v.modelo} ${v.anio}${v.placa ? ` (${v.placa})` : ''}?`,
      '',
    ];
    if (efecto.quedaVacio) {
      lineas.push('⚠️ Es la ÚLTIMA foto del vehículo: la publicación va a quedar vacía y en el catálogo saldrá la silueta genérica en vez del carro.', '');
    } else if (efecto.portadaPromovida) {
      lineas.push('🖼️ Era la última foto de la galería, así que la portada del catálogo pasará a ser una de las fotos de las casillas.', '');
    } else if (actuales.galeria[0] && efecto.portadaDespues !== efecto.portadaAntes) {
      lineas.push('🖼️ Es la foto de PORTADA (la que se ve en el catálogo): pasará a serlo la siguiente de la galería.', '');
    }
    lineas.push('Esto no se puede deshacer desde el panel. El propietario recibe un aviso y queda registrado en la bitácora.');
    return window.confirm(lineas.join('\n'));
  }

  const abrirEditorPlaca = (v: Vehiculo, url: string) => {
    setPlacaMsg('');
    // Si esta foto ya salió de un tapado manual anterior, se edita sobre la ORIGINAL (así el
    // sello nuevo no se apila sobre el viejo y además se ve la placa que hay que marcar).
    setPlacaEditor({ v, url, origenUrl: placas.de(url)?.origen_url || url });
  };

  const guardarPrecio = async (vid: number) => {
    const precio = Number(precioEdit[vid]);
    if (!precio || precio <= 0) return;
    await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ precio_dia: precio }),
    });
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, precio_dia: precio } : v));
    setPrecioEdit(p => { const n = { ...p }; delete n[vid]; return n; });
  };

  const toggleVitrina = async (v: Vehiculo) => {
    const nuevo = v.en_vitrina ? 0 : 1;
    setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, en_vitrina: nuevo } : x));
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ en_vitrina: nuevo }),
      });
      if (!res.ok) throw new Error('No se pudo actualizar');
    } catch {
      // Revierte el cambio optimista si el servidor no lo confirmó.
      setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, en_vitrina: v.en_vitrina } : x));
    }
  };

  // Activa/desactiva `disponible` directamente desde el panel de admin (antes solo se podía
  // desde el dashboard del propietario). El servidor (app/api/vehiculos/[id]/route.ts) ya
  // rechaza con 400 el intento de activar si el SOAT o la Tecno-mecánica no están aprobados,
  // y también rechaza mandar `documentos` junto con `disponible: 1` — por eso el body de este
  // PUT va siempre solo con `{ disponible }`, sin ningún campo extra.
  const toggleDisponible = async (v: Vehiculo) => {
    const nuevo = v.disponible ? 0 : 1;
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disponible: nuevo }),
      });
      if (res.ok) {
        setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, disponible: nuevo } : x));
      } else {
        // Ej. el gate de SOAT/Tecno-mecánica: el servidor no deja marcar disponible=1
        // hasta que ambos documentos estén aprobados por DrivePass.
        const d = await res.json().catch(() => ({}));
        alert((d as { error?: string }).error || 'No se pudo cambiar la disponibilidad.');
      }
    } catch {
      alert('Sin conexión — intenta de nuevo.');
    }
  };

  const alternarVerArchivadosVehiculos = () => {
    const nuevo = !verArchivadosVehiculos;
    setVerArchivadosVehiculos(nuevo);
    if (nuevo) { setVerRevisionContenido(false); cargarVehiculosArchivados(); }
  };

  // Eliminar vehículo (borrado inteligente, ver lib/eliminar.ts): el servidor decide solo
  // entre borrado real y archivado reversible según si el vehículo tiene reservas.
  const eliminarVehiculo = async (v: Vehiculo) => {
    if (!window.confirm(
      `¿Eliminar ${v.marca} ${v.modelo} ${v.anio}?\n\n` +
      'Si nunca tuvo reservas se borra para siempre. Si sí tuvo, se archivará ' +
      '(desaparece de la vitrina y del panel, pero se puede recuperar).'
    )) return;
    setEliminandoVehiculo(v.id);
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({})) as { resultado?: string; error?: string };
      if (!res.ok) { alert(d.error || 'No se pudo eliminar el vehículo.'); return; }
      setVehiculos(vs => vs.filter(x => x.id !== v.id));
      if (d.resultado === 'borrado') {
        alert(`✓ Se eliminó por completo ${v.marca} ${v.modelo} (no tenía reservas).`);
      } else {
        alert(`✓ ${v.marca} ${v.modelo} tenía reservas, así que se archivó (no se borró) — puedes desarchivarlo desde "Ver archivados".`);
        if (verArchivadosVehiculos) cargarVehiculosArchivados();
      }
    } catch {
      alert('Error de conexión, intenta de nuevo.');
    } finally {
      setEliminandoVehiculo(null);
    }
  };

  const desarchivarVehiculo = async (v: Vehiculo) => {
    const res = await fetch(`/api/vehiculos/${v.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archivado: 0 }),
    });
    if (res.ok) {
      setVehiculosArchivados(vs => vs.filter(x => x.id !== v.id));
      cargarVehiculos();
    } else {
      alert('No se pudo desarchivar el vehículo.');
    }
  };

  // ── Moderación de contenido (fotos marcadas por la IA, ver lib/moderacion.ts) ──
  const alternarVerRevisionContenido = () => {
    const nuevo = !verRevisionContenido;
    setVerRevisionContenido(nuevo);
    if (nuevo) { setVerArchivadosVehiculos(false); cargarVehiculosRevisionContenido(); }
  };

  const aprobarContenidoVehiculo = async (v: Vehiculo) => {
    if (!window.confirm(`¿Confirmas que revisaste las fotos de ${v.marca} ${v.modelo} ${v.anio} y NO tienen contenido inapropiado? Quedará publicado de nuevo.`)) return;
    setAprobandoContenido(v.id);
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenido_revision: 0, contenido_revision_motivo: '' }),
      });
      if (res.ok) {
        setVehiculosRevisionContenido(vs => vs.filter(x => x.id !== v.id));
        cargarVehiculos();
      } else {
        alert('No se pudo aprobar el vehículo.');
      }
    } finally {
      setAprobandoContenido(null);
    }
  };

  const abrirDocModal = (v: Vehiculo) => {
    let revs: Record<string, DocRevision> = {};
    try { revs = JSON.parse(v.documentos_revisiones || '{}'); } catch { /* */ }
    setDocRevisiones(revs);
    setRevisandoDoc(null);
    setDocAccionando(null);
    setIaVerif(null);
    setIaError('');
    setIaCargando(false);
    setDocModal({ v });
  };

  // ── Editor de calendario (disponibilidad) del admin ───────────────────────────────────
  // Mismas capacidades que el propietario: marcar/desmarcar días. Sin poderes extra.
  // El servidor (PUT /api/vehiculos/[id]) audita el cambio y le avisa al propietario cuando
  // es un admin tocando un vehículo ajeno, y rechaza con 400 si el cambio cerraría un día
  // que ya tiene una reserva activa.

  /**
   * Días ya comprometidos por reservas activas de ESTE vehículo, con el MISMO criterio que
   * usa el servidor (fin EXCLUSIVO y solo de hoy en adelante, ver lib/dias-disponibles.ts).
   * Alimenta tanto las celdas rojas deshabilitadas como la unión de seguridad al guardar, así
   * que lo que se pinta y lo que se protege es exactamente el mismo conjunto.
   */
  const diasOcupadosVehiculo = (vid: number): string[] =>
    [...diasOcupadosPorReservas(reservas.filter(r => r.vehiculo_id === vid))];

  /** ¿Quedan cambios sin guardar en el modal de disponibilidad? (orden irrelevante) */
  const dispHayCambios = (() => {
    if (dispDias.length !== dispOriginal.length) return true;
    const guardados = new Set(dispOriginal);
    return dispDias.some(d => !guardados.has(d));
  })();

  const abrirDispModal = (v: Vehiculo) => {
    const guardados = parseDiasGuardados(v.dias_disponibles);
    setDispDias(guardados);
    setDispOriginal(guardados);
    setDispMsg('');
    setDispGuardando(false);
    setDispModal({ v });
  };

  /** Cierra el modal, pidiendo confirmación si hay cambios que nunca se guardaron. */
  const cerrarDispModal = () => {
    if (dispHayCambios && !dispGuardando) {
      const seguir = confirm('Tienes cambios en el calendario sin guardar. Si cierras ahora se pierden.\n\n¿Cerrar de todos modos?');
      if (!seguir) return;
    }
    setDispModal(null);
  };

  const guardarDispDias = async (v: Vehiculo, elegidos: string[]) => {
    const anterior = dispOriginal;

    // ⚠️ SEMÁNTICA INVERTIDA: dejar el calendario sin ningún día marcado NO cierra el
    // vehículo, lo deja ABIERTO SIN RESTRICCIONES (ver lib/dias-disponibles.ts) — justo lo
    // contrario de lo que sugiere el botón "Limpiar todo" del componente. Se confirma antes
    // de guardar en vez de cambiar la semántica del dato o el componente compartido.
    if (elegidos.length === 0 && anterior.length > 0) {
      const seguir = confirm(
        `Vas a dejar el calendario de ${v.marca} ${v.modelo} SIN ningún día marcado.\n\n` +
        'OJO: eso NO cierra el vehículo — lo deja ABIERTO SIN RESTRICCIONES (todos los días ' +
        'quedan disponibles para reservar).\n\n¿Continuar?'
      );
      if (!seguir) return;
    }

    // Los días con reserva activa se preservan siempre: el componente no deja marcarlos
    // (celdas deshabilitadas), así que sin esta unión un vehículo irrestricto con una reserva
    // encima quedaba en un callejón sin salida — el primer día que marcaras cerraría los días
    // reservados y el servidor rechazaría el guardado siempre.
    const dias = conDiasOcupados(elegidos, diasOcupadosVehiculo(v.id), anterior);

    setDispDias(dias);
    setDispMsg('');
    setDispGuardando(true);
    try {
      const res = await fetch(`/api/vehiculos/${v.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias_disponibles: JSON.stringify(dias) }),
      });
      if (res.ok) {
        // La UI se sincroniza con lo que el servidor dice que quedó en BD (normalizado), no
        // con lo que mandamos: si difirieran, lo que manda es la BD.
        const d = await res.json().catch(() => ({}));
        const guardados = Array.isArray((d as { dias_disponibles?: unknown }).dias_disponibles)
          ? ((d as { dias_disponibles: string[] }).dias_disponibles)
          : dias;
        setDispDias(guardados);
        setDispOriginal(guardados);
        setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, dias_disponibles: JSON.stringify(guardados) } : x));
        setDispMsg(guardados.length === 0
          ? '✓ Guardado — el vehículo quedó abierto sin restricciones.'
          : `✓ Guardado — ${guardados.length} día${guardados.length !== 1 ? 's' : ''} marcado${guardados.length !== 1 ? 's' : ''}.`);
      } else {
        // Rollback a lo último confirmado por el servidor: si rechazó el cambio, el calendario
        // no puede quedar mostrando algo que no se guardó.
        const d = await res.json().catch(() => ({}));
        setDispDias(anterior);
        setDispMsg((d as { error?: string }).error || 'No se pudo guardar el calendario.');
      }
    } catch {
      setDispDias(anterior);
      setDispMsg('Sin conexión — intenta de nuevo.');
    } finally {
      setDispGuardando(false);
    }
  };

  // Abre el modal de documentos de un vehículo puntual al llegar desde una notificación
  // (?vehiculo=<id>, ver destinoDeNotificacion en components/Navbar.tsx) — solo una vez,
  // cuando la lista de vehículos ya cargó.
  const urlVehiculoAplicado = useRef(false);
  useEffect(() => {
    if (urlVehiculoAplicado.current || vehiculos.length === 0) return;
    if (!vehiculoInicial) { urlVehiculoAplicado.current = true; return; }
    const v = vehiculos.find(x => x.id === Number(vehiculoInicial));
    if (v) abrirDocModal(v);
    urlVehiculoAplicado.current = true;
  }, [vehiculos, vehiculoInicial]);

  const revisarDocIndividual = async (vid: number, key: string, estado: string, nota: string) => {
    setDocAccionando(key);
    const res = await fetch(`/api/vehiculos/${vid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisar_documento: { key, estado, nota } }),
    });
    const data = await res.json() as { documentos_estado?: string; documentos_nota?: string; documentos_revisiones?: string };
    setDocAccionando(null);
    setRevisandoDoc(null);

    const nuevasRevs = { ...docRevisiones, [key]: { estado, nota } };
    setDocRevisiones(nuevasRevs);

    const newEstado = data.documentos_estado;
    const newNota   = data.documentos_nota ?? '';
    const newRevsStr = data.documentos_revisiones ?? JSON.stringify(nuevasRevs);
    setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, documentos_estado: newEstado, documentos_nota: newNota, documentos_revisiones: newRevsStr } : v));
    if (docModal?.v.id === vid) {
      setDocModal(d => d ? { v: { ...d.v, documentos_estado: newEstado, documentos_nota: newNota, documentos_revisiones: newRevsStr } } : null);
    }
  };

  const verificarConIA = async (vid: number) => {
    setIaCargando(true);
    setIaError('');
    setIaVerif(null);
    try {
      const res = await fetch('/api/verificar-documentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculo_id: vid }),
      });
      const data = await res.json() as {
        error?: string;
        verificacion?: VerificacionResultado;
        auto_aprobados?: string[];
        documentos_estado?: string;
        documentos_revisiones?: string;
      };
      if (!res.ok || !data.verificacion) {
        setIaError(data.error || 'No se pudo completar la verificación.');
        return;
      }
      setIaVerif({ vid, res: data.verificacion, auto: data.auto_aprobados || [] });
      // Reflejar auto-aprobaciones híbridas (estado + revisiones) en la UI.
      if (data.documentos_estado) {
        const nuevoEstado = data.documentos_estado;
        const nuevasRevs = data.documentos_revisiones;
        setVehiculos(vs => vs.map(v => v.id === vid ? { ...v, documentos_estado: nuevoEstado, documentos_revisiones: nuevasRevs } : v));
        if (docModal?.v.id === vid) {
          setDocModal(d => d ? { v: { ...d.v, documentos_estado: nuevoEstado, documentos_revisiones: nuevasRevs } } : null);
        }
        if (nuevasRevs) {
          try { setDocRevisiones(JSON.parse(nuevasRevs)); } catch { /* */ }
        }
      }
    } catch {
      setIaError('No se pudo conectar con el verificador de IA.');
    } finally {
      setIaCargando(false);
    }
  };

  // ── Filtros de vehículos ───────────────────────────────────────────────────
  // Se aplican IGUAL a las tres vistas de la pestaña (activos, archivados y en revisión
  // de contenido): son tres consultas distintas al mismo endpoint, pero para quien mira
  // la pantalla es la misma lista de carros, y tener el buscador solo en una de ellas
  // obligaba a recordar en cuál sí funcionaba.
  const propietariosDeVehiculos = (() => {
    const mapa = new Map<number, string>();
    for (const v of [...vehiculos, ...vehiculosArchivados, ...vehiculosRevisionContenido]) {
      if (!mapa.has(v.propietario_id)) mapa.set(v.propietario_id, v.propietario_nombre || `Propietario #${v.propietario_id}`);
    }
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  })();
  const hayFiltrosVehiculos = !!(vehBusq.trim() || vehPropietario || vehDocs || vehDisponible || vehCombustible || vehDesde || vehHasta);
  const limpiarFiltrosVehiculos = () => {
    setVehBusq(''); setVehPropietario(''); setVehDocs(''); setVehDisponible('');
    setVehCombustible(''); setVehDesde(''); setVehHasta('');
  };
  const filtrarVehiculosLista = (lista: Vehiculo[]) => ordenarPorLlegada(
    lista.filter(v => {
      if (vehPropietario && String(v.propietario_id) !== vehPropietario) return false;
      if (vehDocs && (v.documentos_estado || 'sin_documentos') !== vehDocs) return false;
      if (vehDisponible && String(Number(v.disponible) === 1 ? 1 : 0) !== vehDisponible) return false;
      // 'sin' = el propietario no declaró combustible (columna en ''), que es un caso real
      // y útil de listar: son los carros a los que les falta ese dato de la matrícula.
      if (vehCombustible === 'sin' && (v.combustible || '')) return false;
      if (vehCombustible && vehCombustible !== 'sin' && (v.combustible || '') !== vehCombustible) return false;
      if (!enRangoRegistro(v.created_at, vehDesde, vehHasta)) return false;
      const q = plano(vehBusq.trim());
      if (q) {
        const campos = [v.placa, v.marca, v.modelo, `${v.marca} ${v.modelo}`, String(v.anio)];
        if (!campos.some(c => plano(c).includes(q))) return false;
      }
      return true;
    }),
    vehOrden,
  );
  const vehiculosFiltrados = filtrarVehiculosLista(vehiculos);
  const vehiculosArchivadosFiltrados = filtrarVehiculosLista(vehiculosArchivados);
  const vehiculosRevisionFiltrados = filtrarVehiculosLista(vehiculosRevisionContenido);

  // Abre el visor a pantalla completa con TODAS las fotos de un vehículo: primero las
  // siete casillas etiquetadas (`fotos_detalle`) y después las sueltas de la galería
  // (`fotos`) que no estén ya entre ellas.
  const fotosDeVehiculo = (v: Vehiculo): FotoVisor[] => {
    let detalle: Record<string, string> = {};
    try { detalle = JSON.parse(v.fotos_detalle || '{}') as Record<string, string>; } catch { detalle = {}; }
    const fotos: FotoVisor[] = [];
    const vistas = new Set<string>();
    for (const [clave, label] of Object.entries(FOTOS_LABELS)) {
      const url = (detalle[clave] || '').trim();
      if (!url || vistas.has(url)) continue;
      vistas.add(url);
      // `alt` (campo de FotoVisor): sin él el visor arma "Foto de frente 1 de 1", que
      // no dice de qué carro es. Acá sí se sabe.
      fotos.push({ url, grupo: label, alt: `${label} — ${v.marca} ${v.modelo} ${v.anio}` });
    }
    let galeria: string[] = [];
    try { galeria = JSON.parse(v.fotos || '[]') as string[]; } catch { galeria = []; }
    for (const u of galeria) {
      const url = String(u || '').trim();
      if (!url || vistas.has(url)) continue;
      vistas.add(url);
      fotos.push({ url, grupo: 'Galería', alt: `Foto de ${v.marca} ${v.modelo} ${v.anio}` });
    }
    return fotos;
  };
  const tituloVehiculo = (v: Vehiculo) =>
    `${v.marca} ${v.modelo} ${v.anio}${v.placa ? ` · ${v.placa}` : ''}`;
  const abrirVisorVehiculo = (v: Vehiculo, url?: string) => {
    const fotos = fotosDeVehiculo(v);
    if (fotos.length === 0) return;
    const i = url ? fotos.findIndex(f => f.url === url) : 0;
    setVisorFotos({ fotos, indice: i >= 0 ? i : 0, titulo: tituloVehiculo(v) });
  };

  return (
    <>
      {/* Filtros de la lista de vehículos: mismo estilo que Reservas y Usuarios. Los dos
          botones de vista (archivados / en revisión de contenido) viven acá dentro porque
          son parte de "qué carros estoy mirando", igual que el resto de la barra. */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <FiltroCampo label="Buscar" className="flex-1 min-w-48">
            <input
              type="search" placeholder="Placa, marca o modelo…"
              className={CLASE_CONTROL_FILTRO}
              value={vehBusq}
              onChange={e => setVehBusq(e.target.value)}
            />
          </FiltroCampo>
          <FiltroCampo label="Propietario" className="min-w-44">
            <select className={CLASE_CONTROL_FILTRO} value={vehPropietario} onChange={e => setVehPropietario(e.target.value)}>
              <option value="">Todos</option>
              {propietariosDeVehiculos.map(([id, nombre]) => (
                <option key={id} value={String(id)}>{nombre}</option>
              ))}
            </select>
          </FiltroCampo>
          <FiltroCampo label="Documentos">
            <select className={CLASE_CONTROL_FILTRO} value={vehDocs} onChange={e => setVehDocs(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(DOC_ESTADO_FILTRO_LABELS).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </FiltroCampo>
          <FiltroCampo label="Disponible" className="min-w-32">
            <select className={CLASE_CONTROL_FILTRO} value={vehDisponible} onChange={e => setVehDisponible(e.target.value)}>
              <option value="">Todos</option>
              <option value="1">Sí, activo</option>
              <option value="0">No disponible</option>
            </select>
          </FiltroCampo>
          <FiltroCampo label="Combustible">
            <select className={CLASE_CONTROL_FILTRO} value={vehCombustible} onChange={e => setVehCombustible(e.target.value)}>
              <option value="">Todos</option>
              {COMBUSTIBLES.map(c => <option key={c} value={c}>{COMBUSTIBLE_LABELS[c]}</option>)}
              <option value="sin">Sin declarar</option>
            </select>
          </FiltroCampo>
          <FiltroCampo label="Publicados desde" className="min-w-36">
            <input type="date" className={CLASE_CONTROL_FILTRO} value={vehDesde} max={vehHasta || undefined}
              onChange={e => setVehDesde(e.target.value)} />
          </FiltroCampo>
          <FiltroCampo label="hasta" className="min-w-36">
            <input type="date" className={CLASE_CONTROL_FILTRO} value={vehHasta} min={vehDesde || undefined}
              onChange={e => setVehHasta(e.target.value)} />
          </FiltroCampo>
          <BotonOrdenLlegada orden={vehOrden} onCambiar={setVehOrden} titulo="fecha de publicación" />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ResumenFiltros
            mostrados={
              verRevisionContenido ? vehiculosRevisionFiltrados.length
                : verArchivadosVehiculos ? vehiculosArchivadosFiltrados.length
                : vehiculosFiltrados.length
            }
            total={
              verRevisionContenido ? vehiculosRevisionContenido.length
                : verArchivadosVehiculos ? vehiculosArchivados.length
                : vehiculos.length
            }
            hayFiltros={hayFiltrosVehiculos}
            onLimpiar={limpiarFiltrosVehiculos}
            etiqueta={
              verRevisionContenido ? 'vehículos en revisión'
                : verArchivadosVehiculos ? 'vehículos archivados'
                : 'vehículos'
            }
          />
          <div className="flex items-center gap-2 flex-wrap">
            {vehiculosRevisionContenido.length > 0 && !verRevisionContenido && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-danger/15 text-danger border border-danger/25">
                {vehiculosRevisionContenido.length} en revisión de contenido
              </span>
            )}
            <button onClick={alternarVerRevisionContenido}
              className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                verRevisionContenido ? 'border-danger bg-danger text-white' : 'border-border text-ink/60 hover:bg-surface'
              }`}>
              {verRevisionContenido ? '← Ver vehículos activos' : '🔞 Ver en revisión de contenido'}
            </button>
            <button onClick={alternarVerArchivadosVehiculos}
              className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                verArchivadosVehiculos ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-surface'
              }`}>
              {verArchivadosVehiculos ? '← Ver vehículos activos' : '🗄️ Ver archivados'}
            </button>
          </div>
        </div>
      </div>
      {verRevisionContenido && (
        <div className="space-y-3">
          {vehiculosRevisionFiltrados.length === 0 && (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">
                {hayFiltrosVehiculos && vehiculosRevisionContenido.length > 0
                  ? 'Ningún vehículo en revisión coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                  : 'No hay vehículos en revisión de contenido.'}
              </p>
            </div>
          )}
          {vehiculosRevisionFiltrados.map(v => {
            let portada = '';
            try { portada = (JSON.parse(v.fotos) as string[])[0] || ''; } catch { portada = ''; }
            // Se calcula UNA vez por tarjeta (parsea dos JSON): la miniatura necesita
            // cuántas fotos hay para saber si vale la pena ofrecer el visor.
            const fotosV = fotosDeVehiculo(v);
            return (
              <div key={v.id} className="bg-surface-2 rounded-2xl shadow-sm p-4 border border-danger/30 ring-1 ring-danger/20 flex gap-4 items-center flex-wrap">
                <MiniaturaVehiculo portada={portada} alt={`${v.marca} ${v.modelo}`}
                  cantidad={fotosV.length} onAbrir={() => abrirVisorVehiculo(v, portada)} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                  <p className="text-sm text-ink/50 mt-0.5">Propietario: {v.propietario_nombre} {v.placa && `· Placa: ${v.placa}`}</p>
                  <p className="text-xs text-ink/40 mt-0.5" title={`Se publicó el ${fechaRegistroLarga(v.created_at)}`}>
                    Publicado: {fechaRegistroCorta(v.created_at)}
                  </p>
                  <p className="text-xs text-danger mt-1">🔞 {v.contenido_revision_motivo || 'La IA marcó al menos una foto como contenido inapropiado.'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => abrirFotoModal(v)}
                    className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                    Ver fotos
                  </button>
                  <button onClick={() => aprobarContenidoVehiculo(v)} disabled={aprobandoContenido === v.id}
                    className="flex items-center gap-1 text-xs border border-success/30 text-success px-2.5 py-1.5 rounded-xl hover:bg-success/10 transition font-medium disabled:opacity-50">
                    {aprobandoContenido === v.id ? 'Aprobando…' : '✓ Aprobar y publicar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {verArchivadosVehiculos && (
        <div className="space-y-3">
          {vehiculosArchivadosFiltrados.length === 0 && (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">
                {hayFiltrosVehiculos && vehiculosArchivados.length > 0
                  ? 'Ningún vehículo archivado coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                  : 'No hay vehículos archivados.'}
              </p>
            </div>
          )}
          {vehiculosArchivadosFiltrados.map(v => {
            let portada = '';
            try { portada = (JSON.parse(v.fotos) as string[])[0] || ''; } catch { portada = ''; }
            // Se calcula UNA vez por tarjeta (parsea dos JSON): la miniatura necesita
            // cuántas fotos hay para saber si vale la pena ofrecer el visor.
            const fotosV = fotosDeVehiculo(v);
            return (
              <div key={v.id} className="bg-surface-2 rounded-2xl shadow-sm p-4 border border-border flex gap-4 items-center flex-wrap">
                <MiniaturaVehiculo portada={portada} alt={`${v.marca} ${v.modelo}`} atenuada
                  cantidad={fotosV.length} onAbrir={() => abrirVisorVehiculo(v, portada)} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                  <p className="text-sm text-ink/50 mt-0.5">Propietario: {v.propietario_nombre} {v.placa && `· Placa: ${v.placa}`}</p>
                  <p className="text-xs text-ink/40 mt-0.5" title={`Se publicó el ${fechaRegistroLarga(v.created_at)}`}>
                    Publicado: {fechaRegistroCorta(v.created_at)}
                  </p>
                </div>
                <button onClick={() => desarchivarVehiculo(v)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-success/30 text-success hover:bg-success/10 transition font-medium">
                  📤 Desarchivar
                </button>
              </div>
            );
          })}
        </div>
      )}
      {!verArchivadosVehiculos && !verRevisionContenido && (
        <div className="space-y-3">
          {errorListas.vehiculos ? (
            <div className="text-center py-14 bg-danger/5 rounded-2xl border border-danger/25">
              <p className="text-danger mb-4">No pudimos cargar los vehículos. Revisa tu conexión.</p>
              <button onClick={cargarVehiculos} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
            </div>
          ) : vehiculosFiltrados.length === 0 && (
            <div className="text-center py-14 bg-surface-2 rounded-2xl border border-border">
              <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
              <p className="text-ink/50">
                {hayFiltrosVehiculos && vehiculos.length > 0
                  ? 'Ningún vehículo coincide con estos filtros. Prueba a quitar alguno o usa “✕ Limpiar filtros”.'
                  : 'No hay vehículos publicados aún.'}
              </p>
            </div>
          )}
          {vehiculosFiltrados.map(v => {
            let portada = '';
            try { portada = (JSON.parse(v.fotos) as string[])[0] || ''; } catch { portada = ''; }
            // Se calcula UNA vez por tarjeta (parsea dos JSON): la miniatura necesita
            // cuántas fotos hay para saber si vale la pena ofrecer el visor.
            const fotosV = fotosDeVehiculo(v);
            const sinPrecioV = !v.precio_dia || v.precio_dia === 0;
            const editandoPrecio = (vid: number) => vid in precioEdit;
            // La exención entra en la decisión: los eléctricos (y los híbridos/GNV que ya
            // inscribieron el trámite ante la Secretaría de Movilidad) están exentos en
            // Medellín (ver lib/pico-placa.ts), así que no se les pinta el borde rojo ni el badge.
            const enPP = placaRestringida(picoPlaca, v.placa ?? '', new Date(),
              { combustible: v.combustible, inscrita: v.exencion_pico_placa_inscrita });
            const leftBorder = enPP ? 'border-danger' : sinPrecioV ? 'border-accent' : 'border-transparent';
            // `disponible=0` ya se explica visualmente cuando hay un badge de documentos_estado
            // "en revisión" o "denegado" (ver más abajo). Pero también puede estar en 0 sin
            // documentos subidos (documentos_estado='sin_documentos', p. ej. un vehículo recién
            // publicado) o en cualquier otro estado que no lo explique — en esos casos, sin este
            // badge, el vehículo no tenía NINGÚN indicador visual de por qué no es visible al
            // público (así fue como un caso real quedó invisible en las 3 pestañas del panel).
            const noDisponibleSinExplicar = Number(v.disponible) === 0
              && v.documentos_estado !== 'en_revision' && v.documentos_estado !== 'denegado';

            return (
              <div key={v.id} className={`bg-surface-2 rounded-2xl shadow-sm p-4 border-l-4 ${leftBorder} ${enPP ? 'ring-1 ring-danger/30 bg-danger/5' : ''} ${!enPP && !sinPrecioV ? 'border' : ''}`}
                style={!enPP && !sinPrecioV ? { borderWidth: '1px', borderColor: 'var(--color-border)' } : {}}>
                <div className="flex gap-4 items-start flex-wrap">
                  <MiniaturaVehiculo portada={portada} alt={`${v.marca} ${v.modelo}`}
                    cantidad={fotosV.length} onAbrir={() => abrirVisorVehiculo(v, portada)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-ink">{v.marca} {v.modelo} {v.anio}</p>
                      <span className="text-xs bg-brand-muted text-ink/60 px-2 py-0.5 rounded-full capitalize">{v.tipo}</span>
                      {sinPrecioV && (
                        <span className="text-xs bg-accent-light text-accent px-2 py-0.5 rounded-full font-semibold">Sin precio</span>
                      )}
                      {enPP && (
                        <span className="text-xs bg-danger/15 text-danger px-2 py-0.5 rounded-full font-bold border border-danger/30">🚦 Pico y placa hoy</span>
                      )}
                      {noDisponibleSinExplicar && (
                        <span className="text-xs bg-ink/10 text-ink/60 px-2 py-0.5 rounded-full font-semibold border border-border">⛔ No disponible</span>
                      )}
                    </div>
                    <p className="text-sm text-ink/50 mt-0.5">Propietario: {v.propietario_nombre}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {v.placa && <span className="text-xs text-ink/50">Placa: {v.placa}</span>}
                      {/* Cuándo llegó este carro a la plataforma (created_at, en UTC → se
                          pasa a hora de Medellín en lib/fecha-registro.ts). */}
                      <span className="text-xs text-ink/40" title={`Se publicó el ${fechaRegistroLarga(v.created_at)}`}>
                        📅 Publicado: {fechaRegistroCorta(v.created_at)}
                      </span>
                      {v.documentos_estado === 'en_revision' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25">📄 En revisión</span>
                      )}
                      {v.documentos_estado === 'aprobado' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">✓ Docs aprobados</span>
                      )}
                      {v.documentos_estado === 'denegado' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25">✗ Docs denegados</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {sinPrecioV || editandoPrecio(v.id) ? (
                      <>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/50 text-xs">$</span>
                          <input
                            type="number" min="1" placeholder="Precio/día"
                            className="border border-border rounded-xl pl-6 pr-2 py-2 text-sm text-ink bg-surface w-32 focus:outline-none focus:ring-2 focus:ring-accent/40"
                            value={precioEdit[v.id] ?? (v.precio_dia > 0 ? String(v.precio_dia) : '')}
                            onChange={e => setPrecioEdit(p => ({ ...p, [v.id]: e.target.value }))}
                          />
                        </div>
                        <button onClick={() => guardarPrecio(v.id)}
                          className="flex items-center gap-1 bg-accent hover:bg-accent-hover text-white px-3 py-2 rounded-xl text-xs font-semibold transition">
                          <IconCheck size={12} /> Guardar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-accent font-bold">${v.precio_dia.toLocaleString('es-CO')}/día</span>
                        <button onClick={() => setPrecioEdit(p => ({ ...p, [v.id]: String(v.precio_dia) }))}
                          className="text-xs border border-border text-ink/50 px-2.5 py-1.5 rounded-xl hover:bg-surface transition font-medium">
                          Editar
                        </button>
                      </>
                    )}
                    <button onClick={() => toggleVitrina(v)}
                      title={v.en_vitrina ? 'Quitar de la vitrina del inicio' : 'Mostrar en la vitrina del inicio'}
                      className={`flex items-center gap-1 text-xs border px-2.5 py-1.5 rounded-xl transition font-medium ${
                        v.en_vitrina
                          ? 'border-accent bg-accent text-white hover:bg-accent-hover'
                          : 'border-border text-ink/60 hover:bg-surface'
                      }`}>
                      ⭐ {v.en_vitrina ? 'En vitrina' : 'Vitrina'}
                    </button>
                    <button onClick={() => toggleDisponible(v)}
                      title={v.disponible ? 'Desactivar (se oculta del catálogo público)' : 'Activar (requiere SOAT y Tecno-mecánica aprobados)'}
                      className={`flex items-center gap-1 text-xs border px-2.5 py-1.5 rounded-xl transition font-medium ${
                        v.disponible
                          ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
                          : 'border-border text-ink/60 hover:bg-surface'
                      }`}>
                      {v.disponible ? '✓ Activo' : 'Activar'}
                    </button>
                    <button onClick={() => abrirFotoModal(v)}
                      className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                      Fotos
                    </button>
                    <button onClick={() => abrirDispModal(v)}
                      title="Ver y modificar el calendario de disponibilidad de este vehículo"
                      className="flex items-center gap-1 text-xs border border-accent/30 text-accent px-2.5 py-1.5 rounded-xl hover:bg-accent-light transition font-medium">
                      📅 Disponibilidad
                    </button>
                    <button onClick={() => abrirDocModal(v)}
                      className={`flex items-center gap-1 text-xs border px-2.5 py-1.5 rounded-xl transition font-medium ${
                        v.documentos_estado === 'en_revision'
                          ? 'border-warning/30 text-warning bg-warning/10 hover:bg-warning/15'
                          : v.documentos_estado === 'aprobado'
                          ? 'border-success/30 text-success bg-success/10 hover:bg-success/15'
                          : v.documentos_estado === 'denegado'
                          ? 'border-danger/30 text-danger bg-danger/10 hover:bg-danger/15'
                          : 'border-border text-ink/60 hover:bg-surface'
                      }`}>
                      📄 Docs
                      {v.documentos_estado === 'en_revision' && <span className="w-1.5 h-1.5 rounded-full bg-warning/100 ml-0.5" />}
                    </button>
                    <button onClick={() => eliminarVehiculo(v)} disabled={eliminandoVehiculo === v.id}
                      title="Borra el vehículo si nunca tuvo reservas; si tuvo, lo archiva"
                      className="flex items-center gap-1 text-xs border border-danger/30 text-danger px-2.5 py-1.5 rounded-xl hover:bg-danger/10 transition font-medium disabled:opacity-50">
                      {eliminandoVehiculo === v.id ? 'Eliminando…' : '🗑️ Eliminar'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal fotos */}
      {fotoModal && (() => {
        const v = fotoModal.v;
        // Un solo parser para las dos columnas (lib/fotos-vehiculo.ts), el mismo que usan
        // los cambios de más abajo: lo que se ve en pantalla y lo que se guarda salen de
        // la misma lectura del dato.
        const fotos = leerFotos(v);
        const detalle = fotos.detalle;
        const tieneDetalle = Object.values(detalle).some(u => u.trim());
        // Fotos de la galería (`vehiculos.fotos`) que NO son ninguna de las siete casillas.
        // Antes este modal solo miraba `fotos_detalle`, así que un carro publicado con fotos
        // sueltas decía "no tiene fotos" aunque su miniatura sí se viera en la lista.
        const enCasillas = new Set(Object.values(detalle).filter(Boolean));
        const sueltas = fotos.galeria.filter(u => !enCasillas.has(u));
        // `fotos[0]` = portada: lo único que mira la tarjeta del catálogo. Se marca en la
        // rejilla para que borrarla no sea una sorpresa (ver lib/fotos-vehiculo.ts).
        const portada = fotos.galeria[0] || '';
        const hayAlgo = tieneDetalle || sueltas.length > 0;
        // Un guardado en curso bloquea TODAS las demás acciones del modal: dos cambios a la
        // vez se calcularían sobre la misma foto de partida y el segundo pisaría al primero.
        const ocupado = fotosOcupado !== null;
        const marcaPortada = (url: string) => (url && url === portada ? ' · ★ portada' : '');
        /** Caja de subida: la MISMA de la publicación del propietario (components/FotoUpload.tsx),
         *  o sea que sube por POST /api/upload — el único camino que difumina la placa y deja
         *  registro de moderación. No hay otra vía de subida en este panel. */
        const cajaSubir = (etiqueta: string, ranura: string, onUrl: (url: string) => void) => (
          <div className={ocupado ? 'opacity-50 pointer-events-none' : ''}>
            <FotoUpload label={etiqueta} value="" onChange={onUrl} />
            {fotosOcupado === ranura && <p className="text-[11px] text-ink/50 mt-1">Guardando…</p>}
          </div>
        );
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { if (!ocupado) setFotoModal(null); }}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-start gap-3 mb-5">
                <div className="min-w-0">
                  <h3 className="font-bold text-ink">{v.marca} {v.modelo} — Fotos</h3>
                  {hayAlgo && <p className="text-[11px] text-ink/50 mt-0.5">Clic en una foto para verla completa y con zoom · “🛡️ Tapar placa” si quedó alguna a la vista.</p>}
                  {fotosEdit && <p className="text-[11px] text-ink/50 mt-0.5">Cada cambio se guarda solo. Eliminar una foto no se puede deshacer.</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button" onClick={() => { setFotosEdit(e => !e); setFotosMsg(''); setFotosError(''); }}
                    disabled={ocupado}
                    title={fotosEdit ? 'Volver a la vista de solo lectura' : 'Agregar, reemplazar o eliminar fotos de este vehículo'}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition disabled:opacity-50 ${
                      fotosEdit
                        ? 'border-accent bg-accent-light text-accent'
                        : 'border-accent/30 text-accent hover:bg-accent-light'
                    }`}>
                    {fotosEdit ? '✓ Listo' : '✏️ Editar fotos'}
                  </button>
                  <button onClick={() => { if (!ocupado) setFotoModal(null); }} aria-label="Cerrar" disabled={ocupado}
                    className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition disabled:opacity-40">
                    <IconX size={18} />
                  </button>
                </div>
              </div>
              <AvisoPlacas placas={placas} mensaje={placaMsg} />
              {fotosMsg && (
                <div className="mb-4 bg-success/10 border border-success/25 rounded-2xl px-3 py-2">
                  <p className="text-xs font-medium text-success">{fotosMsg}</p>
                </div>
              )}
              {fotosError && (
                <div className="mb-4 bg-danger/5 border border-danger/25 rounded-2xl px-3 py-2">
                  <p className="text-xs font-medium text-danger">{fotosError}</p>
                </div>
              )}
              {fotosEdit && (
                <p className="mb-4 text-[11px] text-ink/50 leading-snug">
                  Las fotos son del propietario: cada cambio queda en la bitácora con tu nombre y se le avisa a él.
                  Toda foto que subas pasa por el tapado automático de placa antes de publicarse.
                </p>
              )}
              {hayAlgo || fotosEdit ? (
                <div className="space-y-5">
                  {(tieneDetalle || fotosEdit) && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {Object.entries(FOTOS_LABELS).map(([key, label]) => (
                        <div key={key}>
                          {detalle[key] ? (
                            // Abre components/VisorFotos.tsx (el mismo de Operaciones): la
                            // miniatura va con object-cover, o sea RECORTADA — sin ampliar no
                            // se puede revisar un rayón ni leer una placa.
                            <FotoPlaca
                              url={detalle[key]} label={`${label}${marcaPortada(detalle[key])}`} alt={label}
                              estado={placas.de(detalle[key])}
                              onVer={() => abrirVisorVehiculo(v, detalle[key])}
                              onTapar={() => abrirEditorPlaca(v, detalle[key])} />
                          ) : !fotosEdit ? (
                            <>
                              <p className="text-xs text-ink/50 mb-1 font-medium">{label}</p>
                              <div className="w-full h-28 bg-surface rounded-xl flex items-center justify-center text-ink/25 text-xs border border-border">
                                Sin foto
                              </div>
                            </>
                          ) : null}
                          {fotosEdit && (
                            <div className={detalle[key] ? 'mt-2' : ''}>
                              {cajaSubir(
                                detalle[key] ? `Reemplazar ${label}` : label,
                                `casilla:${key}`,
                                url => { void ponerFotoCasilla(v, key, label, url); },
                              )}
                              {/* El botón de borrar va al FINAL de la tarjeta, lo más lejos
                                  posible de la miniatura (que en el celular es el botón de
                                  ampliar): un dedo no puede confundirlos. */}
                              {detalle[key] && (
                                <button
                                  type="button" onClick={() => { void borrarFotoCasilla(v, key, label); }}
                                  disabled={ocupado}
                                  className="mt-2 w-full text-[11px] font-semibold px-2 py-2 rounded-xl border border-danger/30 text-danger hover:bg-danger/10 transition disabled:opacity-50">
                                  {fotosOcupado === `casilla:${key}` ? 'Guardando…' : `🗑️ Eliminar ${label}`}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {(sueltas.length > 0 || fotosEdit) && (
                    <div>
                      <p className="text-xs text-ink/50 mb-2 font-medium">
                        Otras fotos de la publicación ({sueltas.length})
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {sueltas.map((url, i) => (
                          <div key={url}>
                            <FotoPlaca
                              url={url} label={portada === url ? '★ portada' : undefined}
                              alt={`Foto ${i + 1} de ${v.marca} ${v.modelo}`} estado={placas.de(url)}
                              onVer={() => abrirVisorVehiculo(v, url)}
                              onTapar={() => abrirEditorPlaca(v, url)} />
                            {fotosEdit && (
                              <button
                                type="button" onClick={() => { void borrarFotoSuelta(v, url, i + 1); }}
                                disabled={ocupado}
                                className="mt-2 w-full text-[11px] font-semibold px-2 py-2 rounded-xl border border-danger/30 text-danger hover:bg-danger/10 transition disabled:opacity-50">
                                {fotosOcupado === `suelta:${url}` ? 'Guardando…' : `🗑️ Eliminar foto ${i + 1}`}
                              </button>
                            )}
                          </div>
                        ))}
                        {fotosEdit && cajaSubir('Agregar otra foto', 'nueva', url => { void agregarFotoSuelta(v, url); })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <IconCar size={48} className="text-ink/20 mx-auto mb-3" />
                  <p className="text-ink/50">Este vehículo no tiene fotos todavía.</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Modal disponibilidad (calendario del vehículo) */}
      {dispModal && (() => {
        const v = dispModal.v;
        // Un admin con la sección "vehiculos" puede NO tener la sección "reservas" (GET
        // /api/reservas responde 403): en ese caso no sabemos qué días están reservados, así
        // que el calendario se muestra en SOLO LECTURA. Editar a ciegas podría pisar una
        // reserva sin que el admin lo vea (el servidor lo rechazaría, pero la UI no debe
        // ofrecer una edición que no puede verificar).
        const puedeEditar = reservasOk === true;
        const ocupadas = puedeEditar ? diasOcupadosVehiculo(v.id) : [];
        // El recuadro informativo habla de lo que hay HOY EN BD (`dispOriginal`), no del
        // borrador que se está editando: el borrador ya se ve en el propio calendario.
        const irrestricto = dispOriginal.length === 0;
        // Un admin puede ser también el propietario del vehículo: ahí no hay "calendario
        // ajeno" ni notificación al propietario (el servidor no se auto-notifica).
        const esAjeno = Number(v.propietario_id) !== miId;

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={cerrarDispModal}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-ink">{v.marca} {v.modelo} {v.anio} — Disponibilidad</h3>
                  {v.placa && <p className="text-xs text-ink/50 mt-0.5">Placa: {v.placa}</p>}
                  <p className="text-xs text-ink/50 mt-0.5">Propietario: <span className="font-semibold text-ink/70">{v.propietario_nombre}</span></p>
                </div>
                <button onClick={cerrarDispModal} aria-label="Cerrar"
                  className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                  <IconX size={18} />
                </button>
              </div>

              {/* Aviso: se está tocando el calendario de otra persona */}
              <div className="bg-warning/10 border border-warning/25 rounded-xl p-3 mb-4">
                <p className="text-xs text-warning font-semibold">
                  {esAjeno
                    ? `Estás editando el calendario de ${v.propietario_nombre}.`
                    : 'Estás editando el calendario de tu propio vehículo.'}
                </p>
                <p className="text-[11px] text-ink/60 mt-1">
                  {esAjeno
                    ? 'Todo cambio queda registrado en la Bitácora y se le notifica al propietario. Los días con una reserva activa no se pueden cerrar.'
                    : 'Los días con una reserva activa no se pueden cerrar.'}
                </p>
              </div>

              {!puedeEditar && (
                <div className="bg-danger/10 border border-danger/25 rounded-xl p-3 mb-4">
                  <p className="text-xs text-danger font-semibold">
                    {reservasOk === null ? 'Cargando reservas…' : 'No podemos verificar las reservas de este vehículo.'}
                  </p>
                  <p className="text-[11px] text-ink/60 mt-1">
                    {reservasOk === null
                      ? 'El calendario queda en solo lectura hasta terminar de cargar las reservas.'
                      : 'Tu cuenta no tiene acceso a la sección Reservas, así que no sabemos qué días están ocupados. El calendario queda en SOLO LECTURA para no pisar una reserva sin verla. Pídele a un administrador principal el permiso de "Reservas".'}
                  </p>
                </div>
              )}

              {/* Semántica invertida: sin días marcados = abierto, no cerrado */}
              <div className={`rounded-xl p-3 mb-4 border ${irrestricto ? 'bg-accent-light border-accent/25' : 'bg-surface border-border'}`}>
                <p className="text-xs text-ink/70">
                  {irrestricto
                    ? <>Hoy este vehículo está <span className="font-bold text-accent">abierto sin restricciones</span>: no hay ningún día marcado, así que todos los días quedan disponibles para reservar.</>
                    : <>Hoy este vehículo tiene <span className="font-bold text-accent">{dispOriginal.length} día{dispOriginal.length !== 1 ? 's' : ''}</span> marcado{dispOriginal.length !== 1 ? 's' : ''} como disponible{dispOriginal.length !== 1 ? 's' : ''}; el resto está cerrado.</>}
                </p>
                <p className="text-[11px] text-ink/50 mt-1">
                  Ojo con “Limpiar todo”: dejar el calendario vacío NO cierra el vehículo, lo abre por completo.
                </p>
                {dispHayCambios && (
                  <p className="text-[11px] text-warning font-semibold mt-1">
                    Estás editando un borrador: quedaría en {dispDias.length === 0 ? 'abierto sin restricciones (0 días marcados)' : `${dispDias.length} día${dispDias.length !== 1 ? 's' : ''} marcado${dispDias.length !== 1 ? 's' : ''}`}. Nada se guarda hasta que toques “Guardar cambios”.
                  </p>
                )}
              </div>

              {/* Edición LOCAL: el calendario emite `onChange` por cada celda, así que guardar
                  ahí mismo significaba un PUT (y una notificación al propietario) por clic.
                  Se acumula en el estado y se persiste con el botón "Guardar cambios". */}
              <CalendarioDisponibilidad
                value={dispDias}
                onChange={(dias) => { setDispDias(dias); setDispMsg(''); }}
                readOnly={!puedeEditar || dispGuardando}
                reservedDates={ocupadas}
                placa={v.placa}
                combustible={v.combustible}
                exencionInscrita={v.exencion_pico_placa_inscrita}
              />

              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <span className={`text-xs font-medium ${dispMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>
                  {dispGuardando
                    ? <span className="text-ink/50">Guardando…</span>
                    : dispMsg || (dispHayCambios
                      ? <span className="text-warning">Tienes cambios sin guardar.</span>
                      : null)}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={cerrarDispModal}
                    className="text-xs border border-border text-ink/60 px-3 py-2 rounded-xl hover:bg-surface transition font-medium">
                    Cerrar
                  </button>
                  {puedeEditar && (
                    <button
                      onClick={() => { void guardarDispDias(v, dispDias); }}
                      disabled={dispGuardando || !dispHayCambios}
                      className="text-xs bg-accent text-white px-4 py-2 rounded-xl hover:bg-accent-hover transition font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                      {dispGuardando ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal documentos */}
      {docModal && (() => {
        const v = docModal.v;
        let docs: Documentos = {};
        try { docs = JSON.parse(v.documentos || '{}'); } catch { docs = {}; }

        const docItems: { key: string; label: string; data: DocItem | { url: string } | undefined }[] = [
          { key: 'soat',       label: 'SOAT',                  data: docs.soat },
          { key: 'tecno',      label: 'Tecno-mecánica',         data: docs.tecno },
          { key: 'tarjeta',    label: 'Tarjeta de propiedad',   data: docs.tarjeta },
        ];

        const tieneDocs = docItems.some(d => d.data && 'url' in d.data && d.data.url);
        const estado = v.documentos_estado || 'sin_documentos';

        const ESTADO_BADGE: Record<string, string> = {
          sin_documentos: 'bg-surface text-ink/50 border-border',
          en_revision:    'bg-warning/15 text-warning border-warning/25',
          aprobado:       'bg-success/15 text-success border-success/30',
          denegado:       'bg-danger/15 text-danger border-danger/25',
        };
        const ESTADO_LABEL: Record<string, string> = {
          sin_documentos: 'Sin documentos',
          en_revision:    'En revisión',
          aprobado:       'Aprobado',
          denegado:       'Denegado',
        };

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDocModal(null)}>
            <div className="bg-surface-2 rounded-3xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h3 className="font-bold text-ink">{v.marca} {v.modelo} {v.anio} — Documentos</h3>
                  {v.placa && <p className="text-xs text-ink/50 mt-0.5">Placa: {v.placa}</p>}
                  <p className="text-xs text-ink/50 mt-0.5">Propietario: {v.propietario_nombre}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ESTADO_BADGE[estado] || ESTADO_BADGE.sin_documentos}`}>
                    {ESTADO_LABEL[estado] || estado}
                  </span>
                  <button onClick={() => setDocModal(null)} aria-label="Cerrar" className="p-1.5 rounded-xl text-ink/50 hover:text-ink hover:bg-surface transition">
                    <IconX size={18} />
                  </button>
                </div>
              </div>

              {/* Verificador con IA */}
              {tieneDocs && (
                <div className="mb-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <button
                      onClick={() => verificarConIA(v.id)}
                      disabled={iaCargando}
                      className="inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-xl gradient-accent text-white shadow hover:opacity-90 transition disabled:opacity-60"
                    >
                      {iaCargando
                        ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Analizando documentos…</>
                        : <><IconShield size={16} /> Verificar con IA</>}
                    </button>
                    <span className="text-xs text-ink/50">Lee SOAT, tecno y tarjeta de propiedad; valida fechas, placa y propietario.</span>
                  </div>

                  {iaError && (
                    <div className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">{iaError}</div>
                  )}

                  {iaVerif && iaVerif.vid === v.id && (
                    <div className="space-y-3">
                      <ResultadoIA res={iaVerif.res} auto={iaVerif.auto} />
                      <p className="text-[11px] text-ink/50 leading-relaxed">
                        La IA auto-aprueba solo documentos limpios de alta confianza; los marcados como revisión quedan a tu criterio abajo. Decisión final humana.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Documentos — revisión individual */}
              {!tieneDocs ? (
                <div className="text-center py-10 text-ink/50">
                  <p className="text-3xl mb-3">📄</p>
                  <p>Este vehículo no tiene documentos cargados aún.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {docItems.map(({ key, label, data }) => {
                    // Tecno-mecánica exenta (Ley 2294 de 2023) y sin nada subido: en vez de
                    // omitir la fila (que se vería igual que "simplemente falta"), se muestra
                    // un aviso explícito de que no aplica — consistente con el mismo aviso
                    // que ya se le muestra al propietario en su dashboard.
                    if (key === 'tecno' && !tecnoRequerida(v.anio) && (!data || !('url' in data) || !data.url)) {
                      return (
                        <div key={key} className="rounded-xl p-3 border bg-surface border-border">
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <p className="text-xs font-bold text-ink">{label}</p>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ink/10 text-ink/60 border border-border whitespace-nowrap">No exigible (vehículo &lt; 5 años)</span>
                          </div>
                          <p className="text-[11px] text-ink/50">✓ No aplica — vehículo de menos de 5 años (Ley 2294 de 2023). El propietario no necesita subir este documento.</p>
                        </div>
                      );
                    }
                    if (!data || !('url' in data) || !data.url) return null;
                    const isPdf = esPdfUrl(data.url);
                    const rev = docRevisiones[key] || { estado: 'pendiente', nota: '' };
                    const isReviewing = revisandoDoc?.key === key;
                    const isLoading = docAccionando === key;

                    return (
                      <div key={key} className={`rounded-xl p-3 border ${
                        rev.estado === 'aprobado' ? 'bg-success/10 border-success/30' :
                        rev.estado === 'denegado' ? 'bg-danger/10 border-danger/25' :
                        'bg-surface border-border'
                      }`}>
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <p className="text-xs font-bold text-ink">{label}</p>
                          {/* Tecno-mecánica: exención de la Ley 2294 de 2023 (ver lib/tecnomecanica.ts) —
                              vehículos con menos de 5 años (aprox. por año-modelo) no la requieren. Se
                              muestra igual si el propietario subió algo (ej. tecno vencida), pero este
                              badge aclara que NO cuenta para el estado agregado ni bloquea la publicación,
                              sin importar si el admin la aprueba o deniega abajo. */}
                          {key === 'tecno' && !tecnoRequerida(v.anio) && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ink/10 text-ink/60 border border-border whitespace-nowrap">No exigible (vehículo &lt; 5 años)</span>
                          )}
                          {rev.estado === 'aprobado' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30 whitespace-nowrap">✓ Aprobado</span>}
                          {rev.estado === 'denegado' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25 whitespace-nowrap">✗ Denegado</span>}
                          {rev.estado === 'pendiente' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 whitespace-nowrap">⏳ Pendiente</span>}
                        </div>

                        {/* Preview */}
                        {isPdf ? (
                          <div className="flex items-center gap-3 flex-wrap mb-2">
                            <a href={data.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-2 text-accent hover:text-accent-hover text-sm font-medium">
                              <span className="text-xl">📄</span> Ver PDF
                            </a>
                            <a href={urlDescarga(data.url)} download
                              className="flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
                              <IconExport size={12} /> Descargar
                            </a>
                          </div>
                        ) : (
                          <div className="mb-2">
                            <img src={data.url} alt={label} className="w-full h-24 object-cover rounded-lg border border-border" />
                            <a href={urlDescarga(data.url)} download
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
                              <IconExport size={12} /> Descargar
                            </a>
                          </div>
                        )}
                        {key === 'tarjeta' && 'url_dorso' in data && (data as { url_dorso?: string }).url_dorso && (
                          <div className="mb-2">
                            <p className="text-[10px] text-ink/50 mb-1">Dorso</p>
                            <img src={(data as { url_dorso?: string }).url_dorso} alt={`${label} (dorso)`} className="w-full h-24 object-cover rounded-lg border border-border" />
                            <a href={urlDescarga((data as { url_dorso?: string }).url_dorso as string)} download
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink/60 hover:text-accent transition">
                              <IconExport size={12} /> Descargar
                            </a>
                          </div>
                        )}
                        {key === 'tarjeta' && !('url_dorso' in data && (data as { url_dorso?: string }).url_dorso) && (
                          <p className="text-[11px] text-warning mb-2">⚠ Falta el dorso.</p>
                        )}
                        {'vence' in data && data.vence && <p className="text-[11px] text-ink/50 mb-1">Vence: {(data as { vence?: string }).vence}</p>}

                        {/* Denial note */}
                        {rev.estado === 'denegado' && rev.nota && (
                          <p className="text-[11px] text-danger bg-danger/10 border border-danger/25 rounded-lg px-2.5 py-1.5 mt-1.5">{rev.nota}</p>
                        )}

                        {/* Inline denial textarea */}
                        {isReviewing && (
                          <div className="mt-2 space-y-1.5">
                            <textarea
                              rows={2}
                              placeholder="Motivo del rechazo (opcional)…"
                              value={revisandoDoc.nota}
                              onChange={e => setRevisandoDoc(r => r ? { ...r, nota: e.target.value } : null)}
                              className="w-full border border-danger/25 rounded-xl px-3 py-2 text-xs text-ink bg-surface-2 focus:outline-none focus:ring-2 focus:ring-danger/40 resize-none"
                            />
                            <div className="flex gap-1.5">
                              <button disabled={isLoading} onClick={() => revisarDocIndividual(v.id, key, 'denegado', revisandoDoc.nota)}
                                className="flex-1 text-xs font-bold bg-danger/100 hover:bg-danger text-white px-3 py-1.5 rounded-xl transition disabled:opacity-50">
                                {isLoading ? 'Guardando…' : 'Confirmar rechazo'}
                              </button>
                              <button onClick={() => setRevisandoDoc(null)}
                                className="text-xs border border-border text-ink/60 px-3 py-1.5 rounded-xl hover:bg-surface-2 transition">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        {!isReviewing && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {rev.estado !== 'aprobado' && (
                              <button disabled={isLoading} onClick={() => revisarDocIndividual(v.id, key, 'aprobado', '')}
                                className="flex items-center gap-1 text-[11px] font-bold bg-success hover:bg-success text-white px-2.5 py-1.5 rounded-xl transition disabled:opacity-50">
                                <IconCheck size={11}/> {isLoading ? '…' : 'Aprobar'}
                              </button>
                            )}
                            {rev.estado !== 'denegado' && !isReviewing && (
                              <button onClick={() => setRevisandoDoc({ key, nota: '' })}
                                className="flex items-center gap-1 text-[11px] font-bold border border-danger/25 text-danger hover:bg-danger/10 px-2.5 py-1.5 rounded-xl transition">
                                <IconX size={11}/> Denegar
                              </button>
                            )}
                            {(rev.estado === 'aprobado' || rev.estado === 'denegado') && (
                              <button disabled={isLoading} onClick={() => revisarDocIndividual(v.id, key, 'pendiente', '')}
                                className="text-[11px] border border-border text-ink/50 hover:bg-surface-2 px-2.5 py-1.5 rounded-xl transition disabled:opacity-50">
                                Resetear
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Carátula de la póliza del vehículo — la carga DrivePass, no el propietario.
                  Va FUERA de la lista de arriba (y fuera del `tieneDocs`) a propósito: no
                  pertenece al flujo de revisión del propietario, no cuenta para el estado
                  agregado y tiene que poder cargarse aunque el carro todavía no tenga ningún
                  otro documento. Ver lib/poliza-vehiculo.ts. */}
              <div className="mt-4">
                <PolizaVehiculoAdmin
                  key={v.id}
                  vehiculoId={v.id}
                  documentos={v.documentos}
                  titulo={`${v.marca} ${v.modelo} ${v.anio}${v.placa ? ` · ${v.placa}` : ''}`}
                  onGuardado={docsJson => {
                    setVehiculos(vs => vs.map(x => x.id === v.id ? { ...x, documentos: docsJson } : x));
                    setDocModal(d => d ? { v: { ...d.v, documentos: docsJson } } : null);
                  }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Visor de fotos a pantalla completa — el MISMO componente que usan Operaciones y
          la pantalla del mensajero (components/VisorFotos.tsx): zoom, flechas, pellizco en
          móvil y cierre con Escape. Va al final y con su propio z-index (z-[100]), por
          encima del modal de fotos desde el que también se abre. */}
      {visorFotos && (
        <VisorFotos
          fotos={visorFotos.fotos}
          indice={visorFotos.indice}
          titulo={visorFotos.titulo}
          onIndice={i => setVisorFotos(v => (v ? { ...v, indice: i } : v))}
          onCerrar={() => setVisorFotos(null)} />
      )}

      {/* Tapado MANUAL de placa: red de seguridad para cuando la detección automática no
          tapó la placa (o tapó donde no era). Ver components/TaparPlacaManual.tsx. */}
      {placaEditor && (
        <TaparPlacaManual
          vehiculoId={placaEditor.v.id}
          url={placaEditor.url}
          origenUrl={placaEditor.origenUrl}
          titulo={tituloVehiculo(placaEditor.v)}
          onCerrar={() => setPlacaEditor(null)}
          onGuardado={(nuevaUrl, aviso) => {
            const { v, url: anterior } = placaEditor;
            setPlacaEditor(null);
            setPlacaMsg(aviso || 'Listo: la placa quedó tapada y la foto publicada se actualizó. La original se conserva por si hay que rehacerlo.');
            if (nuevaUrl) {
              // El modal abierto tiene una copia del vehículo: se actualiza en el acto para
              // que la miniatura muestre ya la foto sellada, sin esperar a la recarga.
              setFotoModal(fm => (fm && fm.v.id === v.id ? { v: vehiculoConFotoCambiada(fm.v, anterior, nuevaUrl) } : fm));
              setVehiculos(vs => vs.map(x => (x.id === v.id ? vehiculoConFotoCambiada(x, anterior, nuevaUrl) : x)));
              setVehiculosRevisionContenido(vs => vs.map(x => (x.id === v.id ? vehiculoConFotoCambiada(x, anterior, nuevaUrl) : x)));
              setVehiculosArchivados(vs => vs.map(x => (x.id === v.id ? vehiculoConFotoCambiada(x, anterior, nuevaUrl) : x)));
            }
            placas.recargar();
          }}
        />
      )}
    </>
  );
}
