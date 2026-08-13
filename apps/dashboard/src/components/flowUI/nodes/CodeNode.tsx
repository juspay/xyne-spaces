import React from 'react';
import { File } from '@pierre/diffs/react';
import { CopyCopied, CopyDefault } from '@xyne/icons';
import type { CodeProps, FlowComponent } from '@xyne/shared';
import { useCopyButton } from '../../../hooks/useCopyButton';
import { useDiffsTheme } from './useDiffsTheme';
import { ArtifactRenderBoundary } from './ArtifactRenderBoundary';

export const CodeNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as CodeProps | undefined;
  const { copied, copy } = useCopyButton();
  const themeOptions = useDiffsTheme();

  if (!props?.code) return null;
  const { code, language } = props;

  return (
    <section
      className='flow-artifact-wide flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
      style={node.style}
    >
      <div className='flex items-center justify-between gap-2 px-4 py-3'>
        <div className='flex items-center gap-2'>
          <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
            Code
          </span>
          {language && (
            <span className='flex h-[18px] items-center'>
              <span className='rounded bg-muted px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px] text-muted-foreground'>
                {language}
              </span>
            </span>
          )}
        </div>
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
      </div>

      <div className='max-h-[420px] overflow-auto border-t border-border text-xs [--diffs-gap-inline:16px]'>
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
      </div>
    </section>
  );
};
