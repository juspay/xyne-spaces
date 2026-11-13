import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { ViewerLoading } from './chrome.js';
import { useDomAnchor, type Anchor } from './useDomAnchor.js';
import { AnchorMiss } from './AnchorMiss.js';

// DOCX renderer — docx-preview parses the file into a styled DOM mounted into a
// ref'd container (it needs a real mounted node, so render the container always
// and overlay the spinner while it works).
export default function DocxView({ url, anchor }: { url: string; anchor?: Anchor | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // `loading` flips false exactly when renderAsync has built the subtree, so it
  // is the precise moment there is text to search.
  const { hit } = useDomAnchor(ref, anchor, loading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then(async (blob) => {
        if (cancelled || !ref.current) return;
        await renderAsync(blob, ref.current, undefined, {
          className: 'wui-docx',
          inWrapper: true,
          ignoreWidth: true,
        });
        if (!cancelled) setLoading(false);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) throw new Error('docx load failed');

  return (
    <div className="h-full overflow-auto px-5 py-4">
      {/* Outside the anchored subtree — see AnchorMiss. */}
      <AnchorMiss anchor={anchor} hit={hit} />
      {loading && <ViewerLoading />}
      <div
        ref={ref}
        className="[&_.wui-docx]:!w-full [&_.wui-docx_section]:!w-full [&_.wui-docx_section]:!max-w-none [&_.wui-docx_section]:!p-0"
      />
    </div>
  );
}
