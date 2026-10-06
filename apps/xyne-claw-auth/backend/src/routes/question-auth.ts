/**
 * Authorization for user-answer flow cards (XYNE flow /action "user-answer").
 *
 * The card's HMAC-signed data.userId is the identity the ANSWER is bound to.
 * For interactive (human-triggered) runs that is the asking human, and the
 * strict caller === answerer check is correct. For automation-triggered runs
 * the baked identity is the triggering BOT, so no human can ever pass the
 * strict check and the card is permanently unanswerable (prod 403/502).
 *
 * Rule set (fail closed everywhere):
 *  1. caller === answerer                    → allowed (unchanged prod path)
 *  2. answerer is a Spaces BOT and the caller is an ACTIVE HUMAN member of the
 *     card's channel                          → allowed (the fix)
 *  3. anything else (missing ids, human answerer, non-member caller, bot
 *     caller, DB errors)                      → denied
 *
 * Continuation, when allowed via rule 2, runs as the CALLING human — the
 * helper returns no identity of its own; flow-action keeps using callerUserId
 * for dispatch.
 */

import { errMsg } from "../lib/errors.js";
import { isSpacesBotUser, isActiveHumanChannelMember } from "../lib/spaces-db.js";
import { createLogger } from "../logger.js";

const log = createLogger("question-auth");

export interface QuestionAnswererContext {
  callerUserId: string;
  answerUserId: string;
  channelId: string;
}

export interface QuestionAnswererVerdict {
  allowed: boolean;
  /** Machine-readable denial (or allowance) reason for logs/metrics. */
  reason: string;
}

export async function authorizeQuestionAnswerer(
  ctx: QuestionAnswererContext,
): Promise<QuestionAnswererVerdict> {
  const { callerUserId, answerUserId, channelId } = ctx;

  if (callerUserId && answerUserId && callerUserId === answerUserId) {
    return { allowed: true, reason: "caller-matches" };
  }
  if (!callerUserId || !answerUserId || !channelId) {
    return { allowed: false, reason: "missing-identity" };
  }

  try {
    const answererIsBot = await isSpacesBotUser(answerUserId);
    if (!answererIsBot) {
      return { allowed: false, reason: "answerer-not-bot" };
    }
    const callerIsHumanMember = await isActiveHumanChannelMember(channelId, callerUserId);
    if (!callerIsHumanMember) {
      return { allowed: false, reason: "caller-not-channel-member" };
    }
    log.info(
      `[question-auth] bot-baked card answer allowed: caller=${callerUserId} answerer=${answerUserId} channelId=${channelId}`,
    );
    return { allowed: true, reason: "bot-baked-human-member" };
  } catch (err) {
    log.error(`[question-auth] authorization check failed (denying): ${errMsg(err)}`);
    return { allowed: false, reason: "db-error" };
  }
}
