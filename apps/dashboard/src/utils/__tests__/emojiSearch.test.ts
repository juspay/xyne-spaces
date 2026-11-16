import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emojiUsageToken, searchEmojis, unifiedToNative } from '../emojiSearch';
import type { EmojiPickerEmoji } from '../../hooks/useCustomEmojis';

/**
 * Trimmed stand-in for emoji-datasource: the array order here is the "dataset order" under
 * test. smirk sits 4th in the "smi" prefix tier and rocket/rock sit past the old
 * maxResults*3 early-exit window, so the legacy order and the full-scan behaviour are both
 * observable.
 */
const mockDataset = vi.hoisted(() => [
  { short_name: 'smiley', short_names: ['smiley'], unified: '1F603' },
  { short_name: 'smile', short_names: ['smile'], unified: '1F600' },
  { short_name: 'smiling_imp', short_names: ['smiling_imp'], unified: '1F608' },
  { short_name: 'smirk', short_names: ['smirk'], unified: '1F60F' },
  { short_name: 'kissing_smiling_eyes', short_names: ['kissing_smiling_eyes'], unified: '1F61A' },
  ...Array.from({ length: 28 }, (_, index) => ({
    short_name: `filler_${index}`,
    short_names: [`filler_${index}`],
    unified: (0x1f300 + index).toString(16).toUpperCase(),
  })),
  { short_name: 'rocket', short_names: ['rocket'], unified: '1F680' },
  { short_name: 'rock', short_names: ['rock'], unified: '1FA94' },
  { short_name: 'parrot', short_names: ['parrot'], unified: '1F9A9' },
]);

vi.mock('emoji-datasource/emoji.json', () => ({ default: mockDataset }));

const CUSTOM_EMOJIS: EmojiPickerEmoji[] = [
  { id: 'emo_1', names: ['party'], imgUrl: 'https://cdn/party.png' },
  { id: 'emo_2', names: ['parrot'], imgUrl: 'https://cdn/parrot.png' },
];

const names = (results: Awaited<ReturnType<typeof searchEmojis>>): string[] =>
  results.map(result => result.shortName);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchEmojis without usage ranks (legacy order)', () => {
  it('keeps the plain dataset order: custom, then prefix, then substring', async () => {
    const results = await searchEmojis('smi', [], 8);
    expect(names(results)).toEqual([
      'smiley',
      'smile',
      'smiling_imp',
      'smirk',
      'kissing_smiling_eyes',
    ]);
  });

  it('orders custom emojis by their store order', async () => {
    const results = await searchEmojis('par', CUSTOM_EMOJIS, 8);
    expect(names(results)).toEqual(['party', 'parrot', 'parrot']);
    expect(results[2]?.isCustom).toBe(false);
  });

  it('treats an empty rank map like no map at all', async () => {
    const results = await searchEmojis('smi', [], 8, new Map());
    expect(names(results)).toEqual([
      'smiley',
      'smile',
      'smiling_imp',
      'smirk',
      'kissing_smiling_eyes',
    ]);
  });
});

describe('searchEmojis with usage ranks', () => {
  it('floats the most used emoji to the top of its tier', async () => {
    // smirk (😏) is the user's most used emoji even though the dataset puts it 4th.
    const results = await searchEmojis('smi', [], 8, new Map([[unifiedToNative('1F60F'), 0]]));

    expect(names(results)).toEqual([
      'smirk',
      'smiley',
      'smile',
      'smiling_imp',
      'kissing_smiling_eyes',
    ]);
  });

  it('never promotes a substring match above prefix matches, whatever its rank', async () => {
    const results = await searchEmojis(
      'smi',
      [],
      8,
      new Map([
        [unifiedToNative('1F61A'), 0], // kissing_smiling_eyes, substring tier, most used
        [unifiedToNative('1F600'), 1], // smile
      ]),
    );

    // smile (rank 1) still leads its tier; the rank-0 substring match stays last.
    expect(names(results)).toEqual([
      'smile',
      'smiley',
      'smiling_imp',
      'smirk',
      'kissing_smiling_eyes',
    ]);
  });

  it('orders custom emojis by their custom:<id>:<name> token', async () => {
    const results = await searchEmojis(
      'par',
      CUSTOM_EMOJIS,
      8,
      new Map([
        ['custom:emo_2:parrot', 0],
        ['custom:emo_1:party', 1],
      ]),
    );

    expect(names(results)).toEqual(['parrot', 'party', 'parrot']);
    expect(results[2]?.isCustom).toBe(false);
  });

  it('keeps the custom tier above unicode matches even when only the unicode emoji is used', async () => {
    const results = await searchEmojis('par', CUSTOM_EMOJIS, 8, new Map([['🦜', 0]]));

    expect(names(results)).toEqual(['party', 'parrot', 'parrot']);
    expect(results[2]?.isCustom).toBe(false);
  });

  it('moves a frequently used emoji past the old maxResults*3 early-exit window', async () => {
    // rocket/rock sit at dataset indexes > 3*maxResults, where the old scan stopped.
    const ranked = await searchEmojis('roc', [], 8, new Map([[unifiedToNative('1FA94'), 0]]));
    expect(names(ranked)).toEqual(['rock', 'rocket']);
  });
});

describe('emojiUsageToken', () => {
  it('uses the reaction token format for custom emojis', () => {
    expect(
      emojiUsageToken({
        id: 'custom-emo_1',
        shortName: 'party',
        allNames: ['party'],
        customImgUrl: 'https://cdn/party.png',
        customEmojiId: 'emo_1',
        isCustom: true,
      }),
    ).toBe('custom:emo_1:party');
  });

  it('uses the native char for unicode emojis', () => {
    expect(
      emojiUsageToken({
        id: 'smile',
        shortName: 'smile',
        allNames: ['smile'],
        unified: '1F600',
        native: unifiedToNative('1F600'),
        isCustom: false,
      }),
    ).toBe('😀');
  });
});
