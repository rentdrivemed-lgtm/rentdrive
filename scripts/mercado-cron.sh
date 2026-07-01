#!/bin/bash
# Cron de comparación de precios de mercado — ejecutar cada día a las 6am
# Agregar a crontab: 0 6 * * * /ruta/a/rentdrive/scripts/mercado-cron.sh >> /tmp/mercado-cron.log 2>&1

set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRET=$(grep -E '^CRON_SECRET=' "$DIR/.env.local" | cut -d= -f2-)
APP_URL=$(grep -E '^APP_URL=' "$DIR/.env.local" | cut -d= -f2-)
APP_URL=${APP_URL:-http://localhost:3100}

echo "[$(date)] Iniciando verificación de precios de mercado..."
curl -s -X POST "$APP_URL/api/admin/mercado/check" \
  -H "x-cron-secret: $SECRET" \
  -H "Content-Type: application/json" \
  -m 120
echo ""
echo "[$(date)] Verificación completada."
