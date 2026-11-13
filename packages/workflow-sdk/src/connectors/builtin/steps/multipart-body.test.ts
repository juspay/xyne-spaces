/**
 * Round-trip: built here, parsed by undici.
 *
 * Hand-rolled wire format passes a byte-count assertion and still fails against
 * a real server — a missing CRLF, a boundary without its `--`. So the parser is
 * deliberately not ours: `Response.formData()` is what `fetch` uses.
 */

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { multipartBody } from './multipart-body.js';
import type { Attachment } from '../../../common/attachment.js';

const att = (name: string, mimeType = 'application/xml'): Attachment => ({
  name,
  mimeType,
  handle: `mem://${name}`,
});

async function roundTrip(
  fields: Array<{ key: string; value: string }>,
  files: Array<{ key: string; attachment: Attachment }>,
  contents: Record<string, string>,
): Promise<FormData> {
  const { body, contentType } = multipartBody(fields, files, (a) =>
    Promise.resolve(Readable.from(Buffer.from(contents[a.name] ?? ''))),
  );
  const web = Readable.toWeb(body) as unknown as ReadableStream;
  return new Response(web, { headers: { 'content-type': contentType } }).formData();
}

describe('multipartBody', () => {
  it('produces a body a real parser reads back', async () => {
    const form = await roundTrip(
      [{ key: 'verdict', value: 'tests passed' }, { key: 'build', value: '7003' }],
      [{ key: 'report', attachment: att('junit.xml') }],
      { 'junit.xml': '<testsuite failures="0"/>' },
    );

    expect(form.get('verdict')).toBe('tests passed');
    expect(form.get('build')).toBe('7003');

    const file = form.get('report') as File;
    expect(file.name).toBe('junit.xml');
    expect(file.type).toBe('application/xml');
    expect(await file.text()).toBe('<testsuite failures="0"/>');
  });

  it('keeps several files under one field distinct', async () => {
    const form = await roundTrip(
      [],
      [
        { key: 'shots', attachment: att('a.png', 'image/png') },
        { key: 'shots', attachment: att('b.png', 'image/png') },
      ],
      { 'a.png': 'AAA', 'b.png': 'BBB' },
    );

    const all = form.getAll('shots') as File[];
    expect(all.map((f) => f.name)).toEqual(['a.png', 'b.png']);
    expect(await Promise.all(all.map((f) => f.text()))).toEqual(['AAA', 'BBB']);
  });

  it('survives a filename with a quote in it', async () => {
    // An unescaped quote would end the Content-Disposition parameter early and
    // the parser would read the rest of the name as something else.
    const form = await roundTrip([], [{ key: 'f', attachment: att('we"ird.xml') }], {
      'we"ird.xml': 'x',
    });
    expect((form.get('f') as File).name).toContain('ird.xml');
    expect(await (form.get('f') as File).text()).toBe('x');
  });

  it('carries bytes through unchanged, including a NUL and high bytes', async () => {
    const raw = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x2d, 0x2d, 0x41]);
    const { body, contentType } = multipartBody(
      [],
      [{ key: 'bin', attachment: att('b.bin', 'application/octet-stream') }],
      () => Promise.resolve(Readable.from(raw)),
    );
    const form = await new Response(Readable.toWeb(body) as unknown as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();

    // CRLF and `--` inside the payload must not be mistaken for a boundary.
    const got = Buffer.from(await (form.get('bin') as File).arrayBuffer());
    expect(got.equals(raw)).toBe(true);
  });

  it('sends an empty body with no parts at all', async () => {
    const form = await roundTrip([], [], {});
    expect([...form.keys()]).toEqual([]);
  });
});
