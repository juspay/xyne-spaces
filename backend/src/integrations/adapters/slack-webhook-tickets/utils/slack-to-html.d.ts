declare module '@clearfeed-ai/slack-to-html' {
  export interface ConversionOptions {
    users?: Record<string, string>;
    channels?: Record<string, string>;
    customEmoji?: Record<string, string>;
    usergroups?: Record<string, string>;
  }

  export function escapeForSlack(text: string, options?: ConversionOptions): string;
  export function escapeForSlackWithMarkdown(text: string, options?: ConversionOptions): string;
}
