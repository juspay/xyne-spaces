import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import { ArrowUp, AudioLines, Loader2, Mic, Square } from 'lucide-react';
import type { CommandDef } from '@xyne/shared/commands';
import { cn } from '../../utils/classNames';
import useMeasure from '../../hooks/useMeasure';
import { posthogService } from '../../services/Analytics/posthogService';
import { LinkSyncPlugin } from '../ui/TipTapExtensions/LinkSyncPlugin';
import { VoiceInput, type VoiceInputHandle } from '../ui/InputBox/VoiceInput';
import { AttachmentPreview, MediaViewer } from '../ui/files';
import type { UserTag } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import type {
  ActiveTrigger,
  ComposerHandle,
  ComposerProps,
  ComposerTrayItem,
  ContextRef,
  PickedContext,
} from './Composer.types';
import { ATOM_PLACEHOLDER, cleanEditorText, findTrigger, refKey } from './Composer.utils';
import { ContextMention, VoiceShimmerMark, mentionRefs } from './ComposerEditor';
import { ChannelMenu, CommandList, MentionPicker, type ComposerMenuHandle } from './ComposerMenus';
import {
  AgentPicker,
  AgentsSubmenu,
  ContextTray,
  ModeChips,
  ModelMenu,
  PlusMenu,
  ToolbarIconButton,
} from './ComposerControls';
import { CollectionsSubmenu } from './ComposerCollections';
import { ComposerGlow } from './ComposerGlow';

/** Pasted text longer than this becomes an attached file instead of a wall of text. */
const LARGE_PASTE_THRESHOLD = 11_500;
/** Below this width (the sidebar) the toolbar's mode chips drop their labels. */
const COMPACT_WIDTH = 520;
/** One is picked per composer, so the empty box hints at something different each time. */
const PLACEHOLDERS = [
  "Ask Xyne AI anything... press '/' for commands",
  'Type @ to bring a person, message or file into context',
  'Ask about a channel — type # to pick one',
  'Summarize a thread, draft a reply, or plan your day',
  'What should we work on today?',
  'Ask about your tickets, calls, canvases or docs',
];
/** A query this long has stopped being a search for a name. */
const MAX_MENTION_QUERY = 120;

/**
 * An open "@" picker. Unlike "#" and "/", it stays open until Escape or its
 * close button — a space doesn't end it (names and messages have spaces) and
 * a pick doesn't either (several can be picked in a row). `queryFrom` is where
 * the search text starts: just after the "@", or after the last pick.
 */
interface MentionSession {
  from: number;
  queryFrom: number;
  /** Opened by a typed "@" (which deleting closes it), not by a pick. */
  typedAt: boolean;
}

interface DocMapping {
  docChanged: boolean;
  mapping: { map: (pos: number, assoc?: number) => number };
}

const sameTrigger = (a: ActiveTrigger | null, b: ActiveTrigger | null): boolean =>
  a === b ||
  (!!a && !!b && a.char === b.char && a.query === b.query && a.from === b.from && a.to === b.to);

/** Plain text → paragraphs, for text the host sets (a prompt, a cleared box). */
const textToDoc = (text: string): { type: 'doc'; content: object[] } => ({
  type: 'doc',
  content: text.split('\n').map(line => ({
    type: 'paragraph',
    ...(line ? { content: [{ type: 'text', text: line }] } : {}),
  })),
});

/** The @ picker's search, or null once the caret has left it. */
function readSession(editor: Editor, session: MentionSession): ActiveTrigger | null {
  const { selection, doc } = editor.state;
  if (!selection.empty || session.from > session.queryFrom) return null;
  const caret = selection.from;
  if (caret < session.queryFrom || session.queryFrom > doc.content.size) return null;
  // Left the paragraph, or deleted the "@" that opened it.
  if (doc.resolve(session.from).start() !== selection.$from.start()) return null;
  if (
    session.typedAt &&
    (session.from >= session.queryFrom || doc.textBetween(session.from, session.queryFrom) !== '@')
  ) {
    return null;
  }
  const typed = doc.textBetween(session.queryFrom, caret, ' ', ATOM_PLACEHOLDER);
  if (typed.includes(ATOM_PLACEHOLDER) || typed.length > MAX_MENTION_QUERY) return null;
  return {
    char: '@',
    query: typed.replace(/^[@\s]+/, ''),
    from: session.from,
    to: caret,
  };
}

function readTrigger(editor: Editor): ActiveTrigger | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if (editor.isActive('code')) return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, ATOM_PLACEHOLDER);
  const found = findTrigger(textBefore);
  if (!found) return null;
  return {
    char: found.char,
    query: found.query,
    from: $from.start() + found.offset,
    to: selection.from,
  };
}

/** People mentioned inline, keyed "<Name>" like the transcript's mention chips. */
function personTags(editor: Editor): Record<string, UserTag> {
  const tags: Record<string, UserTag> = {};
  editor.state.doc.descendants(node => {
    if (node.type.name !== ContextMention.name || node.attrs['kind'] !== 'person') return;
    const name = node.attrs['mention'] as string;
    const userId = node.attrs['id'] as string;
    if (name && userId) tags[`<${name}>`] = { name, userId };
  });
  return tags;
}

/**
 * The AI composer, shared by the AI screen and the Ask AI sidebar so the two
 * never drift. The text box, the context tray above it and the toolbar under
 * it (+, agent, model, mic, and voice ↔ send) are all here; each host keeps
 * only the state that is genuinely its own and passes it in.
 *
 * Typing "@" searches everything (⌘K's search) to attach as context, "#"
 * lists channels and "/" (at the start) lists commands. A pick lands twice:
 * as a pill in the tray and as an inline "@name" in the sentence — the text
 * the agent reads names the item, the attached context carries it once.
 * The "@" picker stays open for more picks until Escape or its close button;
 * for "#" and "/", a space or Escape leaves whatever was typed as plain text.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref) {
  const {
    value,
    autoFocus,
    isStreaming,
    onStop,
    sendTrackingMetadata,
    trayItems,
    attachments = [],
    pickedRefs,
    commands,
    plus,
    agent,
    model,
    onEnterVoiceMode,
    hideToolbar = false,
    anchor = 'bottom',
    children,
    className,
  } = props;

  const [defaultPlaceholder] = useState(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)] ?? PLACEHOLDERS[0]!,
  );
  const placeholder = props.placeholder ?? defaultPlaceholder;
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [previewing, setPreviewing] = useState<File | null>(null);
  const [focused, setFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(value.trim() === '');
  const [voice, setVoice] = useState({ isRecording: false, isTranscribing: false });

  // Editor callbacks are bound once at creation, so they read props through a ref.
  const latest = useRef(props);
  latest.current = props;
  const editorRef = useRef<Editor | null>(null);
  const triggerRef = useRef<ActiveTrigger | null>(null);
  const dismissedAtRef = useRef<number | null>(null);
  const sessionRef = useRef<MentionSession | null>(null);
  const lastEmittedRef = useRef(value);
  // Programmatic edits (clear, setText, removing a pill's mentions) must not
  // read as the user deleting a mention.
  const quietRef = useRef(false);
  const mentionedRef = useRef<Map<string, ContextRef>>(new Map());
  const tagsRef = useRef('{}');
  const menuRef = useRef<HTMLDivElement>(null);
  const menuHandleRef = useRef<ComposerMenuHandle>(null);
  const voiceRef = useRef<VoiceInputHandle>(null);

  const refreshTrigger = useCallback((editor: Editor, change?: DocMapping): void => {
    const session = sessionRef.current;
    if (session && change?.docChanged) {
      session.from = change.mapping.map(session.from, -1);
      session.queryFrom = change.mapping.map(session.queryFrom, -1);
    }
    // An open @ picker survives blur (it reappears on refocus) and spaces.
    let next = session ? readSession(editor, session) : null;
    if (session && !next) sessionRef.current = null;
    if (!sessionRef.current) {
      const found = editor.isFocused ? readTrigger(editor) : null;
      if (!found) dismissedAtRef.current = null;
      next = found && found.from !== dismissedAtRef.current ? found : null;
      if (next?.char === '@') {
        sessionRef.current = { from: next.from, queryFrom: next.from + 1, typedAt: true };
        next = readSession(editor, sessionRef.current);
      }
    }
    if (sameTrigger(triggerRef.current, next)) return;
    triggerRef.current = next;
    setTrigger(next);
  }, []);

  /** Escape, or the picker's close button: what was typed stays as text. */
  const dismissMenu = useCallback((): void => {
    const active = triggerRef.current;
    if (!active) return;
    const session = sessionRef.current;
    // Only a trigger still in the text can reopen itself; mark it seen.
    dismissedAtRef.current = !session || session.typedAt ? active.from : null;
    sessionRef.current = null;
    triggerRef.current = null;
    setTrigger(null);
  }, []);

  /**
   * Keeps the tray and the inline mentions one thing: a mention the user
   * deletes detaches its item (once no other mention names it), and a mention
   * that reappears (undo, paste) attaches it again.
   */
  const syncMentions = useCallback((editor: Editor): void => {
    const now = new Map(mentionRefs(editor.state.doc).map(r => [refKey(r), r]));
    const before = mentionedRef.current;
    mentionedRef.current = now;
    if (!quietRef.current) {
      before.forEach((r, key) => {
        if (!now.has(key)) latest.current.onUnpick(r);
      });
      now.forEach((r, key) => {
        if (before.has(key) || latest.current.pickedRefs.has(key)) return;
        let mention = '';
        editor.state.doc.descendants(node => {
          if (node.type.name === ContextMention.name && node.attrs['id'] === r.id) {
            mention = node.attrs['mention'] as string;
          }
        });
        latest.current.onPick({ ...r, label: mention, mention, isPrivate: false } as PickedContext);
      });
    }
    const tags = personTags(editor);
    const serialized = JSON.stringify(tags);
    if (serialized !== tagsRef.current) {
      tagsRef.current = serialized;
      latest.current.onUserTagsChange?.(tags);
    }
  }, []);

  const submit = useCallback((trigger: 'button' | 'enter'): void => {
    const editor = editorRef.current;
    const text = editor ? cleanEditorText(editor.getText({ blockSeparator: '\n' })).trim() : '';
    if (latest.current.isStreaming || !text) return;
    voiceRef.current?.abortForSend();
    latest.current.onSubmit(trigger);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: { HTMLAttributes: { class: 'm-0' } },
        heading: false,
        horizontalRule: false,
        // Links get their own extension below; underline has no use in a prompt.
        link: false,
        underline: false,
        trailingNode: false,
      }),
      LinkExtension.extend({ inclusive: false }).configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-[color:var(--link-color)] underline cursor-text',
          rel: 'noopener noreferrer',
        },
      }),
      LinkSyncPlugin,
      ContextMention,
      VoiceShimmerMark,
    ],
    content: textToDoc(value),
    onCreate: ({ editor: created }) => {
      editorRef.current = created;
    },
    onUpdate: ({ editor: updated }) => {
      const text = cleanEditorText(updated.getText({ blockSeparator: '\n' }));
      lastEmittedRef.current = text;
      setIsEmpty(text.trim() === '');
      syncMentions(updated);
      latest.current.onValueChange(text);
    },
    onTransaction: ({ editor: changed, transaction }) => refreshTrigger(changed, transaction),
    onFocus: ({ editor: focusedEditor }) => {
      setFocused(true);
      refreshTrigger(focusedEditor);
    },
    onBlur: ({ editor: blurred }) => {
      setFocused(false);
      refreshTrigger(blurred);
    },
    editorProps: {
      /* eslint-disable @typescript-eslint/naming-convention -- DOM attribute names */
      attributes: {
        class: 'composer-editor outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Message',
        spellcheck: 'true',
        autocapitalize: 'sentences',
      },
      /* eslint-enable @typescript-eslint/naming-convention */
      handleKeyDown: (_view, event) => {
        const active = triggerRef.current;
        if (active) {
          if (event.key === 'Escape') {
            // Close the menu, keep the text exactly as typed.
            event.preventDefault();
            dismissMenu();
            return true;
          }
          if (event.key === 'Tab' && active.char === '@' && menuHandleRef.current?.cycleTab) {
            event.preventDefault();
            menuHandleRef.current.cycleTab(event.shiftKey);
            return true;
          }
          const navigates =
            event.key === 'ArrowDown' ||
            event.key === 'ArrowUp' ||
            event.key === 'Tab' ||
            (event.key === 'Enter' && !event.shiftKey && !event.isComposing);
          const root = menuRef.current?.querySelector<HTMLElement>('[cmdk-root]');
          if (navigates && root?.querySelector('[cmdk-item]')) {
            // The menu never takes focus — the caret stays in the text — so its
            // keys are handed to it here.
            event.preventDefault();
            root.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: event.key === 'Tab' ? 'Enter' : event.key,
                bubbles: true,
                cancelable: true,
              }),
            );
            return true;
          }
          // The @ picker is a search until it is closed: Enter with nothing to
          // pick must not send the half-typed message.
          if (active.char === '@' && event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            return true;
          }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          // Keyboard submit is invisible to autocapture; emit it explicitly.
          posthogService.capture('ai_query_submit', { trigger: 'keyboard', keyCombo: 'enter' });
          submit('enter');
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          latest.current.onFilesPasted(files);
          return true;
        }
        const text = event.clipboardData?.getData('text') ?? '';
        if (text.length > LARGE_PASTE_THRESHOLD) {
          event.preventDefault();
          let isJson = false;
          try {
            JSON.parse(text);
            isJson = true;
          } catch {
            isJson = false;
          }
          const type = isJson ? 'application/json' : 'text/plain';
          const name = `pasted-text-${Date.now()}.${isJson ? 'json' : 'txt'}`;
          latest.current.onFilesPasted([new File([text], name, { type })]);
          return true;
        }
        return false;
      },
    },
  });

  // Text the host sets (send clears it, a suggestion fills it) replaces the doc.
  useEffect(() => {
    if (!editor || value === lastEmittedRef.current) return;
    sessionRef.current = null;
    lastEmittedRef.current = value;
    quietRef.current = true;
    editor.commands.setContent(textToDoc(value), { emitUpdate: false });
    mentionedRef.current = new Map(mentionRefs(editor.state.doc).map(r => [refKey(r), r]));
    quietRef.current = false;
    setIsEmpty(value.trim() === '');
  }, [editor, value]);

  useEffect(() => {
    if (!editor || !autoFocus) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    const frame = requestAnimationFrame(() => editor.commands.focus('end'));
    return (): void => cancelAnimationFrame(frame);
  }, [editor, autoFocus]);

  const removeMentions = useCallback((target: ContextRef): void => {
    const current = editorRef.current;
    if (!current) return;
    const ranges: Array<{ from: number; to: number }> = [];
    current.state.doc.descendants((node, pos) => {
      if (
        node.type.name === ContextMention.name &&
        node.attrs['kind'] === target.kind &&
        node.attrs['id'] === target.id
      ) {
        ranges.push({ from: pos, to: pos + node.nodeSize });
      }
    });
    if (ranges.length === 0) return;
    const tr = current.state.tr;
    ranges.reverse().forEach(range => tr.delete(range.from, range.to));
    quietRef.current = true;
    current.view.dispatch(tr);
    quietRef.current = false;
  }, []);

  const returnFocus = useCallback((): void => {
    editorRef.current?.commands.focus();
  }, []);

  const openTrigger = useCallback((char: '@' | '/'): void => {
    const current = editorRef.current;
    if (!current) return;
    dismissedAtRef.current = null;
    if (char === '/') {
      // Commands are read from the start of the message. One already there is
      // reopened (caret to its end, so the menu shows it) rather than stacked.
      const first = current.state.doc.firstChild;
      const existing = first
        ? /^\s*\/[^\s@#/]*/.exec(
            first.textBetween(0, first.content.size, undefined, ATOM_PLACEHOLDER),
          )
        : null;
      if (existing) {
        current
          .chain()
          .focus()
          .setTextSelection(1 + existing[0].length)
          .run();
        return;
      }
      current.chain().focus().insertContentAt(1, '/').setTextSelection(2).run();
      return;
    }
    const { $from } = current.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, ATOM_PLACEHOLDER);
    const lead = before === '' || /[\s(]$/.test(before) ? '' : ' ';
    current.chain().focus().insertContent(`${lead}@`).run();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: (): void => {
        editorRef.current?.commands.focus('end');
      },
      clear: (): void => {
        sessionRef.current = null;
        lastEmittedRef.current = '';
        quietRef.current = true;
        editorRef.current?.commands.setContent(textToDoc(''), { emitUpdate: false });
        mentionedRef.current = new Map();
        quietRef.current = false;
        setIsEmpty(true);
      },
      setText: (text: string): void => {
        const current = editorRef.current;
        if (!current) return;
        sessionRef.current = null;
        quietRef.current = true;
        current.commands.setContent(textToDoc(text));
        quietRef.current = false;
        current.commands.focus('end');
      },
      insertText: (text: string): void => {
        editorRef.current?.chain().focus().insertContent(text).run();
      },
      openTrigger,
      isMenuOpen: (): boolean => triggerRef.current !== null,
      abortDictation: (): void => voiceRef.current?.abortForSend(),
    }),
    [openTrigger],
  );

  const pick = useCallback(
    (item: PickedContext): boolean => {
      const current = editorRef.current;
      const active = triggerRef.current;
      if (!current || !active) return false;
      if (latest.current.pickedRefs.has(refKey(item))) {
        // A row that is already attached is a toggle: picking it takes it off
        // again (its tray pill and inline mentions) and clears the search.
        removeMentions(item);
        latest.current.onUnpick({ kind: item.kind, id: item.id });
        const now = triggerRef.current;
        if (now) {
          // The @ picker stays open on its own "@"; "#" closes like a pick.
          const queryFrom = sessionRef.current?.queryFrom ?? now.from;
          if (now.to > queryFrom) {
            current.chain().focus().deleteRange({ from: queryFrom, to: now.to }).run();
          }
        }
        return false;
      }
      if (!latest.current.onPick(item)) return false;
      // Seen before insertion, so the sync doesn't attach it a second time.
      mentionedRef.current.set(refKey(item), { kind: item.kind, id: item.id });
      const keepOpen = active.char === '@';
      sessionRef.current = null;
      current
        .chain()
        .focus()
        .insertContentAt({ from: active.from, to: active.to }, [
          {
            type: ContextMention.name,
            attrs: { kind: item.kind, id: item.id, mention: item.mention },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
      if (keepOpen) {
        // The picker stays for the next pick, searching what is typed from here.
        const caret = current.state.selection.from;
        sessionRef.current = { from: caret, queryFrom: caret, typedAt: false };
        refreshTrigger(current);
      }
      return true;
    },
    [refreshTrigger, removeMentions],
  );

  const runCommand = useCallback((command: CommandDef): void => {
    const current = editorRef.current;
    const active = triggerRef.current;
    if (!current || !active) return;
    const token = `/${command.name}`;
    const { doc } = current.state;
    if (doc.textBetween(0, active.from, '\n', ATOM_PLACEHOLDER).trim() !== '') {
      // Typed mid-message: the agent reads a command at the start, so the pick
      // goes there (replacing one already there) and the caret stays where
      // the writing was, minus the "/query" that summoned the list.
      const $from = doc.resolve(active.from);
      const before = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 1),
        $from.parentOffset,
        undefined,
        ATOM_PLACEHOLDER,
      );
      const $end = doc.resolve(active.to);
      const after = $end.parent.textBetween(
        $end.parentOffset,
        Math.min($end.parentOffset + 1, $end.parent.content.size),
        undefined,
        ATOM_PLACEHOLDER,
      );
      // Drop the space before it only when another follows, so a pick at the
      // end leaves the caret after a space, ready for the next word.
      const deleteFrom = before === ' ' && after === ' ' ? active.from - 1 : active.from;
      const first = doc.firstChild;
      const leading = first
        ? (/^\s*\/[^\s@#/]*\s?/.exec(
            first.textBetween(0, first.content.size, undefined, ATOM_PLACEHOLDER),
          )?.[0] ?? '')
        : '';
      const inserted = `${token} `;
      current
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: active.to })
        .insertContentAt({ from: 1, to: 1 + leading.length }, inserted)
        .setTextSelection(deleteFrom - leading.length + inserted.length)
        .run();
      return;
    }
    // Replacing a command in front of existing text reuses its space.
    const $to = current.state.doc.resolve(active.to);
    const spaced = $to.parent.textBetween(
      $to.parentOffset,
      Math.min($to.parentOffset + 1, $to.parent.content.size),
      undefined,
      ATOM_PLACEHOLDER,
    );
    current
      .chain()
      .focus()
      .insertContentAt({ from: active.from, to: active.to }, spaced === ' ' ? token : `${token} `)
      .setTextSelection(active.from + token.length + 1)
      .run();
  }, []);

  // A pill removed from the tray takes its inline mentions with it.
  const tray = useMemo<ComposerTrayItem[]>(
    () =>
      trayItems.map(item => {
        const pillRef = item.ref;
        if (!pillRef || !item.onRemove) return item;
        const remove = item.onRemove;
        return {
          ...item,
          onRemove: (): void => {
            removeMentions(pillRef);
            remove();
          },
        };
      }),
    [trayItems, removeMentions],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const { width } = useMeasure({ ref: rootRef, observeResize: true });
  const compact = width > 0 && width < COMPACT_WIDTH;

  const menuSide = anchor === 'top' ? 'bottom' : 'top';
  const showMenu = focused && trigger !== null && (trigger.char !== '/' || commands.length > 0);
  const canSend = !isEmpty && !isStreaming;
  const showVoiceMode = !!onEnterVoiceMode && isEmpty && !isStreaming;

  let menu: ReactElement | null = null;
  if (showMenu && trigger) {
    if (trigger.char === '@') {
      menu = (
        <MentionPicker
          ref={menuHandleRef}
          query={trigger.query}
          pickedRefs={pickedRefs}
          onPick={pick}
          onDismiss={dismissMenu}
        />
      );
    } else if (trigger.char === '#') {
      menu = <ChannelMenu query={trigger.query} pickedRefs={pickedRefs} onPick={pick} />;
    } else {
      menu = <CommandList query={trigger.query} commands={commands} onSelect={runCommand} />;
    }
  }

  return (
    <div ref={rootRef} className={cn('relative w-full', className)} data-testid='composer'>
      {menu && (
        <div
          ref={menuRef}
          // Clicks in the menu must not blur the text — the caret stays put and
          // the menu stays open until something is picked.
          role='presentation'
          onMouseDown={e => e.preventDefault()}
          className={cn(
            'absolute left-0 right-0 z-40 overflow-hidden rounded-[18px] border border-border/70 bg-popover shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)] duration-150 animate-in fade-in-0',
            menuSide === 'bottom'
              ? 'top-full mt-2 slide-in-from-top-1'
              : 'bottom-full mb-2 slide-in-from-bottom-1',
          )}
          data-testid={`composer-menu-${trigger?.char === '@' ? 'mention' : trigger?.char === '#' ? 'channel' : 'command'}`}
        >
          {menu}
        </div>
      )}

      <ContextTray items={tray} overlay={anchor === 'top'} />

      <ComposerGlow active={voice.isRecording}>
        <div
          className={cn(
            'relative rounded-[20px] border border-chat-composer-border-active bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-200',
            'focus-within:border-foreground/25 focus-within:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.18)]',
          )}
        >
          <div
            className='relative cursor-text px-[18px] pb-1 pt-4'
            role='presentation'
            onMouseDown={e => {
              // Clicking the padding focuses the text, like a native textarea.
              if (e.target === e.currentTarget) {
                e.preventDefault();
                editor?.commands.focus('end');
              }
            }}
          >
            <EditorContent
              editor={editor}
              className={cn(
                'max-h-[220px] min-h-[44px] overflow-y-auto text-[15px] leading-6 text-foreground',
                '[&_.ProseMirror]:min-h-[44px] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0',
                voice.isRecording && isEmpty && 'invisible',
              )}
            />
            {isEmpty && !voice.isRecording && (
              <div className='pointer-events-none absolute left-[18px] right-[18px] top-4 select-none truncate text-[15px] leading-6 text-muted-foreground/80'>
                {placeholder}
              </div>
            )}
            {voice.isRecording && isEmpty && (
              <div className='pointer-events-none absolute left-[18px] top-4 flex h-6 select-none items-center gap-3'>
                <div className='flex items-end gap-[3px]' style={{ height: 16 }}>
                  {[0, 120, 60, 180, 90].map((delay, i) => (
                    <div
                      key={delay}
                      // Grey here; the shared class is orange for the channel composer.
                      className='voice-wave-bar !bg-muted-foreground'
                      style={{ height: [9, 16, 12, 16, 9][i], animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
                <span className='text-sm text-muted-foreground'>Listening…</span>
              </div>
            )}
          </div>

          {/* Files from the device: preview cards, as in the chat composer. */}
          {attachments.length > 0 && (
            <div className='flex flex-wrap gap-3 px-[18px] pb-2 pt-1'>
              {attachments.map(attachment => (
                <AttachmentPreview
                  key={attachment.key}
                  file={attachment.file}
                  onRemove={attachment.onRemove}
                  onPreview={() => setPreviewing(attachment.file)}
                  isUploading={false}
                />
              ))}
            </div>
          )}

          {!hideToolbar && (
            <div className='flex items-center justify-between gap-2 px-2 pb-2.5 pt-0.5'>
              <div className='flex min-w-0 items-center gap-1'>
                <PlusMenu
                  plus={plus}
                  collections={<CollectionsSubmenu knowledge={plus.knowledge} />}
                  agents={agent ? <AgentsSubmenu agent={agent} /> : null}
                  onTrigger={openTrigger}
                  returnFocus={returnFocus}
                  side={menuSide}
                />
                {agent && <AgentPicker agent={agent} returnFocus={returnFocus} side={menuSide} />}
                <ModeChips plus={plus} compact={compact} />
              </div>
              <div className='flex shrink-0 items-center gap-1.5'>
                {model && <ModelMenu model={model} returnFocus={returnFocus} side={menuSide} />}
                <ToolbarIconButton
                  label={
                    voice.isTranscribing
                      ? 'Transcribing…'
                      : voice.isRecording
                        ? 'Stop dictation'
                        : 'Dictate'
                  }
                  onClick={() => voiceRef.current?.toggle()}
                  disabled={isStreaming || voice.isTranscribing}
                  trackName={voice.isRecording ? 'STOP_VOICE_INPUT' : 'START_VOICE_INPUT'}
                  className={cn(
                    voice.isRecording &&
                      'bg-red-100 text-red-600 hover:bg-red-100 hover:text-red-600 dark:bg-red-900/30 dark:text-red-400',
                  )}
                >
                  {voice.isTranscribing ? (
                    <Loader2 className='size-[18px] animate-spin' aria-hidden />
                  ) : (
                    <Mic className='size-[18px]' aria-hidden strokeWidth={1.75} />
                  )}
                </ToolbarIconButton>
                {/* Voice mode and send share one slot: an empty box offers to talk,
                  anything typed turns it into send, a running reply into stop. */}
                <div className='relative size-8 shrink-0'>
                  <button
                    type='button'
                    onClick={onEnterVoiceMode}
                    aria-label='Voice mode'
                    title='Voice mode'
                    tabIndex={showVoiceMode ? 0 : -1}
                    aria-hidden={!showVoiceMode}
                    className={cn(
                      'absolute inset-0 grid place-items-center rounded-[10px] text-muted-foreground transition-[opacity,transform,background-color,color] duration-150 hover:bg-secondary hover:text-foreground',
                      showVoiceMode
                        ? 'scale-100 opacity-100'
                        : 'pointer-events-none scale-75 opacity-0',
                    )}
                    data-track-category='XyneAI'
                    data-track-name='ENTER_VOICE_MODE'
                  >
                    <AudioLines className='size-[18px]' aria-hidden strokeWidth={1.75} />
                  </button>
                  <button
                    type='button'
                    onClick={isStreaming ? onStop : (): void => submit('button')}
                    disabled={!isStreaming && !canSend}
                    aria-label={isStreaming ? 'Stop generating' : 'Send'}
                    title={isStreaming ? 'Stop' : 'Send'}
                    tabIndex={showVoiceMode ? -1 : 0}
                    aria-hidden={showVoiceMode}
                    className={cn(
                      'absolute inset-0 grid place-items-center rounded-full transition-[opacity,transform,background-color] duration-150',
                      showVoiceMode
                        ? 'pointer-events-none scale-75 opacity-0'
                        : 'scale-100 opacity-100',
                      isStreaming || canSend
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'cursor-not-allowed bg-secondary text-muted-foreground',
                    )}
                    data-ph-capture-attribute-track-id={
                      isStreaming ? 'abort_message' : 'ai_composer_send'
                    }
                    data-track-category='XyneAI'
                    data-track-name={isStreaming ? 'STOP_GENERATION' : 'SEND_MESSAGE'}
                    data-track-metadata={isStreaming ? undefined : sendTrackingMetadata}
                    data-testid='composer-send'
                  >
                    {isStreaming ? (
                      <Square className='size-2.5 fill-current' aria-hidden strokeWidth={0} />
                    ) : (
                      <ArrowUp className='size-4' aria-hidden strokeWidth={2.25} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ComposerGlow>

      {previewing && <MediaViewer file={previewing} isOpen onClose={() => setPreviewing(null)} />}
      {/* Host popovers hang from the composer's top edge. */}
      {children && <div className='absolute inset-x-0 top-0 z-40'>{children}</div>}
      <VoiceInput
        ref={voiceRef}
        editor={editor}
        headless
        disabled={isStreaming}
        onStateChange={setVoice}
      />
    </div>
  );
});
