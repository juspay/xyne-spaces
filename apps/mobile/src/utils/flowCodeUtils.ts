import { buildMarkdownCodeBlock } from '@/src/utils/markdownCodeFence';
import type { FlowComponentLike, FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';

export type CodeComponentViewModel = {
  code: string;
  language?: string;
  title: string;
  lineCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const countCodeLines = (code: string): number => {
  if (!code) return 0;
  const lines = code.split('\n');
  // Trailing newline should not inflate the line count used in titles/fallback text.
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    return lines.length - 1;
  }
  return lines.length;
};

export const createCodeComponentViewModel = (
  component: FlowComponentLike,
): CodeComponentViewModel | null => {
  if (component.type !== 'code') return null;

  const props = isRecord(component.props) ? component.props : undefined;
  const code = typeof props?.['code'] === 'string' ? props['code'] : '';
  if (!code) return null;

  const language = optionalString(props?.['language']);
  const lineCount = countCodeLines(code);

  return {
    code,
    lineCount,
    title: language ? `${language} snippet` : 'Code snippet',
    ...(language ? { language } : {}),
  };
};

/** Project Flow code props into a markdown fence for the shared chat codeblock renderer. */
export const codeComponentToMarkdown = (
  component: FlowComponentLike,
  _options: FlowTextNormalizationOptions = {},
): string => {
  const viewModel = createCodeComponentViewModel(component);
  if (!viewModel) return '';
  return buildMarkdownCodeBlock(viewModel.code, viewModel.language ?? '').trim();
};
