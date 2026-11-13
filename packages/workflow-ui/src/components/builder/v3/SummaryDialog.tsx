import { useRef, useState } from 'react';
import { MarkdownView } from '../../shared/MarkdownView.js';
import { cn } from '../../shared/cn.js';

export interface SummaryDialogProps {
  /** Current summary markdown. */
  value: string;
  /** Apply the edited summary (in-memory). Persistence happens via the builder's Save. */
  onApply: (value: string) => void;
  onClose: () => void;
}

type Tab = 'write' | 'preview';

/**
 * Modal editor for the workflow summary (markdown). Author can paste/type
 * markdown or upload a `.md` file, with a live rendered preview. Applying only
 * updates in-memory state — the summary is persisted with the workflow's Save.
 */
export function SummaryDialog({ value, onApply, onClose }: SummaryDialogProps) {
  const [draft, setDraft] = useState(value);
  const [tab, setTab] = useState<Tab>('write');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    const tooBig = file.size > 1024 * 1024; // 1 MB guard
    if (tooBig) {
      setUploadError('File is too large (max 1 MB).');
      return;
    }
    try {
      const text = await file.text();
      setDraft(text);
      setTab('preview');
    } catch {
      setUploadError('Could not read that file.');
    }
  };

  const apply = () => {
    onApply(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="summary-dialog">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div
        className={cn(
          'relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl',
          'animate-[wui-fade-in_150ms_ease-out]',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-800">Workflow Summary</h3>
          <div className="flex items-center gap-2">
            {/* Upload */}
            <button
              type="button"
              data-testid="summary-upload"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>
              </svg>
              Upload .md
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              className="hidden"
              data-testid="summary-file-input"
              onChange={(e) => { void handleUpload(e.target.files?.[0]); e.target.value = ''; }}
            />
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200/80 px-5">
          <TabButton label="Write" active={tab === 'write'} onClick={() => setTab('write')} testid="summary-tab-write" />
          <TabButton label="Preview" active={tab === 'preview'} onClick={() => setTab('preview')} testid="summary-tab-preview" />
          {uploadError && <span className="ml-auto py-2 text-[12px] text-red-600">{uploadError}</span>}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'write' ? (
            <textarea
              data-testid="summary-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={'Describe what this workflow does…\n\nMarkdown supported — headings, **bold**, lists, links, tables.'}
              className="h-[45vh] w-full resize-none rounded-md border border-slate-200 px-3 py-2.5 font-mono text-[13px] leading-relaxed outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          ) : (
            <div className="min-h-[45vh]" data-testid="summary-preview">
              {draft.trim() ? (
                <MarkdownView>{draft}</MarkdownView>
              ) : (
                <p className="text-[13px] italic text-slate-400">Nothing to preview yet.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200/80 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="summary-apply"
            onClick={apply}
            className="rounded-md bg-indigo-500 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  testid,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={cn(
        'border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors',
        active
          ? 'border-indigo-500 text-indigo-600'
          : 'border-transparent text-slate-400 hover:text-slate-600',
      )}
    >
      {label}
    </button>
  );
}
