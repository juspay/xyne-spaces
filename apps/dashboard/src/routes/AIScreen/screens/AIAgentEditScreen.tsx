import { type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { AIShell } from '../../../components/AIScreen/AIShell';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useClawAgentDetail } from '../../../hooks/useClawAgentDetail';
import ClawAgentCreateV2 from '../library/agents/create/ClawAgentCreateV2';
import { useAIChatHandoff } from '../useAIChatHandoff';

const AIAgentEditScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();
  const { slug } = useParams<{ slug?: string }>();
  const { data: agent, isLoading, isError } = useClawAgentDetail(slug);

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <main
        data-id='ai-agent-edit-view'
        className='relative flex h-full flex-1 flex-col overflow-hidden'
      >
        {isLoading ? (
          <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 py-6'>
            <Skeleton className='h-8 w-40' />
            <Skeleton className='h-6 w-64' />
            <Skeleton className='h-[86px] w-full rounded-2xl' />
            <Skeleton className='h-[250px] w-full rounded-2xl' />
          </div>
        ) : isError || !agent ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            Couldn&apos;t load this agent.
          </p>
        ) : (
          <ClawAgentCreateV2 agent={agent} />
        )}
      </main>
    </AIShell>
  );
};

export default AIAgentEditScreen;
