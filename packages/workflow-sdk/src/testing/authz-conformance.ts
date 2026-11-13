/**
 * Authorization conformance kit.
 *
 * A host's authorizer + persistence adapter are the two halves of access
 * control, and the SDK cannot see inside either: `TCtx` and `TFilter` are
 * opaque by design, and the filter is executed by the host's own query. So the
 * SDK cannot verify a host is safe by typing alone — it can only hand over the
 * invariants its enforcement *assumes*, and let the host prove its pair upholds
 * them against a real database.
 *
 * That is what this is. It is the contract test for the port.
 *
 * ## What it checks
 *
 * Invariants, never policy. The kit never asserts "a viewer cannot delete" —
 * that is the host's decision, and a deployment where everyone may delete is
 * perfectly conformant. It asserts that whatever the host decided is applied
 * *consistently*:
 *
 * - **list ⊆ readable** — everything `visibleFilter` lets through the adapter's
 *   query is something `permissions` would grant read on. A violation means a
 *   row is listed that the caller is denied on open: the filter and the
 *   decision disagree, and one of them is a bug.
 * - **display ⇔ enforce** — the `permittedActions` the UI gates buttons on are
 *   the decision the runtime enforces. A violation means a button that 403s, or
 *   worse, an action that succeeds while hidden.
 * - **batch agreement** — `permissionsBatch` returns what `permissions` would.
 *   A violation silently mis-gates every list row, because lists take the batch
 *   path and point reads take the single path.
 *
 * Because it only checks consistency, {@link AllowAllAuthorizer} passes — as it
 * should. The kit catches the pair *disagreeing with itself*, which is the
 * failure that produces leaks and phantom buttons, and which no type can catch.
 *
 * ## Framework-agnostic on purpose
 *
 * It returns named cases rather than registering `describe()` blocks, so it
 * doesn't drag a test framework into the SDK or dictate the host's. Wire it into
 * whatever runner you have:
 *
 * ```ts
 * import { authzConformanceCases } from '@xyne/workflow-sdk/testing/authz-conformance';
 *
 * describe('authz conformance', () => {
 *   for (const c of authzConformanceCases({
 *     makeAdapter: () => new DrizzlePersistenceAdapter(db),
 *     makeAuthorizer: () => new XyneWorkflowAuthorizer(db),
 *     actors: { owner: ownerCtx, editor: editorCtx, viewer: viewerCtx, outsider: otherWorkspaceCtx },
 *     seed: async (adapter) => ({ folderId: …, workflowId: … }),
 *   })) {
 *     it(c.name, c.run);
 *   }
 * });
 * ```
 *
 * A case fails by throwing, so it works with vitest, bun:test, jest, or
 * node:test alike.
 */

import type { WorkflowAuthorizer, ResourceRef, Action } from '../authz/types.js';
import { AccessDeniedError } from '../authz/default.js';
import type {
  PersistenceAdapter,
  QueueAdapter,
  SchedulerAdapter,
} from '../persistence/types.js';
import { WorkflowRuntime } from '../runtime/workflow-runtime.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { ApprovalRequirement } from '../types/approval.js';

// ─── Config ───

export interface AuthzConformanceConfig<TCtx, TFilter> {
  /** Fresh adapter per case — so a mutating case cannot leak into the next. */
  makeAdapter(): PersistenceAdapter<TFilter>;
  /** Fresh authorizer per case. Paired with the adapter above. */
  makeAuthorizer(): WorkflowAuthorizer<TCtx, TFilter>;
  /**
   * The callers to run every invariant against. Name them however you like —
   * the kit never reads the names, only the decisions. Include at least one
   * caller you expect to be denied (a different tenant), or the kit has nothing
   * to disagree about.
   */
  actors: Record<string, TCtx>;
  /**
   * Seed the fixtures into the adapter this case will use, and return their ids.
   * Called once per case, before the case runs.
   */
  seed(adapter: PersistenceAdapter<TFilter>): Promise<AuthzConformanceFixture>;
}

export interface AuthzConformanceFixture {
  /** A folder the actors may or may not have access to. */
  folderId: string;
  /** A workflow inside `folderId`. */
  workflowId: string;
}

export interface ConformanceCase {
  name: string;
  run(): Promise<void>;
}

// ─── Assertions ───

/** Framework-free assert — a case fails by throwing, so any runner reports it. */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`authz conformance: ${message}`);
}

/** Did `fn` reject with AccessDeniedError? Any other error propagates. */
async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    if (err instanceof AccessDeniedError) return true;
    throw err;
  }
}

// ─── Harness ───

function buildRuntime<TCtx, TFilter>(cfg: AuthzConformanceConfig<TCtx, TFilter>) {
  const persistence = cfg.makeAdapter();
  const queue: QueueAdapter = { async enqueue() {} };
  const scheduler: SchedulerAdapter = { async schedule() {}, async unschedule() {} };
  const services = new ServiceRegistry();
  // Authorization is decided before any step runs, so an empty registry is
  // enough: these cases never dispatch one.
  const connectors = new ConnectorRegistry();
  const executor = new WorkflowExecutor(persistence, connectors, services);
  const runtime = new WorkflowRuntime<Record<string, unknown>, TCtx, TFilter>({
    persistence,
    queue,
    scheduler,
    services,
    connectors,
    executor,
    authorizer: cfg.makeAuthorizer(),
    // These cases are about the authorizer's answers, so the approval gate is
    // held open: a workflow diverted to review would never reach the decision
    // under test.
    config: { approval: { default: ApprovalRequirement.NOT_REQUIRED } },
  });
  return { runtime, persistence, authorizer: cfg.makeAuthorizer() };
}

async function setup<TCtx, TFilter>(cfg: AuthzConformanceConfig<TCtx, TFilter>) {
  const built = buildRuntime(cfg);
  const fixture = await cfg.seed(built.persistence);
  return { ...built, fixture };
}

const MANUAL_CONFIG = { trigger: { type: 'MANUAL' as const, config: {} }, steps: [] };

// ─── Cases ───

export function authzConformanceCases<TCtx, TFilter>(
  cfg: AuthzConformanceConfig<TCtx, TFilter>,
): ConformanceCase[] {
  const actors = Object.entries(cfg.actors);
  const cases: ConformanceCase[] = [];

  // ── list ⊆ readable ──

  cases.push({
    name: 'list ⊆ readable: every listed workflow is one the caller may read',
    async run() {
      for (const [name, ctx] of actors) {
        const { runtime } = await setup(cfg);
        for (const row of (await runtime.listWorkflows(ctx)).items) {
          const denied = await isDenied(() => runtime.getWorkflow(ctx, row.id));
          check(
            !denied,
            `${name} was listed workflow ${row.id} but denied reading it — ` +
              `visibleFilter and permissions disagree`,
          );
          check(
            row.permittedActions?.includes('workflow:read') ?? false,
            `${name} was listed workflow ${row.id} without 'workflow:read' in its ` +
              `permittedActions — the row is visible but projected as unreadable`,
          );
        }
      }
    },
  });

  cases.push({
    name: 'list ⊆ readable: every listed folder is one the caller may read',
    async run() {
      for (const [name, ctx] of actors) {
        const { runtime } = await setup(cfg);
        for (const row of (await runtime.listFolders(ctx)).items) {
          const denied = await isDenied(() => runtime.getFolder(ctx, row.id));
          check(
            !denied,
            `${name} was listed folder ${row.id} but denied reading it — ` +
              `visibleFilter and permissions disagree`,
          );
        }
      }
    },
  });

  cases.push({
    name: 'list ⊆ readable: a workflow the caller cannot read is never listed',
    async run() {
      for (const [name, ctx] of actors) {
        const { runtime, fixture } = await setup(cfg);
        const canRead = !(await isDenied(() => runtime.getWorkflow(ctx, fixture.workflowId)));
        const listed = (await runtime.listWorkflows(ctx)).items.some((w) => w.id === fixture.workflowId);
        check(
          canRead || !listed,
          `${name} cannot read workflow ${fixture.workflowId} yet it appears in ` +
            `listWorkflows — the filter is leaking rows the guard would deny`,
        );
      }
    },
  });

  // ── display ⇔ enforce ──

  cases.push({
    name: 'display ⇔ enforce: workflow:update matches the projected permittedActions',
    async run() {
      for (const [name, ctx] of actors) {
        const { runtime, fixture } = await setup(cfg);
        let shown: readonly Action[];
        try {
          shown = (await runtime.getWorkflow(ctx, fixture.workflowId)).permittedActions;
        } catch (err) {
          if (err instanceof AccessDeniedError) continue; // cannot read ⇒ nothing displayed
          throw err;
        }
        const displayed = shown.includes('workflow:update');
        const denied = await isDenied(() =>
          runtime.updateWorkflow(ctx, fixture.workflowId, { summary: 'conformance' }),
        );
        check(
          displayed === !denied,
          `${name}: permittedActions ${displayed ? 'grants' : 'withholds'} workflow:update ` +
            `but the runtime ${denied ? 'denied' : 'allowed'} it — the UI and the guard ` +
            `would disagree on workflow ${fixture.workflowId}`,
        );
      }
    },
  });

  cases.push({
    name: 'display ⇔ enforce: workflow:create is gated by the folder that carries it',
    async run() {
      for (const [name, ctx] of actors) {
        const { runtime, fixture } = await setup(cfg);
        let shown: readonly Action[];
        try {
          shown = (await runtime.getFolder(ctx, fixture.folderId)).permittedActions;
        } catch (err) {
          if (err instanceof AccessDeniedError) continue; // folder invisible ⇒ no "New" button
          throw err;
        }
        const displayed = shown.includes('workflow:create');
        const denied = await isDenied(() =>
          runtime.createWorkflow(ctx, {
            name: 'conformance',
            config: MANUAL_CONFIG,
            folderId: fixture.folderId,
          }),
        );
        check(
          displayed === !denied,
          `${name}: folder ${fixture.folderId} ${displayed ? 'shows' : 'hides'} ` +
            `"New workflow" but create was ${denied ? 'denied' : 'allowed'} — a button ` +
            `that 403s, or an action that works while hidden`,
        );
      }
    },
  });

  cases.push({
    name: 'display ⇔ enforce: folder:create at root is gated by capabilities()',
    async run() {
      for (const [name, ctx] of actors) {
        const { runtime } = await setup(cfg);
        const displayed = (await runtime.capabilities(ctx)).includes('folder:create');
        const denied = await isDenied(() => runtime.createFolder(ctx, { name: 'conformance' }));
        check(
          displayed === !denied,
          `${name}: capabilities() ${displayed ? 'grants' : 'withholds'} folder:create at ` +
            `root but createFolder was ${denied ? 'denied' : 'allowed'} — the top-level ` +
            `"New folder" button and the guard disagree`,
        );
      }
    },
  });

  // ── batch agreement ──

  cases.push({
    name: 'permissionsBatch returns exactly what permissions would, ref for ref',
    async run() {
      for (const [name, ctx] of actors) {
        const { runtime, persistence, authorizer } = await setup(cfg);
        if (!authorizer.permissionsBatch) return; // optional optimisation, nothing to check

        const rows = (await runtime.listWorkflows(ctx)).items;
        const refs: ResourceRef[] = rows.map((w) => ({ type: 'workflow', id: w.id, record: w }));
        const folder = await persistence.getFolder(
          (await runtime.listFolders(ctx)).items[0]?.id ?? '',
        );
        if (folder) refs.push({ type: 'folder', id: folder.id, record: folder });
        refs.push({ type: 'root' });
        if (refs.length === 0) continue;

        const batched = await authorizer.permissionsBatch(ctx, refs);
        check(
          batched.length === refs.length,
          `${name}: permissionsBatch returned ${batched.length} results for ${refs.length} ` +
            `refs — results are positional, so a length mismatch mis-gates every row`,
        );
        for (const [i, ref] of refs.entries()) {
          const single = await authorizer.permissions(ctx, ref);
          const a = [...(batched[i] ?? [])].sort();
          const b = [...single].sort();
          check(
            JSON.stringify(a) === JSON.stringify(b),
            `${name}: permissionsBatch and permissions disagree on ` +
              `${ref.type}${ref.type === 'root' ? '' : `:${ref.id}`} — ` +
              `batch said [${a.join(', ')}], single said [${b.join(', ')}]. Lists take the ` +
              `batch path and point reads take the single one, so the UI would mis-gate.`,
          );
        }
      }
    },
  });

  return cases;
}
