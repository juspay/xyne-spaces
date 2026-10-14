import type { QueryResultType } from '@rocicorp/zero';

import type { queries } from '@/src/zero/queries';

type MessageItem = QueryResultType<typeof queries.conversationMessagesV2>[number];

export type { MessageItem };
