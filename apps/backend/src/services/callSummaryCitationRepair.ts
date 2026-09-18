/**
 * Citation self-correction for generated call summaries. The LLM retry loop only
 * sees transport failures, so a confidently mis-cited summary is a "success" to
 * it; validation therefore happens on the content, after generation.
 *
 * Audit against the segment ids the transcript actually has, fix what needs no
 * model, send the rest back once with the exact defect list, and keep the result
 * only if it is genuinely better.
 */

import { logger } from '@/utils/logger';
import { executeStreamingLlmRequest, type SummaryModelType } from './callLlmRetry';
import {
  auditSummaryCitations,
  buildCitationRepairPrompt,
  isRepairAcceptable,
  parseNumberedSegmentIds,
  repairCitationsDeterministically,
  stripBrokenCitationArtifacts,
  summarizeAudit,
  type CitationAudit,
} from './callSummaryCitations';

/**
 * One attempt only: the defect list is already explicit, so a model that ignores
 * it once will ignore it twice, and each attempt costs a full transcript
 * round-trip on a path that already ran one.
 */
const MAX_REPAIR_ATTEMPTS = 1;

const REPAIR_OPERATION = 'detailed_summary_citation_repair';

export interface EnsureCitationsOptions {
  markdown: string;
  /** The SAME numbered transcript that was sent to the summariser. */
  numberedTranscript: string;
  callId: string;
  modelType?: SummaryModelType;
  abortSignal?: AbortSignal;
  /** Reused so a custom template's output contract also applies to the repair. */
  systemPrompt?: string;
}

export interface EnsureCitationsResult {
  markdown: string;
  initialAudit: CitationAudit;
  finalAudit: CitationAudit;
  repairAttempted: boolean;
  repairAccepted: boolean;
}

/**
 * Always returns usable Markdown: a repair failure degrades to the original
 * summary with broken citation artefacts stripped, never to null.
 */
export async function ensureSummaryCitations(
  options: EnsureCitationsOptions,
): Promise<EnsureCitationsResult> {
  const { markdown, numberedTranscript, callId, modelType, abortSignal, systemPrompt } = options;
  const validSegmentIds = parseNumberedSegmentIds(numberedTranscript);

  const initialAudit = auditSummaryCitations(markdown, validSegmentIds);
  logger.info(`[${callId}] detailed_summary_citation_audit`, {
    stage: 'initial',
    segment_count: validSegmentIds.size,
    ...summarizeAudit(initialAudit),
  });

  // An un-numbered transcript means nothing could ever have been cited.
  if (validSegmentIds.size === 0) {
    return {
      markdown,
      initialAudit,
      finalAudit: initialAudit,
      repairAttempted: false,
      repairAccepted: false,
    };
  }

  // Recovers the most common observed failure — the model echoing `[12]` instead
  // of `[clf-12]` — with no latency and no tokens.
  const deterministic = repairCitationsDeterministically(markdown, validSegmentIds);
  let current = deterministic.markdown;
  let currentAudit = auditSummaryCitations(current, validSegmentIds);

  if (deterministic.convertedBareRefs > 0 || deterministic.convertedListRefs > 0) {
    logger.info(`[${callId}] detailed_summary_citation_deterministic_repair`, {
      converted_bare_refs: deterministic.convertedBareRefs,
      converted_list_refs: deterministic.convertedListRefs,
      remaining_defects: currentAudit.defectCount,
      verdict: currentAudit.verdict,
    });
  }

  if (currentAudit.verdict === 'ok') {
    return {
      markdown: current,
      initialAudit,
      finalAudit: currentAudit,
      repairAttempted: false,
      repairAccepted: false,
    };
  }

  let repairAttempted = false;
  let repairAccepted = false;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    if (abortSignal?.aborted) break;

    repairAttempted = true;
    logger.info(`[${callId}] ${REPAIR_OPERATION}_started`, {
      attempt,
      reasons: currentAudit.reasons,
      defect_count: currentAudit.defectCount,
    });

    const result = await executeStreamingLlmRequest({
      userPrompt: buildCitationRepairPrompt({
        summaryMarkdown: current,
        numberedTranscript,
        audit: currentAudit,
        validSegmentIds,
      }),
      operation: REPAIR_OPERATION,
      callId,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(modelType ? { modelType } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    if (!result.ok) {
      logger.warn(`[${callId}] ${REPAIR_OPERATION}_llm_failed`, { attempt, reason: result.reason });
      break;
    }

    // A repair can itself introduce bad tokens, so audit it on the same terms.
    const candidate = repairCitationsDeterministically(result.content, validSegmentIds).markdown;
    const candidateAudit = auditSummaryCitations(candidate, validSegmentIds);
    const acceptance = isRepairAcceptable(
      { markdown: current, audit: currentAudit },
      { markdown: candidate, audit: candidateAudit },
    );

    if (!acceptance.accepted) {
      logger.warn(`[${callId}] ${REPAIR_OPERATION}_rejected`, {
        attempt,
        rejection_reason: acceptance.reason,
        before: summarizeAudit(currentAudit),
        after: summarizeAudit(candidateAudit),
      });
      break;
    }

    logger.info(`[${callId}] ${REPAIR_OPERATION}_applied`, {
      attempt,
      acceptance_reason: acceptance.reason,
      defects_before: currentAudit.defectCount,
      defects_after: candidateAudit.defectCount,
      resolved_before: currentAudit.resolvedTokens,
      resolved_after: candidateAudit.resolvedTokens,
    });

    current = candidate;
    currentAudit = candidateAudit;
    repairAccepted = true;

    if (currentAudit.verdict === 'ok') break;
  }

  // Whatever survives, never ship tokens that would render as literal text.
  const cleaned = stripBrokenCitationArtifacts(current, validSegmentIds);
  const finalAudit = auditSummaryCitations(cleaned, validSegmentIds);

  if (cleaned !== current) {
    logger.info(`[${callId}] detailed_summary_citation_artifacts_stripped`, {
      removed_invalid_tokens: currentAudit.invalidSegmentIds.length,
      removed_bare_refs: currentAudit.bareNumericRefs.length,
      removed_malformed: currentAudit.malformedTokens.length,
    });
  }

  logger.info(`[${callId}] detailed_summary_citation_audit`, {
    stage: 'final',
    segment_count: validSegmentIds.size,
    repair_attempted: repairAttempted,
    repair_accepted: repairAccepted,
    ...summarizeAudit(finalAudit),
  });

  return { markdown: cleaned, initialAudit, finalAudit, repairAttempted, repairAccepted };
}
