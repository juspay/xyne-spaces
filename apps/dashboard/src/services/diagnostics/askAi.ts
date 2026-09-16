import { xyneAIActor } from '../../machines/xyneAIMachine';
import { diagnosticsStore } from './store';
import { buildAskAiPrompt } from './report';
import { runController } from './run';
import { buildRunAskAiPrompt } from './run/report';
import { logger, Event } from '../../utils/logger';

/**
 * Hands the current diagnostics to Ask AI as an auto-sent question.
 *
 * Opt-in and user-initiated. The diagnostics themselves never call a model: by
 * the time this runs every verdict has already been decided on-device, and what
 * is sent is the finished report rather than raw telemetry for something else to
 * interpret from scratch. A finished run is preferred over the session snapshot,
 * since it is scoped to a window the user can describe.
 *
 * `xyneAIActor` is a module-level actor, so unlike the channel post this needs
 * no Zero client and no provider — it works from the mobile overlay too. Opening
 * Ask AI also closes the diagnostics panel via the right-panel alternation in
 * AppRoot, which is the intended handoff: the user asked a question and now
 * watches the answer arrive.
 */
export function askAiAboutPerformance(): void {
  const report = runController.getSnapshot().report;
  const snapshot = diagnosticsStore.getSnapshot();

  xyneAIActor.send({
    type: 'OPEN',
    // A fresh chat so the report is not appended to an unrelated conversation.
    startFreshChat: true,
    initialQuery: report ? buildRunAskAiPrompt(report) : buildAskAiPrompt(snapshot),
  });

  logger.info(Event.DIAGNOSTICS_HELP_REQUESTED, {
    destination: 'ask_ai',
    source: report ? 'run' : 'session',
    overall: report ? report.overall : snapshot.overall,
  });
}
