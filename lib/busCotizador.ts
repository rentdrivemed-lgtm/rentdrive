// Cotizador de Buses (viajes ocasionales) — lógica de categorías y precios.
// Especificación completa: COTIZADOR-BUSES-SPEC.md (raíz del repo). Esta es la Etapa 1
// del orden de construcción sugerido en su §11: mayormente módulo puro, sin acceso a BD
// (mismo estilo que lib/rentabilidad.ts / lib/precioMercado.ts), salvo la sección final de
// helpers de servidor consolidados aquí en la Etapa 2 (ver comentario junto a
// `adminsConAreaBuses` más abajo: reciben `db` ya abierta como parámetro, nunca importan
// better-sqlite3 como valor, así que el resto del archivo sigue siendo seguro de importar
// desde un componente cliente). Los endpoints que leen/escriben tarifas reales de cada bus
// (bus_tarifas_*_veh, bus_tarifas_*_ref) son responsabilidad de la Etapa 2 (app/api/buses/*).

// ─── Categorías (COTIZADOR-BUSES-SPEC.md §1) ───────────────────────────────

export type CategoriaBus = 'px12' | 'px14' | 'px16' | 'px19' | 'px22_25' | 'px30_42';

// Reflejo en TypeScript de la semilla de `bus_categorias` (ver sembrarBusCategorias() en
// lib/db.ts). Existe para que la UI (etapas futuras) muestre nombre/capacidad sin ir a la
// DB. ⚠️ SINCRONIZAR: si cambias esto, cambia también la semilla en lib/db.ts
// (sembrarBusCategorias) — ambas listas deben coincidir siempre.
export const BUS_CATEGORIAS: {
  codigo: CategoriaBus; nombre: string; capacidadMin: number; capacidadMax: number; orden: number;
}[] = [
  { codigo: 'px12',    nombre: 'Buseta 12 pasajeros',     capacidadMin: 1,  capacidadMax: 12, orden: 1 },
  { codigo: 'px14',    nombre: 'Buseta 14 pasajeros',     capacidadMin: 13, capacidadMax: 14, orden: 2 },
  { codigo: 'px16',    nombre: 'Buseta 16 pasajeros',     capacidadMin: 15, capacidadMax: 16, orden: 3 },
  { codigo: 'px19',    nombre: 'Microbús 19 pasajeros',   capacidadMin: 17, capacidadMax: 19, orden: 4 },
  { codigo: 'px22_25', nombre: 'Busetón 22-25 pasajeros', capacidadMin: 20, capacidadMax: 25, orden: 5 },
  { codigo: 'px30_42', nombre: 'Bus 30-42 pasajeros',     capacidadMin: 26, capacidadMax: 42, orden: 6 },
];

// Mapeo fijo categoría → nombres de columna en bus_tarifas_destino_ref/veh (§3 del spec,
// COTIZADOR-BUSES-SPEC.md). Es una constante literal (no interpolación de datos de usuario)
// así que es segura para armar SELECTs dinámicos de la categoría del bus.
//
// Consolidado aquí (hallazgo revisor-código, ronda post-QA de Etapa 2): antes vivía
// duplicado idéntico en app/api/buses/route.ts, cotizar/route.ts y tarifas-vehiculo/route.ts
// — una sola fuente de verdad evita que las tres copias se desincronicen si el mapeo cambia.
export const COL_DESTINO: Record<CategoriaBus, { base: string; recargo: string }> = {
  px12: { base: 'px12', recargo: 'px12_30' },
  px14: { base: 'px14', recargo: 'px14_30' },
  px16: { base: 'px16', recargo: 'px16_30' },
  px19: { base: 'px19', recargo: 'px19_30' },
  px22_25: { base: 'px22_25', recargo: 'px22_25_30' },
  px30_42: { base: 'px30_42', recargo: 'px30_42_30' },
};

// Tope de capacidad de pasajeros al registrar/editar un bus. La categoría más alta del
// catálogo (px30_42) llega hasta 42; se deja un margen razonable hasta 60 (buses
// articulados/mega-bus, infrecuentes pero reales) para no bloquear un caso legítimo, sin
// dejar colar un valor absurdo como 9999. Por debajo, se exige al menos 1 pasajero.
// Consolidado aquí (compartido entre POST /api/buses y PUT /api/buses/[id]) para que ambas
// rutas validen exactamente el mismo rango sin poder desincronizarse.
export const CAPACIDAD_MIN_PASAJEROS = 1;
export const CAPACIDAD_MAX_PASAJEROS = 60;

// Asigna la categoría de un bus a partir de su capacidad real de pasajeros (§7.1 del spec).
// El propietario NO elige la categoría libremente: esto evita que un bus de 20 puestos se
// registre como "12 pasajeros" para verse más barato, o uno de 14 como "30-42" para cobrar
// de más — la categoría queda ligada al dato físico del vehículo.
//
// Deriva el límite de cada categoría de BUS_CATEGORIAS en vez de repetir los números
// (12/14/16/19/25/42) en un if-chain aparte (hallazgo revisor-código, ronda post-QA): así
// ambas fuentes de verdad quedan en un solo lugar. BUS_CATEGORIAS ya está declarado en orden
// ascendente por capacidadMax (ver arriba), así que el primer match de `pasajeros <= capacidadMax`
// es siempre la categoría correcta. Si `pasajeros` no calza en ninguna (mayor a 42, o
// BUS_CATEGORIAS llegara a estar vacío/desordenado), cae a la última categoría de la lista
// (px30_42), igual que el `return 'px30_42'` final del if-chain original. Para pasajeros <= 0
// o negativos, cae en la primera categoría (px12), mismo comportamiento que antes
// (`pasajeros <= 12` ya cubría esos casos).
export function categoriaPorPasajeros(pasajeros: number): CategoriaBus {
  const match = BUS_CATEGORIAS.find(c => pasajeros <= c.capacidadMax);
  return (match ?? BUS_CATEGORIAS[BUS_CATEGORIAS.length - 1]).codigo;
}

// ─── Cotización (§7.2-7.5 del spec) ─────────────────────────────────────────
// Ambas funciones reciben los valores de tarifa YA RESUELTOS como parámetros (no acceden a
// `bus_tarifas_*_veh`/`bus_tarifas_*_ref` en BD, a diferencia del pseudocódigo de §7.3/§7.4
// del spec, que muestra `obtenerValorKmVehiculo(vehiculoId)`/`obtenerTarifaHoraVehiculo(vehiculoId)`
// embebidos). Resolver esos valores contra la BD es responsabilidad de la capa API de la
// Etapa 2 — este módulo se queda puro para poder reutilizarse también en cliente (previsualización
// de precio en la UI) sin tocar better-sqlite3.
//
// Redondeo: a entero (pesos colombianos no manejan centavos en este proyecto — mismo criterio
// que usa el resto de la calculadora de precios, ver precioMercadoSugerido() en
// lib/precioMercado.ts, aunque ahí se redondea al millar porque es un precio SUGERIDO de
// referencia; aquí se redondea al peso porque es el total exacto que se le va a cobrar al
// cliente, no conviene introducir un salto de hasta $999 sobre una tarifa/recargo ya definidos
// por el propietario).

// El recargo "+30%" (§7.5): mientras no se defina la regla exacta, es un checkbox manual
// (`conRecargo`) que la UI expone con un texto editable en Configuración → Buses.
const FACTOR_RECARGO = 1.3;

// Cotización por trayecto libre (KM sueltos, §7.3). `valorKm`/`tarifaMinima` vienen de
// `bus_valor_km_veh` (o de la referencia por categoría si el bus aún no tiene tarifa propia).
export function cotizarTrayecto(km: number, valorKm: number, tarifaMinima: number, conRecargo: boolean): number {
  const base = Math.max(km * valorKm, tarifaMinima);
  const total = conRecargo ? base * FACTOR_RECARGO : base;
  return Math.round(total);
}

// Cotización por horas de disponibilidad (§7.4). `tarifaHora`/`minimoHoras` vienen de
// `bus_tarifas_hora_veh` (o de la referencia por categoría). `horasSolicitadas` nunca baja
// del mínimo contratable del bus.
export function cotizarHoras(horasSolicitadas: number, tarifaHora: number, minimoHoras: number, conRecargo: boolean): number {
  const horas = Math.max(horasSolicitadas, minimoHoras);
  const base = horas * tarifaHora;
  const total = conRecargo ? base * FACTOR_RECARGO : base;
  return Math.round(total);
}

// ─── Banda de aprobación de cambios de tarifa (§4 del spec) ─────────────────
//
// CONVENCIÓN DE `tolerancia`: número de PORCENTAJE ENTERO, no fracción — ej. 20 significa
// ±20%, igual que el string por defecto que se siembra en `config.TOLERANCIA_TARIFA_BUS`
// ('20', ver sembrarConfigBuses() en lib/db.ts). Se eligió así (en vez de fracción 0.20,
// que es la convención que sí usa `comision_plataforma_pct` en lib/contabilidad.ts) porque
// el propio valor por defecto sugerido en el spec y en `config` ya es '20' como texto plano
// — mantenerlo como número de porcentaje evita una conversión ×100/÷100 extra en la capa de
// configuración (Etapa 2/5, donde el admin edita este número en un input tipo "20%").
// Quien llame a esta función debe convertir explícitamente si en algún punto necesita la
// fracción (tolerancia / 100).
//
// Caso borde: `valorReferencia <= 0` (categoría sin referencia cargada todavía, ej. antes de
// importar el tarifario del PDF, §9) se trata como FUERA de banda por defecto (fail-safe):
// sin una referencia válida no hay nada contra qué comparar, así que cualquier cambio del
// propietario debe pasar a revisión manual del admin en vez de auto-aprobarse a ciegas.
//
// Piso explícito (hallazgo auditor-seguridad, ronda post-QA): `valorPropuesto <= 0` NUNCA
// se auto-aprueba, sin importar la tolerancia. Sin este piso, una `tolerancia` alta (ej. 100)
// hace que el mínimo de la banda (`valorReferencia * (1 - factor)`) llegue a 0 o incluso
// negativo, y una tarifa de $0 (o negativa) quedaría matemáticamente "dentro de banda".
// Techo de `tolerancia`: se clampea a un máximo de 100 (además del piso de 0 ya existente)
// para que el rango de la banda nunca pueda ampliarse más allá de [0, 2×referencia] — una
// tolerancia mayor a 100 no tiene sentido de negocio y solo ensancharía la banda sin límite.
export function dentroDeBanda(valorPropuesto: number, valorReferencia: number, tolerancia: number): boolean {
  if (!Number.isFinite(valorReferencia) || valorReferencia <= 0) return false;
  if (!Number.isFinite(valorPropuesto) || !Number.isFinite(tolerancia)) return false;
  if (valorPropuesto <= 0) return false;
  const factor = Math.min(100, Math.max(0, tolerancia)) / 100;
  const min = valorReferencia * (1 - factor);
  const max = valorReferencia * (1 + factor);
  return valorPropuesto >= min && valorPropuesto <= max;
}

// ─── Validación de `anio` (compartida entre POST /api/buses y PUT /api/buses/[id]) ─────────
//
// Mismo patrón estricto que ya usa PUT /api/vehiculos/[id] (hallazgo QA/revisor-código, ronda
// post-Etapa 2: la validación de `anio` en POST /api/buses era más débil — solo `Number(anio) > 0`,
// lo que deja pasar strings como "0x7e8" (`Number()` sí lo parsea a 2024) o decimales). Rechaza
// explícito con `null` en vez de corromper el dato o dejar pasar algo raro; el llamador decide el
// mensaje/status de la respuesta. Devuelve el entero limpio dentro de rango, o `null` si inválido.
export function anioBusValido(raw: unknown): number | null {
  let anioNum = NaN;
  if (typeof raw === 'number') {
    anioNum = raw;
  } else if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
    anioNum = Number(raw);
  }
  anioNum = Math.trunc(anioNum);
  const anioMaxValido = new Date().getFullYear() + 2;
  if (!Number.isFinite(anioNum) || anioNum < 1900 || anioNum > anioMaxValido) return null;
  return anioNum;
}

// ─── Helpers de servidor compartidos por los endpoints de Etapa 2 (app/api/buses/*) ────────
//
// ⚠️ A diferencia del resto de este archivo, `adminsConAreaBuses` SÍ toca BD (recibe la
// conexión ya abierta como parámetro, nunca abre la suya). Se consolidó aquí (hallazgo
// revisor-código, ronda post-QA: vivía copy-pasteada e idéntica en cotizar/route.ts y
// tarifas-vehiculo/route.ts) en vez de en lib/guard.ts para reutilizar `permisosDe`/`puede`
// de lib/permisos.ts (import type-only de `better-sqlite3`, igual que ese módulo) y así NO
// introducir aquí un import de valor de `better-sqlite3` (vía lib/guard.ts -> lib/db.ts) que
// rompería la garantía de "módulo puro, importable desde cliente" del resto de este archivo.
import type Database from 'better-sqlite3';
import { permisosDe, puede } from './permisos';

// Admins con la sección "buses" habilitada (nivel o excepción), para no notificar a
// alguien (ej. secretaría) que luego se encontraría con un 403 al intentar abrir la
// cola de cambios. `estado_cuenta = 'activa'` — mismo criterio que lib/panel.ts.
export function adminsConAreaBuses(db: Database.Database): number[] {
  const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND estado_cuenta = 'activa'").all() as { id: number }[];
  return admins.filter(a => {
    const { nivel, extra } = permisosDe(db, a.id);
    return puede(nivel, 'buses', extra);
  }).map(a => a.id);
}

// Copia (sobrescribiendo) las 3 tarifas de referencia de `categoria` hacia las tablas
// `_veh` de `busId` — mismo criterio de "copia condicional" que ya usaba POST /api/buses al
// crear un bus (si la referencia de esa categoría todavía no está cargada, §9, simplemente
// no se inserta esa tarifa; nunca se aborta por esto). Consolidado aquí (hallazgo QA/
// revisor-código, ronda post-Etapa 2) para que PUT /api/buses/[id] la reutilice cuando
// `capacidad_pasajeros` cambia y por tanto `bus_categoria` recomputa a una categoría
// DISTINTA: sin esto, las tarifas ya cargadas quedaban con los valores de la categoría vieja
// (desincronizadas respecto a la nueva).
//
// Los DELETE previos son lo que la vuelve segura de llamar tanto para un bus nuevo (POST,
// donde no hay nada que borrar — los DELETE son no-ops) como para un bus existente (PUT, donde
// SÍ hay que sobrescribir lo que hubiera antes, incluidas tarifas personalizadas del
// propietario — el llamador es responsable de notificar ese reseteo, ver PUT /api/buses/[id]).
//
// Debe correr DENTRO de la misma transacción que el INSERT/UPDATE del bus (recibe `db` ya
// abierta, no abre su propia transacción) — mismo criterio que `adminsConAreaBuses` arriba:
// toca BD, así que vive en esta sección de helpers de servidor, no en el cuerpo puro del
// archivo.
export function resetearTarifasBusACategoria(db: Database.Database, busId: number, categoria: CategoriaBus): void {
  db.prepare('DELETE FROM bus_tarifas_destino_veh WHERE vehiculo_id = ?').run(busId);
  db.prepare('DELETE FROM bus_tarifas_hora_veh WHERE vehiculo_id = ?').run(busId);
  db.prepare('DELETE FROM bus_valor_km_veh WHERE vehiculo_id = ?').run(busId);

  const horaRef = db.prepare('SELECT tarifa_hora, minimo_horas, hora_adicional FROM bus_tarifas_hora_ref WHERE categoria = ?')
    .get(categoria) as { tarifa_hora: number; minimo_horas: number; hora_adicional: number } | undefined;
  if (horaRef) {
    db.prepare('INSERT INTO bus_tarifas_hora_veh (vehiculo_id, tarifa_hora, minimo_horas, hora_adicional) VALUES (?, ?, ?, ?)')
      .run(busId, horaRef.tarifa_hora, horaRef.minimo_horas, horaRef.hora_adicional);
  }

  const kmRef = db.prepare('SELECT valor_km, tarifa_minima FROM bus_valor_km_ref WHERE categoria = ?')
    .get(categoria) as { valor_km: number; tarifa_minima: number } | undefined;
  if (kmRef) {
    db.prepare('INSERT INTO bus_valor_km_veh (vehiculo_id, valor_km, tarifa_minima) VALUES (?, ?, ?)')
      .run(busId, kmRef.valor_km, kmRef.tarifa_minima);
  }

  const col = COL_DESTINO[categoria];
  const destinosRef = db.prepare(`
    SELECT destino, km, ${col.base} AS tarifa_base, COALESCE(${col.recargo}, ${col.base}) AS tarifa_30
    FROM bus_tarifas_destino_ref
    WHERE ${col.base} IS NOT NULL AND activo = 1
  `).all() as { destino: string; km: number | null; tarifa_base: number; tarifa_30: number }[];

  if (destinosRef.length) {
    const insDestino = db.prepare(
      'INSERT INTO bus_tarifas_destino_veh (vehiculo_id, destino, km, tarifa_base, tarifa_30) VALUES (?, ?, ?, ?, ?)',
    );
    for (const d of destinosRef) insDestino.run(busId, d.destino, d.km, d.tarifa_base, d.tarifa_30);
  }
}
