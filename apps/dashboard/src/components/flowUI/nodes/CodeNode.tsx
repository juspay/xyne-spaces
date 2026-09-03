import React, { useContext, useState } from 'react';
import { File } from '@pierre/diffs/react';
import { Code, CopyCopied, CopyDefault, MaximizeFourArrow } from '@xyne/icons';
import type { CodeProps, FlowComponent } from '@xyne/shared';
import { useCopyButton } from '../../../hooks/useCopyButton';
import { useFlow } from '../FlowContext';
import { useDiffsTheme } from './useDiffsTheme';
import { ArtifactRenderBoundary } from './ArtifactRenderBoundary';
import { InsideWidgetPreviewContext, WidgetPreview } from './WidgetPreview';

export const CodeNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as CodeProps | undefined;
  const { copied, copy } = useCopyButton();
  const themeOptions = useDiffsTheme();
  const { conversationId } = useFlow();
  // A copy of this card lives inside its own widget-preview thread panel; hide the
  // Maximize there so it can't open a nested preview.
  const insidePreview = useContext(InsideWidgetPreviewContext);
  const [expanded, setExpanded] = useState(false);

  if (!props?.code) return null;
  const { code, language } = props;

  const fileView = (
    <ArtifactRenderBoundary fallbackText={code}>
      <File
        file={{ name: 'snippet', contents: code, ...(language ? { lang: language } : {}) }}
        options={{
          ...themeOptions,
          disableFileHeader: true,
          disableLineNumbers: true,
          overflow: 'scroll',
        }}
        disableWorkerPool
      />
    </ArtifactRenderBoundary>
  );

  return (
    <section
      className='flow-artifact-wide flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
      style={node.style}
    >
      <div className='flex items-center justify-between gap-2 px-4 py-3'>
        <div className='flex items-center gap-2'>
          <Code size={16} aria-label='Code' className='shrink-0 text-muted-foreground' />
          {language && (
            <span className='flex h-[18px] items-center'>
              <span className='rounded bg-muted px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px] text-muted-foreground'>
                {language}
              </span>
            </span>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <button
            type='button'
            onClick={() => copy(code)}
            aria-label={copied ? 'Copied' : 'Copy code'}
            className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            data-track-category='CODE_ARTIFACT'
            data-track-name='COPY_CODE'
          >
            {copied ? (
              <CopyCopied size={16} className='shrink-0' />
            ) : (
              <CopyDefault size={16} className='shrink-0' />
            )}
          </button>
          {!insidePreview && (
            <button
              type='button'
              onClick={() => setExpanded(true)}
              aria-label='Expand code'
              className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='CODE_ARTIFACT'
              data-track-name='EXPAND_CODE'
            >
              <MaximizeFourArrow size={16} className='shrink-0' />
            </button>
          )}
        </div>
      </div>

      <div className='max-h-[420px] overflow-auto border-t border-border text-xs [--diffs-gap-inline:16px]'>
        {fileView}
      </div>

      <WidgetPreview
        open={expanded}
        onOpenChange={setExpanded}
        idPrefix='code-preview'
        label='Code'
        title={language ? `${language} snippet` : 'Code snippet'}
        description='Code snippet'
        conversationId={conversationId ?? undefined}
        tracking={{ category: 'CODE_ARTIFACT', closeName: 'CLOSE_CODE_PREVIEW' }}
      >
        <div className='overflow-auto rounded-xl border border-border text-xs [--diffs-gap-inline:16px]'>
          {fileView}
        </div>
      </WidgetPreview>
    </section>
  );
};
