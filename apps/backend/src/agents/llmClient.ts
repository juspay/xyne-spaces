// import { LLMClient } from '@framework'; // framework removed
import type { OrgLLMServiceAccountPurpose } from '@xyne/shared';

/** Placeholder for the removed framework client; nothing can construct one. */
export type LLMClient = never;

// LLM framework removed; original kept below.
export async function resolveOrgLLMClient(_opts: {
  modelName: string;
  userId: string;
  projectId?: string | null;
  purpose?: OrgLLMServiceAccountPurpose;
}): Promise<LLMClient> {
  throw new Error('LLM client is not configured');
}

// import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
// import { OrgLLMServiceAccountPurpose } from '@xyne/shared';
//
// // Resolves the org's LiteLLM credential (project account first, falling back to
// // the user's) and builds a client for it — the shared spine every direct-LLM
// // agent used to inline. Pass `projectId` (even null) to use the project→user
// // chain; omit it for user-only resolution.
// export async function resolveOrgLLMClient(opts: {
//   modelName: string;
//   userId: string;
//   projectId?: string | null;
//   purpose?: OrgLLMServiceAccountPurpose;
// }): Promise<LLMClient> {
//   const purpose = opts.purpose ?? OrgLLMServiceAccountPurpose.DEFAULT;
//   const credential =
//     ('projectId' in opts
//       ? await orgLLMCredentialService.getCredentialByProjectId(opts.projectId ?? null, purpose)
//       : null) ?? (await orgLLMCredentialService.getCredentialByUserId(opts.userId, purpose));
//
//   if (!credential) {
//     throw new Error('LiteLLM credentials are not configured for this organization');
//   }
//
//   return new LLMClient({
//     provider: {
//       type: 'litellm',
//       config: { apiKey: credential.apiKey, baseUrl: credential.baseUrl },
//     },
//     defaultModel: opts.modelName,
//   });
// }
