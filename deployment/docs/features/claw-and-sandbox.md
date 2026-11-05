# Agents (claw) and sandboxes

claw runs AI agents for the app; claw-auth holds their accounts and tool credentials. With the
sandbox addon, each agent session gets its own Kata microVM with a shell, a browser and an editor,
cut off from the cluster and reaching the internet only through an allow-listed proxy.

- [Turn on claw](#turn-on-claw)
- [Turn on sandboxes](#turn-on-sandboxes)
- [What a sandbox is](#what-a-sandbox-is)
- [The workspace image](#the-workspace-image)
- [Network isolation](#network-isolation)
- [Live preview](#live-preview)
- [Kata runtime settings](#kata-runtime-settings)
- [Check it works](#check-it-works)

## Turn on claw

`02-platform.tfvars`:

```hcl
apps = {
  xyne-claw               = { enabled = true }
  xyne-claw-auth          = { enabled = true }
  xyne-claw-auth-frontend = { enabled = true }
}
```

and in `02-platform.secrets.tfvars`, inside `app_secrets`, the model key claw calls its LLM
gateway with:

```hcl
litellm_api_key = "sk-…"
```

The install does not run the gateway itself. Claw expects an OpenAI-compatible LiteLLM endpoint at
`http://litellm:4000`; point it at yours, with a model the gateway serves, through the app values:

```hcl
apps = {
  xyne-claw = {
    enabled = true
    values  = <<-YAML
      env:
        LITELLM_URL: https://llm-gateway.example.com
        LITELLM_MODEL: <model id from the gateway's /v1/models>
    YAML
  }
}
```

`LITELLM_URL` is the base without `/v1`. Without a reachable gateway every Ask AI and agent run
fails with `Connection error.` in the claw log and `getaddrinfo ENOTFOUND litellm`.

`setup.sh --env prod --only platform`. The backend gets `XYNE_CLAW_URL=http://xyne-claw:8081` and
`XYNE_CLAW_AUTH_URL=http://xyne-claw-auth:3003`, and the gateway serves the claw UI at `/claw/`
(the frontend) with its API at `/claw/api/` and `/claw/health` (claw-auth).
claw-auth signs in with the same Google client as the backend. Long-term memory across sessions
is a separate feature: [memory.md](memory.md).

### Spaces database access

claw-auth reads the user's live Spaces session from the Spaces database to act as that user:
downloading message attachments, answering Digital Twin mentions, and Spaces tools. Without it,
attachments arrive as "could not be downloaded" and Twin mentions are skipped with
`no resolvable workspaceId`. Give it a read-only role on the Spaces database:

```sql
CREATE ROLE claw_readonly WITH LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE <spaces db> TO claw_readonly;
GRANT USAGE ON SCHEMA public, workflow TO claw_readonly;
GRANT SELECT ON public.users, workflow.user_sessions, public.installed_apps, public.apps,
  public.channels, public.channel_participants, public.user_groups TO claw_readonly;
```

and its URL in `02-platform.secrets.tfvars`, inside `app_secrets`:

```hcl
spaces_db_url = "postgresql://claw_readonly:…@<host>:5432/<spaces db>?sslmode=require"
```

## Turn on sandboxes

Sandboxes need nodes that can run virtual machines:

| Cloud | `sandbox_enabled = true` creates | Constraint |
|---|---|---|
| AWS | a `m5.metal` node group on Ubuntu 24.04 EKS images | a `.metal`, x86_64 type offered in the region; the doctor checks |
| GCP | an `n1-standard-4` pool with nested virtualization | N1 or N2, not E2 |
| Azure | a `Standard_D4s_v3` pool | a Dv3, Dsv3, Ev3, Esv3, Dv4 or Ev4 size |

`01-infra.tfvars`:

```hcl
sandbox_enabled = true
```

`02-platform.tfvars`:

```hcl
enable_sandbox = true
```

Run `setup.sh --env prod` (both stages). The pool is tainted `workload=sandbox:NoSchedule`, so
only sandboxes land on it.

## What a sandbox is

The addon installs, in wave order:

| Piece | Application | Role |
|---|---|---|
| Kata Containers | `kata-deploy` (DaemonSet on the sandbox pool) | installs the runtime and the `kata-qemu` and `kata-qemu-runtime-rs` RuntimeClasses |
| agent-sandbox controller | `agent-sandbox-controller` | upstream `kubernetes-sigs/agent-sandbox` v0.4.5 with its CRDs: `Sandbox`, `SandboxTemplate`, `SandboxWarmPool`, `SandboxClaim` |
| router | `xyne-sandbox-router` | forwards claw's HTTP and WebSocket calls, and the browser preview, to a sandbox by name |
| egress proxy | `xyne-egress-proxy` | Squid; the only way out of a sandbox |
| template, warm pool, policy | `sandbox` | the `SandboxTemplate`, a warm pool of ready sandboxes (1 by default), the NetworkPolicy, the `xyne-sandbox` ServiceAccount and claw's RBAC |

claw claims a sandbox from the warm pool for each session (`KATA_TEMPLATE`, `KATA_NAMESPACE`,
`KATA_ROUTER_URL` are set on it), and the pool refills.

## The workspace image

Sandboxes run `ghcr.io/juspay/xyne-spaces-agent-workspace`, built from
`claw-deployments/kata-infra/agent-workspace` and published with the other images at `image_tag`.
The same image runs on every cloud. Inside, as uid 1000:

| Port | Service |
|---|---|
| 8888 | the workspace API claw drives: run commands, read and write files |
| 6080 | the noVNC live view of a headed Chromium ([Live preview](#live-preview)) |
| 8443 | code-server (VS Code in the browser) |
| 9223 | a Chromium DevTools endpoint for browser automation |

To have each warm sandbox clone and prepare a repository before it is claimed:

```yaml
template:
  env:
    WORKSPACE_REPO_URL: https://github.com/example-org/app.git
    WORKSPACE_REPO_REF: main
    WORKSPACE_SETUP_COMMAND: npm ci
```

through `addon_values["sandbox"]`. Use an `https://` URL: the clone goes through the egress proxy.
A different image goes in `template.image`.

## Network isolation

A sandbox runs untrusted, agent-written code, so it is fenced in three ways:

1. **Egress only through the proxy.** The NetworkPolicy allows a sandbox DNS to cluster DNS and
   TCP 3128 to `xyne-egress-proxy`, and nothing else: no internet, no other pod, no cloud metadata
   endpoint. `HTTP_PROXY`/`HTTPS_PROXY` point at the proxy, which allows `CONNECT` to its host
   allow list only (GitHub, npm, PyPI, crates, RubyGems, Nix caches and a few others by default).
   Add hosts with `squid.allowedHosts` in `addon_values["sandbox"]` →
   `values.egressProxy`.
2. **No cloud identity.** Sandboxes run as the `xyne-sandbox` ServiceAccount, which has no cloud
   role and no token mounted.
3. **Only the router and claw may connect in.**

This relies on two things that are easy to lose:

- the template sets `networkPolicyManagement: Unmanaged`. In the controller's default `Managed`
  mode it adds its own policy allowing direct internet egress and rewrites pod DNS to
  `8.8.8.8`/`1.1.1.1`, which bypasses the proxy and makes its name unresolvable;
- the CNI must enforce NetworkPolicy. GKE Dataplane V2 and AKS Cilium do; on EKS the stack turns on
  the VPC CNI's `enableNetworkPolicy`.

A sandbox created before a template change keeps its old spec: delete it
(`kubectl -n xyne-apps delete sandbox <name>`) and the warm pool replaces it.

When the cluster runs NodeLocal DNSCache, lookups never reach a kube-dns pod and the policy's DNS
rule does not match: put both addresses from its `-localip` flag in `policy.dns.cidrs`, or every
lookup in a sandbox hangs.

## Live preview

claw posts a link to watch, and drive, the agent's browser:
`https://<domain>/claw-preview/<sandbox>/`. The gateway routes `/claw-preview/` to the sandbox
router, which forwards to the sandbox's noVNC on 6080 (`SANDBOX_PREVIEW_BASE_URL` on claw is the
public URL). The route has no authentication of its own: anyone with a sandbox's name can drive
its browser. The editor link claw also posts, `/claw-code/<sandbox>`, is not routed yet.

## Kata runtime settings

Through `addon_values["sandbox"]`:

| Setting | Default | Meaning |
|---|---|---|
| `kata.shim` | `qemu` | which runtime the template uses; `kata-<shim>` becomes the RuntimeClass. `qemu-runtime-rs` is installed too, but upstream only tests nested containers on `qemu` |
| `kata.hypervisorAnnotations` | memory, vCPUs, I/O and nested-virt settings | the annotations a sandbox may set; one missing from the list is silently ignored and the VM boots at Kata's defaults |
| `template.vcpus`, `template.memory` | `2`, `5120` (MiB) | VM size, applied through those annotations |
| `template.resources` | 2 CPU, 5 GiB | the pod's requests and limits |
| `warmPool.replicas` | `1` | ready sandboxes kept waiting |
| `controller.repoURL` | upstream agent-sandbox | clear it if you install the controller yourself |

## Check it works

```bash
kubectl get runtimeclass                                                # kata-qemu, kata-qemu-runtime-rs
kubectl -n xyne-apps get sandboxtemplate,sandboxwarmpool,sandbox
kubectl -n xyne-apps get pod -l agents.x-k8s.io/sandbox-template-ref-hash \
  -o custom-columns=NAME:.metadata.name,RUNTIME:.spec.runtimeClassName,SA:.spec.serviceAccountName,DNS:.spec.dnsPolicy
```

A sandbox pod shows `kata-qemu`, `xyne-sandbox` and `ClusterFirst`. From inside one:

```bash
S=$(kubectl -n xyne-apps get pod -l agents.x-k8s.io/sandbox-template-ref-hash -o jsonpath='{.items[0].metadata.name}')
kubectl -n xyne-apps exec "$S" -- sh -c '
uname -r                                                                   # the guest kernel, not the node'"'"'s
curl -s -o /dev/null -w "proxy github %{http_code}\n" -m 10 https://github.com
curl -s -o /dev/null -w "proxy example.com %{http_code}\n" -m 10 https://example.com
curl -s -o /dev/null -w "direct %{http_code}\n" -m 5 --noproxy "*" https://example.com
curl -s -o /dev/null -w "metadata %{http_code}\n" -m 3 --noproxy "*" http://169.254.169.254/'
```

Expected: `200` through the proxy for GitHub, `000` for everything else.
