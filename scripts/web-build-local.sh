#!/usr/bin/env bash
# Builds the web app against the local Supabase stack (`npx supabase start`).
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(npx -y supabase@2 status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY)=')"
cd apps/web
# Cloudflare's always-pass Turnstile test key; local Supabase uses the matching test secret.
# GitHub App values default to the fixtures scripts/web-accounts-qa.mjs simulates.
VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
  VITE_GITHUB_APP_CLIENT_ID="${VITE_GITHUB_APP_CLIENT_ID:-fixture-client}" \
  VITE_GITHUB_APP_SLUG="${VITE_GITHUB_APP_SLUG:-grove-fixture}" pnpm -s build
