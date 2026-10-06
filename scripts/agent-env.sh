#!/usr/bin/env bash
# Set up an isolated development copy (a git worktree) with its own database and port.
#   scripts/agent-env.sh <port> <database>      e.g. scripts/agent-env.sh 3201 pcp_onboard
# Shares the main Docker stack (PostgreSQL :5433, Keycloak via Nginx :8088). Starts `next dev` on <port>.
set -euo pipefail
PORT="$1"; DB="$2"
MAIN=/home/sohaib/Downloads/multi_purpose/PCP/pcp-portal
cd "$(git rev-parse --show-toplevel)"
[ "$(pwd)" = "$MAIN" ] && { echo "Run this inside a worktree, not the main checkout"; exit 1; }

# node_modules: hard-linked copy of the main one (fast, no extra space, works with Turbopack)
[ -d node_modules ] || cp -al "$MAIN/node_modules" node_modules

# Environment: the main one with this copy's database, port and storage
sed -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://pcp:pcp_demo_pw@localhost:5433/$DB#" \
    -e "s#^AUTH_URL=.*#AUTH_URL=http://localhost:$PORT#" \
    -e "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=http://localhost:$PORT#" \
    -e "s#^STORAGE_DIR=.*#STORAGE_DIR=./storage#" "$MAIN/.env.local" > .env.local
grep -q "^AUTH_KEYCLOAK_ISSUER=http://localhost:8088" .env.local || sed -i "s#^AUTH_KEYCLOAK_ISSUER=.*#AUTH_KEYCLOAK_ISSUER=http://localhost:8088/auth/realms/pcp#" .env.local

# Database: create if missing, push the schema, seed
(cd "$MAIN" && docker compose exec -T postgres psql -U pcp -d postgres -tAc "select 1 from pg_database where datname='$DB'" | grep -q 1) || \
  (cd "$MAIN" && docker compose exec -T postgres psql -U pcp -d postgres -qc "create database $DB" && docker compose exec -T postgres psql -U pcp -d "$DB" -qc "create extension if not exists pg_trgm")
DATABASE_URL="postgres://pcp:pcp_demo_pw@localhost:5433/$DB" npx drizzle-kit push --force >/dev/null
npm run seed | tail -3

# Dev server
if ! ss -ltn | grep -q ":$PORT "; then nohup npx next dev -p "$PORT" > .dev.log 2>&1 & fi
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$PORT/login" && break; sleep 2; done
echo "Dev server: http://localhost:$PORT (database $DB). Re-seed with: npm run seed"
