# Cotizador de Buses (viajes ocasionales) — Especificación

Añadido por Claude el 2026-08-29 (actualizado el mismo día con el flujo de tarifas por
propietario) a partir de `TARIFAS PARA VIAJES OCASIONALES 2025.pdf` (tarifario de la
empresa, formato Excel exportado a PDF). Documento pensado para cargarse en una futura
sesión de desarrollo de RentDrive/DrivePass, igual que `PROYECTO.md`. Objetivo: registrar
vehículos tipo bus (ej. placa PWY837), que cada propietario ajuste las tarifas de su
propio bus desde su panel, y que el cliente cotice desde la misma app por destino, por
trayecto libre o por horas de disponibilidad — con un cambio de precio del propietario
que se aplica solo si es razonable, o queda pendiente de que el administrador lo apruebe.

## 0. Qué hay hoy y qué falta

- La tabla `vehiculos` solo maneja alquiler por día (`precio_dia`) para 6 categorías de
  carro (`TipoVehiculo` en `lib/rentabilidad.ts`). No existe todavía tipo `bus`, ni ningún
  dato de bus/placa PWY837 en el código, en `rentdrive.db` ni en `supabase/schema.sql`
  (se verificó con `git grep` y consulta directa a la BD).
- El PDF fuente no trae fórmula para "por trayecto libre" (KM sueltos) ni tarifa por hora
  — solo un tarifario fijo por destino. Esas dos modalidades hay que definirlas
  (ver §3.2 y §3.3): quedan como valores configurables, no hardcodeadas.
- El significado exacto de la columna "+30%" (ida y regreso mismo día vs. recargo
  nocturno/festivo vs. otra cosa) no estaba claro al momento de escribir esto. Por eso el
  recargo se modela como un toggle manual por cotización con una etiqueta editable en
  Configuración (§3.5), no como una regla automática.
- Los datos reales del tarifario (~300 destinos) no se transcribieron a mano desde el
  PDF: es una tabla financiera densa y transcribir manualmente cientos de precios
  arriesga errores de dígitos que terminarían cobrándose a clientes reales. El PDF se
  generó desde Excel (metadata: `Creator: Microsoft® Excel® 2016`), así que la ruta
  correcta es importar el `.xlsx` original con el script de §9. Se entrega la plantilla
  CSV exacta (`plantilla_tarifario_buses.csv`) con 3 filas de ejemplo con valores
  inventados, marcadas como tal — no son tarifas reales.

## 1. Categorías de bus (de la tabla del PDF)

El PDF trae 6 categorías por capacidad. Se usan tal cual como la taxonomía del sistema:

| Código | Nombre para mostrar | Capacidad (pasajeros) |
|---|---|---|
| `px12` | Buseta 12 pasajeros | hasta 12 |
| `px14` | Buseta 14 pasajeros | 13–14 |
| `px16` | Buseta 16 pasajeros | 15–16 |
| `px19` | Microbús 19 pasajeros | 17–19 |
| `px22_25` | Busetón 22–25 pasajeros | 20–25 |
| `px30_42` | Bus 30–42 pasajeros | 26–42 |

El propietario no elige la categoría libremente: indica la capacidad real de pasajeros de
su bus y el sistema asigna la categoría con `categoriaPorPasajeros()` (§7.1). Esto evita
que un bus de 20 puestos se registre como "12 pasajeros" para verse más barato, o que uno
de 14 se registre como "30–42" para cobrar de más — la categoría queda ligada al dato
físico del vehículo, no a una elección de conveniencia.

## 2. Dos capas de tarifas: referencia (plataforma) y del vehículo (propietario)

Cada bus tiene sus propias tarifas, igual que hoy cada carro tiene su propio `precio_dia`.
Para que un propietario no arranque en blanco, existe una tabla de referencia por
categoría (la que se llena importando el tarifario del PDF, §9) que se copia como punto
de partida al registrar un bus nuevo, y que además sirve de vara de comparación para
decidir si un ajuste del propietario se aplica solo o necesita aprobación (§4).

```
bus_tarifas_destino_ref / bus_tarifas_hora_ref / bus_valor_km_ref   →  por categoría (6 filas), admin
                                    │  se copian al registrar el bus
                                    ▼
bus_tarifas_destino_veh / bus_tarifas_hora_veh / bus_valor_km_veh   →  por vehiculo_id, el propietario las edita
```

## 3. Modelo de datos (nuevas tablas)

Mismo patrón que el resto del proyecto: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`
defensivo en `lib/db.ts` (SQLite dev), reflejado en paralelo en `supabase/schema.sql`
(Postgres prod) — el propio `PROYECTO.md` advierte mantener ambos en paridad.

```sql
-- Categorías (catálogo fijo, semilla de las 6 filas de la tabla §1)
CREATE TABLE IF NOT EXISTS bus_categorias (
  codigo TEXT PRIMARY KEY,           -- 'px12' | 'px14' | 'px16' | 'px19' | 'px22_25' | 'px30_42'
  nombre TEXT NOT NULL,
  capacidad_min INTEGER NOT NULL,
  capacidad_max INTEGER NOT NULL,
  orden INTEGER NOT NULL
);

-- vehiculos: se reutiliza la tabla existente, con tipo='bus' y 2 columnas nuevas
ALTER TABLE vehiculos ADD COLUMN capacidad_pasajeros INTEGER;
ALTER TABLE vehiculos ADD COLUMN bus_categoria TEXT;  -- calculada desde capacidad_pasajeros, no editable a mano

-- ===== CAPA 1: referencia por categoría (admin, viene del tarifario importado) =====

CREATE TABLE IF NOT EXISTS bus_tarifas_destino_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destino TEXT NOT NULL,
  km INTEGER,
  px12 REAL, px12_30 REAL, px14 REAL, px14_30 REAL, px16 REAL, px16_30 REAL,
  px19 REAL, px19_30 REAL, px22_25 REAL, px22_25_30 REAL, px30_42 REAL, px30_42_30 REAL,
  observaciones TEXT DEFAULT '',
  activo INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(destino)
);

CREATE TABLE IF NOT EXISTS bus_tarifas_hora_ref (
  categoria TEXT PRIMARY KEY REFERENCES bus_categorias(codigo),
  tarifa_hora REAL NOT NULL DEFAULT 0,
  minimo_horas REAL NOT NULL DEFAULT 4,
  hora_adicional REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bus_valor_km_ref (
  categoria TEXT PRIMARY KEY REFERENCES bus_categorias(codigo),
  valor_km REAL NOT NULL DEFAULT 0,
  tarifa_minima REAL NOT NULL DEFAULT 0,
  calculado_de_tarifario INTEGER DEFAULT 0  -- 1 = promedio automático tarifa/km; 0 = a mano
);

-- ===== CAPA 2: tarifas reales de CADA bus (propietario) =====
-- Un bus ya tiene una categoría fija (bus_categoria), así que aquí solo van los 2 precios
-- (base y +30%) de esa categoría por destino — no las 12 columnas de la tabla de referencia.

CREATE TABLE IF NOT EXISTS bus_tarifas_destino_veh (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
  destino TEXT NOT NULL,
  km INTEGER,
  tarifa_base REAL NOT NULL,
  tarifa_30 REAL NOT NULL,
  observaciones TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(vehiculo_id, destino)
);

CREATE TABLE IF NOT EXISTS bus_tarifas_hora_veh (
  vehiculo_id INTEGER PRIMARY KEY REFERENCES vehiculos(id),
  tarifa_hora REAL NOT NULL,
  minimo_horas REAL NOT NULL,
  hora_adicional REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bus_valor_km_veh (
  vehiculo_id INTEGER PRIMARY KEY REFERENCES vehiculos(id),
  valor_km REAL NOT NULL,
  tarifa_minima REAL NOT NULL
);

-- ===== Cola de aprobación =====

CREATE TABLE IF NOT EXISTS bus_tarifas_cambios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
  propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL,                 -- 'destino' | 'hora' | 'km'
  destino TEXT,                       -- solo si tipo='destino'
  categoria TEXT NOT NULL,            -- denormalizado, para comparar contra la referencia rápido
  valor_anterior TEXT NOT NULL,       -- JSON: {tarifa_base, tarifa_30} o {tarifa_hora,...} o {valor_km,...}
  valor_propuesto TEXT NOT NULL,      -- mismo formato
  estado TEXT NOT NULL DEFAULT 'pendiente',  -- 'pendiente' | 'auto_aprobada' | 'aprobada' | 'rechazada'
  motivo_admin TEXT DEFAULT '',
  revisado_por INTEGER REFERENCES usuarios(id),
  revisado_en TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cotizaciones generadas (log + seguimiento comercial, mismo espíritu que la tabla `cotizaciones` existente)
CREATE TABLE IF NOT EXISTS cotizaciones_bus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
  categoria TEXT NOT NULL,
  modo TEXT NOT NULL,                 -- 'destino' | 'trayecto' | 'horas'
  destino TEXT, km REAL, horas REAL,
  con_recargo INTEGER DEFAULT 0,
  tarifa_aplicada REAL NOT NULL,
  recargo_valor REAL DEFAULT 0,
  total REAL NOT NULL,
  cliente_nombre TEXT DEFAULT '',
  cliente_telefono TEXT DEFAULT '',
  fecha_servicio TEXT DEFAULT '',
  estado TEXT DEFAULT 'nueva',        -- 'nueva' | 'contactada' | 'confirmada' | 'descartada'
  created_at TEXT DEFAULT (datetime('now'))
);
```

## 4. Aprobación de cambios de tarifa (automática dentro de un rango, manual fuera de él)

Mismo espíritu que ya usan en el proyecto: `bandaPrecioValor()` en `lib/precioMercado.ts`
marca en ámbar un precio de carro fuera de mercado, y el verificador de documentos con IA
usa un modo híbrido (auto-aprueba alta confianza, el resto va a revisión humana). Se
reutiliza exactamente esa idea para tarifas de bus:

1. El propietario edita un valor (una tarifa de destino, la tarifa/hora o el valor/km de
   su bus).
2. El sistema compara el valor propuesto contra la referencia de su categoría (§2) con una
   tolerancia configurable — por ejemplo ±20% (`TOLERANCIA_TARIFA_BUS`, guardada en la
   tabla `config` existente, mismo lugar que otras banderas del proyecto como
   `WHATSAPP_ENABLED`).
3. **Dentro de la banda** → se aplica de inmediato en `bus_tarifas_*_veh` (el precio que ve
   el cliente cambia ya), el registro en `bus_tarifas_cambios` queda
   `estado='auto_aprobada'`, se anota en `auditoria` (`area:'buses'`,
   `accion:'tarifa_auto_aprobada'`) y se notifica al admin (tabla `notificaciones`) por si
   quiere revisarlo y revertirlo.
4. **Fuera de la banda** → no se aplica todavía: el precio visible para el cliente sigue
   siendo el anterior, el registro queda `estado='pendiente'`, y el admin ve una alerta y
   la fila en el nuevo tab "🕓 Cambios de tarifas" (§5) con botones Aprobar / Rechazar (+
   nota opcional, mismo patrón que `documentos_nota` en la verificación de documentos). Al
   aprobar, se copia a `bus_tarifas_*_veh`; al rechazar, el propietario ve el motivo en su
   panel y su tarifa anterior sigue vigente.
5. El admin puede desactivar el auto-aprobado por completo desde Configuración (todo
   cambio pasa a requerir aprobación manual) o ajustar la tolerancia — es un valor de
   negocio, no debería quedar fijo en código.

## 5. Panel admin — pestaña nueva "🚌 Buses"

- **Permiso**: agregar `buses: ['principal', 'socio']` a `AREA_NIVELES` en
  `lib/permisos.ts` (mismo nivel que `vehiculos`/`calculadora`); gating en servidor con
  `guardArea('buses')`.
- **Ubicación**: pestaña nueva en el dashboard admin (`app/dashboard/admin/page.tsx`),
  junto a "🚗 Vehículos".
- **Sub-secciones** (patrón de pestañas internas como `ContabilidadPanel`):
  - **Flota de buses** — vista de todos los buses de todos los propietarios: marca,
    modelo, placa, capacidad → categoría, propietario, disponibilidad.
  - **Tarifario de referencia** — la plantilla por categoría (12 columnas × destino) que
    se copia a cada bus nuevo y sirve de banda de comparación. Edición inline, Importar
    CSV (§9), Exportar/Copiar CSV.
  - **🕓 Cambios de tarifas** — cola de aprobación (§4): filtro por estado, ver valor
    anterior vs. propuesto, Aprobar / Rechazar con nota, e historial de las ya resueltas
    (incluye las auto-aprobadas, revertibles).
  - **Cotizaciones** — historial de solicitudes de clientes (patrón
    `SoportePanel`/`LeadsPropietariosPanel`).
  - **Configuración** — tolerancia de auto-aprobación (§4.2), texto del recargo "+30%"
    (§7.5), on/off del auto-aprobado.
- Cada cambio pasa por `registrarAuditoria(db, actor, { area: 'buses', ... })`, igual que
  hoy con vehículos.

## 6. Panel del propietario — sus buses y tarifas

Se extiende `app/dashboard/propietario/page.tsx` (el mismo flujo que ya usan para
registrar carros y ver su precio de mercado sugerido):

- **Alta/edición de bus**: cuando el propietario elige tipo `bus` en vez de un tipo de
  carro, el formulario cambia: marca, modelo, año, placa y capacidad de pasajeros (no
  precio/valor comercial). Al guardar, se muestra la categoría asignada (§1) y se copian
  sus tarifas iniciales desde `bus_tarifas_*_ref` de esa categoría — el propietario
  arranca con precios de referencia razonables, no en cero.
- **"Tarifas de mi bus"** (nueva sub-sección, visible solo si el propietario tiene al
  menos un bus): selector de bus si tiene varios → 3 pestañas Por destino / Por hora / Por
  km, mismos campos que ve el admin en el tarifario, pero acotados a ESE vehículo. Cada
  guardado corre la lógica de §4 y da feedback inmediato:
  - ✅ "Aplicado" — quedó dentro del rango razonable, ya es visible para los clientes.
  - ⏳ "Enviado para aprobación" — se avisó al administrador; mientras tanto sigue
    cobrándose la tarifa anterior.
- **Historial de cambios de este bus**: lista simple con fecha, campo cambiado, valor
  anterior → propuesto, y estado (incluye el motivo si el admin rechazó algo).

## 7. Lógica de cotización (`lib/busCotizador.ts`, módulo puro — mismo estilo que `lib/rentabilidad.ts`)

### 7.1 Selección de categoría

```ts
export function categoriaPorPasajeros(pasajeros: number): CategoriaBus {
  if (pasajeros <= 12) return 'px12';
  if (pasajeros <= 14) return 'px14';
  if (pasajeros <= 16) return 'px16';
  if (pasajeros <= 19) return 'px19';
  if (pasajeros <= 25) return 'px22_25';
  return 'px30_42';
}
```

### 7.2 Por destino

El cliente elige o filtra por categoría (auto-sugerida según pasajeros solicitados, igual
que antes) → ve los buses disponibles de esa categoría (vitrina, como ya pasa con carros)
→ elige uno → se busca destino en `bus_tarifas_destino_veh` de ese `vehiculo_id`. Si el
destino no está cargado en ese bus específico, se ofrece "Por trayecto" con los KM, o se
cotiza contra la referencia de su categoría marcado como "tarifa referencial, sujeta a
confirmación del propietario".

### 7.3 Por trayecto libre (KM)

```ts
export function cotizarTrayecto(vehiculoId: number, km: number, conRecargo: boolean) {
  const { valor_km, tarifa_minima } = obtenerValorKmVehiculo(vehiculoId); // bus_valor_km_veh
  const base = Math.max(km * valor_km, tarifa_minima);
  return conRecargo ? base * 1.3 : base;
}
```

### 7.4 Por horas de disponibilidad

```ts
export function cotizarHoras(vehiculoId: number, horasSolicitadas: number, conRecargo: boolean) {
  const { tarifa_hora, minimo_horas } = obtenerTarifaHoraVehiculo(vehiculoId); // bus_tarifas_hora_veh
  const horas = Math.max(horasSolicitadas, minimo_horas);
  const base = horas * tarifa_hora;
  return conRecargo ? base * 1.3 : base;
}
```

### 7.5 El recargo "+30%"

Mientras no se defina la regla exacta, es un checkbox manual con un texto explicativo
editable en Configuración → Buses (ej. "Ida y regreso mismo día"). Cuando el criterio
quede claro, se reemplaza el checkbox por una regla automática sin tocar el resto de
`busCotizador.ts`.

## 8. Flujo público — `app/buses/page.tsx`

Vitrina filtrable por categoría (auto-sugerida por pasajeros) → seleccionar un bus
específico → 3 pestañas Por destino / Por trayecto / Por horas de disponibilidad contra
las tarifas de ESE bus → precio al instante (desglose: tarifa, recargo si aplica, total) →
"Solicitar esta cotización" guarda en `cotizaciones_bus`
(`POST /api/buses/cotizar`, público) y notifica al propietario y al admin (reusa
`notificaciones` y, si está activo, `lib/whatsapp.ts`).

## 9. Cargar el tarifario de referencia (300+ destinos)

**No transcribir a mano desde el PDF.** Pasos recomendados:

1. Ubicar el `.xlsx` original (el PDF se exportó de Excel — casi seguro existe en algún
   equipo del negocio).
2. Exportarlo como CSV con las columnas de `plantilla_tarifario_buses.csv` (entregado
   junto a este documento — mismas 15 columnas que `bus_tarifas_destino_ref`, con 3 filas
   de ejemplo inventadas marcadas `[EJEMPLO]`, para no confundirlas con datos reales).
3. Crear `scripts/importar-tarifario-buses.ts`: lee el CSV, hace upsert por `destino` en
   `bus_tarifas_destino_ref` (SQLite y Postgres/Supabase en paralelo).
4. Si hay que partir del PDF por OCR: que alguien del equipo verifique el CSV contra el
   PDF antes de importarlo — un dígito de más/menos ahí se traduce directo en plata mal
   cobrada.
5. Con la referencia cargada, "Recalcular sugerido" en Valor por KM de referencia promedia
   `tarifa_base / km` por categoría, para que los buses nuevos arranquen con un valor/km
   real.

## 10. Registrar el PWY837

Una vez construido el panel: el propietario del PWY837 lo registra desde su dashboard
(§6) con marca/modelo/año/placa PWY837/capacidad real de pasajeros → categoría asignada
sola → tarifas iniciales copiadas de la referencia → puede ajustarlas ya mismo (sujeto a
aprobación si se sale de la banda).

## 11. Orden sugerido de construcción

1. `lib/db.ts` (+ `supabase/schema.sql`) — tablas de §3, 2 columnas en `vehiculos`,
   semilla de `bus_categorias`, clave `TOLERANCIA_TARIFA_BUS` en `config`.
2. `lib/permisos.ts` — área `buses`.
3. `lib/busCotizador.ts` — categorías, banda de aprobación (§4), las 3 fórmulas de
   cotización (§7).
4. `app/api/buses/*` — buses (CRUD por propietario), tarifas/referencia (CRUD admin +
   import CSV), tarifas/vehiculo (CRUD propietario, pasa por la lógica de banda), cambios
   (GET/aprobar/rechazar admin), cotizar (POST público), cotizaciones (GET admin).
5. `components/buses/BusesPanel.tsx` (+ subcomponentes) — pestaña admin, incluye Cambios
   de tarifas.
6. `components/buses/MisBusesPanel.tsx` (+ subcomponentes) — sección nueva en el
   dashboard del propietario.
7. `app/dashboard/admin/page.tsx` / `app/dashboard/propietario/page.tsx` — enganchan sus
   pestañas nuevas.
8. `app/buses/page.tsx` — vitrina + cotizador público (3 modalidades).
9. `scripts/importar-tarifario-buses.ts` — importación del tarifario de referencia (§9).
10. Registrar el PWY837 (§10) y ajustar sus tarifas desde el panel del propietario.

Ver también el prototipo interactivo (cotizador, panel de precios del admin y panel del
propietario con aprobación) que Claude publicó en la conversación — sirve para validar la
lógica y el look & feel antes de construir esto en el código real.
