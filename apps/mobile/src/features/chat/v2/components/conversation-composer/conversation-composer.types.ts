import type { QueryResultType } from '@rocicorp/zero';

import type { queries } from '@/src/zero/queries';

type ConversationItem = QueryResultType<typeof queries.channelConversationsPaginatedV3>[number];

export type { ConversationItem };
