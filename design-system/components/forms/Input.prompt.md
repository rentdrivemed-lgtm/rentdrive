Form fields — `Input`, `Textarea`, `Select` share label / help / error / icon API; `Checkbox`, `Radio`, `Switch` use the orange active state.

```jsx
<Input label="Correo" type="email" placeholder="tu@correo.com" icon={<Mail/>} required />
<Input label="Contraseña" type="password" error="Credenciales incorrectas" />
<Select label="Ubicación"><option>Medellín</option></Select>
<Textarea label="Descripción" help="Cuéntale a los conductores sobre tu carro" />
<Checkbox label="Acepto los términos" defaultChecked />
<Switch label="Disponible para alquiler" defaultChecked />
```

- Focus = strong border + 2px orange ring. Error = red border + message (overrides `help`).
- Pass `icon` (inline SVG) to `Input` for a left-aligned glyph; padding adjusts automatically.
- All controls are ≥44px tall / wide for touch.
