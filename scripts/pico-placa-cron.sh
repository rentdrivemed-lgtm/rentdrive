#!/bin/bash
# Envía los avisos de pico y placa del día. Pensado para ejecutarse cada mañana vía cron.
# Lee CRON_SECRET y (opcional) APP_URL desde rentdrive/.env.local.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRET=$(grep -E '^CRON_SECRET=' "$DIR/.env.local" | cut -d= -f2-)
APP_URL=$(grep -E '^APP_URL=' "$DIR/.env.local" | cut -d= -f2-)
APP_URL=${APP_URL:-http://localhost:3100}
curl -s -X POST "$APP_URL/api/pico-placa/alertas" -H "x-cron-secret: $SECRET" -m 60
echo ""
