import { prisma } from "../db.js";
import type { OrgProviderCredential } from "@prisma/client";

/** Read-side-only repository for `OrgProviderCredential` — the org-level LiteLLM
 *  key provisioned for an org (by an external process) and used at call sites that
 *  run under the ORG's identity (no meaningful user context): the failure curator,
 *  shared-memory curation, and admin authoring tooling.
 *
 *  Unlike `userProviderCredentialsRepository`, an org key is a single dedicated
 *  row keyed by `(orgId, provider)` — no `managedBy` tier and no shared-credential
 *  binding — so there is no materializer. The row's `model`/`baseUrl`/`authType` are
 *  LiteLLM constants resolved at read time by `buildProviderConfig`, not stored. */
export const orgProviderCredentialsRepository = {
  findByOrgAndProvider: async (orgId: string, provider: string): Promise<OrgProviderCredential | null> => {
    return prisma.orgProviderCredential.findUnique({
      where: { orgId_provider: { orgId, provider } },
    });
  },
};
