import { type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronBigLeft } from '@xyne/icons';
import { Pill } from '../../shared/primitives/Pill';
import { DeveloperToolIcon, badgeTone } from '../DevelopersV2';
import { findDeveloperTool, type DeveloperTool } from '../developerTools';
import { CliDoc } from './CliDoc';
import { McpDoc } from './McpDoc';
import { SdkDoc } from './SdkDoc';

function Header({ tool }: { tool: DeveloperTool }): ReactElement {
  return (
    <div className='flex w-full items-start gap-4'>
      <DeveloperToolIcon id={tool.id} size='md' />
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <div className='flex min-w-0 items-center gap-2'>
          <h1 className='truncate text-xl font-semibold leading-7 tracking-[-0.4px] text-foreground'>
            {tool.name}
          </h1>
          <Pill tone={badgeTone(tool.id)}>{tool.badge}</Pill>
        </div>
        <p className='text-sm leading-[22px] text-foreground/75'>{tool.summary}</p>
        {tool.npmPackage && (
          <a
            href={`https://www.npmjs.com/package/${tool.npmPackage}`}
            target='_blank'
            rel='noreferrer'
            data-track-category='Developer tools'
            data-track-name={`${tool.name}: open npm`}
            className='w-fit font-mono text-xs leading-5 text-primary hover:underline'
          >
            npm · {tool.npmPackage}
          </a>
        )}
      </div>
    </div>
  );
}

const DeveloperToolDetailV2 = (): ReactElement => {
  const navigate = useNavigate();
  const { tool: toolId, workspaceId } = useParams<{ tool?: string; workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  const tool = findDeveloperTool(toolId);

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='DeveloperToolDetailV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-10 px-6 pb-12'>
        <div className='bg-background sticky top-0 z-10 flex flex-col gap-6 pb-3 pt-6'>
          <button
            type='button'
            onClick={() => void navigate(`${libraryPath}?tab=developers`)}
            data-track-category='Developer tools'
            data-track-name='Developer tool detail: back'
            className='flex h-7 w-fit shrink-0 items-center rounded-[10px] pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <span className='flex h-7 w-[22px] shrink-0 items-center justify-center'>
              <ChevronBigLeft className='size-4' aria-hidden />
            </span>
            <span className='text-base font-semibold leading-6 tracking-[-0.32px] text-foreground'>
              Developers
            </span>
          </button>
        </div>

        {tool ? (
          <>
            <Header tool={tool} />
            {tool.id === 'mcp' ? <McpDoc /> : tool.id === 'sdk' ? <SdkDoc /> : <CliDoc />}
          </>
        ) : (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            This developer tool doesn&apos;t exist.
          </p>
        )}
      </div>
    </div>
  );
};

export default DeveloperToolDetailV2;
