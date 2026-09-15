import { type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useClawSubagentDetail } from '../../../hooks/useClawSubagents';
import ClawSubagentCreateV2 from '../library/subagents/create/ClawSubagentCreateV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AISubagentEditScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();
  const { name } = useParams<{ name?: string }>();
  const { data: subagent, isLoading, isError } = useClawSubagentDetail(name);

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-subagent-edit-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        {isLoading ? (
          <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 py-6'>
            <Skeleton className='h-8 w-40' />
            <Skeleton className='h-6 w-64' />
            <Skeleton className='h-[86px] w-full rounded-2xl' />
            <Skeleton className='h-[250px] w-full rounded-2xl' />
          </div>
        ) : isError || !subagent ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            Couldn&apos;t load this subagent.
          </p>
        ) : (
          <ClawSubagentCreateV2 subagent={subagent} />
        )}
      </main>
    </AIShell>
  );
};

export default AISubagentEditScreen;
