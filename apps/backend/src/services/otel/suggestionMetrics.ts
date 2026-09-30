import { metrics } from '@opentelemetry/api';
import type { Counter, Meter, Attributes } from '@opentelemetry/api';
import { config } from '@/config/env';

export interface SuggestionAttributes extends Attributes {
  workspaceId: string;
}

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Ticket updates proposed from call transcripts (updates to existing tickets)
let _callTicketUpdatesTotal: Counter<SuggestionAttributes> | null = null;
export function getCallTicketUpdatesTotal(): Counter<SuggestionAttributes> {
  if (!_callTicketUpdatesTotal) {
    _callTicketUpdatesTotal = getMeter().createCounter('call_ticket_updates_total', {
      description: 'Total number of ticket updates proposed from call transcripts',
      unit: '1',
    });
  }
  return _callTicketUpdatesTotal;
}

// Ticket updates the user actually applied (comment posted and/or status moved)
let _callTicketUpdatesAppliedTotal: Counter<SuggestionAttributes> | null = null;
export function getCallTicketUpdatesAppliedTotal(): Counter<SuggestionAttributes> {
  if (!_callTicketUpdatesAppliedTotal) {
    _callTicketUpdatesAppliedTotal = getMeter().createCounter('call_ticket_updates_applied_total', {
      description: 'Total number of call ticket updates applied by users',
      unit: '1',
    });
  }
  return _callTicketUpdatesAppliedTotal;
}
