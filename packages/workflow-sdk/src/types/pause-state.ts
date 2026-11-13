/**
 * PauseState — describes what the UI should render when an execution is paused.
 *
 * Compositional model: three orthogonal sections — display, form, actions.
 * The UI renders whatever sections are present:
 *
 * - `display` — read-only data sections (key-value pairs)
 * - `form`    — editable form with typed fields and optional defaults
 * - `actions` — buttons (defaults to Approve + Reject if omitted)
 *
 * Steps that pause execution (via `ctx.pause()`) attach a `PauseState`
 * in the `statePatch` to tell the frontend what interaction is needed.
 */

import type { Condition } from './workflow-config.js';

// ─── Display ───

export interface PauseDisplaySection {
  label: string;
  value: unknown;
}

// ─── Form ───

export interface PauseFormFieldOption {
  label: string;
  value: string;
  /**
   * Offer this choice only when the condition holds.
   *
   * Evaluated by the step that pauses, against the run so far — so what reaches
   * the UI is the list this person may actually choose from, and an option that
   * was filtered out is simply not there. Omitted means always offered.
   */
  when?: Condition;
}

export type PauseFormField =
  | {
      type: 'text';
      name: string;
      label: string;
      required?: boolean;
      description?: string;
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      type: 'textarea';
      name: string;
      label: string;
      required?: boolean;
      description?: string;
      placeholder?: string;
      defaultValue?: string;
      rows?: number;
    }
  | {
      type: 'number';
      name: string;
      label: string;
      required?: boolean;
      description?: string;
      placeholder?: string;
      defaultValue?: number;
      min?: number;
      max?: number;
    }
  | {
      type: 'select';
      name: string;
      label: string;
      required?: boolean;
      description?: string;
      placeholder?: string;
      defaultValue?: string;
      options: PauseFormFieldOption[];
      allowCustomValue?: boolean;
    }
  | {
      type: 'checkbox';
      name: string;
      label: string;
      required?: boolean;
      description?: string;
      defaultValue?: boolean;
    }
  // NOTE: keep in sync with `PauseFormFieldSchema` in steps/builtin/wait.step.ts.
  // The value submitted for an attachment field is an Attachment ref (single) or
  // an array of refs (multiple), under resumeData.data.<name>.
  | {
      type: 'attachment';
      name: string;
      label: string;
      required?: boolean;
      description?: string;
      multiple?: boolean;
      accept?: string[];
      maxSize?: number;
      maxItems?: number;
    };

export interface PauseForm {
  fields: PauseFormField[];
  description?: string;
}

// ─── Actions ───

export interface PauseAction {
  key: string;
  label: string;
  style?: 'primary' | 'danger' | 'default' | undefined;
  /** If true, cancels the execution instead of resuming. */
  abort?: boolean | undefined;
  /** If true, form values are included in the resume payload. Default true for non-abort actions. */
  submitsForm?: boolean | undefined;
}

// ─── PauseState ───

export interface PauseState {
  /** Human-readable reason the workflow is paused. */
  reason: string;
  /** What to show above the interaction panel. Each one is shown in turn. */
  prompt?: string[] | undefined;
  /** Read-only data sections to display. */
  display?: PauseDisplaySection[] | undefined;
  /** Editable form with typed fields. */
  form?: PauseForm | undefined;
  /** Action buttons. Defaults to Approve (primary) + Reject (danger, abort) when omitted. */
  actions?: PauseAction[] | undefined;
}

/**
 * What a pause says, as the list it now is.
 *
 * Executions paused before a prompt became a list hold a single string, and no
 * config migration reaches run data — so both shapes read here. Temporary by
 * intent: once no execution paused before that change is still open, every
 * stored prompt is a list and this, and its callers' use of it, can go.
 *
 * Takes the raw record rather than a `PauseState` because that is what it is
 * for: run data whose shape predates the type.
 */
export function promptLines(pause: { prompt?: unknown } | undefined): string[] {
  const prompt = pause?.prompt;
  if (typeof prompt === 'string') return prompt ? [prompt] : [];
  if (!Array.isArray(prompt)) return [];
  return prompt.filter((line): line is string => typeof line === 'string' && line !== '');
}
