import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronRight, Hash, Loader2 } from 'lucide-react';
import { apiInstance } from '../../../services/clients/apiClient';

type VespaDocInspect = {
  docId: string;
  itemId: string;
  collectionId: string;
  name: string;
  fields: Record<string, unknown>;
};

type ChunkRow = {
  index: number;
  text: string;
  pages: number[];
};

type ChunkMeta = {
  chunk_index?: number;
  page_numbers?: number[];
  block_labels?: string[];
  headings?: string[];
  bbox_l?: number;
  bbox_t?: number;
  bbox_r?: number;
  bbox_b?: number;
  width?: number;
  height?: number;
};

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const stripBolding = (value: string): string => value.replace(/<\/?hi>/g, '');

const pickArray = (
  fields: Record<string, unknown>,
  names: ReadonlyArray<string>,
): unknown[] | null => {
  for (const name of names) {
    const value = fields[name];
    if (Array.isArray(value)) return value as unknown[];
  }
  return null;
};

const readChunkText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const objectValue = value as { text?: unknown; chunk?: unknown };
    if (typeof objectValue.text === 'string') return objectValue.text;
    if (typeof objectValue.chunk === 'string') return objectValue.chunk;
  }
  return '';
};

const joinChunks = (chunks: unknown, map: unknown): ChunkRow[] => {
  if (!Array.isArray(chunks)) return [];
  const rows = new Map<number, ChunkRow>();
  chunks.forEach((chunk, index) => {
    rows.set(index, {
      index,
      text: stripBolding(readChunkText(chunk)),
      pages: [],
    });
  });
  if (Array.isArray(map)) {
    for (const entry of map as ChunkMeta[]) {
      if (typeof entry?.chunk_index !== 'number') continue;
      const row = rows.get(entry.chunk_index);
      if (row && Array.isArray(entry.page_numbers)) row.pages = entry.page_numbers;
    }
  }
  return Array.from(rows.values());
};

function Section({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className='rounded-md border border-border/60 bg-background/40'>
      <button
        type='button'
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        data-track-category='knowledge-base'
        data-track-name='vespa-doc-section-toggle'
        className='flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-secondary/50'
      >
        <ChevronRight
          className={`h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
          strokeWidth={2}
        />
        <span className='flex-1 font-mono text-[11.5px] font-medium text-foreground'>{title}</span>
        {typeof count === 'number' && (
          <span className='font-mono text-[10.5px] text-muted-foreground tabular-nums'>
            [{count}]
          </span>
        )}
      </button>
      {open && <div className='border-t border-border/40 px-3 py-2'>{children}</div>}
    </section>
  );
}

function EmptyState(): React.ReactElement {
  return <div className='px-2 py-3 text-center text-[12px] text-muted-foreground'>Empty.</div>;
}

function ChunkCards({ rows }: { rows: ChunkRow[] }): React.ReactElement {
  if (rows.length === 0) return <EmptyState />;
  return (
    <div className='space-y-2'>
      {rows.map(chunk => (
        <article
          key={chunk.index}
          className='rounded-md border border-border/60 bg-background/60 px-3 py-2'
        >
          <header className='mb-1 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground'>
            <span className='inline-flex items-center gap-0.5'>
              <Hash className='h-3 w-3' aria-hidden strokeWidth={1.75} />
              {chunk.index}
            </span>
            {chunk.pages.length > 0 && <span>page {chunk.pages.join(', ')}</span>}
          </header>
          <pre className='whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-foreground/85'>
            {chunk.text || '(empty)'}
          </pre>
        </article>
      ))}
    </div>
  );
}

function ChunkMetaCards({ entries }: { entries: ChunkMeta[] }): React.ReactElement {
  if (entries.length === 0) return <EmptyState />;
  return (
    <div className='space-y-2'>
      {entries.map((entry, index) => (
        <article
          key={`${entry.chunk_index ?? index}-${index}`}
          className='rounded-md border border-border/60 bg-background/60 px-3 py-2'
        >
          <header className='mb-1 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground'>
            <span className='inline-flex items-center gap-0.5'>
              <Hash className='h-3 w-3' aria-hidden strokeWidth={1.75} />
              {entry.chunk_index ?? index}
            </span>
            {Array.isArray(entry.page_numbers) && entry.page_numbers.length > 0 && (
              <span>page {entry.page_numbers.join(', ')}</span>
            )}
          </header>
          <dl className='grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]'>
            {Array.isArray(entry.block_labels) && entry.block_labels.length > 0 && (
              <>
                <dt className='text-muted-foreground'>block_labels</dt>
                <dd className='break-words text-foreground/85'>{entry.block_labels.join(', ')}</dd>
              </>
            )}
            {Array.isArray(entry.headings) && entry.headings.length > 0 && (
              <>
                <dt className='text-muted-foreground'>headings</dt>
                <dd className='break-words text-foreground/85'>{entry.headings.join(' > ')}</dd>
              </>
            )}
            {typeof entry.bbox_l === 'number' &&
              typeof entry.bbox_t === 'number' &&
              typeof entry.bbox_r === 'number' &&
              typeof entry.bbox_b === 'number' && (
                <>
                  <dt className='text-muted-foreground'>bbox</dt>
                  <dd className='text-foreground/85 tabular-nums'>
                    {entry.bbox_l.toFixed(2)}, {entry.bbox_t.toFixed(2)}, {entry.bbox_r.toFixed(2)},{' '}
                    {entry.bbox_b.toFixed(2)}
                  </dd>
                </>
              )}
            {(typeof entry.width === 'number' || typeof entry.height === 'number') && (
              <>
                <dt className='text-muted-foreground'>size</dt>
                <dd className='text-foreground/85 tabular-nums'>
                  {entry.width ?? '?'} x {entry.height ?? '?'}
                </dd>
              </>
            )}
          </dl>
        </article>
      ))}
    </div>
  );
}

function StringList({ items }: { items: string[] }): React.ReactElement {
  if (items.length === 0) return <EmptyState />;
  return (
    <ol className='space-y-0.5 font-mono text-[11.5px] text-foreground/85'>
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 16)}`} className='flex items-baseline gap-2'>
          <span className='flex-shrink-0 text-[10px] text-muted-foreground tabular-nums'>
            {index}
          </span>
          <span className='break-words'>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function TextBlock({ text }: { text: string }): React.ReactElement {
  return (
    <pre className='whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-foreground/85'>
      {text || '(empty)'}
    </pre>
  );
}

function JsonStringBlock({ value }: { value: string }): React.ReactElement {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  return (
    <pre className='max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/85'>
      {parsed === null ? value : stringify(parsed)}
    </pre>
  );
}

export const VespaDocView: React.FC<{ itemId: string; name: string }> = ({ itemId, name }) => {
  const [doc, setDoc] = useState<VespaDocInspect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawOpen, setRawOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiInstance
      .get<VespaDocInspect>(`/collections/items/${itemId}/vespa-doc`)
      .then(response => {
        if (cancelled) return;
        setDoc(response.data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load Vespa document');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const sections = useMemo(() => {
    const fields = doc?.fields ?? {};
    return {
      chunks: joinChunks(pickArray(fields, ['chunks_summary', 'chunks']), fields['chunks_map']),
      imageChunks: joinChunks(
        pickArray(fields, ['image_chunks_summary', 'image_chunks']),
        fields['image_chunks_map'],
      ),
      chunksMap: Array.isArray(fields['chunks_map']) ? (fields['chunks_map'] as ChunkMeta[]) : [],
      imageChunksMap: Array.isArray(fields['image_chunks_map'])
        ? (fields['image_chunks_map'] as ChunkMeta[])
        : [],
    };
  }, [doc]);

  if (loading) {
    return (
      <div className='flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' aria-hidden strokeWidth={1.75} />
        Loading Vespa document...
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2 px-6 text-center'>
        <AlertCircle className='h-5 w-5 text-destructive' aria-hidden strokeWidth={1.75} />
        <p className='text-[14px] font-medium text-foreground'>Could not load the Vespa document</p>
        <p className='font-mono text-[11.5px] text-muted-foreground'>{error}</p>
      </div>
    );
  }

  if (!doc) return null;

  const fields = doc.fields;
  const tocChunks = (pickArray(fields, ['toc_chunks_summary', 'toc_chunks']) ?? []).map(item =>
    stripBolding(String(item)),
  );
  const stringField = (key: string): string[] =>
    Array.isArray(fields[key]) ? (fields[key] as unknown[]).map(item => String(item)) : [];
  const chunksPos = (pickArray(fields, ['chunks_pos_summary', 'chunks_pos']) ?? []).map(item =>
    String(item),
  );
  const imageChunksPos = (
    pickArray(fields, ['image_chunks_pos_summary', 'image_chunks_pos']) ?? []
  ).map(item => String(item));
  const aiSummary = typeof fields['ai_summary'] === 'string' ? fields['ai_summary'] : '';
  const description = typeof fields['description'] === 'string' ? fields['description'] : '';
  const metadata = typeof fields['metadata'] === 'string' ? fields['metadata'] : '';
  const bboxesJson = typeof fields['bboxes_json'] === 'string' ? fields['bboxes_json'] : '';

  return (
    <div className='flex h-full flex-col bg-background'>
      <div className='border-b border-border bg-secondary/20 px-3 py-2'>
        <div className='truncate text-[12.5px] font-medium text-foreground' title={name}>
          {name}
        </div>
        <dl className='mt-1 grid grid-cols-1 gap-y-0.5 font-mono text-[10.5px]'>
          <div className='flex min-w-0 gap-1'>
            <dt className='flex-shrink-0 text-muted-foreground'>docId</dt>
            <dd className='truncate text-foreground/85' title={doc.docId}>
              {doc.docId}
            </dd>
          </div>
        </dl>
      </div>

      <div className='flex-1 space-y-2 overflow-y-auto px-3 py-3'>
        {sections.chunks.length > 0 && (
          <Section title='chunks' count={sections.chunks.length} defaultOpen>
            <ChunkCards rows={sections.chunks} />
          </Section>
        )}
        {sections.imageChunks.length > 0 && (
          <Section title='image_chunks' count={sections.imageChunks.length}>
            <ChunkCards rows={sections.imageChunks} />
          </Section>
        )}
        {sections.chunksMap.length > 0 && (
          <Section title='chunks_map' count={sections.chunksMap.length}>
            <ChunkMetaCards entries={sections.chunksMap} />
          </Section>
        )}
        {sections.imageChunksMap.length > 0 && (
          <Section title='image_chunks_map' count={sections.imageChunksMap.length}>
            <ChunkMetaCards entries={sections.imageChunksMap} />
          </Section>
        )}
        {tocChunks.length > 0 && (
          <Section title='toc_chunks' count={tocChunks.length}>
            <StringList items={tocChunks} />
          </Section>
        )}
        {stringField('headings').length > 0 && (
          <Section title='headings' count={stringField('headings').length}>
            <StringList items={stringField('headings')} />
          </Section>
        )}
        {stringField('block_labels').length > 0 && (
          <Section title='block_labels' count={stringField('block_labels').length}>
            <StringList items={stringField('block_labels')} />
          </Section>
        )}
        {stringField('entities_involved').length > 0 && (
          <Section title='entities_involved' count={stringField('entities_involved').length}>
            <StringList items={stringField('entities_involved')} />
          </Section>
        )}
        {stringField('referenced_ids').length > 0 && (
          <Section title='referenced_ids' count={stringField('referenced_ids').length}>
            <StringList items={stringField('referenced_ids')} />
          </Section>
        )}
        {stringField('pan_ids').length > 0 && (
          <Section title='pan_ids' count={stringField('pan_ids').length}>
            <StringList items={stringField('pan_ids')} />
          </Section>
        )}
        {chunksPos.length > 0 && (
          <Section title='chunks_pos' count={chunksPos.length}>
            <StringList items={chunksPos} />
          </Section>
        )}
        {imageChunksPos.length > 0 && (
          <Section title='image_chunks_pos' count={imageChunksPos.length}>
            <StringList items={imageChunksPos} />
          </Section>
        )}
        {aiSummary && (
          <Section title='ai_summary'>
            <TextBlock text={aiSummary} />
          </Section>
        )}
        {description && (
          <Section title='description'>
            <TextBlock text={description} />
          </Section>
        )}
        {metadata && (
          <Section title='metadata'>
            <JsonStringBlock value={metadata} />
          </Section>
        )}
        {bboxesJson && (
          <Section title='bboxes_json'>
            <JsonStringBlock value={bboxesJson} />
          </Section>
        )}

        <div className='pt-2'>
          <button
            type='button'
            onClick={() => setRawOpen(value => !value)}
            data-track-category='knowledge-base'
            data-track-name='vespa-doc-raw-fields-toggle'
            className='inline-flex h-6 items-center rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground transition hover:text-foreground'
          >
            {rawOpen ? 'Hide raw Vespa fields' : 'Show raw Vespa fields'}
          </button>
          {rawOpen && (
            <pre className='mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/70 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-foreground/85'>
              {stringify(fields)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
