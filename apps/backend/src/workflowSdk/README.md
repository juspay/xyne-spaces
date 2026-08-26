# workflowSdk — the v2 workflow engine

Integration of the published [`@xyne/workflow-sdk`](https://www.npmjs.com/package/@xyne/workflow-sdk)
engine, mounted at **`/api/workflow-studio`** and rendered by `@xyne/workflow-ui`
in the dashboard (`/:workspaceId/workflow-studio`).

**This is NOT `src/workflows/`** — that is the legacy homegrown engine serving
`/api/workflows`. The two engines coexist and SHARE the four legacy tables
(`workflows`, `workflow_executions`, `workflow_execution_states`,
`workflow_steps`), discriminated by **`workflowType='SDK'`** on every SDK row:

- every adapter read/write filters `workflowType='SDK'` (never touches legacy rows);
- the legacy generic poller/recovery never claims SDK executions — `'SDK'` is in
  `GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES` (`src/workflows/polling/workflowRecoveryPolicy.ts`),
  the same mechanism 'Automations' uses;
- automation/legacy queries all filter their own `workflowType`, so they never see SDK rows.

Stores with no legacy counterpart live in the dedicated `workflow` Postgres
schema under bare names (matching the SDK's reference layout in xyne-search):
`workflow.folders`, `step_events`, `credentials`, `webhooks`,
`workflow_callbacks`, `resume_payloads`, `static_data` — plus
`public.sdk_resource_permissions` for grants, which keeps its prefix because it
sits in the shared `public` schema. Prisma models keep the `Sdk` prefix
(`db.sdkFolder` → `workflow.folders`) to stay unambiguous in a 190-model schema.

| File | Role |
|---|---|
| `runtime.ts` | Singleton `WorkflowRuntime` assembly (adapters + registries) |
| `persistence.ts` | `PersistenceAdapter` over Prisma (shared legacy tables + `workflow.*`); encrypts credential data |
| `queue.ts` / `scheduler.ts` | Execution queue + cron scheduling on Bull/Redis (`workflow-sdk-execution`) |
| `storage.ts` | Attachments on GCS/S3 via `storageServiceFactory` under `workflow-sdk/<ws>/` |
| `accessControl.ts` | The `WORKFLOW-STUDIO` ACL gate — READ browses, WRITE mutates, ADMIN adds approvals + credentials |
| `authorizer.ts` / `acl.ts` | Workspace-scoped policy: everything in the workspace is visible to everyone holding the grant |
| `resourcePermissions.ts` | `sdk_resource_permissions` owner rows (creator bookkeeping; not read for authorization) |
| `router.ts` | Express glue over `createWorkflowRouter` (auth ctx, SSE, multipart, public webhook routes) |
| `worker.ts` | `initWorkflowSdkWorkers()` — called from `src/worker.ts` (worker process) |

Phase-1 limits: no sandbox (CODE step fails closed), no AgentStep/ai-builder,
no per-resource sharing — access is the ACL resource, as with automations.
Env: `BACKEND_URL` — the public backend origin that webhook and wait-callback
URLs render from.
