#!/usr/bin/env bash
# Test the README's VPS steps in a clean container, with podman (as root):
#
#   sudo deploy/test/run.sh /path/to/open-frequency /path/to/open-frequency/private
#
# Builds a plain Ubuntu 24.04 with systemd (deploy/test/Containerfile), gives it
# bare copies of the two repositories as stand-ins for their remotes, runs
# deploy/test/steps.sh inside, and removes the container. Nothing on the host
# changes except the image it builds. NET=host uses the host's network, for a
# host where podman's own network does not work (WSL, which has no nftables).
set -euo pipefail
net=${NET:+--network=$NET}
public=$(cd "${1:?public repo}" && pwd)
private=$(cd "${2:?private repo}" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'podman rm -f of-vps-test >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

git clone -q --bare "$public" "$work/public.git"
git clone -q --bare "$private" "$work/private.git"
podman build -q $net -t of-vps:test "$here" >/dev/null
# --privileged: the unit's hardening (ProtectSystem, PrivateTmp...) needs the mount
# namespaces a VM has and an unprivileged container does not.
podman run -d $net --privileged --name of-vps-test --systemd=always -v "$work:/repos:ro,Z" of-vps:test >/dev/null
for i in $(seq 1 30); do podman exec of-vps-test systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && break; sleep 1; done
podman cp "$here/steps.sh" of-vps-test:/root/steps.sh
podman exec of-vps-test bash /root/steps.sh
