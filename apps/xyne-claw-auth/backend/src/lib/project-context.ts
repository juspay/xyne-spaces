/**
 * The project context a run inherits from the chat it belongs to.
 *
 * Shared by both dispatch paths on purpose. `run-stream.ts` (the /ai screen)
 * does not import start-run.ts, so anything wired into one and not the other
 * silently applies to half the product — the failure mode is a user seeing
 * their project's instructions honoured in a thread but ignored on /ai.
 */

import { chatProjectRepository } from "../repositories/index.js";
import { errMsg } from "./errors.js";

import { createLogger } from "../logger.js";
const log = createLogger("project-context");

/** Matches the app-layer cap on ChatProject.instructions. Applied again here
 *  so a row written before the cap existed cannot blow up a run envelope. */
const MAX_PROJECT_INSTRUCTIONS_CHARS = 10_000;

/**
 * The instructions to inject for a conversation, or null when there are none.
 *
 * Null covers every "nothing to add" case: the chat is unfiled, the project is
 * not the caller's, the text is empty, or the owner switched the instructions
 * off. `instructionsEnabled` is a soft toggle — the text stays on the row but
 * must not reach a run.
 *
 * Best-effort by design. A lookup that throws returns null and logs, because a
 * project-context failure must never stop someone's chat from answering.
 */
export async function resolveProjectInstructions(
  conversationId: string,
  userIds: string | string[],
  orgId: string | undefined,
): Promise<string | null> {
  if (!conversationId || !orgId) return null;

  try {
    const byConversation = await chatProjectRepository.projectIdsForConversations(
      [conversationId],
      userIds,
    );
    const projectId = byConversation.get(conversationId);
    if (!projectId) return null;

    // findOwned, not findUnique: membership rows carry no proof the caller may
    // read the project, and a chat can outlive the access that filed it.
    const project = await chatProjectRepository.findOwned(projectId, userIds, orgId);
    if (!project || !project.instructionsEnabled) return null;

    const instructions = project.instructions.trim();
    if (!instructions) return null;

    const capped = instructions.slice(0, MAX_PROJECT_INSTRUCTIONS_CHARS);
    log.info(
      `[project-context] injected project=${project.id} chars=${capped.length}` +
        (capped.length < instructions.length ? " truncated=true" : ""),
    );
    return capped;
  } catch (err) {
    log.warn(`[project-context] lookup failed conversation=${conversationId}: ${errMsg(err)}`);
    return null;
  }
}
