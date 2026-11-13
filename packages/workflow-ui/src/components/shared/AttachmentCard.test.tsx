import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import type { WorkflowClient, Attachment } from '@xyne/workflow-sdk/client';
import { AttachmentCard, DisplayValue, isAttachment, isAttachmentArray } from './AttachmentCard.js';
import { SchemaAwareRenderer } from '../execution/SchemaAwareRenderer.js';

function makeClient(): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    schema: {} as WorkflowClient['schema'],
    credentials: {} as WorkflowClient['credentials'],
    workflows: {} as WorkflowClient['workflows'],
    executions: {} as WorkflowClient['executions'],
    analytics: {} as WorkflowClient['analytics'],
    uploads: {
      create: vi.fn(),
      url: (att: Attachment) =>
        `http://localhost/attachments?ref=${encodeURIComponent(att.handle)}&name=${encodeURIComponent(att.name)}&mime=${encodeURIComponent(att.mimeType)}`,
    },
  } as unknown as WorkflowClient;
}

function wrap(node: React.ReactNode) {
  return render(
    React.createElement(WorkflowUIProvider, { client: makeClient(), children: node }),
  );
}

const PDF: Attachment = { name: 'report.pdf', mimeType: 'application/pdf', handle: 'mem://1_abc', size: 2048 };

describe('isAttachment / isAttachmentArray', () => {
  it('recognizes an attachment object', () => {
    expect(isAttachment(PDF)).toBe(true);
    expect(isAttachment({ foo: 'bar' })).toBe(false);
    expect(isAttachment(null)).toBe(false);
  });
  it('recognizes a non-empty attachment array', () => {
    expect(isAttachmentArray([PDF])).toBe(true);
    expect(isAttachmentArray([])).toBe(false);
    expect(isAttachmentArray([{ foo: 1 }])).toBe(false);
  });
});

describe('AttachmentCard', () => {
  it('renders the filename, size, and a download link to /attachments', () => {
    wrap(<AttachmentCard attachment={PDF} />);

    expect(screen.getByText('report.pdf')).toBeDefined();
    expect(screen.getByText('2.0 KB')).toBeDefined();

    const link = screen.getByRole('link', { name: 'Download' });
    expect(link).not.toBeNull();
    expect(link.getAttribute('download')).toBe('report.pdf');
    expect(link.getAttribute('href')).toContain('/attachments?ref=');
    expect(link.getAttribute('href')).toContain('mem%3A%2F%2F1_abc');
  });

  it('previews an image attachment inline via <img>', () => {
    const png: Attachment = { name: 'chart.png', mimeType: 'image/png', handle: 'mem://2_x', size: 100 };
    const { container } = wrap(<AttachmentCard attachment={png} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toContain('/attachments?ref=');
  });
});

describe('DisplayValue — attachment-aware (used by WAIT pause display sections)', () => {
  it('renders a single attachment as a download card, not "[object Object]"', () => {
    wrap(<DisplayValue value={PDF} />);
    expect(screen.getByText('report.pdf')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Download' })).toBeDefined();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  it('renders an attachment array as multiple cards', () => {
    wrap(
      <DisplayValue
        value={[PDF, { name: 'notes.txt', mimeType: 'text/plain', handle: 'mem://3_y', size: 12 }]}
      />,
    );
    expect(screen.getByText('report.pdf')).toBeDefined();
    expect(screen.getByText('notes.txt')).toBeDefined();
  });

  it('renders string values as markdown, plain non-strings as text', () => {
    wrap(<DisplayValue value="hello" />);
    expect(screen.getByText('hello')).toBeDefined();
    wrap(<DisplayValue value={['x', 'y']} />);
    expect(screen.getByText('x, y')).toBeDefined();
  });

  it('renders a markdown string with formatting (bold → <strong>)', () => {
    const { container } = wrap(<DisplayValue value={'**Refund** approved'} />);
    expect(container.querySelector('strong')?.textContent).toBe('Refund');
    expect(screen.getByText(/approved/)).toBeDefined();
  });
});

describe('SchemaAwareRenderer — attachment fields', () => {
  it('renders an attachment-typed output value as a download card', () => {
    const data = { response: 'done', report: PDF };
    const schema = {
      type: 'object',
      properties: {
        response: { type: 'string' },
        report: { type: 'object' },
      },
    };
    wrap(<SchemaAwareRenderer data={data} schema={schema} />);

    // The attachment value rendered as a card (download link), not raw JSON.
    expect(screen.getByText('report.pdf')).toBeDefined();
    const link = screen.getByRole('link', { name: 'Download' });
    expect(link.getAttribute('href')).toContain('/attachments?ref=');
  });

  it('renders an array of attachments as multiple cards', () => {
    const data = {
      attachments: [
        PDF,
        { name: 'notes.txt', mimeType: 'text/plain', handle: 'mem://3_y', size: 12 },
      ],
    };
    const schema = { type: 'object', properties: { attachments: { type: 'array' } } };
    wrap(<SchemaAwareRenderer data={data} schema={schema} />);

    expect(screen.getByText('report.pdf')).toBeDefined();
    expect(screen.getByText('notes.txt')).toBeDefined();
    expect(screen.getAllByRole('link', { name: 'Download' })).toHaveLength(2);
  });
});
