import { createMachine, createActor, fromPromise, assign } from 'xstate';
import { emojiService } from '../services/Emoji/emojiService';
import { fetchEmojiBlobUrls } from '../services/clients/fileFetchService';

export interface CustomEmoji {
  id: string;
  name: string;
  emojiId: string; // Backend emoji ID
  imageUrl: string;
}

export interface EmojiPickerEmoji {
  id: string;
  names: string[];
  imgUrl: string;
}

interface EmojiContext {
  customEmojis: EmojiPickerEmoji[];
  emojiBlobUrls: Record<string, string>;
  error: string | null;
  isLoading: boolean;
}

interface FetchEmojisOutput {
  emojis: EmojiPickerEmoji[];
  blobUrls: Record<string, string>;
}

type EmojiEvent =
  | { type: 'FETCH_EMOJIS' }
  | { type: 'REFRESH_EMOJIS' }
  | { type: 'ADD_EMOJI'; emoji: CustomEmoji }
  | { type: 'DELETE_EMOJI'; emojiId: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'CLEANUP' };

export type EmojiState = 'idle' | 'loading' | 'loaded' | 'error';

export const emojiMachine = createMachine(
  {
    id: 'emojiMachine',
    initial: 'idle',
    types: {
      context: {} as EmojiContext,
      events: {} as EmojiEvent,
    },
    context: {
      customEmojis: [],
      emojiBlobUrls: {},
      error: null,
      isLoading: false,
    },
    states: {
      idle: {
        on: {
          FETCH_EMOJIS: 'loading',
          REFRESH_EMOJIS: 'loading',
        },
      },
      loading: {
        entry: assign(() => ({ isLoading: true, error: null })),
        invoke: {
          src: 'fetchCustomEmojis',
          onDone: {
            target: 'loaded',
            actions: assign(({ context, event }) => {
              const output = event.output as FetchEmojisOutput;
              const { emojis, blobUrls } = output;

              // Revoke old blob URLs
              Object.values(context.emojiBlobUrls).forEach(url => {
                try {
                  URL.revokeObjectURL(url);
                } catch {
                  // Ignore revoke errors
                }
              });

              return {
                ...context,
                customEmojis: emojis,
                emojiBlobUrls: blobUrls,
                isLoading: false,
                error: null,
              };
            }),
          },
          onError: {
            target: 'error',
            actions: assign(({ context }) => ({
              ...context,
              isLoading: false,
              error: 'Failed to fetch emojis',
            })),
          },
        },
      },
      loaded: {
        on: {
          REFRESH_EMOJIS: 'loading',
          ADD_EMOJI: 'loading',
          DELETE_EMOJI: 'loading',
          CLEAR_ERROR: {
            actions: assign({ error: null }),
          },
        },
      },
      error: {
        on: {
          REFRESH_EMOJIS: 'loading',
          CLEAR_ERROR: {
            actions: assign({ error: null }),
          },
          CLEANUP: {
            actions: 'cleanupBlobUrls',
          },
        },
      },
    },
  },
  {
    actions: {
      cleanupBlobUrls: ({ context }) => {
        Object.values(context.emojiBlobUrls).forEach(url => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // Ignore revoke errors
          }
        });
      },
    },

    actors: {
      fetchCustomEmojis: fromPromise(async () => {
        const response = await emojiService.getAllCustomEmojis();

        // Validate API response
        if (!response || !response.emojis) {
          throw new Error('Invalid API response: missing emojis data');
        }

        // Validate emojis array
        if (!Array.isArray(response.emojis)) {
          throw new Error('Invalid API response: emojis is not an array');
        }

        const urls = await fetchEmojiBlobUrls(response.emojis);

        const convertedEmojis: EmojiPickerEmoji[] = response.emojis
          .map(emoji => ({
            id: emoji.id,
            names: [emoji.name],
            imgUrl: urls[emoji.id],
          }))
          .filter((emoji): emoji is EmojiPickerEmoji => !!emoji.imgUrl);

        return {
          emojis: convertedEmojis,
          blobUrls: urls,
        };
      }),
    },
  },
);

export const emojiActor = createActor(emojiMachine).start();
