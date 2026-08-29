// Cotizador de Buses (viajes ocasionales) — lógica PURA de categorías y precios.
// Especificación completa: COTIZADOR-BUSES-SPEC.md (raíz del repo). Esta es la Etapa 1
// del orden de construcción sugerido en su §11: solo módulo puro, sin acceso a BD (mismo
// estilo que lib/rentabilidad.ts / lib/precioMercado.ts). Los endpoints que leen/escriben
// tarifas reales de cada bus (bus_tarifas_*_veh, bus_tarifas_*_ref) son responsabilidad de
// la Etapa 2 (app/api/buses/*), NO de este archivo.

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
