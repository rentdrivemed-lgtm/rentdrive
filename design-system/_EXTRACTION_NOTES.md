# Extracción del Design System — notas

Esta carpeta es un **espejo local** del proyecto de Claude Design **"DrivePass Design System"**
(claude.ai/design, project `1a34f06e-16cc-413c-9b1b-0f6afed28020`), extraído el **2026-07-14**
como fuente de verdad dentro del repo.

- **Es referencia, no build de la app.** La app consume estos tokens/estilos vía `app/globals.css`
  (tokens portados) y componentes TSX propios; esta carpeta guarda el sistema original completo
  (tokens, componentes JSX, guidelines, kits, templates, logos) para futuras pantallas.
- `styles.css` es el punto de entrada del DS (importa todos los `tokens/*.css` + `components/components.css`).
- Los `*.card.html` y kits referencian `_ds_bundle.js` / `styles.css` / `assets/*` con rutas relativas;
  se renderizan bien dentro de esta carpeta.

## Archivos NO incluidos (5)
`DesignSync.get_file` corta en 256 KiB, así que estas imágenes demo quedaron fuera (bájalas manual
del proyecto si se necesitan; **no** afectan a la app, solo a las previews del propio DS):

- `ui_kits/marketing/cars/wide1.jpg`
- `ui_kits/marketing/cars/wide2.jpg`
- `ui_kits/marketing/cars/wide4.jpg`
- `uploads/Captura de pantalla 2026-06-05 a las 5.43.20 p.m..png`
- `uploads/f5d50a4f70504ba39d0cf9226508b1e9.jpeg`

(`ui_kits/marketing/cars/wide3.jpg` sí entró.)
