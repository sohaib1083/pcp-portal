#!/usr/bin/env bash
# Hosted demo on Google Cloud (free-trial credit): one VM running Caddy (HTTPS), Nginx, the app, Keycloak, PostgreSQL.
#   deploy/deploy.sh first     create the VM, static IP, firewall, secrets; then build and start
#   deploy/deploy.sh update    ship the current git HEAD and rebuild (data is kept)
#   deploy/deploy.sh reset     restart the portal from its clean demo data
#   deploy/deploy.sh status    show the link and container state
#   deploy/deploy.sh destroy   delete the VM and its IP (stops all charges)
# Settings: PROJECT (default: gcloud's project), ZONE (asia-south1-a, Mumbai), VM, MACHINE (e2-standard-2), PUBLIC_HOST.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null)}
ZONE=${ZONE:-asia-south1-a}
REGION=${ZONE%-*}
VM=${VM:-pcp-portal}
MACHINE=${MACHINE:-e2-standard-2}
G="gcloud --project $PROJECT"
COMPOSE="sudo docker compose -f docker-compose.single.yml --env-file .env"
remote() { $G compute ssh "$VM" --zone "$ZONE" --quiet --command "$1"; }
wait_for() { for _ in $(seq 1 120); do curl -sf -o /dev/null --max-time 10 "$1" && return 0; sleep 5; done; echo "Timed out waiting for $1"; return 1; }
host() { grep '^PUBLIC_HOST=' deploy/.env | cut -d= -f2; }
rand() { openssl rand -hex "${1:-24}"; }

ship() {
  [ -f deploy/.env ] || { echo "Run deploy/deploy.sh first"; exit 1; }
  local H; H=$(host)
  # The same tested all-in-one package as deploy/hf: compiled app, no source code.
  rm -rf /tmp/pcp-space && deploy/hf/build.sh /tmp/pcp-space
  tar -czf /tmp/pcp-release.tgz -C /tmp pcp-space -C "$(pwd)/deploy" docker-compose.single.yml
  $G compute scp --zone "$ZONE" --quiet /tmp/pcp-release.tgz deploy/.env "$VM":/tmp/
  remote "until [ -f /var/run/pcp-setup-done ]; do echo 'waiting for VM setup'; sleep 5; done
    rm -rf ~/pcp && mkdir -p ~/pcp && tar -xzf /tmp/pcp-release.tgz -C ~/pcp && mv ~/pcp/pcp-space ~/pcp/space && cp /tmp/.env ~/pcp/.env
    cd ~/pcp && $COMPOSE up -d --build --remove-orphans"
  echo "Waiting for https://$H ..."
  wait_for "https://$H/login"
  echo; echo "Live: https://$H   (start at https://$H/coverage; demo password Demo@1234)"
}

case "${1:-status}" in
  first)
    $G services enable compute.googleapis.com
    $G compute addresses describe pcp-ip --region "$REGION" >/dev/null 2>&1 || $G compute addresses create pcp-ip --region "$REGION"
    IP=$($G compute addresses describe pcp-ip --region "$REGION" --format='value(address)')
    $G compute firewall-rules describe pcp-allow-web >/dev/null 2>&1 || \
      $G compute firewall-rules create pcp-allow-web --allow=tcp:80,tcp:443 --target-tags=pcp-web --description="PCP demo: HTTP and HTTPS only"
    $G compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1 || \
      $G compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
        --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB \
        --address "$IP" --tags pcp-web --metadata-from-file startup-script=deploy/vm-setup.sh
    if [ ! -f deploy/.env ]; then
      H=${PUBLIC_HOST:-pcp-${IP//./-}.sslip.io}
      umask 077
      cat > deploy/.env <<ENV
PUBLIC_HOST=$H
PG_PASSWORD=$(rand 16)
AUTH_SECRET=$(openssl rand -base64 32)
PORTAL_CLIENT_SECRET=$(rand)
ADMIN_API_CLIENT_SECRET=$(rand)
DEMO_CLIENT_SECRET=$(rand)
KC_ADMIN_PASSWORD=$(rand 12)
ENV
    fi
    echo "VM $VM at $IP; public address https://$(host)"
    ship
    ;;
  update) ship ;;
  reset) remote "cd ~/pcp && $COMPOSE restart pcp" && wait_for "https://$(host)/login" && echo "Demo data reset" ;;
  status)
    echo "https://$(host)"; curl -s -o /dev/null -w "login page: %{http_code} in %{time_total}s\n" "https://$(host)/login" || true
    remote "cd ~/pcp && $COMPOSE ps --format '{{.Service}}: {{.Status}}'"
    ;;
  destroy)
    $G compute instances delete "$VM" --zone "$ZONE" --quiet || true
    $G compute addresses delete pcp-ip --region "$REGION" --quiet || true
    $G compute firewall-rules delete pcp-allow-web --quiet || true
    ;;
  *) echo "usage: deploy/deploy.sh first|update|reset|status|destroy"; exit 1 ;;
esac
