# RentDrive

Plataforma de alquiler de carros (Next.js 16 + TypeScript + Tailwind + Supabase).

## Stack

- **Frontend / API**: Next.js 16 (App Router) + React 19
- **Estilos**: Tailwind CSS 4
- **DB**: Postgres en Supabase (vía [`postgres.js`](https://github.com/porsager/postgres))
- **Storage**: Supabase Storage (fotos vehículos, documentos, licencias)
- **Auth**: JWT propio con bcrypt (no usa Supabase Auth)

## Despliegue desde cero — paso a paso

### 1. Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (free tier sirve).
2. En **SQL Editor**, pega y ejecuta el contenido de [`supabase/schema.sql`](./supabase/schema.sql).
3. (Opcional, para preservar datos locales) Ejecuta también [`supabase/seed.sql`](./supabase/seed.sql).
4. **Project Settings → API** — copia el `Project URL` y el `service_role` key.
5. **Project Settings → Database → Connection string → URI → Transaction (puerto 6543)** — copia esa URL (es el pooler en modo transacción, requerido por serverless).

### 2. Variables de entorno

Crea `.env.local` en la raíz con los valores reales:

```bash
DATABASE_URL="postgresql://postgres.xxxxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJ..."
SUPABASE_BUCKET="uploads"
JWT_SECRET="cambia-esto-por-algo-largo-y-aleatorio"
```

Ver [`.env.example`](./.env.example).

### 3. Instalar dependencias y probar local

```bash
npm install
npm run dev
```

Abre [http://localhost:3100](http://localhost:3100) y verifica login con `admin@rentdrive.com / admin123` (si migraste los datos).

> El dev server corre en el puerto **3100** (`next dev -p 3100`) para no chocar con otros servicios que usan el 3000.

### 4. Subir a GitHub

```bash
bash SUBIR_A_GITHUB.sh
```

### 5. Desplegar en Vercel

1. Entra a [vercel.com/new](https://vercel.com/new) e importa el repo `alquiler-de-carros`.
2. Framework: **Next.js** (detectado).
3. **Environment Variables** — añade las 5 variables del `.env.local`.
4. Click **Deploy**.

## Estructura

```
app/api/            Endpoints (auth, vehiculos, reservas, chat, upload, notificaciones, admin)
lib/db.ts           Adaptador postgres.js con la API .prepare().get/all/run
lib/storage.ts      Helper de Supabase Storage para uploads
lib/auth.ts         JWT firma/verificación
supabase/schema.sql Schema completo en Postgres
supabase/seed.sql   Datos exportados de rentdrive.db local (5 usuarios, 4 vehículos, 3 reservas)
```

## Notas

- El chat real-time usa SSE con polling de 1.5s. En Vercel Hobby el stream se cortará tras ~10s; el cliente debe reconectar automáticamente.
- Los uploads van a un bucket público `uploads` de Supabase Storage. Si quieres que sean privados, usa `signed URLs` en `lib/storage.ts`.
- Para regenerar `seed.sql` desde la BD local: `python3 supabase/_export_data.py`.
