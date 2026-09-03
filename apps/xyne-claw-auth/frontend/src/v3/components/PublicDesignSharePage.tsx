import { useEffect, useMemo, useState } from "react";
import { ArrowClockwiseIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  getPublicDesignArtifact,
  getPublicDesignArtifactHtml,
  type PublicDesignArtifact,
} from "../../lib/api";

function tokenFromFragment(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
  } catch {
    return "";
  }
}

export function PublicDesignSharePage() {
  const token = useMemo(tokenFromFragment, []);
  const [metadata, setMetadata] = useState<PublicDesignArtifact | null>(null);
  const [htmlBlob, setHtmlBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!token) {
      setError("This share link is incomplete.");
      return;
    }
    Promise.all([getPublicDesignArtifact(token), getPublicDesignArtifactHtml(token)])
      .then(([nextMetadata, blob]) => {
        if (cancelled) return;
        setMetadata(nextMetadata);
        setHtmlBlob(blob);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "This shared design is unavailable.");
      });
    return () => { cancelled = true; };
  }, [token, reload]);

  useEffect(() => {
    if (!htmlBlob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(htmlBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [htmlBlob]);

  const download = () => {
    if (!htmlBlob) return;
    const url = URL.createObjectURL(htmlBlob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(metadata?.title ?? "xyne-design").replace(/[^a-zA-Z0-9._-]+/g, "-")}.html`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <main className="flex h-screen min-h-0 flex-col bg-[#ececef] text-xyne-fg-primary dark:bg-[#111214]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-xyne-border-subtle bg-xyne-surface px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1.5">
            <img src="/claw/assets/xyne-text-logo.svg" alt="Xyne" className="h-5 w-auto" />
            <span className="text-[13px] font-semibold text-xyne-fg-secondary">Design</span>
          </div>
          <span className="h-4 w-px bg-xyne-border-subtle" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{metadata?.title ?? "Shared design"}</p>
            <p className="text-[10px] text-xyne-fg-muted">View-only artifact</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-xyne-border-subtle px-2.5 text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary"
          >
            <ArrowClockwiseIcon size={13} /> Refresh
          </button>
          <button
            type="button"
            disabled={!htmlBlob}
            onClick={download}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-xyne-fg-primary px-3 text-[11px] font-medium text-xyne-fg-inverse disabled:opacity-40"
          >
            <DownloadSimpleIcon size={13} /> Download
          </button>
        </div>
      </header>

      <section className="relative min-h-0 flex-1 p-3 sm:p-5">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title={metadata?.title ?? "Shared Xyne design"}
            // The blob inherits this viewer's origin, so the iframe sandbox is
            // the load-bearing isolation boundary. Never add allow-same-origin.
            sandbox="allow-scripts allow-forms allow-modals"
            referrerPolicy="no-referrer"
            className="h-full w-full rounded-xl border border-black/10 bg-white shadow-[0_18px_60px_rgba(0,0,0,.16)]"
          />
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-xyne-error/25 bg-xyne-surface p-6 text-center shadow-sm">
              <WarningCircleIcon size={30} className="mx-auto text-xyne-error" />
              <h1 className="mt-3 text-[16px] font-semibold">Design unavailable</h1>
              <p className="mt-1 text-[13px] leading-relaxed text-xyne-fg-muted">{error}</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full bg-xyne-surface px-4 py-2 text-[12px] text-xyne-fg-secondary shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-xyne-brand" /> Loading shared design
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
