import { useState, type ReactElement } from 'react';
import { WrapText } from 'lucide-react';
import { PreviewButton, PreviewControls, PreviewMeta, PreviewSkeletonView } from '../chrome';
import { useFileText } from '../content';
import type { PreviewerProps } from '../types';
import { CodeLines } from './code/CodeLines';
import { CodeFontSizeControls } from './code/codeFontSize';
import { languageFor, languageName } from './code/languages';

/** A text file as numbered lines, coloured when its name says it's code. */
export default function TextPreview(props: PreviewerProps): ReactElement {
  const text = useFileText(props.content);
  const [wrap, setWrap] = useState(true);
  if (text === null) return <PreviewSkeletonView shape='text' />;

  const lineCount = text === '' ? 0 : text.split(/\r\n?|\n/).length;
  const language = languageFor(props.file.name);
  return (
    <>
      <PreviewMeta>
        {language && `${languageName(language)} · `}
        {lineCount.toLocaleString()} {lineCount === 1 ? 'line' : 'lines'}
      </PreviewMeta>
      <PreviewControls>
        <CodeFontSizeControls />
        <PreviewButton
          title={wrap ? "Don't wrap long lines" : 'Wrap long lines'}
          pressed={wrap}
          onClick={() => setWrap(current => !current)}
          trackName='PreviewWrapToggled'
        >
          <WrapText className='size-4' />
        </PreviewButton>
      </PreviewControls>
      <CodeLines text={text} language={language} wrap={wrap} />
    </>
  );
}
