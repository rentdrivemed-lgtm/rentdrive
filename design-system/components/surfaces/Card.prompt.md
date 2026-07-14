Surfaces & containers — `Card` (+Header/Body/Footer), `StatCard`, `Avatar`/`AvatarGroup`, `Tabs`, `Accordion`, `EmptyState`, `Modal`/`Drawer`.

```jsx
<Card interactive>
  <CardBody>Contenido</CardBody>
</Card>

<StatCard label="Ingresos del mes" value="$3.480.000" delta="+12%" />
<Avatar name="Ana Gómez" verified size={48} />
<Tabs tabs={[{id:"act",label:"Activas",count:3},{id:"comp",label:"Completadas"}]} value={tab} onChange={setTab} />
<Accordion items={[{q:"¿Necesito licencia?", a:"Sí, vigente."}]} />
<EmptyState icon={<CarIcon/>} title="No encontramos carros" description="Prueba con otros filtros." action={<Button>Limpiar filtros</Button>} />
<Modal open={open} onClose={close} title="Confirmar reserva">…</Modal>
<Drawer open={open} onClose={close} title="Filtros" side="responsive">…</Drawer>
```

- `Card interactive` lifts -2px on hover — use for clickable cards; render as a link with `as="a"`.
- `StatCard.value` is mono; `delta` auto-colors green (up) / red (down by leading "-").
- `Drawer side="responsive"` = right panel on desktop, bottom sheet on mobile (catalog filters pattern).
- `EmptyState` is the standard zero-data block for every list — always pair with a CTA.
