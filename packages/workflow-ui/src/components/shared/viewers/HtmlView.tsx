import { useEffect, useState } from 'react';
import { ViewerLoading } from './chrome.js';

// HTML renderer. Fetches the file as text (same-origin — the auth cookie rides
// along) and renders it inside a FULLY sandboxed iframe via `srcdoc`:
// `sandbox=""` blocks all scripts and gives the content a unique opaque origin,
// so untrusted / uploaded HTML can't run code or reach the app's origin. We
// deliberately don't point the iframe `src` at the raw URL (that would depend on
// the server's content-type/disposition and could execute inline). External or
// relative resources (remote CSS/images) won't load — the safe trade-off for a
// preview. On load failure it throws during render so the parent ViewerBoundary
// shows the download fallback.
export default function HtmlView({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((t) => { if (!cancelled) setHtml(t); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) throw new Error('html load failed');
  if (html === null) return <ViewerLoading />;

  return (
    <iframe
      title="HTML preview"
      srcDoc={html}
      sandbox=""
      className="block h-full w-full border-0 bg-white"
    />
  );
}
