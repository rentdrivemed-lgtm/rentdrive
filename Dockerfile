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

# Build de Next.js
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]
