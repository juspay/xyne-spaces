# Ingress

How traffic reaches the install, where TLS is terminated, and what you have to
create yourself. Everything here is chosen by one variable, `ingress_mode` in
`01-infra.tfvars`.

- [The three modes](#the-three-modes)
- [Choosing a mode](#choosing-a-mode)
- [Addresses and DNS come first](#addresses-and-dns-come-first)
- [gateway](#gateway)
- [cloud-lb](#cloud-lb)
- [external](#external)
- [Certificates](#certificates)
- [Node ports](#node-ports)
- [Switching modes on a running install](#switching-modes-on-a-running-install)
- [Checking it works](#checking-it-works)

## The three modes

In all three, routing is done by Istio. There is no Kubernetes `Ingress`
object anywhere in this repository, and no ingress controller other than the
Istio ingress gateway. What changes is only what sits in front of that gateway
and where the TLS session ends.

| | `gateway` | `cloud-lb` | `external` |
|---|---|---|---|
| Edge | the cloud's L4 load balancer, created by the cluster from the gateway Service | an L7 or TLS load balancer that Terraform creates | a load balancer you run |
| TLS terminates | at the Istio gateway | at the edge, re-encrypted to the gateway | at your load balancer |
| Certificate | cert-manager, Let's Encrypt `http01` | yours, given to the edge | yours, on your load balancer |
| Gateway Service | `LoadBalancer` | `NodePort`, or internal `LoadBalancer` on Azure | `NodePort` |
| Public address | the gateway Service's address | the edge load balancer's address | your load balancer's address |
| DNS written by | Terraform, or external-dns on AWS | Terraform | you |
| Works on-prem | only with MetalLB or similar | no | yes |

`gateway` is the default and is what an install gets when `ingress_mode` is not
set. Leaving the new variables alone changes nothing about an existing install.

## Choosing a mode

Use `gateway` unless you have a reason not to. It is the shortest path, it
issues and renews its own certificate, and it needs nothing from you but a DNS
record.

Use `cloud-lb` when the edge has to be a cloud load balancer you can attach
other things to: a WAF, managed TLS policies, an existing certificate in a
cloud certificate store, logging your organisation already collects, or a
static address you were allocated in advance. It also removes the Let's
Encrypt dependency, since the certificate is one you supply.

Use `external` for on-prem, for an air-gapped install, or whenever the
load balancer is not yours to create: a hardware appliance, a shared ingress
another team runs, or a CDN. Terraform builds no load balancer and
`scripts/lb-config.sh` prints what to configure on yours.

## Addresses and DNS come first

The application is served on `<domain>` and `*.<domain>`, and the certificate
cannot be issued, validated or trusted until those names resolve. So reserve
the address before you build the cluster, not after.

`setup.sh` reserves the public addresses as its own stage, prints the records
to create, and waits for you before it builds the network and the cluster.
That way DNS propagates while the slow part of the build runs.

```bash
deployment/scripts/setup.sh --env prod
```

```
17:04:11 stage ingress addresses
Reserve the public address(es) for spaces.example.com now? [yes/N] yes
+ terraform apply -target=google_compute_address.ingress ...

create these records now, the build continues once they resolve:
  spaces.example.com           -> 203.0.113.10
  *.spaces.example.com         -> 203.0.113.10

Continue with the network and cluster build? [yes/N]
```

With a `dns_zone` set there is nothing to do by hand: the stage prints the
records it is about to create, and the `01-infra` apply that follows creates
them. Without one, create them yourself at that prompt. Skip the wait with
`--skip-dns-gate`, or let it run unattended with `--auto-approve`.

In `external` mode there is no cloud address to reserve, so the stage prints
the names to point at your load balancer and nothing else. The same is true on
AWS in `gateway` mode, where the NLB is created inside the cluster and has a
hostname rather than an address; the stage says so and moves on, and the
records come from external-dns later.

On GCP in `cloud-lb` mode the stage is followed by a second targeted apply that
builds the cluster before the rest of `01-infra`. The load balancer's backends
are the node pools' instance groups, whose names Terraform cannot know until
they exist, so the node pools have to be created first. `setup.sh` does this
for you; if you run Terraform by hand, apply `-target=module.cluster` once
before a full apply.

## gateway

The Istio gateway Service is `type: LoadBalancer`. GCP and Azure reserve a
static address and pin the Service to it with `ingress_static_ip` (default
`true`). AWS gets an NLB from `aws-load-balancer-controller`, whose hostname
only exists once the Service is reconciled, which is why external-dns writes
the AWS records from inside the cluster.

`platform-config` renders `Gateway istio-ingress/xyne-gateway` with an HTTP
server on 80 that redirects to HTTPS, and an HTTPS server on 443 holding the
cert-manager certificate `xyne-gateway-tls`.

Nothing here changed. This is the mode every existing install runs.

## cloud-lb

Terraform builds the edge, it terminates TLS, and it opens a second TLS
session to the Istio gateway. The gateway serves a certificate on that inner
leg, and the edge does not verify it, so a self-signed certificate is enough
and `ingress_tls` defaults to `internal`.

What gets built differs per cloud, because the three clouds do not offer the
same thing.

**GCP** gets a global external HTTPS load balancer on a global static address:
a backend service with protocol `HTTPS` whose backends are the node pools'
managed instance groups, a health check against the gateway status port, a URL
map, a target HTTPS proxy, and a forwarding rule on 443. Port 80 gets a
redirect to 443. The gateway Service becomes a `NodePort`.

**AWS** gets a Network Load Balancer with Elastic IPs and a TLS listener. An
Application Load Balancer would have been the obvious L7 choice, but it has no
static IP, only a DNS name, and static addresses reserved ahead of DNS are the
point of this mode. The NLB terminates TLS with an ACM certificate and its
target group re-encrypts to the gateway node port. Istio still does all the
HTTP routing, so nothing is lost by the edge being L4. The gateway Service
becomes a `NodePort`.

**Azure** gets an Application Gateway on a static public IP. Its backend pool
can hold only addresses, not node pools, so the gateway Service stays a
`LoadBalancer` but becomes an *internal* one on a private address you choose
with `ingress_internal_ip`, and that address is the backend.

Azure has one constraint the other two do not: **Application Gateway v2 will
not talk HTTPS to a backend whose certificate is not signed by a well-known
CA unless you give it that certificate's root as a trusted root certificate.**
Terraform cannot know a certificate cert-manager has not issued yet. So on
Azure you either

- supply the backend certificate yourself, `ingress_tls = "existing"`, passing
  the PEM to `gateway_tls` in `02-platform.tfvars` and the same root to
  `ingress_backend_root_certificate_pem`; or
- set `ingress_backend_protocol = "Http"` and `ingress_tls = "none"`, which
  drops the inner TLS session entirely. Only do that when the Application
  Gateway subnet and the cluster subnet are on the same private network, which
  they are in this layout.

## external

Terraform creates no load balancer, no address and no DNS record. The Istio
gateway Service becomes a `NodePort` on fixed ports, and everything in front
of it is yours.

Get the configuration from the script:

```bash
deployment/scripts/lb-config.sh --env prod --format all
```

It prints the node addresses and ports, the health check, the backend
protocol, and a ready-to-edit `haproxy.cfg` and `nginx.conf`. Read it again
after the node pool scales, or point your load balancer at a pool it can
discover rather than at the fixed list.

What your load balancer must do:

- terminate TLS for `<domain>` and `*.<domain>`;
- forward to the gateway's HTTPS node port, not verifying the backend
  certificate, or to the HTTP node port when `ingress_tls = "none"`;
- health check `GET /healthz/ready` on the status node port, expecting `200`;
- pass the client's `Host` header through unchanged, because Istio routes on
  it;
- set `X-Forwarded-For` and `X-Forwarded-Proto: https`;
- allow WebSocket upgrades and long-lived connections, which `/zero/` and
  `/ysweet/` need. A 60-second idle timeout will break both.

On-prem with MetalLB you can also use `gateway` mode instead, which gives you
the cert-manager certificate back, as long as MetalLB can hand the Service an
address and Let's Encrypt can reach port 80.

## Certificates

`ingress_tls` picks where the gateway's certificate comes from. Leave it empty
and the mode picks for you.

| `ingress_tls` | Gateway serves | Who issues it | Use with |
|---|---|---|---|
| `acme` | a real certificate | cert-manager, Let's Encrypt `http01` | `gateway` |
| `internal` | a self-signed certificate | cert-manager, self-signed issuer | `cloud-lb`, `external` |
| `existing` | a certificate you supply | you, through `gateway_tls` in `02-platform.tfvars` | Azure `cloud-lb`, or any edge that verifies the backend |
| `none` | nothing; plain HTTP on 80 | nobody | `cloud-lb`, `external`, when the inner leg is private |

`acme` needs DNS to resolve to the gateway and port 80 to be reachable from
the internet, because the `http01` solver is served through the gateway
itself. That is why it belongs to `gateway` mode.

`internal` exists only to satisfy the inner leg. It is never seen by a
browser. GCP backend services and AWS NLB target groups do not verify it.

The certificate the *public* sees in `cloud-lb` mode is the edge one, issued
and renewed by the cloud itself where it can be:

| Cloud | Issued by the cloud | Or supply your own |
|---|---|---|
| GCP | a Google-managed certificate for `ingress_certificate_domains` | `ingress_certificate_ids`, `ingress_certificate_pem` |
| AWS | an ACM certificate for `domain` and `*.domain` (or `ingress_certificate_domains`), validated in `dns_zone` | `ingress_certificate_arn` |
| Azure | none | `ingress_certificate_key_vault_secret_id`, `ingress_certificate_pfx_data` |

On AWS that makes `cloud-lb` with `dns_zone` set the fully managed path: no
Let's Encrypt, no certificate in the cluster that the public sees, and the NLB
keeps its Elastic IPs.

## Node ports

`cloud-lb` on GCP and AWS, and `external` everywhere, put the gateway on fixed
node ports so the edge has something stable to target. Change them with
`ingress_node_ports`. Azure in `cloud-lb` mode does not use them, because its
backend is an internal load balancer address rather than the nodes.

| Port | Default | Carries |
|---|---|---|
| `https` | 30443 | the gateway's HTTPS server, the backend leg |
| `http` | 30080 | the gateway's HTTP server, used when `ingress_tls = "none"` |
| `status` | 30021 | `/healthz/ready`, the health check only |

The status port must never be exposed to the internet. On AWS the module opens
the http and https ports to `ingress_allowed_cidrs` (default everywhere,
because an internet-facing NLB with instance targets preserves the client IP)
and the status port to the VPC only. On GCP the firewall admits only Google's
front-end and health-check ranges.

## Switching modes on a running install

Changing `ingress_mode` changes the gateway Service type, which means the
cloud load balancer in front of it is deleted and a new path is built. Expect
an outage the length of a DNS change plus a load balancer creation.

Do it in this order:

1. Lower the TTL on the apex and wildcard records, and wait out the old TTL.
2. Apply `01-infra` with the new mode. The new address appears.
3. Apply `02-platform`, which re-renders the root Application, and let Argo CD
   reconcile the gateway Service.
4. Move DNS to the new address and confirm it resolves.
5. Raise the TTL again.

Going from `gateway` to anything else discards the Let's Encrypt certificate,
so have the replacement certificate ready before step 2. Going back to
`gateway` re-issues it, which needs DNS already pointing at the new gateway
address, so step 4 has to come before the certificate turns `READY`.

## Checking it works

```bash
kubectl -n istio-ingress get svc istio-ingressgateway
kubectl -n istio-ingress get gateway xyne-gateway -o yaml
kubectl -n istio-ingress get certificate xyne-gateway-tls
curl -sSI https://<domain>/ | head -n1
```

The Service's `EXTERNAL-IP` is not the address you care about outside `gateway`
mode. On GCP and AWS in `cloud-lb`, and everywhere in `external`, the Service is
a `NodePort` and has none at all. On Azure in `cloud-lb` it shows the private
`ingress_internal_ip` of the internal load balancer. Both are correct. The
public address is the edge one, which `setup.sh` prints as `edge address`.

If the edge answers but every request is a 404, the `Host` header is not
reaching Istio. If it answers but WebSockets drop after a minute, the idle
timeout on the edge is too low. If the health check never passes, check the
status node port rather than the traffic port.

See [operations.md](operations.md#troubleshooting) for the rest.
