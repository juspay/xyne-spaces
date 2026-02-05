import React from 'react';
import {
  DecoratorNode,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import Avatar from '../../ui/Avatar/Avatar';
import { Hash } from 'lucide-react';
import { MentionType } from './ChannelCommandMenu.types';

export interface MentionData {
  id: string;
  name: string;
  type: 'user' | 'channel';
  prefix?: 'from:' | 'in:' | 'assignee:';
  email?: string;
  photoLink?: string;
}

export type SerializedMentionNode = Spread<
  {
    mentionData: MentionData;
    type: 'mention';
    version: 1;
  },
  SerializedLexicalNode
>;

export class MentionNode extends DecoratorNode<React.JSX.Element> {
  __mentionData: MentionData;

  static override getType(): string {
    return 'mention';
  }

  static override clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__mentionData, node.__key);
  }

  constructor(mentionData: MentionData, key?: NodeKey) {
    super(key);
    this.__mentionData = mentionData;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    const baseClasses =
      'mention-node inline-flex items-center gap-1.5 px-1.5 py-1 m-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium cursor-pointer select-all h-6';
    element.className = baseClasses;
    element.setAttribute('data-lexical-mention', 'true');
    element.setAttribute('data-lexical-decorator', 'true');
    element.setAttribute('data-mention-id', this.__mentionData.id);
    element.setAttribute('data-mention-type', `mention-${this.__mentionData.type}`);
    element.contentEditable = 'false';
    element.setAttribute('draggable', 'true');
    element.spellcheck = false;
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override exportJSON(): SerializedMentionNode {
    return {
      mentionData: this.__mentionData,
      type: 'mention',
      version: 1,
    };
  }

  static override importJSON(serializedNode: SerializedMentionNode): MentionNode {
    const node = $createMentionNode(serializedNode.mentionData);
    return node;
  }

  override decorate(): React.JSX.Element {
    const baseClasses =
      'mention-node inline-flex items-center gap-1.5 px-1.5 py-1 m-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium cursor-pointer h-6';

    return (
      <span
        className={baseClasses}
        data-lexical-mention='true'
        data-mention-id={this.__mentionData.id}
        data-mention-type={`mention-${this.__mentionData.type}`}
        style={{ verticalAlign: 'baseline', lineHeight: '1.5', display: 'inline-flex' }}
      >
        {this.__mentionData.type === MentionType.USER ? (
          <Avatar
            userId={this.__mentionData.id}
            size='sm'
            className='rounded-none flex-shrink-0 size-3'
          />
        ) : (
          <div className='flex items-center justify-center flex-shrink-0 size-4 rounded-sm'>
            <Hash size={12} className='text-gray-700' />
          </div>
        )}
        <span className='leading-tight'>{this.getTextContent()}</span>
      </span>
    );
  }

  getMentionData(): MentionData {
    return this.__mentionData;
  }

  override getTextContent(): string {
    if (this.__mentionData.prefix) {
      return `${this.__mentionData.prefix} ${this.__mentionData.name}`;
    }
    // Fallback for backward compatibility
    const prefix = this.__mentionData.type === MentionType.USER ? 'from: ' : 'in: ';
    return `${prefix}${this.__mentionData.name}`;
  }

  override isInline(): boolean {
    return true;
  }

  override isIsolated(): boolean {
    return false;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  isSegmented(): boolean {
    return true;
  }

  excludeFromCopy(): boolean {
    return false;
  }
}

export function $createMentionNode(mentionData: MentionData): MentionNode {
  return new MentionNode(mentionData);
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}
