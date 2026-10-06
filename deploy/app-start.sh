#!/bin/sh
# Container entrypoint: wait for the database, apply the schema, seed once, start the app.
set -e
until pg_isready -h postgres -U pcp -q; do echo "waiting for postgres"; sleep 2; done
npx drizzle-kit push --force >/dev/null
COUNT=$(psql "$DATABASE_URL" -tAc "select count(*) from institutions" 2>/dev/null || echo 0)
if [ "${COUNT:-0}" = "0" ] || [ "${RESEED:-0}" = "1" ]; then
  echo "Seeding demo data"
  npx tsx scripts/seed.ts
fi
exec npx next start -p 3150
