import { useMemo, type ReactElement } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ToolInvocation } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { openLink } from '../../utils/openLink';

const OPEN_URL_TOOL = 'open-url';

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface OpenUrlRequest {
  key: string;
  url: string;
}

export function OpenUrlActions({
  toolInvocations,
}: {
  toolInvocations: ToolInvocation[] | undefined;
}): ReactElement | null {
  const requests = useMemo<OpenUrlRequest[]>(() => {
    if (!toolInvocations) return [];
    const seen = new Set<string>();
    const out: OpenUrlRequest[] = [];
    for (const inv of toolInvocations) {
      if (inv.toolName !== OPEN_URL_TOOL || inv.isError) continue;
      const url = httpUrl(inv.args?.['url']);
      if (!url) continue;
      const key = inv.toolCallId ?? url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, url });
    }
    return out;
  }, [toolInvocations]);

  if (requests.length === 0) return null;

  return (
    <div className='mt-2 flex flex-wrap gap-2'>
      {requests.map(req => (
        <button
          key={req.key}
          type='button'
          onClick={event => openLink(req.url, event, { force: 'external' })}
          className='inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground transition-colors hover:bg-secondary/60'
          title={req.url}
          data-track-category='XyneAI'
          data-track-name='open-url-action'
        >
          <ExternalLink className='h-3.5 w-3.5' />
          {`Open ${hostOf(req.url)}`}
        </button>
      ))}
    </div>
  );
}
