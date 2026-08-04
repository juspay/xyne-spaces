import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import Input from '../../../ui/Input/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { useCategoryCatalog } from '../../../../hooks/useCategoryCatalog';
import { normalizeTagName, TAG_FORMAT_REGEX } from '@xyne/shared';

// Value format stored in LeafCondition.value: "category:match:tag1,tag2"
// e.g. "priority:any:critical,high"

function parseValue(raw: string): { category: string; match: string; tags: string[] } {
  const firstColon = raw.indexOf(':');
  const secondColon = raw.indexOf(':', firstColon + 1);
  if (firstColon === -1 || secondColon === -1) {
    return { category: raw, match: 'any', tags: [] };
  }
  return {
    category: raw.slice(0, firstColon),
    match: raw.slice(firstColon + 1, secondColon),
    tags: raw
      .slice(secondColon + 1)
      .split(',')
      .filter(Boolean),
  };
}

function serializeValue(category: string, match: string, tags: string[]): string {
  return `${category}:${match}:${tags.join(',')}`;
}

interface TagValueInputProps {
  value: string;
  onChange: (next: unknown) => void;
}

export function TagValueInput({ value, onChange }: TagValueInputProps): React.ReactElement {
  const parsed = parseValue(value);
  const [tagInput, setTagInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [tagError, setTagError] = useState<string | null>(null);
  const { catalog } = useCategoryCatalog(true);

  const update = (patch: Partial<{ category: string; match: string; tags: string[] }>): void => {
    const next = { ...parsed, ...patch };
    onChange(serializeValue(next.category, next.match, next.tags));
  };

  const addTag = (tag: string): void => {
    const normalized = normalizeTagName(tag);
    if (!normalized) {
      setTagInput('');
      setTagError('Tag must not be empty.');
      return;
    }
    if (!TAG_FORMAT_REGEX.test(normalized)) {
      setTagInput('');
      setTagError('Tag must be lowercase and hyphen-separated (e.g. "high-priority").');
      return;
    }
    if (parsed.tags.includes(normalized)) {
      setTagInput('');
      setTagError(`"${normalized}" is already added.`);
      return;
    }
    setTagError(null);
    update({ tags: [...parsed.tags, normalized] });
    setTagInput('');
  };

  const removeTag = (tag: string): void => {
    update({ tags: parsed.tags.filter(t => t !== tag) });
  };

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        {/* Category dropdown */}
        <div className='w-[160px]'>
          <Select value={parsed.category} onValueChange={cat => update({ category: cat })}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Category…' />
            </SelectTrigger>
            <SelectContent>
              {catalog.map(c => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* any / all */}
        <div className='w-[90px]'>
          <Select value={parsed.match} onValueChange={m => update({ match: m })}>
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='any'>any of</SelectItem>
              <SelectItem value='all'>all of</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tag chips + input */}
      <div
        role='presentation'
        className='flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 cursor-text'
        onClick={() => inputRef.current?.focus()}
        onKeyDown={() => inputRef.current?.focus()}
        data-track-category='automation-builder'
        data-track-name='tag-value-input-focus'
      >
        {parsed.tags.map(tag => (
          <span
            key={tag}
            className='flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs font-mono text-foreground'
          >
            {tag}
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                removeTag(tag);
              }}
              data-track-category='automation-builder'
              data-track-name='tag-value-remove'
              aria-label={`Remove tag ${tag}`}
              className='text-muted-foreground hover:text-foreground'
            >
              <X className='size-3' />
            </button>
          </span>
        ))}
        <Input
          ref={inputRef}
          placeholder={parsed.tags.length === 0 ? 'Type a tag and press Enter…' : 'Add tag…'}
          value={tagInput}
          onChange={e => {
            setTagInput(e.target.value);
            setTagError(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag(tagInput);
            }
            if (e.key === 'Backspace' && !tagInput && parsed.tags.length > 0) {
              removeTag(parsed.tags[parsed.tags.length - 1]!);
            }
          }}
          onBlur={() => {
            if (tagInput.trim()) addTag(tagInput);
          }}
          className='h-auto min-w-[120px] flex-1 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0'
        />
      </div>
      {tagError && <p className='text-xs text-destructive px-1'>{tagError}</p>}
      {!tagError && parsed.tags.length === 0 && (
        <p className='text-xs text-destructive px-1'>At least one tag is required.</p>
      )}
    </div>
  );
}
