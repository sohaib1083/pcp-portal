#!/bin/bash
# Runs once as root when the VM first boots: Docker, the Compose plugin and a swap file for the build.
set -e
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi
touch /var/run/pcp-setup-done
