import { useEffect, useState } from 'react';
import { FolderPlus, MessagesSquare, Workflow } from 'lucide-react';
import type { TriggerSummary } from '@xyne/workflow-sdk';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { cn } from '../shared/cn.js';
import { TagInput } from '../shared/TagInput.js';
import { useOptionalSlot } from '../provider/slot-resolution.js';
import { getTriggerIcon } from '../builder/icons.js';
import { ConnectorCatalog } from '../builder/v3/ConnectorCatalog.js';
import type { AttributeFieldsProps } from '../../types/slots.js';
import type { WorkflowRecord, FolderRecord } from '@xyne/workflow-sdk/client';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { createConversationalFlow } from '@xyne/workflow-sdk/conversational-flow';

export interface CreateWorkflowDialogProps {
  onCreated: (workflow: WorkflowRecord) => void;
  onClose: () => void;
  /** Existing folders — every workflow must belong to one. */
  folders: FolderRecord[];
  /** Preselected folder (e.g. the folder currently open in the rail). */
  defaultFolderId?: string | undefined;
  /** Create a folder inline (used when none exist yet). Returns the new folder. */
  onCreateFolder: (name: string) => Promise<FolderRecord>;
}

const DEFAULT_TRIGGER_TYPE = 'MANUAL';

function buildDefaultConfig(triggerType: string): WorkflowConfig {
  return {
    trigger: { type: triggerType, config: {} },
    steps: [],
  };
}

export function CreateWorkflowDialog({
  onCreated,
  onClose,
  folders,
  defaultFolderId,
}: CreateWorkflowDialogProps) {
  const client = useWorkflowClient();
  const AttributeFields = useOptionalSlot<AttributeFieldsProps>('workflowAttributes');
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<TriggerSummary[]>([]);
  const [selectedTrigger, setSelectedTrigger] = useState(DEFAULT_TRIGGER_TYPE);
  const [choosingTrigger, setChoosingTrigger] = useState(false);
  // Workflows are always created in the folder the user currently has open —
  // no picker. (The "Create workflow" action only surfaces inside a folder.)
  const folderId = defaultFolderId ?? folders[0]?.id ?? '';
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A conversational flow is a conversation built on its own map; it always starts manually.
  const [shape, setShape] = useState<'workflow' | 'conversational'>('workflow');

  // The triggers this deployment registered, so every connector's triggers can be picked.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.schema.triggers();
        if (!cancelled) setTriggers(result);
      } catch { /* unavailable: the default trigger still works */ }
    })();
    return () => { cancelled = true; };
  }, [client]);

  const selected = triggers.find((trigger) => trigger.type === selectedTrigger);
  const canCreate = name.trim().length > 0 && folderId.length > 0;

  const handleCreate = async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setError(null);
    try {
      const conversational = shape === 'conversational' ? createConversationalFlow({ title: name.trim() }) : null;
      const metadata = {
        ...(conversational ? { name: name.trim(), ...conversational.metadata } : {}),
        ...(tags.length > 0 ? { name: name.trim(), tags } : {}),
      };
      const workflow = await client.workflows.create({
        name: name.trim(),
        config: conversational ? conversational.config : buildDefaultConfig(selectedTrigger),
        folderId,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      });
      onCreated(workflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal — header and footer stay put; the body scrolls when the screen is short */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create Workflow"
        className={cn(
          'relative z-10 flex max-h-[calc(100vh_-_2rem)] w-full max-w-lg flex-col rounded-xl border border-[var(--wui-border)] bg-[var(--wui-surface)] shadow-[var(--wui-shadow-lg)]',
          'animate-[wui-fade-in_150ms_ease-out]',
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--wui-border)] px-5 py-4">
          <h3 className="text-[15px] font-semibold text-[var(--wui-fg)]">Create Workflow</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* What is being built — decides which editor opens */}
          <div role="radiogroup" aria-label="What are you building?" className="grid grid-cols-2 gap-2">
            {([
              { key: 'workflow', Icon: Workflow, title: 'Workflow', text: 'Steps, triggers and connectors.' },
              { key: 'conversational', Icon: MessagesSquare, title: 'Conversational flow', text: 'Talk someone through a process: ask, answer from your systems, act, reach an outcome.' },
            ] as const).map(({ key, Icon, title, text }) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={shape === key}
                onClick={() => setShape(key)}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  shape === key
                    ? 'border-[var(--wui-primary)] bg-[color-mix(in_srgb,var(--wui-primary)_7%,transparent)]'
                    : 'border-[var(--wui-border)] hover:border-[var(--wui-border-strong,var(--wui-border))]',
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--wui-fg)]">
                  <Icon className="h-4 w-4 text-[var(--wui-primary)]" strokeWidth={2} aria-hidden /> {title}
                </span>
                <span className="text-[12px] leading-snug text-[var(--wui-fg-muted)]">{text}</span>
              </button>
            ))}
          </div>

          {/* Name field */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--wui-fg-muted)] mb-1.5">
              Workflow Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={shape === 'conversational' ? 'e.g. IT help desk' : 'e.g. Customer Onboarding Pipeline'}
              autoFocus
              className={cn(
                'w-full rounded-lg border border-[var(--wui-border)] bg-[var(--wui-surface)] px-3 py-2',
                'text-[13px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]',
                'outline-none focus:border-[var(--wui-primary)] focus:ring-2 focus:ring-[var(--wui-primary-light)]',
                'transition-colors',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) void handleCreate();
              }}
            />
          </div>

          {/* Teams — optional; used for filtering in the browser + approvals */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--wui-fg-muted)] mb-1.5">
              Teams <span className="font-normal text-[var(--wui-fg-muted)]">(optional)</span>
            </label>
            <TagInput value={tags} onChange={setTags} placeholder="e.g. finance, legal — Enter to add" />
          </div>

          {/* Product-provided attribute fields (department/team/etc.) */}
          {AttributeFields && (
            <AttributeFields
              value={attributes}
              onChange={(patch) => setAttributes((a) => ({ ...a, ...patch }))}
            />
          )}

          {/* Folder — fixed to the open folder, shown read-only */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--wui-fg-muted)] mb-1.5">
              Folder
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-3 py-2 text-[13px] text-[var(--wui-fg)]">
              <FolderPlus className="h-4 w-4 shrink-0 text-[var(--wui-fg-muted)]" strokeWidth={2} />
              <span className="truncate">{folders.find((f) => f.id === folderId)?.name ?? 'Current folder'}</span>
            </div>
          </div>

          {/* Trigger — connector first, then that connector's triggers */}
          {shape === 'workflow' && <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-[12px] font-medium text-[var(--wui-fg-muted)]">Trigger</label>
              {choosingTrigger && (
                <button
                  type="button"
                  onClick={() => setChoosingTrigger(false)}
                  className="text-[12px] font-medium text-[var(--wui-fg-muted)] transition-colors hover:text-[var(--wui-fg)]"
                >
                  Cancel
                </button>
              )}
            </div>
            {choosingTrigger ? (
              // Fixed height, so moving between connectors does not resize the dialog.
              <div className="flex h-80 flex-col overflow-hidden rounded-lg border border-[var(--wui-border)]">
                <ConnectorCatalog
                  className="flex-1"
                  items={triggers}
                  noun="trigger"
                  selectedType={selectedTrigger}
                  onSelect={(trigger) => {
                    setSelectedTrigger(trigger.type);
                    setChoosingTrigger(false);
                  }}
                  autoFocus
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--wui-border)] px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--wui-bg-muted)] text-[var(--wui-primary)]">
                  {getTriggerIcon(selected?.icon, { size: 16 })}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--wui-fg)]">
                    {selected?.name ?? selectedTrigger}
                  </div>
                  {selected?.connectorName && (
                    <div className="truncate text-[11px] text-[var(--wui-fg-muted)]">{selected.connectorName}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setChoosingTrigger(true)}
                  className="rounded-md border border-[var(--wui-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--wui-fg)] transition-colors hover:bg-[var(--wui-bg-muted)]"
                >
                  Change
                </button>
              </div>
            )}
          </div>}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--wui-border)] px-5 py-3.5">
          {error && (
            <span className="mr-auto text-xs text-[var(--wui-status-failed)]">{error}</span>
          )}
          <button
            onClick={onClose}
            disabled={isCreating}
            className="rounded-md border border-[var(--wui-border)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={!canCreate || isCreating}
            className={cn(
              'rounded-md px-4 py-1.5 text-[13px] font-semibold text-[var(--wui-primary-fg)] transition-colors',
              'bg-[var(--wui-primary)] hover:bg-[var(--wui-primary-hover)]',
              (!canCreate || isCreating) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
