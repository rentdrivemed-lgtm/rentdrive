# DrivePass — Design System

> **Conduce libre.** — Premium / Dark visual system for DrivePass Medellín.

DrivePass Medellín is a peer-to-peer car-rental web platform in Colombia that connects
three roles around one fleet:

- **Usuario** — searches, books and drives vehicles.
- **Propietario** — lists cars, manages documents, approves reservations.
- **Admin** — supervises users, vehicles and operations.

The product spans a public marketing site, a catalog with filters, vehicle detail &
booking (with before/after photos, signed contracts, payments), role dashboards, chat,
document/license management, notifications and history.

**Brand voice:** active, direct, empowering. Always `tú` (tuteo), short sentences,
action verbs (Reserva, Conduce, Explora, Avanza). Never bureaucratic, never intimidating
fine print.

**Visual direction:** sober, luxurious, technological. A deep blue-black canvas, elevated
surfaces with thin luminous borders, and a single disciplined orange accent for CTAs, key
data and active states. Lots of air, clear hierarchy, subtle micro-details (faint glows,
barely-there gradients, light glassmorphism on floating bars).

---

## Sources

This system was authored from the **DrivePass Visual System prompt package** (Spanish,
dated 2026-06-05) — a complete written spec defining the product, tone, color tokens,
typography, shape, motion and component/screen inventory. There was **no codebase or
Figma file** attached; everything here is built to that spec.

- Intended production stack (per spec): **Next.js 16 App Router + React 19 + Tailwind CSS 4
  (`@theme inline`) + TypeScript**. The CSS tokens here ship plain `:root` custom properties
  plus `--color-*` aliases so Tailwind 4 utilities (`bg-surface-2`, `text-soft`, …) resolve
  if a consumer wires them through `@theme inline`.
- The components in this system are framework-agnostic React (JSX) for prototyping; port the
  class names / tokens directly to the production TSX components.

---

## Content fundamentals

How DrivePass writes. Copy is **Spanish**, second person singular (**tuteo** — "tú", never
"usted"), and built on **short, active sentences** with action verbs up front.

- **Tone:** empowering and confident, never bureaucratic. "Conduce libre por Medellín."
  not "Servicio de alquiler de vehículos".
- **Headlines:** punchy, verb-led, 2–5 words. *Reserva en minutos · Monetiza tu carro ·
  Conduce libre.*
- **Body:** plain and reassuring; it can explain process (deposit, insurance, contract)
  but stays clear. Legal copy may be more formal but always legible.
- **CTAs:** imperative verbs — *Buscar carros, Reservar ahora, Crear cuenta, Publicar mi
  carro, Ver mi reserva*.
- **Trust microcopy** is woven in subtly, never shouty: "+800 reservas completadas este
  mes", "Propietario verificado", "Documentos verificados". Use real numbers only.
- **Numbers, prices, plates, dates** are always set in **Geist Mono** (e.g. `$120.000`,
  `KXR 482`, `12 — 16 jun`). Currency is COP with thousands separators: `$120.000`.
- **No emoji** as UI or iconography. **Sentence case** for body and most UI; titles may use
  light Title Case but prefer sentence case.
- **Empty states** speak to the user and offer a way forward: "No encontramos carros con
  esos filtros" + a *Limpiar filtros* CTA.

---

## Visual foundations

The signature is **deep blue-black + one orange**, premium and restrained.

**Color.** Backgrounds rise through four steps — `--bg #0A1422` (canvas) → `--surface-1
#0F1E33` (panels) → `--surface-2 #16263F` (cards) → `--surface-3 #1B3356` (hover / active,
the brand blue). The accent `--accent #F25C2B` is used **with discipline**: CTAs, prices,
active states, key data — **never** as a massive flat background and **never** on white.
Text is `--text #F4F6FA` / `--text-soft #A9B8CE` / `--text-muted #64748B`. Semantic colors:
success `#34D399`, warning `#FBBF24`, danger `#F87171`, info `#60A5FA`, each with a 14%-tint
surface for badges/alerts.

**Type.** A single family — **Geist Sans** for everything, **Geist Mono** for figures,
prices, plates and data. Weights: 700 titles, 600 subtitles/buttons/data, 500 labels, 400
body. Desktop scale Display 48/56 → Caption 12/18; Display/H1/H2 step down one notch on
mobile. Tight tracking (-0.02em) on display/titles.

**Spacing & layout.** 4px base scale (`--space-1…24`). Max content width 1200px; a 68ch
prose column for legal/reading. Mobile-first with a fixed **BottomNav** (64px + safe-area)
and a desktop **Navbar** (68px); reserve bottom padding so content clears the BottomNav.
Touch targets ≥ 44px.

**Shape & elevation.** Radii: sm 10 (chips), md 14 (buttons/inputs), lg 20 (cards), xl 28
(hero panels), pill 999. Borders: 1px `--border` on everything elevated; focus uses
`--border-strong` + a 2px orange ring. Shadows are subtle and deep on dark — `--shadow-card
0 8px 30px rgba(0,0,0,.35)`, `--shadow-float 0 16px 50px rgba(0,0,0,.5)`, and the signature
`--shadow-glow 0 8px 24px rgba(242,92,43,.30)` reserved for primary CTAs. Corners are
rounded and soft — the brand signals safety, so no sharp angles.

**Backgrounds & imagery.** No illustrations — vehicle imagery is **real photos**, treated
cool and slightly dark/elegant. The hero uses `--gradient-hero` (deep canvas → card with a
faint orange radial glow in one corner). Vehicle cards put a bottom protection-gradient over
the photo for legibility. Otherwise surfaces are flat dark fills, not gradients.

**Glass & blur.** Glassmorphism (`--glass-bg rgba(15,30,51,.7)` + `backdrop-blur`) is used
**only** on floating bars and overlays — Navbar (when solid), BottomNav, modals/drawers,
toasts, the hero search card, and the mobile sticky reserve bar. Never on resting content
cards.

**Motion.** Transitions 150–250ms on `cubic-bezier(0.4,0,0.2,1)`. Cards lift -2px and gain
shadow on hover; primary CTAs gain glow on hover and settle on press (`translateY(0)` +
slight brightness). Lists appear with a staggered fade + `translateY(8px)` (`.fade-up`,
`--i` per child). Skeletons use a left-to-right shimmer. No long animations, no exaggerated
bounces; all motion respects `prefers-reduced-motion`.

**Hover / press states.** Hover: surfaces step up one level (surface-2 → surface-3), text
muted → bright, cards lift. Press: subtle brightness/scale settle, never a big bounce.
Focus-visible is always a 2px orange ring (keyboard accessible).

**Cards.** `--surface-2` fill, 1px `--border`, `--radius-lg`, `--shadow-card`. Interactive
cards add the -2px hover lift + `--shadow-float`. Vehicle cards add a 16:9 photo with
protection gradient, glass type chip, status badge, and a glass favorite button.

---

## Iconography

- **Style:** thin line icons, **stroke 1.5–2px**, rounded caps/joins — the **Lucide / Feather**
  family. One set, uniform stroke, no fills (except toggled states like a filled favorite
  heart).
- **Delivery:** icons are authored as **inline SVG** inside components (so they inherit
  `currentColor` and the brand stroke). In prototypes, link Lucide from CDN:
  `https://unpkg.com/lucide-static` or the `lucide` web font, and keep stroke-width 1.5–2.
  This is a **substitution note**: the spec names Lucide/Feather but ships no icon binaries,
  so consumers should pull Lucide directly.
- **No emoji**, no multicolor icons, no unicode glyphs as iconography. The brand mark itself
  (`assets/logo-mark.svg` / `logo-wordmark.svg`) is the only custom glyph — a pair of
  exchange arrows ("keys pass from owner to driver" — the P2P handoff, and literally "a
  pass"), white + orange on the brand-blue plate.
- **Color:** icons default to `--text-soft` / `--text-muted`; active or key icons take
  `--accent`. Never put orange icons on white.

---

## Fonts — substitution note

**Geist Sans** and **Geist Mono** are loaded from **Google Fonts (CDN)** in
`tokens/typography.css`, not self-hosted binaries — so the compiler reports 0 bundled fonts.
Geist is the exact brand family (it's free/open), so this is a faithful match, but if you
want the system fully self-contained, drop the licensed `Geist`/`GeistMono` `.woff2` files in
`assets/fonts/` and swap the `@import` for `@font-face` rules. **Action for the user:** confirm
CDN Geist is acceptable, or send the font files.

---

## Index / manifest

**Root**
- `styles.css` — global entry point (import manifest only). Consumers link this one file.
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill front-matter for use in Claude Code.

**`tokens/`** — all CSS custom properties + base/utilities (each `@import`ed by `styles.css`)
- `colors.css` · `typography.css` (+ Geist @import) · `spacing.css` · `elevation.css` ·
  `motion.css` · `base.css` (resets, scrollbar, `.glass` / `.card` / `.glow-accent` /
  gradients / `.shimmer` / `.fade-up`, keyframes).

**`components/`** — reusable React primitives (compiled into the runtime bundle)
- `components.css` — class-based styling for all primitives (shipped via `styles.css`).
- `forms/` — **Button, IconButton, Input, Textarea, Select, Checkbox, Radio, Switch**
- `feedback/` — **Badge, Chip, Toast, Tooltip, Spinner, Skeleton**
- `surfaces/` — **Card** (+Header/Body/Footer), **StatCard, Avatar / AvatarGroup, Tabs,
  Accordion, EmptyState, Modal / Drawer**
- `navigation/` — **Navbar, BottomNav, PageHeader, Breadcrumbs**
- `vehicle/` — **VehiculoCard** (the catalog unit)

**`guidelines/`** — foundation specimen cards (Design System tab): colors, type, spacing,
radii, elevation, gradients, logo.

**`ui_kits/`** — full-screen product recreations
- `marketing/` — public landing + catalog (hero, search, featured grid, how-it-works, trust).
- `app/` — authenticated product (user dashboard, owner dashboard, chat).

**`assets/`** — `logo-wordmark.svg`, `logo-mark.svg`.

> **Namespace:** components are exposed at `window.DrivePassDesignSystem_1a34f0.<Name>` in
> card/preview HTML (after loading `_ds_bundle.js`).
