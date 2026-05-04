# Kata Sandbox Infrastructure — Architecture & Deployment Guide

## What This Is

A system for running isolated sandbox environments inside Kubernetes, where each sandbox is a
Firecracker microVM (via Kata Containers). The AI agent (xyne-claw) can spin up sandboxes
on-demand, run commands and manipulate files inside them, then destroy them — all through a
TypeScript SDK.

Each sandbox gets its **own Linux kernel** (not a shared host kernel). This means:
- Full Docker daemon runs inside the sandbox
- Untrusted / external code cannot escape to the host
- Pod death = everything inside dies cleanly

---

## Components

### 1. `agent-sandbox` Controller (installed via `00-install.sh`)

The Kubernetes controller from `kubernetes-sigs/agent-sandbox`. It is the foundation — without it,
none of the custom resource types exist.

**What it does:**
- Registers 3 CRDs into the cluster:
  - `SandboxTemplate` — defines the pod spec for sandbox pods
  - `SandboxWarmPool` — instructs the controller to keep N sandbox pods pre-warmed
  - `SandboxClaim` — a request to claim one of the warm pods for a session

**Install:**
```bash
bash 00-install.sh
```

---

### 2. Sandbox Router (`01-sandbox-router.yaml`)

An HTTP reverse proxy that sits between the SDK client and the sandbox pods. The SDK never talks
directly to a pod IP — it always goes through the router.

**How it works:**
- Deployed as `sandbox-router` in `xyne-apps` namespace
- Exposed internally as `sandbox-router-svc:8080`
- SDK sends requests with headers:
  - `X-Sandbox-ID: <sandbox-name>` — which sandbox to route to
  - `X-Sandbox-Namespace: xyne-apps`
  - `X-Sandbox-Port: 8888`
- Router resolves the sandbox pod by name and proxies the request to it on port 8888

**Apply:**
```bash
kubectl apply -f 01-sandbox-router.yaml
```

---

### 3. Sandbox Template (`02-sandbox-template.yaml`)

A `SandboxTemplate` CRD that defines what a sandbox pod looks like. The controller uses this
as a blueprint when pre-warming pods.

**Key spec:**
- `runtimeClassName: kata-qemu` — each pod runs as a Kata/Firecracker microVM
- Node affinity: pinned to `kata-sandbox-ng` node pool (Ubuntu nodes, not COS)
- Container image: `asia.gcr.io/xyne-spaces/kata-workspace:latest` (the workspace agent)
- Port 8888 exposed, readiness probe on `GET /`
- `privileged: true` inside the VM — safe because the VM boundary provides isolation

**Apply:**
```bash
kubectl apply -f 02-sandbox-template.yaml
```

---

### 4. Warm Pool (`03-sandbox-warmpool.yaml`)

A `SandboxWarmPool` CRD that tells the controller to keep 3 sandbox pods in a ready-but-unclaimed
state at all times.

**Why warm pools:**
- Without pre-warming, creating a session would require spinning up a new pod from scratch — slow
- With warm pools, claiming a session is near-instant (the pod is already Running)
- After a sandbox is claimed and later destroyed, the controller spins up a replacement to maintain
  the configured replica count

**Apply:**
```bash
kubectl apply -f 03-sandbox-warmpool.yaml
```

---

### 5. Kata Workspace Agent (image: `kata-workspace`)

The process running inside each sandbox pod on port 8888. It is a minimal Node.js/Express HTTP
server that exposes the sandbox's filesystem and shell.

**Source:** `kata-workspace/src/main.ts`

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check — returns `{ status: "ok" }` |
| `POST` | `/execute` | Run a shell command in `/workspace`. Returns `{ stdout, stderr, exit_code }` |
| `POST` | `/upload` | Upload a file into `/workspace` (multipart form) |
| `GET` | `/download/:path` | Download a file from `/workspace` |
| `GET` | `/list[/:path]` | List directory contents |
| `GET` | `/exists[/:path]` | Check if a path exists |

**Entrypoint (`entrypoint.sh`):**
1. Switches `iptables` to legacy mode (required inside Kata VMs for Docker networking)
2. Starts `dockerd` in the background with `overlay2` storage driver
3. Waits up to 60s for dockerd to be ready
4. Starts the Node.js workspace agent

---

### 6. Kata SDK (`@xyne/kata-sdk`)

The TypeScript client used by xyne-claw to interact with the sandbox system.

**Source:** `packages/kata-sdk/`

**Key classes:**

#### `KataClient`
Top-level client. Constructed once with the router URL.

```typescript
const kata = new KataClient({
  routerUrl: "http://sandbox-router-svc:8080",
});
```

**`createSession(options?)`** — creates a sandbox session:
1. Creates a `SandboxClaim` CRD in Kubernetes
2. The agent-sandbox controller assigns a warm pod and sets `status.sandboxRef.name` on the claim
3. SDK polls the claim until `sandboxRef.name` is populated
4. SDK polls the sandbox until its `status.phase == "Running"`
5. Returns a `Session` object

**`exec(cmd, options?)`** — one-shot: create session → run command → destroy session → return result

#### `Session`
Represents a live sandbox. All requests are proxied through the router with sandbox identity headers.

```typescript
const session = await kata.createSession();

// Run a command
const result = await session.commands.run("echo hello");
console.log(result.stdout); // "hello\n"

// Write a file
await session.files.write("hello.txt", "Hello, world!");

// Read a file
const buffer = await session.files.read("hello.txt");

// List files
const entries = await session.files.list(".");

// Check existence
const exists = await session.files.exists("hello.txt");

// Destroy (deletes the SandboxClaim → controller cleans up the pod)
await session.destroy();
```

---

## Full Request Flow

```
xyne-claw
  │
  ├─ kata.createSession()
  │     │
  │     ├─ kubectl create SandboxClaim  ──►  agent-sandbox controller
  │     │                                        │
  │     │                                        ├─ assigns warm pod from SandboxWarmPool
  │     │                                        └─ sets claim.status.sandboxRef.name
  │     │
  │     ├─ polls claim until sandboxRef.name is set
  │     └─ polls sandbox until phase == "Running"
  │
  ├─ session.commands.run("docker run node:20 ...")
  │     │
  │     └─ POST http://sandbox-router-svc:8080/execute
  │           + X-Sandbox-ID: kata-sandbox-abc123
  │           + X-Sandbox-Namespace: xyne-apps
  │           + X-Sandbox-Port: 8888
  │                 │
  │                 └─ sandbox-router resolves pod → proxies to pod:8888/execute
  │                       │
  │                       └─ kata-workspace agent runs command in /workspace
  │                             (Docker is available — full daemon inside the microVM)
  │
  └─ session.destroy()
        └─ kubectl delete SandboxClaim  ──►  controller destroys pod, spins up replacement
```

---

## Deployment Order

```bash
# 1. Install agent-sandbox controller (one-time per cluster)
bash 00-install.sh

# 2. Deploy the sandbox router
kubectl apply -f 01-sandbox-router.yaml

# 3. Register the sandbox template
kubectl apply -f 02-sandbox-template.yaml

# 4. Start the warm pool (controller begins pre-warming pods)
kubectl apply -f 03-sandbox-warmpool.yaml

# 5. Verify
kubectl get sandboxes -n xyne-apps        # should show 3 warm pods
kubectl get sandboxclaims -n xyne-apps    # empty until sessions are created
kubectl get pods -n xyne-apps -l app=sandbox-router  # router running
```

---

## Node Pool Requirement

Kata Containers + Firecracker require **KVM access**, which is blocked on GKE's default
Container-Optimized OS (COS) nodes. The sandbox pods must run on Ubuntu nodes.

The `SandboxTemplate` has a node affinity for `kata-sandbox-ng` — a GKE node pool that must be
created with `imageType: UBUNTU_CONTAINERD` before deploying.

See `xyne-claw/infra/kata/` for the node pool creation scripts.
