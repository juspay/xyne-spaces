import { replaceCustomEmojiShortcodesWithImg } from './customEmojiUtils';

// The repo returns whatever emoji names it "knows". We register `aws` and
// `tada` as existing custom emojis for the whole suite.
const KNOWN_EMOJIS: Record<string, { id: string; name: string }> = {
  aws: { id: 'cmqjxqfo100aq103oqxexk1os', name: 'aws' },
  tada: { id: 'emoji_tada_1', name: 'tada' },
};

jest.mock('@/database/repositories/customEmojiRepository', () => ({
  CustomEmojiRepository: class {
    async findManyByNames(names: string[]): Promise<Array<{ id: string; name: string }>> {
      return names.map((n) => KNOWN_EMOJIS[n]).filter(Boolean);
    }
  },
}));

const IMG = (name: string): string => {
  const { id } = KNOWN_EMOJIS[name];
  return `<img src="/api/emojis/${id}/stream" alt=":${name}:" title="${name}" data-emoji="true" data-emoji-id="${id}" class="inline-emoji">`;
};

describe('replaceCustomEmojiShortcodesWithImg', () => {
  it('replaces a real shortcode in normal prose', async () => {
    expect(await replaceCustomEmojiShortcodesWithImg('ship it :tada:')).toBe(`ship it ${IMG('tada')}`);
  });

  it('does NOT corrupt an ARN inside an inline code span (the reported bug)', async () => {
    const input = '`arn:aws:kms:ap-south-1:297984596149:key/6655bd8c`';
    // The :aws: inside the code span must be left untouched.
    expect(await replaceCustomEmojiShortcodesWithImg(input)).toBe(input);
  });

  it('does NOT corrupt an ARN inside a fenced code block', async () => {
    const input = '```\narn:aws:kms:ap-south-1:297984596149:key/abc\n```';
    expect(await replaceCustomEmojiShortcodesWithImg(input)).toBe(input);
  });

  it('does NOT substitute inside HTML <code> spans', async () => {
    const input = '<code>arn:aws:s3:::my-bucket</code>';
    expect(await replaceCustomEmojiShortcodesWithImg(input)).toBe(input);
  });

  it('replaces prose shortcodes but preserves code in the same message', async () => {
    const input = 'deploy done :tada: — key is `arn:aws:kms:ap-south-1:1:key/x`';
    const expected = `deploy done ${IMG('tada')} — key is \`arn:aws:kms:ap-south-1:1:key/x\``;
    expect(await replaceCustomEmojiShortcodesWithImg(input)).toBe(expected);
  });

  it('leaves unknown shortcodes untouched', async () => {
    expect(await replaceCustomEmojiShortcodesWithImg('hi :nonexistent:')).toBe('hi :nonexistent:');
  });

  it('returns empty/falsy content unchanged', async () => {
    expect(await replaceCustomEmojiShortcodesWithImg('')).toBe('');
  });
});
