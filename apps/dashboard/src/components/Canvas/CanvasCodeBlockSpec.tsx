import { defaultBlockSpecs } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import hljs from 'highlight.js';
import { useMemo, type ReactElement, type Ref } from 'react';
import { MermaidBlock } from '../Markdown/MermaidBlock';

const codeConfig = defaultBlockSpecs.codeBlock.config;

export const CANVAS_CODE_LANGUAGES = [
  { value: '', label: 'Auto' },
  { value: 'text', label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'diff', label: 'Diff' },
  { value: 'go', label: 'Go' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'yaml', label: 'YAML' },
] as const;

function HighlightedCanvasCode(props: {
  code: string;
  language: string;
  contentRef: Ref<HTMLElement>;
}): ReactElement {
  const highlighted = useMemo(() => {
    try {
      return hljs.getLanguage(props.language)
        ? hljs.highlight(props.code, { language: props.language }).value
        : hljs.highlightAuto(props.code).value;
    } catch {
      return hljs.highlightAuto(props.code).value;
    }
  }, [props.code, props.language]);

  return (
    <div className='canvas-highlighted-code relative' data-language={props.language}>
      <pre className='pointer-events-none absolute inset-0 m-0 overflow-hidden' aria-hidden='true'>
        {/* eslint-disable-next-line react/no-danger, @typescript-eslint/naming-convention */}
        <code className='hljs block' dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
      <pre className='bn-code-block relative m-0 bg-transparent'>
        <code ref={props.contentRef} className='canvas-code-editor block' spellCheck={false} />
      </pre>
    </div>
  );
}

export const canvasCodeBlockSpec = createReactBlockSpec(
  codeConfig,
  {
    meta: { code: true, defining: true },
    render: ({ block, contentRef }) => {
      const language = String(block.props.language ?? 'text').toLocaleLowerCase();
      const chart = Array.isArray(block.content)
        ? block.content
            .map(content =>
              'text' in content && typeof content.text === 'string' ? content.text : '',
            )
            .join('')
        : '';
      if (language !== 'mermaid') {
        return (
          <HighlightedCanvasCode
            code={chart}
            language={language}
            contentRef={contentRef as Ref<HTMLElement>}
          />
        );
      }
      return (
        <div className='w-full' data-wiki-mermaid='true'>
          <MermaidBlock chart={chart} messageId={`canvas-${block.id}`} controlsOnHover />
          <pre className='hidden' aria-hidden='true'>
            <code ref={contentRef} spellCheck={false} />
          </pre>
        </div>
      );
    },
  },
  defaultBlockSpecs.codeBlock.extensions,
)();
