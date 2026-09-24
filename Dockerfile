FROM node:22-bookworm-slim

# Dependencias para compilar better-sqlite3 (módulo nativo)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias npm
COPY package*.json ./
RUN npm ci

# Copiar el resto del código
COPY . .

# Variables NEXT_PUBLIC_* deben estar disponibles en build-time: Next.js las
# inlinea en el bundle de JS al compilar, no las lee en runtime. Railway las
# pasa como build-args de Docker, pero Docker las ignora si no se declaran.
#
# ⚠️ CADA `NEXT_PUBLIC_*` NUEVA HAY QUE AÑADIRLA AQUÍ, EN LAS DOS LÍNEAS (ARG y ENV).
# Crearla en el panel de Railway NO basta y el fallo es silencioso: el build compila
# igual, la app arranca igual, y el valor llega vacío solo al navegador. Pasó con
# NEXT_PUBLIC_WOMPI_PUBLIC_KEY (sep-2026): estaba en Railway pero no acá, así que el
# widget de pago se abría con la clave en blanco y ningún cliente podía pagar con
# tarjeta. Hay una prueba que lo caza antes de desplegar: `npm run verificar-env`.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CALCULADORA_VERIFICACION
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_WOMPI_PUBLIC_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CALCULADORA_VERIFICACION=$NEXT_PUBLIC_CALCULADORA_VERIFICACION
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_WOMPI_PUBLIC_KEY=$NEXT_PUBLIC_WOMPI_PUBLIC_KEY

# Build de Next.js
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]
