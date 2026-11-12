#!/usr/bin/env bash
# Builds the web app against the local Supabase stack (`npx supabase start`).
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(npx -y supabase@2 status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY)=')"
cd apps/web
VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" pnpm -s build
