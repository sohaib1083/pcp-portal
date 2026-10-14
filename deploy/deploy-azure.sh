#!/usr/bin/env bash
# Hosted demo on Azure (Azure for Students credit, no card): one VM running Caddy (HTTPS) in front of the
# tested all-in-one PCP container (deploy/hf). The address is https://<DNS_LABEL>.<region>.cloudapp.azure.com.
#   deploy/deploy-azure.sh first     create the resource group, VM, firewall and DNS name, then build and start
#   deploy/deploy-azure.sh update    ship the current working tree and rebuild
#   deploy/deploy-azure.sh reset     restart the portal from its clean demo data
#   deploy/deploy-azure.sh status    show the link and container state
#   deploy/deploy-azure.sh stop      deallocate the VM (stops compute charges; the address is kept)
#   deploy/deploy-azure.sh start     start it again
#   deploy/deploy-azure.sh destroy   delete everything (the resource group)
# Settings: LOCATION (centralindia), SIZE (Standard_B2s), RG (pcp-portal-rg), VM (pcp-portal), DNS_LABEL (pcp-portal-<random>).
set -euo pipefail
cd "$(dirname "$0")/.."
LOCATION=${LOCATION:-centralindia}
SIZE=${SIZE:-Standard_B2s}
RG=${RG:-pcp-portal-rg}
VM=${VM:-pcp-portal}
STATE=deploy/.azure.env
KEY=$HOME/.ssh/pcp_azure
[ -f "$STATE" ] && . "$STATE"
COMPOSE="sudo docker compose -f docker-compose.single.yml --env-file .env"

ip() { az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv; }
host() { echo "${DNS_LABEL}.${LOCATION}.cloudapp.azure.com"; }
remote() { ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "azureuser@$(ip)" "$1"; }
wait_for() { for _ in $(seq 1 120); do curl -sf -o /dev/null --max-time 10 "$1" && return 0; sleep 5; done; echo "Timed out waiting for $1"; return 1; }

ship() {
  local H; H=$(host)
  rm -rf /tmp/pcp-space && deploy/hf/build.sh /tmp/pcp-space
  tar -czf /tmp/pcp-release.tgz -C /tmp pcp-space -C "$(pwd)/deploy" docker-compose.single.yml
  printf 'PUBLIC_HOST=%s\n' "$H" > /tmp/pcp.env
  scp -i "$KEY" -o StrictHostKeyChecking=accept-new /tmp/pcp-release.tgz /tmp/pcp.env "azureuser@$(ip)":/tmp/
  remote "until [ -f /var/lib/cloud/instance/boot-finished ] && command -v docker >/dev/null; do echo 'waiting for VM setup'; sleep 5; done
    rm -rf ~/pcp && mkdir -p ~/pcp && tar -xzf /tmp/pcp-release.tgz -C ~/pcp && mv ~/pcp/pcp-space ~/pcp/space && cp /tmp/pcp.env ~/pcp/.env
    cd ~/pcp && $COMPOSE up -d --build --remove-orphans"
  echo "Waiting for https://$H ..."
  wait_for "https://$H/login"
  echo; echo "Live: https://$H   (start at https://$H/coverage; demo password Demo@1234)"
}

case "${1:-status}" in
  first)
    [ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -f "$KEY" -C pcp-azure
    if [ ! -f "$STATE" ]; then
      DNS_LABEL=pcp-portal-$(openssl rand -hex 3)
      printf 'DNS_LABEL=%s\nLOCATION=%s\n' "$DNS_LABEL" "$LOCATION" > "$STATE"
    fi
    az provider register --namespace Microsoft.Compute --wait >/dev/null
    az provider register --namespace Microsoft.Network --wait >/dev/null
    az group create -n "$RG" -l "$LOCATION" -o none
    cat > /tmp/pcp-cloud-init.yaml <<'CI'
#cloud-config
package_update: true
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo "/swapfile none swap sw 0 0" >> /etc/fstab
CI
    az vm show -g "$RG" -n "$VM" -o none 2>/dev/null || az vm create -g "$RG" -n "$VM" --image Ubuntu2204 --size "$SIZE" \
      --admin-username azureuser --ssh-key-values "$KEY.pub" --public-ip-sku Standard --public-ip-address-dns-name "$DNS_LABEL" \
      --os-disk-size-gb 30 --custom-data /tmp/pcp-cloud-init.yaml -o none
    az vm open-port -g "$RG" -n "$VM" --port 80,443 --priority 900 -o none
    echo "VM $VM at $(ip); address https://$(host)"
    ship
    ;;
  update) ship ;;
  reset) remote "cd ~/pcp && $COMPOSE restart pcp" && wait_for "https://$(host)/login" && echo "Demo data reset" ;;
  status)
    echo "https://$(host)"; curl -s -o /dev/null -w "login page: %{http_code} in %{time_total}s\n" "https://$(host)/login" || true
    remote "cd ~/pcp && $COMPOSE ps --format '{{.Service}}: {{.Status}}'"
    ;;
  stop) az vm deallocate -g "$RG" -n "$VM" -o none && echo "Stopped (no compute charges)" ;;
  start) az vm start -g "$RG" -n "$VM" -o none && wait_for "https://$(host)/login" && echo "Running: https://$(host)" ;;
  destroy) az group delete -n "$RG" --yes && rm -f "$STATE" ;;
  *) echo "usage: deploy/deploy-azure.sh first|update|reset|status|stop|start|destroy"; exit 1 ;;
esac
