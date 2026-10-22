import { type ReactElement, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '@/machines/stateMachine';
import { TwinDraftRow, type TwinDraftItem } from '@/components/Chat/DraftsPanel/TwinDraftsPanel';
import { TabMessage } from '@/routes/AIScreen/library/admin/components/TabMessage';

const DigitalTwinRepliesTab = (): ReactElement => {
  const twinDrafts = useSelector(stateMachineActor, state => state.context.twinDrafts);
  const drafts = useMemo<TwinDraftItem[]>(
    () => [...twinDrafts].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
    [twinDrafts],
  );

  if (drafts.length === 0) {
    return (
      <TabMessage>
        No suggested replies right now. When someone tags you, your Twin drafts a reply here for you
        to review.
      </TabMessage>
    );
  }

  return (
    <ul className='flex flex-col gap-3' data-testid='digital-twin-replies'>
      {drafts.map(draft => (
        <li key={draft.id}>
          <TwinDraftRow draft={draft} />
        </li>
      ))}
    </ul>
  );
};

export default DigitalTwinRepliesTab;
