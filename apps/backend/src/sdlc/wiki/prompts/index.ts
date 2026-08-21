import { SDLC_WIKI_ROLE_INSTRUCTIONS, type SdlcWikiPromptRole } from './roles';
import { SDLC_WIKI_PROMPT_VERSION, SDLC_WIKI_SHARED_POLICY } from './sharedPolicy';

export interface WikiPromptContext {
  executionId: string;
  repoId: string;
  baseBranch: string;
  targetHeadSha: string;
  sessionId: string;
  assignedCommitShas: string[];
  historyWindow?: {
    beforeRef: string;
    afterRef: string;
    includedRefs: string[];
  };
}

export function buildSdlcWikiPrompt(input: {
  role: SdlcWikiPromptRole;
  context: WikiPromptContext;
  existingPageSummaries: string;
  validatorFeedback?: string;
  bootstrapPlan?: string;
}): string {
  const trustedContext = JSON.stringify(input.context);
  const untrusted = [
    '<UNTRUSTED_EXISTING_WIKI_SUMMARIES>',
    input.existingPageSummaries,
    '</UNTRUSTED_EXISTING_WIKI_SUMMARIES>',
    ...(input.validatorFeedback === undefined
      ? []
      : [
          '<UNTRUSTED_VALIDATOR_FEEDBACK>',
          input.validatorFeedback,
          '</UNTRUSTED_VALIDATOR_FEEDBACK>',
        ]),
    ...(input.bootstrapPlan === undefined
      ? []
      : [
          '<UNTRUSTED_BOOTSTRAP_PLAN>',
          input.bootstrapPlan,
          '</UNTRUSTED_BOOTSTRAP_PLAN>',
        ]),
  ].join('\n');

  return [
    `SDLC_WIKI_PROMPT_VERSION=${SDLC_WIKI_PROMPT_VERSION}`,
    SDLC_WIKI_SHARED_POLICY,
    `ROLE=${input.role}`,
    SDLC_WIKI_ROLE_INSTRUCTIONS[input.role],
    '<TRUSTED_RUN_CONTEXT>',
    trustedContext,
    '</TRUSTED_RUN_CONTEXT>',
    untrusted,
  ].join('\n\n');
}

export { SDLC_WIKI_PROMPT_VERSION, SDLC_WIKI_ROLE_INSTRUCTIONS, SDLC_WIKI_SHARED_POLICY };
export type { SdlcWikiPromptRole };
