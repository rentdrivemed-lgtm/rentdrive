Vehicle catalog card — the core unit of catalog and featured grids. 16:9 photo, type chip, status badge, favorite heart, mono COP price.

```jsx
<VehiculoCard
  vehiculo={{
    marca: "Mazda", modelo: "CX-5", anio: 2023, tipo: "SUV",
    ubicacion: "El Poblado", precioDia: 180000,
    descripcion: "SUV full equipo, ideal para viajes en familia.",
    foto: "/cars/cx5.jpg", verificado: true,
  }}
  favorite={saved}
  onFavorite={() => toggleSave(id)}
  onClick={() => goToDetail(id)}
/>
```

- `precioDia: 0` (or missing) renders an "En revisión" badge and disables the price → use for vehicles awaiting approval.
- Price is mono orange `$180.000 /día`; the heart toggles via `favorite` + `onFavorite` (stops propagation so it won't trigger the card `onClick`).
- Hover lifts the card -2px and zooms the photo. Grid it 1/2/3–4 cols and stagger with `.fade-up`.
