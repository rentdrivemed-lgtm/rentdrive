# Alianza DrivePass × DTravel SAS — Propuesta de integración

> Documento de estrategia comercial. Fuente analizada: `https://dtravelsas.com/es/antioquia-2/` y home.
> Fecha: 2026-06-09.

---

## 1. Quién es DTravel SAS

**Agencia de viajes colombiana** (constituida ~2023-2024) enfocada en **experiencias turísticas en Antioquia y Colombia**. Vende tours culturales y de naturaleza con un discurso de "experiencias auténticas y personalizadas".

| Dato | Valor |
|---|---|
| Tipo | Agencia de viajes / tour operador |
| Cobertura | Antioquia + Colombia (también Coveñas en costa) |
| Canal de venta | **Solo WhatsApp** (+57 321 673 7988) — sin reserva online ni precios públicos |
| Redes | Instagram, Facebook, TikTok (@dtravelsas) |
| Destinos estrella | Guatapé, Comuna 13, Santa Fe de Antioquia, Jardín, Hacienda Nápoles, Santa Elena (silleteros), Medellín |

### Diagnóstico rápido
- **Fortaleza:** catálogo de destinos atractivo, narrativa de marca cuidada, presencia social.
- **Debilidades / huecos que DrivePass llena:**
  1. **No tiene oferta de movilidad/transporte.** El turista que compra un tour a Guatapé o Jardín necesita *cómo moverse*; hoy DTravel no lo resuelve.
  2. **No tiene reserva online ni pasarela de pago** — todo pasa por WhatsApp manual. DrivePass sí tiene flujo de reserva + pago (Visa/MC) + verificación de documentos con IA.
  3. **No monetiza la fase "antes y después del tour"** (traslado aeropuerto, días libres del viajero).

> **Tesis de la alianza:** DTravel vende la *experiencia*; DrivePass vende la *libertad de moverse*. Antioquia es un destino ideal para **autoconducción** (Guatapé a 2h, Santa Fe 1.5h, Jardín 3h) — el carro propio multiplica el valor del viaje. Encajan sin competir.

---

## 2. Propuesta de valor de la alianza

**Para el viajero:** un solo punto donde resuelve **dónde ir** (DTravel) y **cómo llegar a su ritmo** (DrivePass), con carro verificado, seguro todo riesgo, GPS y servicio aeropuerto.

**Para DTravel:** una nueva línea de ingreso (comisión por cada alquiler referido) **sin operar ni un solo carro**, y un argumento de venta más fuerte ("incluye opción de vehículo").

**Para DrivePass:** acceso a un **flujo cualificado de turistas** (alto ticket, temporadas), un aliado con audiencia social ya construida y una narrativa de marca premium alineada con el #1 de Medellín.

---

## 3. Modelos de colaboración (de menor a mayor integración)

### Fase 1 — Referido / Afiliado (lanzar YA, sin desarrollo)
- DrivePass entrega a DTravel un **enlace de afiliado** con código (`?ref=dtravel`) que apunta a la **landing co-marca** (la que se construye en este entregable).
- DTravel lo comparte en su WhatsApp, bio de Instagram/TikTok y en cada cierre de venta de tour ("¿quieres moverte a tu ritmo? mira esto").
- **Comisión sugerida: 10–15%** del valor del alquiler referido (o tarifa fija por reserva, p. ej. $40.000–$60.000 COP).
- Atribución simple: cupón/código en el checkout + registro manual de referidos al inicio.

### Fase 2 — Paquetes "Carro + Ruta" (co-creación de producto)
- Empaquetar **vehículo DrivePass + ruta curada DTravel** como un solo producto:
  - *Ruta Oriente:* Guatapé + Peñol (carro 1–2 días + guía/tips DTravel).
  - *Ruta Occidente:* Santa Fe de Antioquia colonial.
  - *Ruta Suroeste:* Jardín (pueblo cafetero).
  - *Ruta Familiar:* Hacienda Nápoles.
- Precio paquete con margen compartido; DrivePass opera el carro, DTravel la experiencia/contenido.

### Fase 3 — Integración técnica (cuando el volumen lo justifique)
- **Botón embebido / widget** "Alquila tu carro con DrivePass" en dtravelsas.com.
- **Deep-links de WhatsApp** prellenados desde la landing hacia el bot de DTravel para los tours.
- A futuro: endpoint de afiliados (`/api/afiliados`) que registre referidos por código y calcule comisión automáticamente; dashboard de aliado.

---

## 4. Cómo se vería en el producto (lo que entrego hoy)

1. **Landing page co-marca** `/alianzas/dtravel` dentro de DrivePass: presenta la alianza, las rutas de autoconducción por Antioquia, los beneficios del carro y CTA dobles (reservar carro / hablar con DTravel por WhatsApp). Bilingüe (ES/EN), tema oscuro fiel al Design System.
2. CTA principal → `/#vehiculos` (flujo de reserva existente).
3. CTA secundario → `https://wa.me/573216737988` (WhatsApp de DTravel para los tours).

---

## 5. Métricas de éxito (primeros 90 días)

| KPI | Meta inicial |
|---|---|
| Reservas referidas por DTravel | 8–15 / mes |
| Tasa de conversión de la landing | > 4% |
| Ticket promedio alquiler turista | > 3 días |
| Comisión pagada a DTravel | señal de tracción, no costo |

---

## 6. Siguientes pasos

1. **Acordar comisión** (recomendado: 12% o $50.000/reserva) y firmar acuerdo simple de afiliación.
2. Publicar la **landing** y entregar a DTravel su **enlace con `?ref=dtravel`**.
3. DTravel la difunde en WhatsApp + bio de redes.
4. Medir 30 días → decidir si pasamos a **Fase 2 (paquetes)**.
5. Si funciona: construir el **registro de afiliados automático** (Fase 3).

---

### Anexo — Argumentario de venta para DTravel (1 línea)
> "Tus clientes ya están en Antioquia. Con DrivePass se mueven a su ritmo a Guatapé, Santa Fe o Jardín en un carro verificado con seguro y GPS — y tú ganas comisión por cada uno, sin tener que manejar ni un solo vehículo."
