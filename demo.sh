#!/usr/bin/env bash
# PCP Digital Portal demo: ./demo.sh up | down | reset | test | tour | share | unshare | logs
set -euo pipefail
cd "$(dirname "$0")"
PORT=3150

wait_for() { for _ in $(seq 1 90); do curl -sf -o /dev/null "$1" && return 0; sleep 2; done; echo "Timed out waiting for $1"; exit 1; }

app_pid() { ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1 || true; }
start_app() {
  if [ -z "$(app_pid)" ]; then nohup npm run start > .app.log 2>&1 & echo $! > .app.pid; fi
  wait_for "http://localhost:$PORT/"
}
restart_app() {
  local pid; pid=$(app_pid)
  if [ -n "$pid" ]; then kill "$pid"; while [ -n "$(app_pid)" ]; do sleep 0.5; done; fi
  start_app
}
stop_tunnel() {
  if [ -f .tunnel.pid ]; then kill "$(cat .tunnel.pid)" 2>/dev/null || true; fi
  pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:8088" 2>/dev/null || true
  rm -f .tunnel.pid .tunnel.url
}

case "${1:-up}" in
  up)
    docker compose up -d
    echo "Waiting for Keycloak ..."; wait_for http://localhost:8088/auth/realms/pcp
    [ -d node_modules ] || npm install
    npx drizzle-kit push >/dev/null
    COUNT=$(docker compose exec -T postgres psql -U pcp -d pcp -tAc "select count(*) from institutions" 2>/dev/null || echo 0)
    [ "${COUNT// /}" = "0" ] && npm run seed
    [ -d .next ] || npm run build
    start_app
    echo; echo "PCP Digital Portal is running: http://localhost:8088"
    echo "Demo accounts are listed at http://localhost:8088/login (password Demo@1234)"
    ;;
  down)
    stop_tunnel
    PID=$(app_pid); [ -n "${PID:-}" ] && kill "$PID" || true
    docker compose stop
    ;;
  reset)
    # Resets the app data AND Keycloak (users, tenants), so both stay in step.
    docker compose stop keycloak >/dev/null
    docker compose exec -T postgres psql -U pcp -d pcp -qc "DROP DATABASE IF EXISTS keycloak;" -c "CREATE DATABASE keycloak;"
    docker compose up -d keycloak >/dev/null
    echo "Re-importing Keycloak realm ..."; wait_for http://localhost:8088/auth/realms/pcp
    npm run seed
    # The realm import forgets the public address, so re-apply it while sharing.
    if [ -f .tunnel.url ]; then node scripts/public-url.mjs "$(cat .tunnel.url)"; fi
    ;;
  share)
    # A free public HTTPS link through a Cloudflare quick tunnel (no account needed).
    # The link works while this machine and the demo are running, and changes each time you share.
    command -v cloudflared >/dev/null || { echo "Install cloudflared first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1; }
    stop_tunnel
    nohup cloudflared tunnel --no-autoupdate --url http://localhost:8088 > .tunnel.log 2>&1 & echo $! > .tunnel.pid
    URL=""
    for _ in $(seq 1 60); do URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' .tunnel.log | head -1 || true); [ -n "$URL" ] && break; sleep 1; done
    [ -n "$URL" ] || { echo "The tunnel did not start; see .tunnel.log"; exit 1; }
    echo "$URL" > .tunnel.url
    node scripts/public-url.mjs "$URL"
    restart_app
    echo "Waiting for the public link to answer ..."; wait_for "$URL/login"
    echo; echo "Public link: $URL"
    echo "Share $URL/login with council members. Every demo account uses Demo@1234, or the one-click personas."
    echo "While sharing, use the public link on this machine too. Stop with ./demo.sh unshare"
    ;;
  unshare)
    stop_tunnel
    node scripts/public-url.mjs http://localhost:8088
    restart_app
    echo "Sharing stopped. The demo is back on http://localhost:8088"
    ;;
  test) node e2e/demo-flow.mjs ;;
  tour) node e2e/presenter-run.mjs ;;
  logs) tail -f .app.log ;;
  *) echo "usage: ./demo.sh up|down|reset|test|tour|share|unshare|logs"; exit 1 ;;
esac
