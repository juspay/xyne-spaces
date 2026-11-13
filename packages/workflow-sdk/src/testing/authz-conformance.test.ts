import { describe, it, expect } from 'vitest';
import { authzConformanceCases } from './authz-conformance.js';
import type { AuthzConformanceConfig } from './authz-conformance.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { AllowAllAuthorizer } from '../authz/default.js';
import type { WorkflowAuthorizer, Action, ResourceRef } from '../authz/types.js';
import { ALL_ACTIONS, FOLDER_ACTIONS, CONTAINER_ACTIONS } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import type { PersistenceAdapter } from '../persistence/types.js';

interface Ctx {
  userId: string;
}

const owner: Ctx = { userId: 'owner' };
const outsider: Ctx = { userId: 'outsider' };

async function seed(adapter: PersistenceAdapter<IdScope>) {
  const folderId = await adapter.createFolder({ name: 'F', metadata: '{}' });
  const workflowId = await adapter.createWorkflow({
    status: 'ACTIVE',
    config: JSON.stringify({ trigger: { type: 'MANUAL', config: {} }, steps: [] }),
    metadata: JSON.stringify({ name: 'W' }),
    eventType: 'MANUAL',
    folderId,
  });
  return { folderId, workflowId };
}

/** Run every case; return the names that failed, with their messages. */
async function runAll(cfg: AuthzConformanceConfig<Ctx, IdScope>): Promise<string[]> {
  const failures: string[] = [];
  for (const c of authzConformanceCases(cfg)) {
    try {
      await c.run();
    } catch (err) {
      failures.push(`${c.name} :: ${(err as Error).message}`);
    }
  }
  return failures;
}

/** A conformant tenant authorizer: `owner` sees and does all; `outsider` nothing. */
class TenantAuthorizer implements WorkflowAuthorizer<Ctx, IdScope> {
  protected isOwner(ctx: Ctx): boolean {
    return ctx.userId === 'owner';
  }
  async permissions(ctx: Ctx, _ref: ResourceRef): Promise<readonly Action[]> {
    return this.isOwner(ctx) ? ALL_ACTIONS : [];
  }
  async visibleFilter(ctx: Ctx): Promise<IdScope> {
    return this.isOwner(ctx) ? { kind: 'all' } : { kind: 'none' };
  }
}

describe('authz conformance kit', () => {
  it('passes for AllowAll — permissive is conformant, the kit checks consistency not strictness', async () => {
    expect(
      await runAll({
        makeAdapter: () => new InMemoryPersistenceAdapter(),
        makeAuthorizer: () => new AllowAllAuthorizer<Ctx>(),
        actors: { owner, outsider },
        seed,
      }),
    ).toEqual([]);
  });

  it('passes for a real tenant authorizer that denies the outsider consistently', async () => {
    expect(
      await runAll({
        makeAdapter: () => new InMemoryPersistenceAdapter(),
        makeAuthorizer: () => new TenantAuthorizer(),
        actors: { owner, outsider },
        seed,
      }),
    ).toEqual([]);
  });

  // ── The kit must BITE. Each of these is a real leak shape. ──

  it('catches a filter that lists rows the guard denies (list ⊄ readable)', async () => {
    // The classic: visibleFilter forgets the tenant predicate while permissions
    // still denies. Rows appear in the list, then 403 on click — or worse, the
    // list itself is the leak, exposing names and ids cross-tenant.
    class LeakyFilter extends TenantAuthorizer {
      override async visibleFilter(): Promise<IdScope> {
        return { kind: 'all' }; // <- leak: everyone sees everything
      }
    }
    const failures = await runAll({
      makeAdapter: () => new InMemoryPersistenceAdapter(),
      makeAuthorizer: () => new LeakyFilter(),
      actors: { owner, outsider },
      seed,
    });
    expect(failures.join('\n')).toMatch(/list ⊆ readable/);
  });

  it('catches permissionsBatch disagreeing with permissions (mis-gates every list row)', async () => {
    class DriftingBatch extends TenantAuthorizer {
      async permissionsBatch(_ctx: Ctx, refs: readonly ResourceRef[]): Promise<ReadonlyArray<readonly Action[]>> {
        return refs.map(() => ALL_ACTIONS); // <- drift: batch is permissive, single is not
      }
    }
    const failures = await runAll({
      makeAdapter: () => new InMemoryPersistenceAdapter(),
      makeAuthorizer: () => new DriftingBatch(),
      actors: { owner, outsider },
      seed,
    });
    expect(failures.join('\n')).toMatch(/permissionsBatch and permissions disagree/);
  });

  it('create gating holds in the negative direction: folder hides "New workflow" ⇒ create is denied', async () => {
    // A deterministic authorizer CANNOT drift here, and that is the whole point
    // of deciding create on the container: `getFolder` projects
    // `permissions(folderRef)` and `createWorkflow` guards `permissions(folderRef)`
    // — the same ref through the same method. There is no second code path to
    // disagree with. (The fabricated-draft ref it replaced had exactly that
    // second path, which is why the button could only ever be optimistic.)
    //
    // So this asserts the negative direction really is wired: withhold the
    // container action and the create must fail, not merely be hidden.
    class NoCreateHere implements WorkflowAuthorizer<Ctx, IdScope> {
      async permissions(_ctx: Ctx, ref: ResourceRef): Promise<readonly Action[]> {
        if (ref.type === 'folder') return FOLDER_ACTIONS; // readable, but no children
        if (ref.type === 'root') return [];
        return ALL_ACTIONS;
      }
      async visibleFilter(): Promise<IdScope> {
        return { kind: 'all' };
      }
    }
    const cfg = {
      makeAdapter: () => new InMemoryPersistenceAdapter(),
      makeAuthorizer: () => new NoCreateHere(),
      actors: { owner },
      seed,
    };
    expect(await runAll(cfg)).toEqual([]);

    // And prove the case was actually exercised rather than vacuously passing:
    // the folder really does hide create, and create really is denied.
    const adapter = new InMemoryPersistenceAdapter();
    const { folderId } = await seed(adapter);
    const perms = await new NoCreateHere().permissions(owner, {
      type: 'folder',
      id: folderId,
      record: (await adapter.getFolder(folderId))!,
    });
    expect(perms).not.toContain('workflow:create');
  });

  it('catches root capabilities disagreeing with createFolder', async () => {
    class RootDrift implements WorkflowAuthorizer<Ctx, IdScope> {
      private asked = 0;
      async permissions(_ctx: Ctx, ref: ResourceRef): Promise<readonly Action[]> {
        if (ref.type === 'root') {
          // Grants on the first ask (capabilities → button shown), denies on the
          // second (the create guard). A stateful/racy authorizer does this for
          // real; here it is forced.
          this.asked += 1;
          return this.asked === 1 ? [...CONTAINER_ACTIONS] : [];
        }
        return ALL_ACTIONS;
      }
      async visibleFilter(): Promise<IdScope> {
        return { kind: 'all' };
      }
    }
    const failures = await runAll({
      makeAdapter: () => new InMemoryPersistenceAdapter(),
      makeAuthorizer: () => new RootDrift(),
      actors: { owner },
      seed,
    });
    expect(failures.join('\n')).toMatch(/"New folder" button and the guard disagree/);
  });
});
