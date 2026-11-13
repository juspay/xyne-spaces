import { describe, it, expect } from 'vitest';
import { attachDeliveryFiles } from './attach.js';
import { ATTACHMENT_JSON_SCHEMA } from '../common/attachment.js';
import type { DeliveryFile } from './types.js';

const file = (fieldName: string, name: string): DeliveryFile => ({
  fieldName,
  attachment: { name, mimeType: 'application/xml', handle: `mem://${name}`, size: 3 },
});

const contract = {
  type: 'object',
  properties: {
    result: { type: 'string' },
    report: ATTACHMENT_JSON_SCHEMA,
    screenshots: { type: 'array', items: ATTACHMENT_JSON_SCHEMA },
  },
};

describe('attachDeliveryFiles', () => {
  it('leaves a payload with no files exactly as it was', () => {
    const payload = { result: 'success' };
    expect(attachDeliveryFiles(payload, [], contract)).toBe(payload);
  });

  it('merges one file under its field name', () => {
    expect(attachDeliveryFiles({ result: 'success' }, [file('report', 'junit.xml')], contract))
      .toEqual({
        result: 'success',
        report: {
          name: 'junit.xml', mimeType: 'application/xml', handle: 'mem://junit.xml', size: 3,
        },
      });
  });

  it('gives a list to a field the contract declares as a list, even for one file', () => {
    const out = attachDeliveryFiles({}, [file('screenshots', 'a.png')], contract) as
      Record<string, unknown>;
    expect(Array.isArray(out['screenshots'])).toBe(true);
    expect((out['screenshots'] as unknown[]).length).toBe(1);
  });

  it('groups repeats under one field into a list', () => {
    const out = attachDeliveryFiles(
      {},
      [file('screenshots', 'a.png'), file('screenshots', 'b.png')],
      contract,
    ) as Record<string, unknown>;
    expect((out['screenshots'] as Array<{ name: string }>).map((a) => a.name))
      .toEqual(['a.png', 'b.png']);
  });

  it('keeps a file the contract never declared, for the contract check to reject', () => {
    const out = attachDeliveryFiles({}, [file('coverage', 'c.html')], contract) as
      Record<string, unknown>;
    // Merged, not dropped: `invalid` naming the field beats silence.
    expect(out['coverage']).toMatchObject({ name: 'c.html' });
  });
});
