#!/usr/bin/env bash
# Build the Hugging Face Space folder: Dockerfile + README + bundle/ (compiled app, no source code).
#   deploy/hf/build.sh [out-dir]     default: ../pcp-hf-space next to this repo
# Builds in a scratch copy of the working tree, so the local .next build is left alone.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
OUT=$(realpath -m "${1:-$ROOT/../pcp-hf-space}")
WORK=$(mktemp -d /tmp/pcp-hf-build.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

echo "Copying the working tree to $WORK"
rsync -a --exclude node_modules --exclude .next --exclude .claude --exclude storage --exclude e2e --exclude '.env*' --exclude .git ./ "$WORK/"
cp -al node_modules "$WORK/node_modules"
cd "$WORK"

echo "Building the app (standalone, demo mode)"
NEXT_STANDALONE=1 NEXT_PUBLIC_DEMO_MODE=1 NEXT_TELEMETRY_DISABLED=1 npx next build >/tmp/pcp-hf-next-build.log 2>&1 || { tail -30 /tmp/pcp-hf-next-build.log; exit 1; }

B="$WORK/bundle"
mkdir -p "$B/hf"
cp -a .next/standalone/. "$B/"
mkdir -p "$B/.next" && cp -a .next/static "$B/.next/static"
cp -a public "$B/public"
# Compiled output only: no source maps, no scripts or deploy files the file tracer picked up.
find "$B" -name "*.map" -not -path "*/node_modules/*" -delete
rm -rf "$B/scripts" "$B/deploy"

echo "Bundling the demo-data seed and exporting the schema"
npx esbuild scripts/seed.ts --bundle --platform=node --format=cjs --target=node20 --minify --legal-comments=none \
  --external:pg-native --outfile="$B/hf/seed.cjs" --log-level=warning
DATABASE_URL=postgres://unused@localhost/unused npx drizzle-kit export --sql > "$B/hf/schema.sql"
grep -q 'CREATE TABLE "institutions"' "$B/hf/schema.sql" || { echo "Schema export looks wrong"; exit 1; }
cp scripts/gen-realm.mjs scripts/poc-password.mjs deploy/hf/start.sh deploy/hf/nginx.conf "$B/hf/"
mkdir -p "$B/hf/themes" && cp -a docker/keycloak/themes/pcp "$B/hf/themes/pcp"

echo "Writing $OUT"
mkdir -p "$OUT"
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .git ! -name .cache -exec rm -rf {} +
cp deploy/hf/Dockerfile deploy/hf/README.md "$OUT/"
cp -a "$B" "$OUT/bundle"
du -sh "$OUT/bundle"
echo "Done: $OUT"
