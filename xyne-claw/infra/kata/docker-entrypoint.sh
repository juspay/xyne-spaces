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
#
# setpriv, NOT su (2026-07-15): `su` stays alive as PID 1 and on SIGTERM it
# forwards the signal to node but then TERMINATES THE SESSION and SIGKILLs the
# child ~3s later ("Session terminated, killing shell... ...killed."). Every
# graceful drain since this entrypoint existed was therefore a 3-second drain —
# terminationGracePeriodSeconds never applied, in-flight runs died on every
# deploy, and drain-handoff checkpoints never got to run. setpriv exec()s the
# command directly: node becomes PID 1, receives SIGTERM itself, and the full
# grace period governs.
exec setpriv --reuid=claw --regid=nodejs --init-groups env HOME=/home/claw "$@"
