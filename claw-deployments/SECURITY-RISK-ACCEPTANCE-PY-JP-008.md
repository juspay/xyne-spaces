# Risk Acceptance — PY-JP-008 (Privileged Containers) for Kata/gVisor-isolated workloads

**Finding:** PY-JP-008, "Insecure Container securityContext Misconfigurations (Privileged Mode & Missing Escalation Guards)" — MEDIUM, CVSS 6.3 (Payatu, PAYATU/JUSPAY/VAPT/IN/29122025, 2026-08-06).

**Scope of this acceptance:** the remaining `privileged: true` containers listed below. It does **not** cover the escalation-guard hardening for non-privileged workloads, which has been implemented (see the companion PR: `01-sandbox-router.yaml`, `09-verdaccio.yaml`, `phase1-org-migrate.job.yaml`).

## Decision

Retain `privileged: true` on the following containers as an accepted risk, on the basis that each runs behind a deliberate hardware- or kernel-level isolation boundary that bounds the blast radius of a container escape to a disposable, per-workload sandbox rather than the host node.

| Manifest | Container | Why privileged is retained |
|---|---|---|
| `kata-infra/11-kata-deploy.yaml`, `apps/xyne-claw/infra/kata/02-kata-deploy.yaml` | kata-deploy DaemonSet | **Required by design.** These install and configure the Kata Containers runtime on the nodes (host mounts, containerd runtime config). Upstream kata-deploy cannot function without privileged. Removing it breaks the sandbox platform entirely. |
| `xyne-claw-deployment.yaml` | `xyne-claw` | Runs under `runtimeClassName: kata-qemu` on the dedicated `xyne-claw-kata-ng` node pool. `privileged` grants privilege over the **guest micro-VM kernel**, not the host node kernel. A container escape lands inside a throwaway per-pod QEMU VM, not on the node. This is the intended strong-isolation architecture for executing agent/untrusted workloads. |
| `kata-infra/02-sandbox-template.yaml`, `kata-infra/05-sandbox-template-docker-dev.yaml` | sandbox template pods | Templates for the pods that execute untrusted user code, isolated via Kata / gVisor. The docker-dev variant needs privileged for Docker-in-Docker inside the sandbox. The gVisor sibling (`10-sandbox-template-gvisor.yaml`) already applies `runAsNonRoot`, `runAsUser: 1000`, and `allowPrivilegeEscalation: false`. |

## Justification

1. **The privilege is contained by a VM/sandbox boundary, not by the shared host kernel.** The report performed a static source-code review and flagged the raw `privileged: true` flag without runtime context. In practice these containers run under `runtimeClassName: kata-qemu` (hardware-virtualized micro-VMs) or gVisor (`runsc`, a user-space kernel). The security boundary is the hypervisor/sandbox, so `privileged` inside it does not grant host-node compromise — which is the outcome the finding describes.

2. **This is the purpose-built isolation model for the workload.** The claw/agent-sandbox stack exists specifically to run untrusted, user-supplied code. Kata + gVisor on an isolated node pool (`xyne-claw-kata-ng`, tainted `workload=xyne-claw`) is the GKE-recommended pattern for exactly this. Removing privileged from these containers would break the sandboxing they provide, trading a bounded, well-understood risk for a functional regression.

3. **kata-deploy privilege is non-negotiable.** The DaemonSets are upstream components whose job is host-level runtime installation; they are privileged by construction and are not application code we control.

4. **Blast radius is further limited by scheduling isolation.** These workloads are pinned to a dedicated node pool with taints/tolerations, separating them from general application and data-plane workloads.

## Compensating controls (in place)

- Hardware isolation (Kata `kata-qemu`) / user-space-kernel isolation (gVisor `runsc`) on every retained privileged container.
- Dedicated, tainted node pool (`xyne-claw-kata-ng`) separating agent workloads from the rest of the cluster.
- Escalation guards (`allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, `seccompProfile: RuntimeDefault`) applied to the **non-privileged** workloads in the companion PR.
- The gVisor sandbox template already enforces non-root + no-escalation.

## Residual risk

Low. A guest-kernel or hypervisor/gVisor escape (a materially higher bar than a standard container escape) would be required to reach the host from a retained privileged container, and such an escape would have to defeat the Kata/gVisor boundary that is the entire point of this architecture.

## Revisit if

- Any of these workloads is moved off the Kata/gVisor runtime class onto the default (shared-kernel) runtime.
- A CVE materially weakens the Kata or gVisor isolation guarantee.
- A compliance or contractual requirement (SOC 2, ISO 27001, CIS Benchmark attestation) mandates elimination of `privileged: true` regardless of runtime isolation — in which case the Kata/gVisor boundary is a documented compensating control, not a substitute, and any container that can drop privileged (e.g. via specific `capabilities.add` instead) should be migrated.

## Related

- Companion hardening PR: escalation guards + non-root Dockerfiles for the non-privileged workloads (PY-JP-008 partial, PY-JP-009 partial).
- Deferred follow-ups: verdaccio non-root (needs `fsGroup` + PVC chown migration); `nginx`-based claw-auth frontend non-root (needs unprivileged image + Service port change); `python-agent` non-root (needs cache-dir chown).
