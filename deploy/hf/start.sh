#!/bin/sh
# Start the whole demo in one container: PostgreSQL, schema and demo data, Keycloak with the PCP realm,
# the Next.js app, and Nginx in front on :7860. Every start is a clean demo; secrets are new each time.
set -eu
ORIGIN=${PUBLIC_ORIGIN:-https://${SPACE_HOST:?SPACE_HOST is not set}}
HOST=${ORIGIN#*://}
rand() { openssl rand -hex 24; }
PG=/data/pg
export PORTAL_CLIENT_SECRET=$(rand) ADMIN_API_CLIENT_SECRET=$(rand) DEMO_CLIENT_SECRET=$(rand)

echo "[start] PostgreSQL"
rm -rf "$PG" && initdb -D "$PG" -U pcp --auth=trust >/dev/null
pg_ctl -D "$PG" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" -l /data/pg.log -w start >/dev/null
psql -h 127.0.0.1 -U pcp -d postgres -qc "CREATE DATABASE pcp" -c "CREATE DATABASE keycloak"
psql -h 127.0.0.1 -U pcp -d pcp -qc "CREATE EXTENSION pg_trgm" -c "CREATE EXTENSION fuzzystrmatch"
psql -h 127.0.0.1 -U pcp -d pcp -q -v ON_ERROR_STOP=1 -f /app/hf/schema.sql >/dev/null

export DATABASE_URL=postgres://pcp@127.0.0.1:5432/pcp STORAGE_DIR=/data/storage \
  AUTH_URL=$ORIGIN PUBLIC_BASE_URL=$ORIGIN AUTH_TRUST_HOST=true AUTH_SECRET=$(openssl rand -base64 32) \
  AUTH_KEYCLOAK_ID=pcp-portal AUTH_KEYCLOAK_SECRET=$PORTAL_CLIENT_SECRET AUTH_KEYCLOAK_ISSUER=$ORIGIN/auth/realms/pcp \
  KEYCLOAK_ADMIN_CLIENT_ID=pcp-admin-api KEYCLOAK_ADMIN_CLIENT_SECRET=$ADMIN_API_CLIENT_SECRET \
  DEMO_MODE=1 KEYCLOAK_DEMO_CLIENT_ID=pcp-demo KEYCLOAK_DEMO_CLIENT_SECRET=$DEMO_CLIENT_SECRET

echo "[start] Keycloak realm for $ORIGIN"
mkdir -p /opt/keycloak/data/import
PUBLIC_ORIGIN=$ORIGIN REALM_OUT=/opt/keycloak/data/import/realm-pcp.json node /app/hf/gen-realm.mjs
KC_DB_URL=jdbc:postgresql://127.0.0.1:5432/keycloak KC_DB_USERNAME=pcp KC_DB_PASSWORD=unused \
  KC_HTTP_ENABLED=true KC_HTTP_HOST=127.0.0.1 KC_HOSTNAME_STRICT=false KC_PROXY_HEADERS=xforwarded \
  KEYCLOAK_ADMIN=admin KEYCLOAK_ADMIN_PASSWORD=$(rand) JAVA_OPTS_KC_HEAP="-Xms256m -Xmx1g" \
  /opt/keycloak/bin/kc.sh start --optimized --import-realm > /data/keycloak.log 2>&1 &

echo "[start] Demo data"
node /app/hf/seed.cjs | tail -3

echo "[start] App and Nginx"
(cd /app && HOSTNAME=127.0.0.1 PORT=3150 node server.js > /data/app.log 2>&1 &)
for _ in $(seq 1 120); do curl -sf -o /dev/null http://127.0.0.1:8080/auth/realms/pcp && break; sleep 2; done
echo "[start] Keycloak ready"
PROTO=${ORIGIN%%://*}; PORT=443; [ "$PROTO" = http ] && PORT=${HOST##*:}
sed -e "s#__HOST__#$HOST#g" -e "s#__PROTO__#$PROTO#g" -e "s#__PORT__#$PORT#g" /app/hf/nginx.conf > /data/nginx.conf
exec nginx -c /data/nginx.conf -g "daemon off;"
