'use client';
// ── Mercado: el comparador de precios de la competencia ─────────────────────
//
// La pestaña «Mercado» del panel de siempre, extraída TAL CUAL de
// app/dashboard/admin/page.tsx para que las DOS pantallas monten el mismo componente:
// /dashboard/admin y /panel (sección Mercado, grupo Catálogo).
//
// CUÁNDO PIDE LOS DATOS: igual que antes, al entrar a la sección y no al abrir la
// pantalla — de ahí la prop `activa`, que en /dashboard/admin vale `tab === 'mercado'`
// (la sección se queda montada al cambiar de pestaña para no perder lo escrito) y en
// /panel se deja en su valor por defecto, porque allá la sección solo existe mientras
// se está mirando.
//
// Si una verificación cambió precios, se vuelve a pedir la lista de vehículos
// compartida (components/panel/DatosAdmin.tsx) para que la sección Vehículos no quede
// mostrando los precios viejos.
import { useEffect, useState } from 'react';
import { useDatosAdmin } from '@/components/panel/DatosAdmin';
import { IconCheck, IconShield, IconX } from '@/components/Icons';


export default function MercadoSeccion({ activa = true }: { activa?: boolean }) {
  const { cargarVehiculos } = useDatosAdmin();

  type PrecioRow = { sedan: number | null; suv: number | null; compacto: number | null; pickup: number | null; encontrado: number; nota: string; fecha: string };
  type CompetidorUI = { id: number; nombre: string; url: string; activo: number; ajuste_pct: number; auto_actualizar: number; ultimo_check: string | null; ultimo_precio: PrecioRow | null };
  const [competidores, setCompetidores] = useState<CompetidorUI[]>([]);
  const [mercadoLoading, setMercadoLoading] = useState(false);
  const [mercadoChecking, setMercadoChecking] = useState(false);
  const [mercadoMsg, setMercadoMsg] = useState('');
  const [nuevoComp, setNuevoComp] = useState({ nombre: '', url: '', ajuste_pct: '-5', auto_actualizar: false });
  const [confirmarElimComp, setConfirmarElimComp] = useState<number | null>(null);

  const cargarMercado = () => {
    setMercadoLoading(true);
    fetch('/api/admin/mercado')
      .then(r => r.json())
      .then(d => setCompetidores(d.competidores || []))
      .catch(() => {})
      .finally(() => setMercadoLoading(false));
  };

  // Misma condición que tenía el efecto original del panel (`if (tab === 'mercado')`):
  // se recarga al entrar a la sección, no al abrir la pantalla.
  useEffect(() => {
    if (activa) cargarMercado();
  }, [activa]);

  const agregarCompetidor = async () => {
    if (!nuevoComp.nombre || !nuevoComp.url) return;
    try {
      const res = await fetch('/api/admin/mercado', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nuevoComp, ajuste_pct: Number(nuevoComp.ajuste_pct), auto_actualizar: nuevoComp.auto_actualizar ? 1 : 0 }),
      });
      if (res.ok) { setNuevoComp({ nombre: '', url: '', ajuste_pct: '-5', auto_actualizar: false }); cargarMercado(); }
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const eliminarCompetidor = async (id: number) => {
    if (confirmarElimComp !== id) { setConfirmarElimComp(id); return; }
    setConfirmarElimComp(null);
    try {
      await fetch('/api/admin/mercado', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      cargarMercado();
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const toggleActivoComp = async (id: number, activo: number) => {
    try {
      await fetch('/api/admin/mercado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, activo: activo ? 0 : 1 }) });
      cargarMercado();
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const toggleAutoComp = async (id: number, auto: number) => {
    try {
      await fetch('/api/admin/mercado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, auto_actualizar: auto ? 0 : 1 }) });
      cargarMercado();
    } catch { /* el usuario puede reintentar el clic */ }
  };

  const ejecutarCheck = async () => {
    setMercadoChecking(true);
    setMercadoMsg('');
    try {
      const res = await fetch('/api/admin/mercado/check', { method: 'POST' });
      const d = await res.json() as { mensaje?: string; cambios?: string[] };
      setMercadoMsg(d.mensaje || '✓ Verificación completada');
      cargarMercado();
      if ((d.cambios?.length ?? 0) > 0) cargarVehiculos();
    } catch { setMercadoMsg('Error al ejecutar la verificación'); }
    setMercadoChecking(false);
  };


  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-bold text-ink text-lg">Comparador de precios de mercado</h2>
          <p className="text-sm text-ink/50">
            La IA analiza las páginas de tu competencia y ajusta los precios automáticamente cada mañana a las 6am.
          </p>
        </div>
        <button onClick={ejecutarCheck} disabled={mercadoChecking}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-60 text-sm">
          <IconShield size={15} />
          {mercadoChecking ? 'Analizando…' : '▶ Verificar ahora'}
        </button>
      </div>

      {mercadoMsg && (
        <div className="text-sm px-4 py-2.5 rounded-xl border bg-brand-muted border-border text-ink">
          {mercadoMsg}
        </div>
      )}

      {/* Cron setup */}
      <div className="bg-surface-2 rounded-2xl border border-border p-4">
        <p className="text-xs font-bold text-ink/50 uppercase tracking-widest mb-2">Cron automático (6am diario)</p>
        <code className="text-xs bg-surface rounded-xl px-3 py-2 border border-border block text-ink/70 break-all">
          0 6 * * * /ruta/a/rentdrive/scripts/mercado-cron.sh &gt;&gt; /tmp/mercado-cron.log 2&gt;&amp;1
        </code>
        <p className="text-[11px] text-ink/50 mt-2">
          Asegúrate de tener <code>CRON_SECRET</code> y <code>APP_URL</code> en <code>.env.local</code>.
        </p>
      </div>

      {/* Agregar competidor */}
      <div className="bg-surface-2 rounded-2xl border border-border p-5">
        <h3 className="font-bold text-ink mb-4">+ Agregar competidor</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Nombre</label>
            <input placeholder="Ej. Localiza Colombia"
              value={nuevoComp.nombre}
              onChange={e => setNuevoComp(n => ({ ...n, nombre: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">URL de su página de precios</label>
            <input placeholder="https://www.localiza.com/co/..."
              value={nuevoComp.url}
              onChange={e => setNuevoComp(n => ({ ...n, url: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60 block mb-1">Ajuste vs. mercado (%)</label>
            <input type="number" placeholder="-5"
              value={nuevoComp.ajuste_pct}
              onChange={e => setNuevoComp(n => ({ ...n, ajuste_pct: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
            <p className="text-[11px] text-ink/50 mt-1">-5 = 5% más barato que el promedio. 0 = igualar el mercado.</p>
          </div>
          <div className="flex flex-col justify-center gap-2 pt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox"
                checked={nuevoComp.auto_actualizar}
                onChange={e => setNuevoComp(n => ({ ...n, auto_actualizar: e.target.checked }))}
                className="w-4 h-4 accent-accent" />
              <span className="text-sm text-ink font-medium">Actualizar precios automáticamente</span>
            </label>
            <p className="text-[11px] text-ink/50">Si activo, el cron modifica los precios de tus vehículos cada día.</p>
          </div>
        </div>
        <button onClick={agregarCompetidor}
          disabled={!nuevoComp.nombre || !nuevoComp.url}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-40">
          <IconCheck size={14} /> Agregar
        </button>
      </div>

      {/* Lista de competidores */}
      {mercadoLoading ? (
        <div className="space-y-3">{[1, 2].map(i => <div key={i} className="bg-surface-2 rounded-2xl border border-border h-28 animate-pulse" />)}</div>
      ) : competidores.length === 0 ? (
        <div className="text-center py-12 bg-surface-2 rounded-2xl border border-border">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-ink/50 text-sm">Aún no has agregado ningún competidor.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {competidores.map(c => {
            const p = c.ultimo_precio;
            const tiposConPrecio = p && p.encontrado ? [
              p.sedan && `Sedán $${p.sedan.toLocaleString('es-CO')}`,
              p.suv && `SUV $${p.suv.toLocaleString('es-CO')}`,
              p.compacto && `Compacto $${p.compacto.toLocaleString('es-CO')}`,
              p.pickup && `Pickup $${p.pickup.toLocaleString('es-CO')}`,
            ].filter(Boolean) : [];

            return (
              <div key={c.id} className={`bg-surface-2 rounded-2xl border p-5 ${c.activo ? 'border-border' : 'border-border/50 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-ink">{c.nombre}</p>
                      {c.auto_actualizar === 1 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/20">⚡ Auto-precio</span>
                      )}
                      {c.ajuste_pct !== 0 && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          c.ajuste_pct < 0 ? 'bg-success/10 text-success border-success/30' : 'bg-warning/10 text-warning border-warning/25'
                        }`}>
                          {c.ajuste_pct > 0 ? '+' : ''}{c.ajuste_pct}% vs mercado
                        </span>
                      )}
                    </div>
                    <a href={c.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-accent/70 hover:text-accent transition truncate block max-w-xs mt-0.5">
                      {c.url}
                    </a>
                    {c.ultimo_check && (
                      <p className="text-[11px] text-ink/50 mt-0.5">
                        Último check: {c.ultimo_check.split('T')[0]} {c.ultimo_check.split('T')[1]?.slice(0, 5)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => toggleActivoComp(c.id, c.activo)}
                      className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                        c.activo ? 'border-success/30 text-success hover:bg-success/10' : 'border-border text-ink/50 hover:border-accent/30 hover:text-accent'
                      }`}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </button>
                    <button onClick={() => toggleAutoComp(c.id, c.auto_actualizar)}
                      className={`text-xs px-3 py-1.5 rounded-xl border transition font-medium ${
                        c.auto_actualizar ? 'border-accent/30 text-accent bg-accent/10' : 'border-border text-ink/50'
                      }`}>
                      {c.auto_actualizar ? '⚡ Auto ON' : 'Auto OFF'}
                    </button>
                    <button onClick={() => eliminarCompetidor(c.id)}
                      onBlur={() => setConfirmarElimComp(cur => cur === c.id ? null : cur)}
                      aria-label={confirmarElimComp === c.id ? 'Confirmar eliminación' : 'Eliminar competidor'}
                      title={confirmarElimComp === c.id ? 'Confirmar eliminación' : 'Eliminar competidor'}
                      className={`text-xs border px-2.5 py-1.5 rounded-xl transition font-medium flex items-center gap-1 ${
                        confirmarElimComp === c.id ? 'border-danger bg-danger text-white' : 'border-danger/25 text-danger hover:bg-danger/10'
                      }`}>
                      <IconX size={12} /> {confirmarElimComp === c.id && '¿Seguro?'}
                    </button>
                  </div>
                </div>

                {/* Precios encontrados */}
                {p ? (
                  p.encontrado ? (
                    <div className="border-t border-border pt-3">
                      <div className="flex flex-wrap gap-2 mb-1">
                        {tiposConPrecio.map(t => (
                          <span key={t as string} className="text-xs bg-success/10 border border-success/30 text-success font-medium px-2.5 py-1 rounded-xl">
                            {t}
                          </span>
                        ))}
                      </div>
                      {p.nota && <p className="text-[11px] text-ink/50 mt-1">{p.nota}</p>}
                    </div>
                  ) : (
                    <div className="border-t border-border pt-3">
                      <p className="text-xs text-warning">⚠ Sin precios en el último check</p>
                      {p.nota && <p className="text-[11px] text-ink/50 mt-0.5">{p.nota}</p>}
                    </div>
                  )
                ) : (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs text-ink/50">Sin verificaciones aún. Haz clic en "Verificar ahora".</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Advertencia JS */}
      <div className="bg-surface-2 rounded-xl border border-border/60 p-4">
        <p className="text-xs font-bold text-ink/50 uppercase tracking-wide mb-1">Importante</p>
        <p className="text-xs text-ink/50">
          La IA analiza el HTML estático de las páginas. Sitios que usan JavaScript para cargar precios (Sixt, Europcar, etc.) pueden aparecer como "Sin precios" — en ese caso, agrega la URL de una página de lista de tarifas específica o ingresa los precios de referencia manualmente.
        </p>
      </div>
    </div>
  );
}
