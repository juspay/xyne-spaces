import { useCallback, useRef, type ReactElement } from 'react';
import { PROSE_BOX_HEIGHT, ProseBox } from '../../../shared/primitives/ProseBox';
import { AgentPromptVersions } from './AgentPromptVersions';
import { CredentialsCard } from './credentials/CredentialsCard';
import { ModelCard } from './model/ModelCard';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentDraft } from '../useAgentDraft';
import {
  DetailCard,
  DetailEmpty,
  DetailProse,
  DetailSection,
} from '../../../shared/primitives/DetailPrimitives';

const EDITOR =
  'w-full rounded-2xl border-border p-4 text-sm leading-5 tracking-[-0.28px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring';

const DESCRIPTION_EDITOR = `${EDITOR} border bg-card resize-none overflow-hidden`;

const PROMPT_EDITOR = `${EDITOR} border-[0.8px] bg-muted/30 resize-y`;

interface CaretHint {
  offset: number;
  scrollTop: number;
}

function fitToContent(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
}

function caretNodeFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  return null;
}

function scrollTopOf(node: Node, root: HTMLElement): number {
  let el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (el && root.contains(el)) {
    if (el.scrollHeight > el.clientHeight) return el.scrollTop;
    el = el.parentElement;
  }
  return 0;
}

function caretFromClick(root: HTMLElement, x: number, y: number): CaretHint | null {
  const hit = caretNodeFromPoint(x, y);
  if (!hit || !root.contains(hit.node)) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let before = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === hit.node) {
      return { offset: before + hit.offset, scrollTop: scrollTopOf(hit.node, root) };
    }
    before += (walker.currentNode.textContent ?? '').length;
  }
  return null;
}

function placeCaret(el: HTMLTextAreaElement, hint: CaretHint | null): void {
  if (!hint) return;
  el.focus();
  const at = Math.min(Math.max(hint.offset, 0), el.value.length);
  el.setSelectionRange(at, at);
  el.scrollTop = hint.scrollTop;
}

function ClickToEdit({
  enabled,
  label,
  onEdit,
  children,
}: {
  enabled: boolean;
  label: string;
  onEdit: (caret: CaretHint | null) => void;
  children: ReactElement;
}): ReactElement {
  if (!enabled) return children;
  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={label}
      onClick={event => onEdit(caretFromClick(event.currentTarget, event.clientX, event.clientY))}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(null);
        }
      }}
      data-track-category='Claw Agents'
      data-track-name={`Agent detail v2: ${label}`}
      className='w-full cursor-text rounded-2xl focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
    >
      {children}
    </div>
  );
}

export function AgentPersonaTabV2({
  agent,
  canEdit,
  canManageCredentials,
  draft,
}: {
  agent: Agent;
  canEdit: boolean;
  canManageCredentials: boolean;
  draft: AgentDraft;
}): ReactElement {
  const pendingCaret = useRef<CaretHint | null>(null);

  const attachDescription = useCallback((el: HTMLTextAreaElement | null): void => {
    if (!el) return;
    fitToContent(el);
    placeCaret(el, pendingCaret.current);
    pendingCaret.current = null;
  }, []);

  const attachPrompt = useCallback((el: HTMLTextAreaElement | null): void => {
    if (!el) return;
    placeCaret(el, pendingCaret.current);
    pendingCaret.current = null;
  }, []);

  const startWithCaret = (caret: CaretHint | null): void => {
    pendingCaret.current = caret;
    draft.start();
  };

  const editing = canEdit && draft.editing;

  return (
    <div className='flex w-full flex-col gap-8'>
      <div className='flex w-full flex-col gap-8'>
        <DetailSection label='Description' info='What this agent is for'>
          {editing ? (
            <textarea
              value={draft.description}
              onChange={event => {
                draft.setDescription(event.target.value);
                fitToContent(event.target);
              }}
              placeholder='Add a description so people and agents understand when to use it.'
              aria-label='Agent description'
              rows={1}
              ref={attachDescription}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: edit description'
              className={DESCRIPTION_EDITOR}
            />
          ) : (
            <ClickToEdit enabled={canEdit} label='Edit description' onEdit={startWithCaret}>
              <DetailCard>
                {draft.description ? (
                  <DetailProse>{draft.description}</DetailProse>
                ) : (
                  <DetailEmpty>No description added</DetailEmpty>
                )}
              </DetailCard>
            </ClickToEdit>
          )}
        </DetailSection>

        <DetailSection label='System Prompt' info='The instructions this agent runs with'>
          {editing ? (
            <textarea
              value={draft.systemPrompt}
              onChange={event => draft.setSystemPrompt(event.target.value)}
              placeholder='Describe how this agent should behave.'
              aria-label='Agent system prompt'
              ref={attachPrompt}
              style={{ height: PROSE_BOX_HEIGHT }}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: edit system prompt'
              className={PROMPT_EDITOR}
            />
          ) : (
            <ClickToEdit enabled={canEdit} label='Edit system prompt' onEdit={startWithCaret}>
              {draft.systemPrompt ? (
                <ProseBox>{draft.systemPrompt}</ProseBox>
              ) : (
                <DetailCard>
                  <DetailEmpty>No system prompt set</DetailEmpty>
                </DetailCard>
              )}
            </ClickToEdit>
          )}
        </DetailSection>
      </div>

      {canManageCredentials && (
        <AgentPromptVersions
          agentSlug={agent.slug}
          canRestore={canEdit}
          onRestored={restored => draft.setSystemPrompt(restored)}
        />
      )}

      <ModelCard agent={agent} canEdit={canEdit} />

      <CredentialsCard slug={agent.slug} canRead={canEdit} canManage={canManageCredentials} />
    </div>
  );
}
