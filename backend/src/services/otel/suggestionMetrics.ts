import { metrics } from '@opentelemetry/api';
import type { Counter, Meter, Attributes } from '@opentelemetry/api';
import { config } from '@/config/env';

export interface SuggestionAttributes extends Attributes {
  workspaceId: string;
}

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Total ticket suggestions generated from call summaries
let _callTicketSuggestionsTotal: Counter<SuggestionAttributes> | null = null;
export function getCallTicketSuggestionsTotal(): Counter<SuggestionAttributes> {
  if (!_callTicketSuggestionsTotal) {
    _callTicketSuggestionsTotal = getMeter().createCounter('call_ticket_suggestions_total', {
      description: 'Total number of ticket suggestions generated from call summaries',
      unit: '1',
    });
  }
  return _callTicketSuggestionsTotal;
}

// Total tickets actually created from call summary suggestions
let _callTicketsCreatedFromSuggestionsTotal: Counter<SuggestionAttributes> | null = null;
export function getCallTicketsCreatedFromSuggestionsTotal(): Counter<SuggestionAttributes> {
  if (!_callTicketsCreatedFromSuggestionsTotal) {
    _callTicketsCreatedFromSuggestionsTotal = getMeter().createCounter(
      'call_tickets_created_from_suggestions_total',
      {
        description: 'Total number of tickets created from call summary suggestions',
        unit: '1',
      }
    );
  }
  return _callTicketsCreatedFromSuggestionsTotal;
}
