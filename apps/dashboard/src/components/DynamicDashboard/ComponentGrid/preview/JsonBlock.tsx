import { ReactElement, useMemo } from 'react';
import hljs from 'highlight.js';
import { Braces, Check, Copy } from 'lucide-react';
import { useCopyButton } from '../../../../hooks/useCopyButton';

interface JsonBlockProps {
  value: unknown;
  title: string;
  subtitle?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const JsonBlock = ({ value, title, subtitle }: JsonBlockProps): ReactElement => {
  const text = useMemo(() => JSON.stringify(value ?? {}, null, 2), [value]);
  const html = useMemo(() => {
    try {
      return hljs.highlight(text, { language: 'json' }).value;
    } catch {
      return escapeHtml(text);
    }
  }, [text]);
  const { copied, copy } = useCopyButton();

  return (
    <div className='flex flex-col h-full min-h-0'>
      <div className='flex items-center justify-between px-3.5 py-2 border-b border-xyne-gray-100 bg-xyne-gray-50/60'>
        <div className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-xyne-gray-500'>
          <Braces size={13} />
          {title}
          {subtitle && (
            <span className='ml-1 normal-case tracking-normal font-normal text-xyne-gray-400'>
              · {subtitle}
            </span>
          )}
        </div>
        <button
          type='button'
          onClick={() => copy(text)}
          className='inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-xyne-gray-200 bg-white text-[12px] font-medium text-xyne-gray-600 hover:bg-xyne-gray-50 transition-colors'
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Copy_Component_Plan'
        >
          {copied ? (
            <>
              <Check size={13} className='text-xyne-green-600' /> Copied
            </>
          ) : (
            <>
              <Copy size={13} /> Copy
            </>
          )}
        </button>
      </div>
      <pre
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
        className='flex-1 min-h-0 overflow-auto px-4 py-3.5 text-[12.5px] leading-[1.65] font-mono text-xyne-gray-700 whitespace-pre-wrap break-words'
      />
    </div>
  );
};

export default JsonBlock;
