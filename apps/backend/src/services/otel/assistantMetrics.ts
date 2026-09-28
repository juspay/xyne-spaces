import { metrics } from '@opentelemetry/api';
import type { Attributes, Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

export interface AssistantTurnAttributes extends Attributes {
  /** What the user sent: text, choose (a tap), or planResult. */
  input: string;
  /** How the turn ended: plan, question, reply, error, or failed. */
  outcome: string;
}

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

let _assistantTurnsTotal: Counter<AssistantTurnAttributes> | null = null;
export function getAssistantTurnsTotal(): Counter<AssistantTurnAttributes> {
  if (!_assistantTurnsTotal) {
    _assistantTurnsTotal = getMeter().createCounter('assistant_turns_total', {
      description: 'Voice and text assistant turns, by input and outcome',
      unit: '1',
    });
  }
  return _assistantTurnsTotal;
}

let _assistantTurnDuration: Histogram<AssistantTurnAttributes> | null = null;
export function getAssistantTurnDuration(): Histogram<AssistantTurnAttributes> {
  if (!_assistantTurnDuration) {
    _assistantTurnDuration = getMeter().createHistogram('assistant_turn_duration_ms', {
      description: 'Time to answer one assistant turn',
      unit: 'ms',
    });
  }
  return _assistantTurnDuration;
}

let _assistantJevDuration: Histogram<{ ok: string }> | null = null;
export function getAssistantJevDuration(): Histogram<{ ok: string }> {
  if (!_assistantJevDuration) {
    _assistantJevDuration = getMeter().createHistogram('assistant_jev_duration_ms', {
      description: 'Time for one Jev request from the assistant, by whether it answered',
      unit: 'ms',
    });
  }
  return _assistantJevDuration;
}
