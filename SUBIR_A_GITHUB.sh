#!/bin/bash
# Script para subir el proyecto a GitHub.
# Ejecutar desde la carpeta rentdrive con: bash SUBIR_A_GITHUB.sh

set -e

cd "$(dirname "$0")"

echo "==> Limpiando lock stale (si existe)..."
rm -f .git/index.lock

echo "==> Asegurando que la BD local no se suba..."
git rm --cached -f rentdrive.db rentdrive.db-shm rentdrive.db-wal 2>/dev/null || true

echo "==> Agregando todos los cambios..."
git add -A

echo "==> Creando commit..."
git commit -m "feat: migrar de SQLite a Supabase (Postgres + Storage) y preparar deploy en Vercel" || echo "(sin cambios para commitear)"

echo "==> Verificando autenticación de GitHub CLI..."
gh auth status

echo "==> Creando repositorio privado 'alquiler-de-carros' en GitHub y haciendo push..."
gh repo create alquiler-de-carros \
  --private \
  --source=. \
  --remote=origin \
  --description "RentDrive — Plataforma de alquiler de carros (Next.js + TypeScript + Tailwind)" \
  --push

echo ""
echo "================================================================"
echo "Listo. Tu repo: https://github.com/$(gh api user -q .login)/alquiler-de-carros"
echo "================================================================"
