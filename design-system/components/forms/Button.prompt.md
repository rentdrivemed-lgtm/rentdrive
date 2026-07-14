Primary action button — gradient-orange `primary` carries the brand glow for the single key CTA per view; `secondary`/`ghost`/`danger` support it.

```jsx
<Button variant="primary" size="lg" iconRight={<ChevronRight />}>Reservar ahora</Button>
<Button variant="secondary">Ver más</Button>
<Button variant="ghost" size="sm">Cancelar</Button>
<Button variant="danger" loading>Eliminando…</Button>
```

- **Discipline:** only one `primary` per screen — it's the orange anchor. Everything else is `secondary`/`ghost`.
- `size`: `sm` 36px · `md` 44px (default, min touch target) · `lg` 52px.
- `loading` swaps content for a spinner and disables the button; `block` makes it full-width (common on mobile); `pill` for fully-rounded chips/CTAs.
- Pass `iconLeft` / `iconRight` as inline SVG (Lucide stroke 1.5–2px).
