---
name: drivepass-design
description: Use this skill to generate well-branded interfaces and assets for DrivePass (premium/dark peer-to-peer car rental, Medellín), either for production or throwaway prototypes/mocks. Contains design guidelines, color & type tokens, fonts, logo assets, and a React UI kit (components + full screens).
user-invocable: true
---

Read the `readme.md` file within this skill first — it is the full design guide (product
context, content/voice rules, visual foundations, iconography, manifest). Then explore the
other files.

Key map:
- `styles.css` — link this one file to get every token, font and utility.
- `tokens/` — color, type (+Geist fonts), spacing, elevation, motion, base utilities.
- `components/` — React primitives (Button, Input, Card, Badge, VehiculoCard, Navbar, …),
  each with a `.d.ts` (props) and `.prompt.md` (usage). Styling is class-based in
  `components/components.css`.
- `ui_kits/marketing/` and `ui_kits/app/` — full-screen recreations (landing, catalog,
  vehicle detail; user/owner dashboards, chat). Open `index.html`.
- `assets/` — `logo-wordmark.svg`, `logo-mark.svg`.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and
build static HTML files for the user to view; link `styles.css` and use the tokens/classes.
If working on production code, port the tokens (the spec targets Next.js + Tailwind 4
`@theme inline`) and the component class names directly.

Brand rules to never break: deep blue-black surfaces; one disciplined orange accent
(`#F25C2B`) for CTAs/prices/active states only, never as a flat background or on white;
Geist Sans for text, Geist Mono for prices/plates/dates; Spanish copy, tuteo, short active
sentences; Lucide-style line icons (stroke 1.5–2px), no emoji; touch targets ≥44px; every
list needs empty/loading/error states.

If the user invokes this skill without other guidance, ask what they want to build, ask a
few focused questions, then act as an expert DrivePass designer who outputs HTML artifacts
or production code as needed.
