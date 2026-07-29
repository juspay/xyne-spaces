/**
 * Slash-command Metrics Event Types
 *
 * Structure of the slash-command usage funnel emitted from the Cmd+K box
 * (`/chat`, `/call`, `/goto`, `/askai`, `/record`). Mirrors the shape of
 * `searchEvents.ts`, but logs-only (no OTel, no sudoQuery).
 *
 * Note: timestamp, version, platformName and emailId are added by the logger
 * envelope automatically.
 */

/** How the user picked a row. Tab/ArrowRight only occur at the command-word stage. */
export type SlashSelectionType = 'mouse' | 'arrow_enter' | 'tab' | 'arrow_right' | 'unknown';

/** Which UI surface was shown for an impression. */
export type SlashImpressionStage = 'discovery' | 'picker';

/** Command-row applied vs. target-row picked. */
export type SlashClickStage = 'command' | 'target';

/** How far the session progressed before it ended. */
export type SlashReachedStage = 'opened' | 'discovery' | 'picker' | 'command' | 'target';

/**
 * Why the slash session ended:
 * - invoke: a command executed
 * - abandon: the box closed without executing (e.g. Escape)
 * - clear: the leading `/` was deleted while the box stayed open
 */
export type SlashSessionEndReason = 'invoke' | 'abandon' | 'clear';

/** Fields present on every slash-command event. */
interface CommonSlashEventFields {
  slash_session_id: string;
  user_id: string;
}

/**
 * Event: slash_command_session_start
 * One entry into command mode (typing `/`) until it executes or the box leaves
 * command mode.
 */
export type SlashCommandSessionStartEvent = CommonSlashEventFields;

/**
 * Event: slash_command_impression
 * The palette shows options — the discovery list (`/`) or a command's picker.
 */
export interface SlashCommandImpressionEvent extends CommonSlashEventFields {
  stage: SlashImpressionStage;
  /** The applied command for a picker; null for the discovery list. */
  command: string | null;
  options_count: number;
  /**
   * The typed text driving the view: the partial command word for discovery
   * (e.g. `/ch`), or just the command token for a resolved command (`/chat`).
   * Never the picker's recipient/query arg — that can be PII.
   */
  typed_text: string;
}

/**
 * Event: slash_command_click
 * A command row was applied (`stage: 'command'`) or a target row was picked
 * (`stage: 'target'`). `selection_type` records the gesture.
 */
export interface SlashCommandClickEvent extends CommonSlashEventFields {
  stage: SlashClickStage;
  command: string;
  selection_type: SlashSelectionType;
  /**
   * Whether this click executed the command. `true` for the terminal action
   * (run/target pick); `false` for an intermediate command-apply step (e.g.
   * Tab-completing `/record`). Count `terminal:true` for invocations.
   */
  terminal: boolean;
  /** Present for `/chat` & `/call` target picks. */
  target_type?: 'user' | 'channel';
  /** For `/goto`: the nav path (e.g. `/activity`) or the extra id (`preferences`/`profile`). */
  destination?: string;
}

/**
 * Event: slash_command_session_end
 * The session concluded. `end_reason: 'invoke'` means a command executed.
 */
export interface SlashCommandSessionEndEvent extends CommonSlashEventFields {
  end_reason: SlashSessionEndReason;
  /** The last active command, or null if the user never picked one. */
  command: string | null;
  reached_stage: SlashReachedStage;
  total_impressions: number;
  /** Time from the last impression to the terminal action (ms). */
  dwell_time_ms: number;
  /** Total time from session start to end (ms). */
  total_session_duration_ms: number;
}

/** Union of all slash-command metric events. */
export type SlashCommandMetricEvent =
  | SlashCommandSessionStartEvent
  | SlashCommandImpressionEvent
  | SlashCommandClickEvent
  | SlashCommandSessionEndEvent;
