'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { IconBus, IconX, IconUsers } from '@/components/Icons';
import { BUS_CATEGORIAS } from '@/lib/busCotizador';
import BusVitrinaCard, { type BusPublico } from '@/components/buses/BusVitrinaCard';
import CotizadorPublico from '@/components/buses/CotizadorPublico';

// Vitrina pública del Cotizador de Buses (COTIZADOR-BUSES-SPEC.md §8, Etapa 6). Sin sesión:
// consume únicamente GET /api/buses (sin `panelAdmin` ni `propietarioId`, así que el propio
// endpoint ya filtra a disponible=1 AND contenido_revision=0, ver app/api/buses/route.ts) y
// POST /api/buses/cotizar (también público). No se toca ningún endpoint ni tabla — solo se
// consume lo que ya existe.
function BusesContent() {
  const searchParams = useSearchParams();
  const busIdParam = searchParams.get('id');

  const [buses, setBuses] = useState<BusPublico[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [categoria, setCategoria] = useState('');
  // Arranca con lo que traiga el enlace: la franja «¿Viajan en grupo?» de la portada
  // manda acá el número que la persona ya escribió, y volvérselo a pedir sería tratar
  // su respuesta como si no contara.
  const [pasajeros, setPasajeros] = useState(searchParams.get('pasajeros') || '');
  const [seleccionado, setSeleccionado] = useState<BusPublico | null>(null);
  // Deep-link `/buses?id=<vehiculoId>` (ver app/vehiculos/[id]/page.tsx): mientras se resuelve
  // el bus puntual, no mostramos la vitrina filtrable de fondo para evitar el parpadeo de
  // "vitrina completa -> cotizador de un solo bus".
  const [cargandoDeepLink, setCargandoDeepLink] = useState(!!busIdParam);

  useEffect(() => {
    if (!busIdParam) return;
    fetch(`/api/buses/${busIdParam}`)
      .then(r => r.json())
      .then(d => { if (d.bus) setSeleccionado(d.bus); })
      .catch(() => {})
      .finally(() => setCargandoDeepLink(false));
  }, [busIdParam]);

  const cargar = async () => {
    setLoading(true);
    setErrorCarga('');
    const p = new URLSearchParams();
    // `categoria` explícita manda sobre `pasajeros` — mismo criterio que ya resuelve el
    // propio backend (ver GET /api/buses: `categoriaParam || (pasajerosParam ? ... : null)`),
    // así que basta con no mandar ambos a la vez.
    if (categoria) p.set('categoria', categoria);
    else if (pasajeros) p.set('pasajeros', pasajeros);
    try {
      const res = await fetch('/api/buses?' + p.toString());
      const data = await res.json();
      setBuses(data.buses || []);
    } catch {
      setErrorCarga('No pudimos cargar los buses disponibles. Revisa tu conexión.');
    } finally {
      setLoading(false);
    }
  };

  const limpiar = () => { setCategoria(''); setPasajeros(''); };
  // Re-consulta al montar y cada vez que cambia un filtro (mismo patrón que el filtro de tipo
  // en app/page.tsx, pero automático en vez de esperar un botón "Filtrar": los dos filtros de
  // buses son simples de por sí, así que no hace falta un paso extra de confirmación).
  useEffect(() => { cargar(); }, [categoria, pasajeros]); // eslint-disable-line react-hooks/exhaustive-deps

  if (seleccionado) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <CotizadorPublico bus={seleccionado} onVolver={() => setSeleccionado(null)} />
      </div>
    );
  }

  if (cargandoDeepLink) {
    return <div className="text-center py-20 text-ink/50">Cargando...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <IconBus size={22} className="text-accent" /> Alquiler de buses y busetas
        </h1>
        <p className="text-ink/50 text-sm mt-1">
          Cotiza en segundos tu viaje ocasional: por destino, por trayecto o por horas de disponibilidad.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-surface-2 rounded-2xl shadow-sm border border-border p-4 mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Categoría</label>
            <select value={categoria}
              onChange={e => { setCategoria(e.target.value); if (e.target.value) setPasajeros(''); }}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
              <option value="">Todas</option>
              {BUS_CATEGORIAS.map(c => (
                <option key={c.codigo} value={c.codigo}>{c.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1 flex items-center gap-1">
              <IconUsers size={12} /> ¿Cuántos pasajeros necesitas?
            </label>
            <input type="number" min={1} placeholder="Ej. 20"
              value={pasajeros}
              onChange={e => { setPasajeros(e.target.value); if (e.target.value) setCategoria(''); }}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
        </div>
        {(categoria || pasajeros) && (
          <button onClick={limpiar}
            className="mt-3 flex items-center gap-1.5 text-sm text-accent font-medium transition px-3 py-2 rounded-xl border border-accent/20 bg-accent-light hover:bg-accent/10">
            <IconX size={13} /> Limpiar filtros
          </button>
        )}
      </div>

      {/* Grid buses */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface-2 rounded-2xl h-72 animate-pulse border border-border">
              <div className="h-48 bg-brand-muted rounded-t-2xl" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-brand-muted rounded w-2/3" />
                <div className="h-3 bg-brand-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : errorCarga ? (
        <div className="text-center py-20 bg-surface-2 rounded-2xl border border-border">
          <p className="text-ink/50 font-medium mb-4">{errorCarga}</p>
          <button onClick={cargar} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-xl text-sm">Reintentar</button>
        </div>
      ) : buses.length === 0 ? (
        <div className="text-center py-20 bg-surface-2 rounded-2xl border border-border">
          <IconBus size={48} className="text-ink/20 mx-auto mb-4" />
          <p className="text-ink/50 font-medium">No hay buses disponibles con esos filtros por ahora.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {buses.map(b => (
            <BusVitrinaCard key={b.id} bus={b} onSeleccionar={setSeleccionado} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BusesPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-ink/50">Cargando...</div>}>
      <BusesContent />
    </Suspense>
  );
}
