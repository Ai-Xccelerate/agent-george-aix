#!/usr/bin/env bash
# Apply one Supabase migration file against the project's pooler.
#
# Usage:
#   pnpm db:migrate supabase/migrations/<file>.sql
#
# Requires SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD in .env.local.
# Uses ON_ERROR_STOP so a partial apply aborts cleanly.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: pnpm db:migrate <path-to-sql-file>" >&2
  exit 2
fi

FILE="$1"
if [ ! -f "$FILE" ]; then
  echo "error: $FILE not found" >&2
  exit 2
fi

if [ ! -f .env.local ]; then
  echo "error: .env.local not found in $(pwd)" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF must be set in .env.local}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD must be set in .env.local}"

echo "[db:migrate] applying $FILE"
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  -h aws-1-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U "postgres.$SUPABASE_PROJECT_REF" \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -f "$FILE"
echo "[db:migrate] done."
