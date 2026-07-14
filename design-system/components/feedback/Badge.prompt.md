Feedback primitives — `Badge`/`Chip` (status & filters), `Toast`/`Tooltip` (messaging), `Spinner`/`Skeleton` (loading).

```jsx
<Badge variant="success" dot>Confirmada</Badge>
<Badge variant="warning">En revisión</Badge>
<Chip selected onRemove={() => {}}>SUV</Chip>

<div className="dp-toast-region">
  <Toast tone="success" title="Reserva confirmada" duration={4000} onClose={dismiss}>
    Te enviamos los detalles al correo.
  </Toast>
</div>

<Tooltip label="Propietario verificado"><InfoIcon/></Tooltip>
<Spinner size={24} />
<Skeleton variant="card" />
```

- Badge variants map to reservation/document states: `success` confirmada, `warning` en revisión/pendiente, `danger` rechazado, `info` pendiente, `accent` destacado.
- `Chip` is the catalog filter control — `selected` paints orange; pass `onRemove` for active-filter chips.
- Toasts live in a fixed `.dp-toast-region` (bottom-right, respects safe-area); they fade-up in and auto-dismiss with `duration`.
- Skeletons already include the shimmer; size with `width`/`height` or the `line`/`block`/`card` variants.
