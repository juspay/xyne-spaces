import { useEffect, useRef, useState } from 'react';
import { MarkdownView } from '../MarkdownView.js';
import { ViewerLoading } from './chrome.js';
import { useDomAnchor, type Anchor } from './useDomAnchor.js';
import { AnchorMiss } from './AnchorMiss.js';

// Plain-text / JSON / Markdown renderer. Fetches the file as text (same-origin,
// so the auth cookie rides along) and renders by mode. On load failure it
// throws during render so the parent ViewerBoundary shows the download fallback.
export default function TextView({
  url,
  mode,
  anchor,
}: {
  url: string;
  mode: 'text' | 'json' | 'markdown';
  anchor?: Anchor | undefined;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // `text` gates the search: the content only exists in the DOM once it has
  // loaded, and `mode` because switching renderer rebuilds the subtree.
  const { hit } = useDomAnchor(bodyRef, anchor, `${mode}:${String(text?.length ?? -1)}`);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setFailed(false);
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((t) => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) throw new Error('text load failed');
  if (text === null) return <ViewerLoading />;

  if (mode === 'markdown') {
    return (
      <div ref={bodyRef} className="h-full overflow-auto px-5 py-4 text-[14px] text-[var(--wui-fg)]">
        <MarkdownView>{text}</MarkdownView>
      </div>
    );
  }

  const body = mode === 'json' ? prettyJson(text) : text;
  return (
    <div className="h-full overflow-auto">
    {/* Sibling of the anchored container, never inside it — see AnchorMiss. */}
    <AnchorMiss anchor={anchor} hit={hit} />
    <div ref={bodyRef}>
      <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-relaxed text-[var(--wui-fg)]">
        {body}
      </pre>
    </div>
    </div>
  );
}

function prettyJson(t: string): string {
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}
