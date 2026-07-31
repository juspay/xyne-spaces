<div align="center">

# Xyne Spaces

**The context layer for your organization — permission-aware by default, and built for agents.**

Every conversation, ticket, call, document and calendar in one place, indexed and served
back to your people *and* your agents — with each read and write filtered through the same
permission model.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENCE)
[![CI](https://github.com/juspay/xyne-spaces/actions/workflows/ci.yml/badge.svg)](https://github.com/juspay/xyne-spaces/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

<details>
<summary><b>📁 Table of Contents</b></summary>

- [Why Xyne Spaces?](#why-xyne-spaces)
- [What can I do with Xyne Spaces?](#what-can-i-do-with-xyne-spaces)
- [Architecture](#architecture)
- [Agents and the sandbox](#agents-and-the-sandbox)
- [Quickstart](#quickstart)
- [Connectors](#connectors)
- [MCP tools](#mcp-tools)
- [Demos](#demos)
- [Repository map](#repository-map)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Feature requests and bugs](#feature-requests-and-bugs)
- [License](#license)

</details>

---

## Why Xyne Spaces?

An organization's context is scattered across a dozen tools, and the moment you try to
gather it somewhere useful you hit the same wall: **most of it is not safe to show to
everyone.** Search that ignores permissions is a leak. An assistant that ignores them is a
worse one.

Xyne Spaces starts from the opposite end. Context is centralized, but **access control
lives in the data layer, not in a filter bolted on top**:

- **Synced reads are narrowed before they run.** Every table carries a policy that rewrites
  the query for the acting user, so rows they may not see are never selected — not fetched
  and then hidden.
- **Writes are wrapped, not trusted.** Sync mutations are ACL-wrapped centrally, and REST
  routes go through a permission matrix of resource × access level resolved per user and
  group. Both paths are enforced in one place each, so a new feature is guarded by default
  rather than by someone remembering to add a check.
- **Agents inherit the same boundary.** An agent acts *as the person who invoked it*. It
  reaches exactly their slice of the org, and there is no system-token back door around it.

That last point is what makes it worth pointing an agent at your company's context at all.
It can use everything that person could have found themselves — no more, and no less.

---

## What can I do with Xyne Spaces?

<details>
<summary><b>Bring your org's context into one place</b></summary>
<br>

Sync conversations, tickets, email and calendars from the tools you already use, or bulk
import history from Jira, Confluence and Slack. Everything is normalized, deduplicated,
threaded and indexed for hybrid search.

</details>

<details>
<summary><b>Work in real time, together</b></summary>
<br>

Channels, threads, tickets, boards, calls and collaborative canvases. The client keeps a
live local replica rather than polling, so edits appear instantly, keep working offline,
and replay on reconnect.

</details>

<details>
<summary><b>Run agents that actually have context</b></summary>
<br>

Agents run inside an isolated sandbox with no credentials of their own, reach your context
through the same permission checks as the UI, and pause for explicit approval before doing
anything that writes. They can search, summarize, triage, draft, review code and act across
connected systems.

</details>

<details>
<summary><b>Search across everything you're allowed to see</b></summary>
<br>

Hybrid retrieval over the full corpus — conversations, documents, tickets, call
transcripts — scoped to the person asking. The same index backs both the search box and an
agent's context lookups.

</details>

<details>
<summary><b>Automate the routine work</b></summary>
<br>

Scheduled agent runs, ticket triage and classification, entity extraction, draft replies,
SLA and deadline tracking, recaps and daily briefs — background jobs rather than things
someone has to remember.

</details>

---

## Architecture

<div align="center">
  <img src="docs/assets/architecture.svg" alt="Xyne Spaces layered architecture" width="960">
</div>

## Agents and the sandbox

Agents here run real code — they read repositories, execute shell commands, call internal
APIs and write files. That is the point, and it is also the risk. So the agent plane is
split across three tiers, and the split *is* the security model:

**the tier that runs untrusted code holds no secrets, and the tier that holds every secret
runs no untrusted code.**

<div align="center">
  <img src="docs/assets/agent-sandbox.svg" alt="Xyne Claw and sandbox layered architecture" width="1000">
</div>

**The gateway holds everything.** `claw-auth` verifies the HMAC-signed webhook from Spaces,
resolves the agent and its credentials, dispatches the run, and then executes *every*
external tool call itself through `/mcp/call`. It also owns the backing stores — Postgres
for agents and credentials, Redis and BullMQ for scheduled jobs and run recovery, GCS for
session checkpoints.

**The runtime has no secrets and no shell.** The `xyne-claw` pod runs the LLM agent loop and
a set of path-scoped filesystem tools. It cannot reach a connected system directly: it posts
a tool name and parameters back to the gateway with a short-lived HMAC session token and
receives only the result. A compromised run yields no reusable secret, because none was ever
there.

**Bash lives behind a hypervisor.** Anything that needs a real shell runs in a
[Kata Containers](https://katacontainers.io/) QEMU microVM with its own kernel, driven by
the gateway through `sandbox-*` control-plane calls. That VM has **egress closed** — no
network, no gateway credentials — so it is safe by isolation rather than by permission.
Setup lives in `apps/xyne-claw/infra/kata/`.

**Writes need a human.** Read tools run freely. Tools that create a ticket, schedule a call,
edit a canvas or send a message *as you* post an approve/decline card in the thread and wait
for a click. The distinction is identity, not danger: acting as the bot is autonomous,
acting as you needs your consent.

---

## Quickstart

**Prerequisites** — Node.js 22.x, pnpm 10.15.0, and Docker (or OrbStack / Podman) with
Compose. Details in [Prerequisites](docs/setup/prerequisites.md).

```bash
git clone https://github.com/juspay/xyne-spaces.git
cd xyne-spaces
pnpm run up
```

<details>
<summary>What <code>pnpm run up</code> does</summary>
<br>

Each phase runs serially and stops at the first failure. Every phase is idempotent, so
re-running it on an existing checkout is safe — and you can run any phase on its own.

| Phase | What it does |
| --- | --- |
| `pnpm run env:setup` | Copies each app's `.env.example` into place — never overwrites an existing file |
| `pnpm run setup` | Installs workspace dependencies and builds the shared packages |
| `pnpm run secrets` | Generates the local secrets that ship as `set-me` placeholders |
| `pnpm run services` | Starts infrastructure containers, runs migrations, seeds the databases |
| `pnpm run dev:all` | Starts backend, dashboard, `xyne-claw` and `xyne-claw-auth` in parallel |

</details>

Once it finishes:

| Service | URL |
| --- | --- |
| Dashboard | http://localhost:5173 |
| Backend API | http://localhost:3001 |
| API docs | http://localhost:3001/api-docs |
| Xyne Claw | http://localhost:3002 |
| Claw Auth | http://localhost:3003 |

Sign in locally with `admin@xyne.ai` / `xynelocal@123`.

Stuck? → [Troubleshooting](docs/setup/troubleshooting.md). Configuring model providers?
→ [AI providers](docs/setup/ai-providers.md).

---

## Connectors

Context arrives two ways. **Live sync** is continuous — webhooks in, scheduled pulls out.
**Migration** is a one-time bulk import of history. Both end in the same place: normalized
records in PostgreSQL, indexed into Vespa, behind the same ACLs as everything else.

| Connector | Type | Brings in |
| --- | --- | --- |
| **Slack** | Live sync + migration | Channels, threads, messages; ticket intake from Slack |
| **Gmail / Google Workspace** | Live sync | Mail, attachments, calendar |
| **Microsoft 365** | Live sync | Mail and calendar |
| **Jira** | Migration | Projects, issues and history |
| **Confluence** | Migration | Spaces, page trees and attachments |

The pipeline is platform-agnostic: each connector is an adapter — resolve, authenticate,
transform, sync — and everything after it is shared. Adding a platform means writing an
adapter, not touching the pipeline. Credentials are stored encrypted and decrypted only at
the moment of use.

→ Adapter contract: [`apps/backend/src/integrations/README.md`](apps/backend/src/integrations/README.md)

---

## MCP tools

Connectors bring context **in**. MCP tools let an agent **act on** an external system —
different system, different code path, configured per user rather than per workspace.

Claw Auth brokers **50+ MCP integrations**. A representative slice:

| Category | Examples |
| --- | --- |
| Code and delivery | GitHub, Bitbucket, Sentry, Grafana, Honeycomb, Kibana |
| Work tracking | Asana, Notion, Calendly, Docusign |
| Data | BigQuery, ClickHouse, Databricks, MongoDB, Neo4j |
| Product and growth | Amplitude, Mixpanel, Customer.io, HubSpot, Salesforce, Intercom |
| Design and docs | Figma, Miro, Excalidraw, Webflow |
| Xyne first-party | Spaces context search, ticket and canvas tools, knowledge base, dashboard |

A connector only appears for a user once they have connected it, so an agent's available
tools are a function of that user's own integrations — and tool sets are scoped per agent
rather than handing every run the full catalogue.

---

## Demos

> 📹 Walkthroughs are being recorded. Links land here as they are published.

| Demo | What it covers | Link |
| --- | --- | --- |
| Getting started | Clone to running locally in one command | _coming soon_ |
| Spaces tour | Channels, threads, tickets, boards and canvases | _coming soon_ |
| Permission-aware context | The same search, two users, two different result sets | _coming soon_ |
| Agents in a thread | Asking an agent, citations, approving a write action | _coming soon_ |
| Connecting a source | Connecting Slack and watching context arrive | _coming soon_ |
| Migrating from Jira / Confluence | Preview, mapping and import | _coming soon_ |

---

## Repository map

```
xyne-spaces/
├── apps/
│   ├── backend/            REST API, Zero sync server, workers, integrations
│   ├── dashboard/          Web client — React 19 + Vite + Zero
│   ├── dashboard-external/ Externally embeddable dashboard
│   ├── electron/           Desktop wrapper
│   ├── public-web/         Public marketing site
│   ├── site/               Documentation site
│   ├── xyne-claw/          Agent runtime — the sandbox
│   └── xyne-claw-auth/     Identity, credential store, MCP gateway
├── packages/
│   ├── shared/             Zero schema, query ACLs, shared types
│   ├── framework/          Agentic framework library
│   ├── icons/              Icon set
│   └── xyne-claw-mcp/      MCP server + plugin for Xyne Claw agents
├── vespa-core/             Search schemas and deployment
├── docker/                 Container configuration
├── docs/                   Setup documentation
├── scripts/                Bootstrap, seeding and validation scripts
└── tools/                  E2E automation and analysis tooling
```

| Component | Stack |
| --- | --- |
| Backend | Node 22, TypeScript, Express, Prisma, PostgreSQL, Redis, Bull |
| Sync | Zero (Rocicorp), ACL-enforced queries and mutators |
| Dashboard | React 19, Vite, Tailwind, Radix UI, XState, TipTap |
| Search | Vespa |
| Agents | Xyne Claw + Claw Auth, MCP tooling, LiteLLM for model access |
| Isolation | Kata Containers with QEMU microVMs, egress closed |

---

## Documentation

| Guide | |
| --- | --- |
| [Prerequisites](docs/setup/prerequisites.md) | Versions and tooling you need first |
| [Local development](docs/setup/local-development.md) | Getting a working environment |
| [Services](docs/setup/services.md) | What the infrastructure containers do |
| [AI providers](docs/setup/ai-providers.md) | Configuring model access |
| [Troubleshooting](docs/setup/troubleshooting.md) | When setup goes wrong |
| [API reference](API_DOCUMENTATION.md) | REST API documentation |

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers what the tooling enforces, so a
first pull request does not bounce on something mechanical. In short: branches are `fix/*`
or `feature/*`, commits are `<type>: <TICKET-ID> <subject>`, and dependencies are added
with a `--filter`.

For anything larger than a small fix, open an issue first so the approach can be agreed
before it is written. Participation is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Feature requests and bugs

- **Bug** — [open a bug report](https://github.com/juspay/xyne-spaces/issues/new?template=bug_report.yml)
  with what you ran, what happened, and the output.
- **Feature** — [open a feature request](https://github.com/juspay/xyne-spaces/issues/new?template=feature_request.yml)
  describing the problem before the solution.

## License

Licensed under the [Apache License 2.0](LICENCE).
