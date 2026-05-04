#!/bin/bash
set -e

mkdir -p /var/lib/docker

if [[ $(df -PT /var/lib/docker | awk 'NR==2 {print $2}') == virtiofs ]]; then
  # Kata's VM /dev is minimal — repopulate it so loop-control exists
  mount -t devtmpfs none /dev 2>/dev/null || true

  truncate -s 20G /tmp/docker-disk.img
  mkfs.ext4 -F /tmp/docker-disk.img
  # -o loop avoids needing an explicit losetup step
  mount -o loop /tmp/docker-disk.img /var/lib/docker
fi

update-alternatives --set iptables /usr/sbin/iptables-legacy 2>/dev/null || true
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy 2>/dev/null || true

dockerd \
  --host=unix:///var/run/docker.sock \
  --storage-driver=overlay2 \
  --log-level=error &

echo "[entrypoint] waiting for dockerd..."
timeout 60 sh -c 'until docker info >/dev/null 2>&1; do sleep 0.5; done'
echo "[entrypoint] dockerd ready"

exec su -s /bin/bash claw -- -c "HOME=/home/claw exec $(printf '%q ' "$@")"
