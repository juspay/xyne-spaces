import { describe, expect, it } from 'vitest';
import {
  SESSION_EXPORT_OPTIONS,
  exportErrorMessage,
  exportFileName,
  resumeStepsFor,
  sessionExportUrl,
} from '../sessionExport';

describe('sessionExport', () => {
  it('offers the three v3 formats in order', () => {
    expect(SESSION_EXPORT_OPTIONS.map(o => [o.format, o.extension])).toEqual([
      ['claude-project', '.zip'],
      ['claude-code', '.jsonl'],
      ['markdown', '.md'],
    ]);
  });

  it('builds the claw-auth export URL with encoded params', () => {
    expect(sessionExportUrl('chat-1', 'pokemon-dex', 'markdown')).toBe(
      '/claw/api/v1/runs/session/export?conversationId=chat-1&agentSlug=pokemon-dex&format=markdown',
    );
    expect(sessionExportUrl('chat 1&x', 'a/b', 'claude-code')).toContain(
      'conversationId=chat+1%26x&agentSlug=a%2Fb',
    );
  });

  it('takes the file name from Content-Disposition, else falls back to the chat id', () => {
    expect(exportFileName('attachment; filename="7dfa.zip"', 'chat-1', 'claude-project')).toBe(
      '7dfa.zip',
    );
    expect(
      exportFileName("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.md", 'chat-1', 'markdown'),
    ).toBe('résumé.md');
    expect(exportFileName(null, 'chat-1', 'claude-code')).toBe('chat-1.jsonl');
    expect(exportFileName('attachment', 'chat-1', 'markdown')).toBe('chat-1.md');
  });

  it('explains failures in plain words', () => {
    expect(exportErrorMessage(404)).toMatch(/no finished replies/);
    expect(exportErrorMessage(403)).toMatch(/access/);
    expect(exportErrorMessage(500)).toMatch(/try again/);
    expect(exportErrorMessage(undefined)).toMatch(/try again/);
  });

  it('gives resume steps for the Claude Code formats, using the downloaded file name', () => {
    expect(resumeStepsFor('claude-project', '7dfa.zip')).toContain('unzip ~/Downloads/7dfa.zip');
    expect(resumeStepsFor('claude-code', '7dfa.jsonl')).toContain('mv ~/Downloads/7dfa.jsonl');
    expect(resumeStepsFor('claude-code', '7dfa.jsonl')).toContain('claude --resume 7dfa');
    expect(resumeStepsFor('claude-project', '7dfa.zip')).toContain('mv 7dfa.jsonl "$DIR"/');
    expect(resumeStepsFor('claude-project', '7dfa.zip')).not.toContain('<file>');
    expect(resumeStepsFor('markdown', '7dfa.md')).toBeNull();
  });
});
