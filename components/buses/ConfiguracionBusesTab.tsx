'use client';

// Sub-sección "Configuración" (§4/§5 del spec): tolerancia de auto-aprobación de cambios
// de tarifa (`config.TOLERANCIA_TARIFA_BUS`, sembrada en '20' por la Etapa 1), texto del
// recargo "+30%" y on/off del auto-aprobado.
//
// ⚠️ HUECO DE API (no se improvisa un endpoint nuevo en este ciclo, solo de UI): el único
// endpoint genérico de configuración del proyecto (GET/PUT /api/config, app/api/config/route.ts)
// tiene una whitelist fija de claves (`CLAVES`) y un mapa de permiso por clave
// (`CAMPO_PERMISO`) que NO incluyen `TOLERANCIA_TARIFA_BUS` — ese GET jamás la devuelve
// (el loop solo itera sobre `CLAVES`) y ese PUT la ignora en silencio si se envía (el filtro
// `CLAVES.filter(...)` la descarta antes de llegar a ningún UPDATE). Por eso esta pestaña NO
// intenta leer/guardar nada contra `/api/config`: haría una llamada que parece funcionar pero
// no cambia nada en la fila real de `config`, lo cual sería peor que dejarlo explícito.
//
// Además, el "texto editable del recargo +30%" y el on/off del auto-aprobado que pide el
// spec (§5) no tienen siquiera una clave sembrada en `config` todavía (solo se sembró
// `TOLERANCIA_TARIFA_BUS`, ver lib/db.ts) — hoy el recargo usa un factor fijo (1.3) en
// lib/busCotizador.ts y el auto-aprobado siempre está activo (no hay bandera para apagarlo).
//
// Para habilitar esta pantalla de verdad hace falta (fuera de alcance de esta etapa, solo UI):
//   1) sumar 'TOLERANCIA_TARIFA_BUS' a `CLAVES` en app/api/config/route.ts + decidir a qué
//      grupo de permiso pertenece (¿nuevo `config_editar_buses`, o reusar uno existente?);
//   2) si se quiere también texto de recargo / on-off de auto-aprobado, sembrar esas claves
//      nuevas en `config` (lib/db.ts) y sumarlas igual a `CLAVES`.
// Ese diseño de permisos debería pasar por revisión antes de tocar app/api/config/route.ts.
export default function ConfiguracionBusesTab() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-warning/10 border border-warning/25 rounded-2xl px-4 py-3 text-sm text-warning">
        ⚠ Esta sección todavía no se puede guardar desde el panel: el endpoint genérico de
        configuración (<code>/api/config</code>) no expone la clave <code>TOLERANCIA_TARIFA_BUS</code> (ni
        ninguna otra de buses) en su lista de claves editables. Hace falta un cambio de backend
        (fuera del alcance de este ciclo, que es solo de UI) para habilitar guardado real aquí.
        Ver comentario en <code>components/buses/ConfiguracionBusesTab.tsx</code>.
      </div>

      <div className="bg-surface-2 rounded-2xl border border-border p-5 space-y-4 opacity-70">
        <div>
          <label className="text-sm font-bold text-ink block mb-1">Tolerancia de auto-aprobación</label>
          <p className="text-xs text-ink/50 mb-2">
            Un cambio de tarifa del propietario se aplica de inmediato si queda dentro de este
            % de diferencia contra la tarifa de referencia de su categoría; si se sale, queda
            pendiente de tu aprobación en &quot;🕓 Cambios de tarifas&quot;. Valor sembrado por defecto: 20%.
          </p>
          <div className="flex items-center gap-2">
            <input type="number" disabled value={20}
              className="w-24 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink/50 cursor-not-allowed" />
            <span className="text-sm text-ink/50">%</span>
          </div>
        </div>

        <div>
          <label className="text-sm font-bold text-ink block mb-1">Texto del recargo &quot;+30%&quot;</label>
          <p className="text-xs text-ink/50 mb-2">
            Etiqueta que verá el cliente junto al checkbox de recargo en el cotizador público
            (§7.5 del spec — la regla exacta del recargo aún no está definida, hoy es un
            checkbox manual con un factor fijo de 1.3× en <code>lib/busCotizador.ts</code>).
          </p>
          <input disabled value="Ida y regreso mismo día"
            placeholder="Ej. Ida y regreso mismo día"
            className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-ink/50 cursor-not-allowed" />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" disabled checked
            className="cursor-not-allowed" />
          <span className="text-sm text-ink/50">Auto-aprobar cambios dentro de la tolerancia (siempre activo hoy — no hay bandera para apagarlo)</span>
        </div>

        <button disabled
          className="text-sm font-semibold bg-accent text-white px-4 py-2 rounded-xl opacity-50 cursor-not-allowed">
          Guardar (no disponible todavía)
        </button>
      </div>
    </div>
  );
}
