#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRET=$(grep -E '^CRON_SECRET=' "$DIR/.env.local" | cut -d= -f2-)
APP_URL=$(grep -E '^APP_URL=' "$DIR/.env.local" | cut -d= -f2-)
APP_URL=${APP_URL:-http://localhost:3100}
curl -s -X POST "$APP_URL/api/pico-placa/alertas" -H "x-cron-secret: $SECIQT -m 60
echo ""