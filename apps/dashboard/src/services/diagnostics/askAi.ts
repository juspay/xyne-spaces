import { xyneAIActor } from '../../machines/xyneAIMachine';
import { diagnosticsStore } from './store';
import { buildAskAiPrompt } from './report';
import { logger, Event } from '../../utils/logger';

/**
 * Hands the current diagnostics snapshot to Ask AI as an auto-sent question.
 *
 * `xyneAIActor` is a module-level actor, so unlike the channel post this needs
 * no Zero client and no provider — it works from the mobile overlay too. Opening
 * Ask AI also closes the diagnostics panel via the right-panel alternation in
 * AppRoot, which is the intended handoff: the user asked a question and now
 * watches the answer arrive.
 */
export function askAiAboutPerformance(): void {
  const snapshot = diagnosticsStore.getSnapshot();

  xyneAIActor.send({
    type: 'OPEN',
    // A fresh chat so the report is not appended to an unrelated conversation.
    startFreshChat: true,
    initialQuery: buildAskAiPrompt(snapshot),
  });

  logger.info(Event.DIAGNOSTICS_HELP_REQUESTED, {
    destination: 'ask_ai',
    overall: snapshot.overall,
  });
}
