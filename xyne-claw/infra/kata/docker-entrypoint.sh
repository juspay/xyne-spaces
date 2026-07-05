#!/bin/bash
# Container entrypoint — runs as root, drops privileges to `claw`.
#
# Historical note: this file used to start an in-container `dockerd`
# (DinD on overlay2) so xyne-claw could run a sandboxed dockerd inside
# kata-qemu. xyne-claw no longer shells out to docker — sandbox work
# happens via the SandboxClaim/Template flow on gvisor/kata-runtime
# nodes — so the dockerd startup was removed. The remaining job is
# just dropping privs to the unprivileged `claw` user before exec'ing
# the CMD. Image still works on any runtime (gvisor, runc, kata) and
# no longer requires `privileged: true` on the Pod.
set -e

# Docker-in-docker setup removed — sandboxes run remotely via the
# sandbox-router (kata/gVisor), not a local dockerd. This entrypoint now just
# drops privileges to the unprivileged `claw` user and execs the container
# command.
exec su -s /bin/bash claw -- -c "HOME=/home/claw exec $(printf '%q ' "$@")"
