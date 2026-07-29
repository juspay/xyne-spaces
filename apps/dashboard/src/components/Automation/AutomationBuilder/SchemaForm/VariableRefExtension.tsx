import { createContext, useContext, type ReactElement } from 'react';
import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Variable as VariableIcon } from 'lucide-react';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import { parseReference } from '../VariablePicker/VariablePicker.utils';

const VARIABLE_REF_REGEX = /\{\{([^{}]+)\}\}/g;
const VARIABLE_REF_INPUT_RULE = /\{\{([^{}]+)\}\}$/;

/* ────────────────────────────────────────────────────────────────────── */
/* Label resolver context                                                  */

export interface VariableLabelInfo {
  full: string;
  short: string;
  unknown: boolean;
}

const VariableLabelContext = createContext<(ref: string) => VariableLabelInfo>(ref => ({
  full: ref,
  short: ref,
  unknown: true,
}));

export const VariableLabelProvider = VariableLabelContext.Provider;

export function buildVariableLabelResolver(
  sources: readonly VariablePickerSource[],
): (ref: string) => VariableLabelInfo {
  const byKey = new Map<string, { groupLabel: string; baseLabel: string }>();
  for (const s of sources) {
    if (!byKey.has(s.sourceKey)) {
      byKey.set(s.sourceKey, { groupLabel: s.groupLabel, baseLabel: s.label });
    }
  }

  return (ref: string): VariableLabelInfo => {
    const parsed = parseReference(`{{${ref}}}`);
    if (!parsed) return { full: ref, short: ref, unknown: true };

    const info = byKey.get(parsed.sourceKey);
    if (!info) {
      // Step was deleted, or this is a freshly-typed ref. Fall back to
      // a generic "Unknown" with the path so the user can spot it.
      return {
        full: `Unknown · ${parsed.path || parsed.sourceKey}`,
        short: parsed.path || parsed.sourceKey,
        unknown: true,
      };
    }

    const pathPart = parsed.path ? parsed.path.replace(/\./g, ' / ') : '';
    const rolePart = parsed.role === 'trigger' ? '' : parsed.role;
    const parts = [info.groupLabel.split(' — ')[0] ?? info.groupLabel, rolePart, pathPart].filter(
      Boolean,
    );

    const full = parts.join(' / ');
    return { full, short: full, unknown: false };
  };
}

export function wrapVariableRefsForLoad(html: string): string {
  if (!html.includes('{{')) return html;

  const SPLIT = /(<span\b[^>]*\bdata-variable-ref\b[^>]*>[\s\S]*?<\/span>)/g;
  const parts = html.split(SPLIT);
  return parts
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk;
      return chunk.replace(VARIABLE_REF_REGEX, (_, ref: string) => {
        const safe = escapeHtmlAttr(ref);
        return `<span data-variable-ref="${safe}">{{${ref}}}</span>`;
      });
    })
    .join('');
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

function VariableChipView(props: NodeViewProps): ReactElement {
  const ref = (props.node.attrs as { ref?: string }).ref ?? '';
  const labelFor = useContext(VariableLabelContext);
  const info = labelFor(ref);
  return (
    <NodeViewWrapper as='span' className='inline-block align-baseline'>
      <span
        contentEditable={false}
        title={`{{${ref}}}`}
        data-variable-ref={ref}
        className={
          info.unknown
            ? 'inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[12px] font-medium text-amber-700 dark:text-amber-400 cursor-default select-none mx-0.5'
            : 'inline-flex items-center gap-0.5 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-px text-[12px] font-medium text-blue-700 dark:text-blue-400 cursor-default select-none mx-0.5'
        }
      >
        <VariableIcon className='size-3 opacity-70' />
        <span className='whitespace-nowrap'>{info.short}</span>
      </span>
    </NodeViewWrapper>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* The Tiptap Node                                                         */

export const VariableRef = Node.create({
  name: 'variableRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      ref: {
        default: '',
        parseHTML: el => el.getAttribute('data-variable-ref') ?? '',
        renderHTML: attrs => ({ 'data-variable-ref': (attrs as { ref?: string }).ref ?? '' }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-variable-ref]',
        getAttrs: el => {
          if (typeof el === 'string') return false;
          const ref = el.getAttribute('data-variable-ref');
          return ref ? { ref } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const ref = (node.attrs as { ref?: string }).ref ?? '';
    // Emit the raw `{{ref}}` inside the span — backend resolver reads it.
    return ['span', mergeAttributes(HTMLAttributes), `{{${ref}}}`];
  },

  renderText({ node }) {
    return `{{${(node.attrs as { ref?: string }).ref ?? ''}}}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(VariableChipView);
  },

  addInputRules() {
    return [
      new InputRule({
        find: VARIABLE_REF_INPUT_RULE,
        handler: ({ state, range, match }) => {
          const ref = match[1]?.trim();
          if (!ref) return null;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ ref }));
          return null;
        },
      }),
    ];
  },
});
