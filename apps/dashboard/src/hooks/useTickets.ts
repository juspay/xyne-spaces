import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';

export type Ticket = NonNullable<QueryResultType<typeof queries.ticketByIdV2>>;

export interface UseTicketsResult {
  tickets: Ticket[];
  isLoading: boolean;
  error: string | null;
  totalCount: number;
}
