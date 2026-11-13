import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';
import { useAiBuilder } from '../../../hooks/use-ai-builder.js';
import { SharedChatPanel } from '../../shared/ChatPanel.js';
import { cn } from '../../shared/cn.js';

export interface AiBuilderPanelProps {
  isOpen: boolean;
  currentConfig: WorkflowConfig;
  client: AiBuilderClient;
  onApplyConfig: (config: WorkflowConfig) => void;
  onSave?: (config: WorkflowConfig) => Promise<void>;
  onClose: () => void;
}

const BUILDER_SUGGESTIONS = [
  'Add an HTTP request step',
  'Make this run on a schedule',
  'Add error handling with a conditional',
];

export function AiBuilderPanel({
  isOpen,
  currentConfig,
  client,
  onApplyConfig,
  onSave,
  onClose,
}: AiBuilderPanelProps) {
  const { messages, pendingPatch, isLoading, streaming, error, send, stop, clearPatch, reset } =
    useAiBuilder(client);

  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-apply and save as soon as the AI returns a patch
  useEffect(() => {
    if (!pendingPatch) return;
    const patch = pendingPatch;
    clearPatch();
    onApplyConfig(patch);
    if (onSave) {
      setIsSaving(true);
      void onSave(patch).catch((err) => {
        console.warn('[AiBuilderPanel] save failed (canvas still updated):', err);
      }).finally(() => setIsSaving(false));
    }
  }, [pendingPatch, onApplyConfig, onSave, clearPatch]);

  const handleSend = useCallback(async () => {
    const userText = draft.trim();
    if (!userText && !attachedFile) return;
    if (isLoading) return;

    let messageText = userText;
    if (attachedFile) {
      const intro = userText || 'Generate a workflow from this document.';
      messageText = `${intro}\n\n<document name="${attachedFile.name}">\n${attachedFile.text}\n</document>`;
    }

    setDraft('');
    setAttachedFile(null);
    await send(messageText, currentConfig);
  }, [draft, attachedFile, isLoading, send, currentConfig]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    try {
      let text: string;
      if (
        file.name.endsWith('.md') || file.name.endsWith('.json') ||
        file.name.endsWith('.txt') || file.type === 'text/markdown' ||
        file.type === 'text/plain' || file.type === 'application/json'
      ) {
        text = await file.text();
      } else {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${client.baseUrl}/api/parse-file`, {
          method: 'POST', body: form,
        });
        if (!res.ok) throw new Error((await (res.json() as Promise<{ error: string }>)).error);
        text = (await (res.json() as Promise<{ text: string }>)).text;
      }
      setAttachedFile({ name: file.name, text });
    } catch (err) {
      setAttachedFile({ name: file.name, text: `[Parse error: ${err instanceof Error ? err.message : String(err)}]` });
    } finally {
      setIsUploading(false);
    }
  }, [client.baseUrl]);

  const bannerSlot = (
    <>
      {isSaving && (
        <div className="shrink-0 border-b border-indigo-100 px-4 py-2">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-600 italic flex items-center gap-1.5">
            <svg className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Applying and saving…
          </div>
        </div>
      )}
      {attachedFile && (
        <div className="shrink-0 border-b border-[var(--wui-border)] px-4 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-indigo-500">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="flex-1 truncate text-xs font-medium text-indigo-700">{attachedFile.name}</span>
            <button
              type="button"
              onClick={() => setAttachedFile(null)}
              className="shrink-0 text-indigo-400 hover:text-indigo-600 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );

  const inputPrefixSlot = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.json,.txt,.pdf,text/markdown,text/plain,application/json,application/pdf"
        className="hidden"
        onChange={(e) => void handleFileSelect(e)}
      />
      <button
        type="button"
        title="Attach .md or .pdf"
        disabled={isLoading || isUploading}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'flex h-7 w-7 flex-shrink-0 self-end items-center justify-center rounded-lg transition-all',
          isLoading || isUploading
            ? 'text-[var(--wui-fg-muted)] cursor-not-allowed opacity-50'
            : attachedFile
              ? 'text-indigo-500 hover:bg-indigo-50'
              : 'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] active:scale-95',
        )}
      >
        {isUploading ? (
          <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        )}
      </button>
    </>
  );

  return (
    <SharedChatPanel
      isOpen={isOpen}
      messages={messages}
      isLoading={isLoading}
      streaming={streaming}
      error={error}
      draft={draft}
      onDraftChange={setDraft}
      onSend={handleSend}
      onStop={stop}
      onReset={reset}
      onClose={onClose}
      suggestions={BUILDER_SUGGESTIONS}
      emptyStateDescription="Describe what you want to build and I'll help you create or modify the workflow."
      placeholder={attachedFile ? 'Add a prompt or send as-is…' : 'Ask anything about your workflow…'}
      canSend={!!(draft.trim() || attachedFile)}
      bannerSlot={bannerSlot}
      inputPrefixSlot={inputPrefixSlot}
      containerStyle={{ flex: isOpen ? '0 0 380px' : '0 0 0px' }}
      containerClassName="transition-[flex,opacity] duration-200"
    />
  );
}
